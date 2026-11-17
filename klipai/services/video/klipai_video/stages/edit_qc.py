"""Aşama 5 — Kurgu ve Aşama 8 — Kalite kontrol."""
from __future__ import annotations

import asyncio
import hashlib
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .. import ffmpeg
from ..ai import llm
from ..core import Ctx, StageError, settings
from ..render import compose, crop, subtitles
from .candidates import split_sentences
from .llm_stages import clip_words


class Translation(BaseModel):
    lines: list[str]


async def translate_subtitles(ctx: Ctx, words: list[dict[str, Any]], source: str, target: str) -> list[dict[str, Any]]:
    """Altyazı çevirisi: cümle cümle çevrilir, zamanlama cümle süresine yayılır."""
    sentences = split_sentences([{"w": w["text"], "s": w["start"], "e": w["end"]} for w in words])
    if not sentences:
        return words
    out = await llm.parse(
        ctx, "translate", Translation, max_tokens=6000,
        target_language=llm.language_name(target), source_language=llm.language_name(source),
        lines="\n".join(f"{i + 1}. {s.text}" for i, s in enumerate(sentences)),
    )
    if len(out.lines) != len(sentences):
        raise StageError("TRANSLATION_MISMATCH", "Çeviri satır sayısı uyuşmadı")
    return subtitles.retime_translation([{"start": s.start, "end": s.end} for s in sentences], out.lines)


def pick_music(keys: list[str], seed: str) -> str | None:
    """Türe ait parçalardan klip kimliğine göre kararlı bir seçim (aynı klip yeniden kurgulanınca müzik değişmez)."""
    tracks = sorted(k for k in keys if k.lower().endswith((".mp3", ".m4a", ".wav")))
    return tracks[int(hashlib.sha256(seed.encode()).hexdigest(), 16) % len(tracks)] if tracks else None


async def _fetch(ctx: Ctx, key: str | None, name: str) -> Path | None:
    if not key:
        return None
    return await asyncio.to_thread(ctx.storage.download, key, ctx.workdir / f"{name}{Path(key).suffix}")


