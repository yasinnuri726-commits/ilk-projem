"""FFmpeg / ffprobe sarmalayıcıları."""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Awaitable, Callable

from .core import StageError

_TIME = re.compile(rb"out_time_ms=(\d+)")


async def run(args: list[str], *, duration: float | None = None, on_progress: Callable[[float], Awaitable[None]] | None = None, timeout: float = 3600) -> str:
    """ffmpeg çalıştırır; `-progress pipe:1` çıktısından yüzde hesaplar. stderr'i döner."""
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "info", "-progress", "pipe:1", *args]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)

    async def pump() -> None:
        assert proc.stdout
        async for line in proc.stdout:
            m = _TIME.search(line)
            if m and duration and on_progress:
                await on_progress(min(99.0, int(m.group(1)) / 1e6 / duration * 100))

    async def drain() -> bytes:
        assert proc.stderr
        return await proc.stderr.read()

    try:
        _, err, code = await asyncio.wait_for(asyncio.gather(pump(), drain(), proc.wait()), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise StageError("FFMPEG_TIMEOUT", f"ffmpeg {timeout:.0f} sn içinde bitmedi")
    text = err.decode("utf-8", "replace")
    if code != 0:
        raise StageError("FFMPEG_FAILED", text[-1500:])
    return text


async def probe(src: str | Path) -> dict:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(src),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise StageError("UNSUPPORTED_MEDIA", f"Dosya okunamadı: {err.decode('utf-8', 'replace')[-400:]}", retryable=False)
    return json.loads(out)


def _fps(rate: str) -> float:
    try:
        n, d = rate.split("/")
        return round(float(n) / float(d), 3) if float(d) else 0.0
    except Exception:
        return 0.0


def media_info(data: dict) -> dict:
    """ffprobe çıktısını sade bir sözlüğe indirger. Döndürülmüş videolarda genişlik/yükseklik yer değiştirir."""
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic", 0) == 0), None)
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    fmt = data.get("format", {})
    width = int(video["width"]) if video else 0
    height = int(video["height"]) if video else 0
    rotation = 0
    if video:
        for sd in video.get("side_data_list", []):
            if "rotation" in sd:
                rotation = int(sd["rotation"])
        rotation = int(video.get("tags", {}).get("rotate", rotation))
    if abs(rotation) % 180 == 90:
        width, height = height, width
    return {
        "durationSec": float(fmt.get("duration") or (video or {}).get("duration") or (audio or {}).get("duration") or 0),
        "sizeBytes": int(fmt.get("size") or 0),
        "width": width,
        "height": height,
        "fps": _fps(video.get("avg_frame_rate", "0/1")) if video else 0.0,
        "videoCodec": video.get("codec_name") if video else None,
        "audioCodec": audio.get("codec_name") if audio else None,
        "hasVideo": video is not None,
        "hasAudio": audio is not None,
    }


_LOUD = re.compile(r"\{\s*\"input_i\".*?\}", re.S)


async def measure_loudness(src: str | Path) -> dict[str, float]:
    """EBU R128 ölçümü (loudnorm birinci geçiş)."""
    err = await run(["-i", str(src), "-vn", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"])
    m = _LOUD.search(err)
    if not m:
        raise StageError("LOUDNESS_FAILED", "Ses seviyesi ölçülemedi")
    j = json.loads(m.group(0))
    def f(k: str) -> float:
        try:
            return float(j[k])
        except (ValueError, KeyError):
            return -70.0  # sessiz ("-inf")
    return {"i": f("input_i"), "tp": f("input_tp"), "lra": f("input_lra"), "thresh": f("input_thresh")}


_BLACK = re.compile(r"black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)")


async def detect_black(src: str | Path) -> list[tuple[float, float]]:
    err = await run(["-i", str(src), "-an", "-vf", "blackdetect=d=0.3:pix_th=0.10", "-f", "null", "-"])
    return [(float(a), float(b)) for a, b, _ in _BLACK.findall(err)]
