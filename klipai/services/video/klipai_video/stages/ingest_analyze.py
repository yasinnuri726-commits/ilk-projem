"""Aşama 1 — Alım ve Aşama 2 — Analiz."""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import socket
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .. import ffmpeg
from ..ai import analysis
from ..core import Ctx, StageError

MAX_DURATION_SEC = 6 * 3600
MAX_LINK_BYTES = 20 * 1024**3
EXT = (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".mp3", ".wav", ".m4a")


def assert_public_host(host: str) -> None:
    """SSRF koruması: ad çözümlenir ve tüm adreslerin genel ağda olduğu doğrulanır."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise StageError("LINK_UNREACHABLE", f"Adres çözümlenemedi: {host}", retryable=False) from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise StageError("LINK_FORBIDDEN", "Bu adrese erişime izin verilmiyor", retryable=False)


async def download_link(url: str, dest: Path, ctx: Ctx) -> None:
    """Doğrudan medya bağlantısını indirir. Yönlendirmeler elle izlenir; her adım yeniden denetlenir."""
    import httpx

    async with httpx.AsyncClient(timeout=httpx.Timeout(30, read=120), follow_redirects=False) as http:
        for _ in range(5):
            u = urlparse(url)
            if u.scheme != "https" or not u.hostname:
                raise StageError("LINK_FORBIDDEN", "Yalnızca https bağlantıları kabul edilir", retryable=False)
            await asyncio.to_thread(assert_public_host, u.hostname)
            async with http.stream("GET", url) as r:
                if r.status_code in (301, 302, 303, 307, 308):
                    url = str(r.next_request.url) if r.next_request else r.headers["location"]
                    continue
                if r.status_code >= 400:
                    raise StageError("LINK_UNREACHABLE", f"Kaynak {r.status_code} döndü", retryable=r.status_code >= 500)
                ctype = r.headers.get("content-type", "").split(";")[0]
                if not (ctype.startswith(("video/", "audio/")) or ctype == "application/octet-stream"):
                    raise StageError("UNSUPPORTED_MEDIA", f"Bağlantı bir medya dosyası değil ({ctype or 'bilinmiyor'})", retryable=False)
                total = int(r.headers.get("content-length") or 0)
                if total > MAX_LINK_BYTES:
                    raise StageError("UPLOAD_TOO_LARGE", "Dosya 20 GB sınırını aşıyor", retryable=False)
                got = 0
                with dest.open("wb") as f:
                    async for chunk in r.aiter_bytes(1024 * 1024):
                        got += len(chunk)
                        if got > MAX_LINK_BYTES:
                            raise StageError("UPLOAD_TOO_LARGE", "Dosya 20 GB sınırını aşıyor", retryable=False)
                        f.write(chunk)
                        if total:
                            await ctx.progress(got / total * 30)
                return
    raise StageError("LINK_UNREACHABLE", "Çok fazla yönlendirme", retryable=False)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


async def ingest(ctx: Ctx) -> dict[str, Any]:
    src = ctx.payload["source"]
    if src["type"] == "UPLOAD":
        ext = Path(src["storageKey"]).suffix.lower() or ".mp4"
        local = ctx.workdir / f"source{ext}"
        await asyncio.to_thread(ctx.storage.download, src["storageKey"], local)
        storage_key = src["storageKey"]
    else:
        ext = Path(urlparse(src["url"]).path).suffix.lower()
        if ext not in EXT:
            raise StageError("UNSUPPORTED_MEDIA", "Bağlantı doğrudan bir medya dosyasına işaret etmeli", retryable=False)
        local = ctx.workdir / f"source{ext}"
        await download_link(src["url"], local, ctx)
        storage_key = await asyncio.to_thread(ctx.storage.upload, local, ctx.project_key(f"source{ext}"), "application/octet-stream")
    await ctx.progress(30)

    info = ffmpeg.media_info(await ffmpeg.probe(local))
    if not info["hasAudio"]:
        raise StageError("NO_AUDIO", "Kaynakta ses izi yok; transkript çıkarılamaz", retryable=False)
    if info["durationSec"] < 30:
        raise StageError("TOO_SHORT", "Kaynak en az 30 saniye olmalı", retryable=False)
    if info["durationSec"] > MAX_DURATION_SEC:
        raise StageError("TOO_LONG", "Kaynak en çok 6 saat olabilir", retryable=False)
    dur = info["durationSec"]

    # Analiz için hafif kopyalar: 720p proxy (sahne/yüz) ve 16 kHz mono ses (transkript). Tek ffmpeg geçişi.
    proxy, audio, thumb = ctx.workdir / "proxy.mp4", ctx.workdir / "audio.wav", ctx.workdir / "thumb.jpg"
    args = ["-i", str(local)]
    if info["hasVideo"]:
        args += ["-map", "0:v:0", "-map", "0:a:0", "-vf", "scale=-2:'min(720,ih)',fps=25", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-g", "50",
                 "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(proxy)]
    else:  # yalnızca ses (podcast): proxy siyah zeminli video olur ki sonraki aşamalar tek biçimle çalışsın
        args = ["-f", "lavfi", "-i", "color=c=black:s=1280x720:r=25", "-i", str(local), "-shortest", "-map", "0:v", "-map", "1:a:0",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "32", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(proxy)]
    args += ["-map", f"{'1' if not info['hasVideo'] else '0'}:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio)]

    async def on_progress(p: float) -> None:
        await ctx.progress(30 + p * 0.6)

    await ffmpeg.run(args, duration=dur, on_progress=on_progress, timeout=1800)
    await ffmpeg.run(["-ss", f"{dur * 0.1:.2f}", "-i", str(proxy), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", str(thumb)])

    out_source = storage_key
    if not info["hasVideo"]:
        # Ses kaynaklarında kurgu aşaması görüntü olarak proxy'yi kullanır.
        out_source = await asyncio.to_thread(ctx.storage.upload, proxy, ctx.project_key("source_video.mp4"), "video/mp4")
        info["width"], info["height"], info["fps"], info["videoCodec"] = 1280, 720, 25.0, "h264"
    keys = await asyncio.gather(
        asyncio.to_thread(ctx.storage.upload, proxy, ctx.project_key("proxy.mp4"), "video/mp4"),
        asyncio.to_thread(ctx.storage.upload, audio, ctx.project_key("audio.wav"), "audio/wav"),
        asyncio.to_thread(ctx.storage.upload, thumb, ctx.project_key("thumb.jpg"), "image/jpeg"),
        asyncio.to_thread(sha256_file, local),
    )
    return {
        "storageKey": out_source, "proxyKey": keys[0], "audioKey": keys[1], "thumbnailKey": keys[2], "checksumSha256": keys[3],
        "durationSec": dur, "width": info["width"], "height": info["height"], "fps": info["fps"],
        "videoCodec": info["videoCodec"], "audioCodec": info["audioCodec"], "sizeBytes": info["sizeBytes"] or local.stat().st_size,
    }


async def analyze(ctx: Ctx) -> dict[str, Any]:
    p = ctx.payload
    proxy = ctx.workdir / "proxy.mp4"
    audio = ctx.workdir / "audio.wav"
    await asyncio.gather(asyncio.to_thread(ctx.storage.download, p["proxyKey"], proxy), asyncio.to_thread(ctx.storage.download, p["audioKey"], audio))
    await ctx.progress(5)

    # Transkript GPU'da, sahne/yüz/enerji CPU'da eşzamanlı çalışır; toplam süreyi en yavaş kol belirler.
    started = time.monotonic()
    done = 0

    async def tracked(fn, *args):
        nonlocal done
        res = await asyncio.to_thread(fn, *args)
        done += 1
        await ctx.progress(5 + done / 5 * 85)
        return res

    transcript, turns, scenes, faces, energy = await asyncio.gather(
        tracked(analysis.transcribe, audio, p.get("languageHint")),
        tracked(analysis.diarize, audio),
        tracked(analysis.detect_scenes, proxy),
        tracked(analysis.detect_faces, proxy),
        tracked(analysis.audio_energy, audio),
    )
    ctx.add_gpu_usage(time.monotonic() - started)

    words, segments = transcript["words"], transcript["segments"]
    if not words:
        raise StageError("NO_SPEECH", "Videoda konuşma bulunamadı", retryable=False)
    speakers = analysis.assign_speakers(words, segments, turns)

    put = ctx.storage.put_json
    words_key, scenes_key, energy_key, faces_key = await asyncio.gather(
        asyncio.to_thread(put, ctx.project_key("analysis/words.json"), words),
        asyncio.to_thread(put, ctx.project_key("analysis/scenes.json"), scenes),
        asyncio.to_thread(put, ctx.project_key("analysis/energy.json"), energy),
        asyncio.to_thread(put, ctx.project_key("analysis/faces.json"), faces),
    )
    return {
        "language": transcript["language"], "text": " ".join(s["text"] for s in segments)[:200_000], "segments": segments, "speakers": speakers,
        "wordCount": len(words), "wordsKey": words_key, "scenesKey": scenes_key, "audioEnergyKey": energy_key, "facesKey": faces_key,
    }