async def edit(ctx: Ctx) -> dict[str, Any]:
    p = ctx.payload
    start, end = float(p["startSec"]), float(p["endSec"])
    duration = end - start
    out_w, out_h = int(p["width"]), int(p["height"])
    spec: dict[str, Any] = p["editSpec"]
    style, audio, brand = p["subtitleStyle"], p["audio"], p["brand"]
    get = ctx.storage.get_json

    all_words, faces, scenes, energy = await asyncio.gather(
        asyncio.to_thread(get, p["wordsKey"]), asyncio.to_thread(get, p["facesKey"]), asyncio.to_thread(get, p["scenesKey"]), asyncio.to_thread(get, p["audioEnergyKey"]),
    )
    await ctx.progress(5)

    # ── Kurgu tarifini tamamla: kullanıcı doldurmadıysa otomatik değerler yazılır ve API'ye geri döner ──
    mode = spec["crop"].get("mode", "AUTO_FACE")
    if mode == "AUTO_FACE" or (mode == "MANUAL" and not spec["crop"].get("keyframes")):
        spec["crop"]["keyframes"] = crop.face_keyframes(faces, start, end)
    elif mode == "CENTER":
        spec["crop"]["keyframes"] = [{"t": 0.0, "x": 0.5, "y": 0.5, "scale": 1.0}]
    if not spec["subtitles"].get("words"):
        spec["subtitles"]["words"] = [{"start": w["s"], "end": w["e"], "text": w["w"]} for w in clip_words(all_words, start, end)]
        target = style.get("translateTo")
        if target and target != p.get("language"):
            spec["subtitles"]["words"] = await translate_subtitles(ctx, spec["subtitles"]["words"], p.get("language") or "tr", target)
    if spec.get("autoEffects", True) and not spec.get("effects"):
        spec["effects"] = crop.auto_effects(energy, scenes, start, end)
    await ctx.progress(12)

    ass_path = None
    if (spec["subtitles"].get("enabled", True) and spec["subtitles"]["words"]) or spec["hook"].get("text") or p.get("watermarked"):
        ass_path = ctx.workdir / "subs.ass"
        ass_path.write_text(
            subtitles.build_ass(
                spec["subtitles"]["words"] if spec["subtitles"].get("enabled", True) else [],
                width=out_w, height=out_h, duration=duration, style=style, hook=spec["hook"],
                watermark="KlipAI" if p.get("watermarked") else None,
            ),
            encoding="utf-8",
        )

    # ── Yardımcı girdiler ──
    commentary = await _fetch(ctx, (p.get("commentary") or {}).get("audioKey"), "commentary")
    logo = await _fetch(ctx, brand.get("logoKey"), "logo")
    mark = await _fetch(ctx, brand.get("watermarkKey"), "mark")
    music = None
    music_key = spec["music"].get("trackId")
    if not music_key and audio.get("musicGenre") not in (None, "", "none"):
        music_key = pick_music(await asyncio.to_thread(ctx.storage.list_keys, f"music/{audio['musicGenre']}/"), ctx.clip_id or ctx.job_id)
        spec["music"]["trackId"] = music_key
    if music_key:
        music = await _fetch(ctx, music_key, "music")

    plan = compose.RenderPlan(
        source=ctx.storage.sign_get(p["sourceKey"]), start=start, duration=duration,
        src_w=int(p["sourceWidth"]), src_h=int(p["sourceHeight"]), out_w=out_w, out_h=out_h,
        keyframes=spec["crop"]["keyframes"], effects=spec.get("effects", []), ass_path=ass_path, fonts_dir=settings().font_dir,
        commentary=commentary, commentary_format=(p.get("commentary") or {}).get("format", "NONE"),
        music=music, music_db=float(spec["music"].get("levelDb", audio.get("musicLevelDb", -22))), ducking=bool(spec["music"].get("ducking", True)),
        logo=logo, watermark_image=mark,
    )
    main = ctx.workdir / "main.mp4"
    started = time.monotonic()

    async def on_progress(pct: float) -> None:
        await ctx.progress(15 + pct * 0.7)

    await ffmpeg.run(compose.build_command(plan, main), duration=duration, on_progress=on_progress, timeout=900)

    # ── Marka giriş/çıkışı ──
    output = main
    intro, outro = await _fetch(ctx, brand.get("introKey"), "intro"), await _fetch(ctx, brand.get("outroKey"), "outro")
    if intro or outro:
        parts: list[Path] = []
        if intro:
            parts.append(await compose.normalize_segment(intro, ctx.workdir / "intro_n.mp4", out_w, out_h))
        parts.append(main)
        if outro:
            parts.append(await compose.normalize_segment(outro, ctx.workdir / "outro_n.mp4", out_w, out_h))
        output = await compose.concat(parts, ctx.workdir / "final.mp4")
    if settings().video_encoder == "h264_nvenc":
        ctx.add_gpu_usage(time.monotonic() - started)
    await ctx.progress(90)

    # Kapak için kare: ilk çeyrekte, kanca yazısı kaybolduktan sonra.
    frame = ctx.workdir / "frame.jpg"
    intro_dur = ffmpeg.media_info(await ffmpeg.probe(ctx.workdir / "intro_n.mp4"))["durationSec"] if intro else 0.0
    await ffmpeg.run(["-ss", f"{intro_dur + min(duration * 0.25, max(2.5, duration - 1)):.2f}", "-i", str(output), "-frames:v", "1", "-q:v", "2", str(frame)])

    info = ffmpeg.media_info(await ffmpeg.probe(output))
    loud = await ffmpeg.measure_loudness(output)
    out_key, frame_key = await asyncio.gather(
        asyncio.to_thread(ctx.storage.upload, output, ctx.clip_key("output.mp4"), "video/mp4"),
        asyncio.to_thread(ctx.storage.upload, frame, ctx.clip_key("frame.jpg"), "image/jpeg"),
    )
    return {"outputKey": out_key, "frameKey": frame_key, "durationSec": round(info["durationSec"], 3), "sizeBytes": output.stat().st_size, "loudnessLufs": round(loud["i"], 2), "editSpec": spec}


# ═══════════════ 8 — Kalite kontrol ═══════════════
LOUDNESS_TOLERANCE = 1.0


def evaluate(info: dict[str, Any], loud_i: float, black: list[tuple[float, float]], overflow: list[str], p: dict[str, Any]) -> list[dict[str, Any]]:
    """Denetim raporu (saf fonksiyon). `fixable` olanlar otomatik düzeltilir, diğerleri işaretlenir."""
    dur = info["durationSec"]
    black_total = sum(b - a for a, b in black)
    return [
        {"check": "DURATION", "passed": float(p["minDurationSec"]) <= dur <= float(p["maxDurationSec"]), "value": f"{dur:.1f}s", "fixable": False},
        {"check": "RESOLUTION", "passed": info["width"] == int(p["width"]) and info["height"] == int(p["height"]), "value": f"{info['width']}x{info['height']}", "fixable": False},
        {"check": "LOUDNESS", "passed": abs(loud_i - compose.TARGET_LUFS) <= LOUDNESS_TOLERANCE, "value": f"{loud_i:.1f} LUFS", "fixable": loud_i > -50},
        {"check": "SUBTITLE_OVERFLOW", "passed": not overflow, "value": ", ".join(overflow[:5]) or "-", "fixable": False},
        # Kısa geçiş karartmaları normaldir; toplamı 1 saniyeyi ya da klibin %10'unu aşan siyahlık hatadır.
        {"check": "BLACK_FRAMES", "passed": black_total <= max(1.0, dur * 0.1), "value": f"{black_total:.1f}s", "fixable": False},
    ]


async def qc(ctx: Ctx) -> dict[str, Any]:
    p = ctx.payload
    src = await asyncio.to_thread(ctx.storage.download, p["outputKey"], ctx.workdir / "output.mp4")
    info = ffmpeg.media_info(await ffmpeg.probe(src))
    loud = await ffmpeg.measure_loudness(src)
    await ctx.progress(40)
    black = await ffmpeg.detect_black(src)
    subs = p.get("subtitles") or {}
    font_px = float(subs.get("fontSize", 72)) * int(p["width"]) / subtitles.REF_WIDTH
    overflow = subtitles.overflow_report(subs.get("words") or [], font_px, int(p["width"])) if subs.get("enabled") else []
    report = evaluate(info, loud["i"], black, overflow, p)
    await ctx.progress(60)

    result: dict[str, Any] = {"loudnessLufs": round(loud["i"], 2), "durationSec": round(info["durationSec"], 3), "sizeBytes": src.stat().st_size}
    fixed_any = False
    for item in report:
        item["fixed"] = False
        if item["passed"] or not item["fixable"]:
            continue
        if item["check"] == "LOUDNESS":
            # Görüntüye dokunmadan ses, ölçülen değerlerle ikinci geçiş loudnorm'dan geçirilir.
            fixed = ctx.workdir / "output_qc.mp4"
            af = f"loudnorm=I={compose.TARGET_LUFS}:TP=-1.5:LRA=11:measured_I={loud['i']}:measured_TP={loud['tp']}:measured_LRA={loud['lra']}:measured_thresh={loud['thresh']}:linear=true,aresample=48000"
            await ffmpeg.run(["-i", str(src), "-c:v", "copy", "-af", af, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(fixed)])
            after = await ffmpeg.measure_loudness(fixed)
            if abs(after["i"] - compose.TARGET_LUFS) <= LOUDNESS_TOLERANCE:
                item.update(fixed=True, value=f"{loud['i']:.1f} → {after['i']:.1f} LUFS")
                result.update(outputKey=await asyncio.to_thread(ctx.storage.upload, fixed, ctx.clip_key("output_qc.mp4"), "video/mp4"), loudnessLufs=round(after["i"], 2), sizeBytes=fixed.stat().st_size)
                fixed_any = True
    for item in report:
        item.pop("fixable")
    unresolved = [i for i in report if not i["passed"] and not i["fixed"]]
    result["status"] = "FLAGGED" if unresolved else "AUTO_FIXED" if fixed_any else "PASSED"
    result["report"] = report
    return result
