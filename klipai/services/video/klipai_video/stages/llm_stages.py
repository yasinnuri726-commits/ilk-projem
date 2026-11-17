"""LLM tabanlı aşamalar: 4 — Puanlama, 6 — Özgünleştirme (yorum + TTS), 7 — Meta veri."""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .. import ffmpeg
from ..ai import llm, tts
from ..core import Ctx, StageError
from .candidates import split_sentences

PROMPT_VERSION = "score-2026-11"
BATCH = 8
WORDS_PER_SEC = {"tr": 2.3, "en": 2.7}


def clip_words(words: list[dict[str, Any]], start: float, end: float) -> list[dict[str, Any]]:
    """Klip aralığındaki kelimeler; zamanlar klip başlangıcına göre."""
    return [{**w, "s": round(max(0.0, w["s"] - start), 3), "e": round(min(end, w["e"]) - start, 3)} for w in words if w["e"] > start and w["s"] < end]


def timed_transcript(words: list[dict[str, Any]]) -> str:
    return "\n".join(f"[{s.start:.1f}] {s.text}" for s in split_sentences(words)) or "(no speech)"


# ═══════════════ 4 — Puanlama ═══════════════
class Reasons(BaseModel):
    hook: str
    emotion: str
    standalone: str
    curiosity: str
    shareability: str


class CandidateScore(BaseModel):
    id: str
    hook: int = Field(ge=0, le=100)
    emotion: int = Field(ge=0, le=100)
    standalone: int = Field(ge=0, le=100)
    curiosity: int = Field(ge=0, le=100)
    shareability: int = Field(ge=0, le=100)
    summary: str
    reasons: Reasons
    suggested_hook: str
    risks: list[str]


class ScoreBatch(BaseModel):
    scores: list[CandidateScore]


def format_excerpt(c: dict[str, Any]) -> str:
    f = c.get("features") or {}
    return (
        f"<excerpt id=\"{c['id']}\">\n"
        f"duration: {c['endSec'] - c['startSec']:.0f}s | speech rate: {f.get('wordsPerSec', '?')} words/s | "
        f"energy vs video average: {f.get('energyRatio', '?')}x | scene cuts: {f.get('sceneCuts', '?')} | "
        f"speakers: {f.get('speakerCount', '?')} | face on screen: {round(float(f.get('faceCoverage', 0)) * 100)}% | "
        f"ends on a pause: {'yes' if f.get('endsOnPause') else 'no'}\n"
        f"transcript: {c['text']}\n</excerpt>"
    )


def to_api_score(s: CandidateScore) -> dict[str, Any]:
    return {
        "id": s.id, "hook": s.hook, "emotion": s.emotion, "standalone": s.standalone, "curiosity": s.curiosity, "shareability": s.shareability,
        "rationale": {"summary": s.summary, **s.reasons.model_dump(), "suggestedHook": s.suggested_hook[:80], "risks": s.risks},
    }


async def score(ctx: Ctx) -> dict[str, Any]:
    p = ctx.payload
    candidates: list[dict[str, Any]] = p["candidates"]
    language = llm.language_name(p.get("language"))
    insights_block = llm.render("learning", insights=p["insights"]) if p.get("insights") else ""
    batches = [candidates[i: i + BATCH] for i in range(0, len(candidates), BATCH)]
    done = 0
    sem = asyncio.Semaphore(4)

    async def one(batch: list[dict[str, Any]]) -> list[CandidateScore]:
        nonlocal done
        async with sem:
            out = await llm.parse(
                ctx, "score", ScoreBatch,
                language=language, video_title=p.get("videoTitle", ""), channel_title=p.get("channelTitle", ""),
                insights_block=insights_block, excerpts="\n\n".join(format_excerpt(c) for c in batch),
            )
        done += 1
        await ctx.progress(done / len(batches) * 100)
        ids = {c["id"] for c in batch}
        return [s for s in out.scores if s.id in ids]  # modelin uydurduğu kimlikler atılır

    results = await asyncio.gather(*(one(b) for b in batches))
    scores = {s.id: s for batch in results for s in batch}
    if len(scores) < len(candidates) * 0.5:
        raise StageError("SCORE_INCOMPLETE", f"{len(candidates)} adaydan yalnızca {len(scores)} tanesi puanlandı")
    return {"scores": [to_api_score(s) for s in scores.values()], "promptVersion": PROMPT_VERSION}


# ═══════════════ 6 — Özgünleştirme ═══════════════
class CommentaryLine(BaseModel):
    at_sec: float = Field(ge=0)
    text: str


class Commentary(BaseModel):
    lines: list[CommentaryLine]


_LINE = re.compile(r"^\s*\[(\d+(?:\.\d+)?)\]\s*(.+)$")


def script_to_lines(script: str) -> list[dict[str, Any]]:
    """Düzenlenebilir metin biçimi: her satır `[saniye] metin`. Zaman damgasız satır 0. saniyeye konur."""
    out = []
    for raw in script.splitlines():
        if not raw.strip():
            continue
        m = _LINE.match(raw)
        out.append({"at": float(m.group(1)), "text": m.group(2).strip()} if m else {"at": 0.0, "text": raw.strip()})
    return sorted(out, key=lambda l: l["at"])


def lines_to_script(lines: list[dict[str, Any]]) -> str:
    return "\n".join(f"[{l['at']:.1f}] {l['text']}" for l in lines)


def layout_lines(lines: list[dict[str, Any]], durations: list[float], clip_duration: float, gap: float = 0.3) -> list[dict[str, Any]]:
    """Seslendirme satırlarını üst üste binmeyecek ve klip dışına taşmayacak şekilde yerleştirir."""
    placed: list[dict[str, Any]] = []
    cursor = 0.0
    for line, dur in zip(lines, durations):
        at = max(line["at"], cursor)
        if at + dur > clip_duration:  # sona sığmıyorsa geri çek; yine sığmıyorsa satır atlanır
            at = max(cursor, clip_duration - dur)
            if at + dur > clip_duration + 0.05:
                continue
        placed.append({"at": round(at, 2), "text": line["text"], "durationSec": round(dur, 2)})
        cursor = at + dur + gap
    return placed


async def commentary(ctx: Ctx) -> dict[str, Any]:
    p = ctx.payload
    start, end = float(p["startSec"]), float(p["endSec"])
    clip_dur = end - start
    lang = (p.get("language") or "tr")[:2]
    wps = WORDS_PER_SEC.get(lang, 2.4)
    max_sec = min(float(p["maxSec"]), clip_dur * 0.5)

    if p.get("script"):
        lines = script_to_lines(p["script"])  # kullanıcı metni düzenlemiş: yalnızca yeniden seslendirilir
    else:
        words = clip_words(ctx.storage.get_json(p["wordsKey"]), start, end)
        custom = f"\nAdditional instructions from the channel owner (follow them unless they conflict with the rules above):\n{p['customPrompt']}\n" if p.get("customPrompt") else ""
        out = await llm.parse(
            ctx, f"commentary_{p['format'].lower()}", Commentary, max_tokens=2000,
            tone={"FUNNY": "funny, playful, quick", "SERIOUS": "serious, measured, direct", "INFORMATIVE": "informative, clear, curious"}[p["tone"]],
            max_sec=f"{max_sec:.0f}", words_per_sec=wps, max_words=int(max_sec * wps), language=llm.language_name(lang),
            custom_block=custom, clip_duration=f"{clip_dur:.1f}", video_title=p.get("videoTitle", ""), transcript=timed_transcript(words),
        )
        lines = sorted(({"at": min(l.at_sec, clip_dur), "text": l.text.strip()} for l in out.lines if l.text.strip()), key=lambda l: l["at"])
    if not lines:
        raise StageError("COMMENTARY_EMPTY", "Yorum metni üretilemedi")
    await ctx.progress(40)

    # Her satır ayrı seslendirilir; süreleri ölçülüp tek bir ses izine yerleştirilir.
    files: list[Path] = []
    durations: list[float] = []
    for i, line in enumerate(lines):
        f = ctx.workdir / f"tts_{i}.mp3"
        await tts.synthesize(ctx, line["text"], f, voice=p["tts"]["voice"], speed=float(p["tts"]["speed"]))
        files.append(f)
        durations.append(ffmpeg.media_info(await ffmpeg.probe(f))["durationSec"])
        await ctx.progress(40 + 40 * (i + 1) / len(lines))
    placed = layout_lines(lines, durations, clip_dur)
    if not placed:
        raise StageError("COMMENTARY_TOO_LONG", "Seslendirme klibe sığmadı", retryable=False)
    kept = [files[lines.index(next(l for l in lines if l["text"] == pl["text"]))] for pl in placed]

    track = ctx.workdir / "commentary.wav"
    inputs: list[str] = []
    for f in kept:
        inputs += ["-i", str(f)]
    delays = ";".join(f"[{i}:a]aresample=48000,adelay={int(pl['at'] * 1000)}:all=1[a{i}]" for i, pl in enumerate(placed))
    mix = "".join(f"[a{i}]" for i in range(len(placed))) + f"amix=inputs={len(placed)}:normalize=0,apad=whole_dur={clip_dur:.3f}[out]"
    await ffmpeg.run([*inputs, "-filter_complex", f"{delays};{mix}", "-map", "[out]", "-t", f"{clip_dur:.3f}", "-ac", "1", "-ar", "48000", str(track)])
    key = ctx.storage.upload(track, ctx.clip_key("commentary.wav"), "audio/wav")
    return {"script": lines_to_script(placed), "audioKey": key, "placements": placed}


# ═══════════════ 7 — Meta veri ═══════════════
class Metadata(BaseModel):
    titles: list[str] = Field(min_length=3, max_length=3)
    description: str
    tags: list[str]
    hashtags: list[str]
    thumbnail_text: str


def clean_tag(t: str) -> str:
    return re.sub(r"\s+", " ", t.replace("#", "").replace(",", " ")).strip().lower()[:40]


def clean_hashtag(t: str) -> str:
    return re.sub(r"[^\w]", "", t, flags=re.UNICODE)[:40]


async def metadata(ctx: Ctx) -> dict[str, Any]:
    from ..render.compose import make_thumbnail

    p = ctx.payload
    result: dict[str, Any] = {}
    thumb_text = (p.get("hookText") or p.get("currentTitle") or "")[:40]

    if not p.get("thumbnailOnly"):
        words = clip_words(ctx.storage.get_json(p["wordsKey"]), float(p["startSec"]), float(p["endSec"]))
        fixed = [clean_tag(t) for t in p.get("fixedTags", [])]
        out = await llm.parse(
            ctx, "metadata", Metadata, max_tokens=3000,
            title_language=llm.language_name(p.get("titleLanguage")), video_title=p.get("videoTitle", ""), channel_title=p.get("channelTitle", ""),
            hook_text=p.get("hookText") or "(none)", commentary=p.get("commentaryScript") or "(none)", fixed_tags=", ".join(fixed) or "(none)",
            insights_block=llm.render("learning", insights=p["insights"]) if p.get("insights") else "",
            instruction_block=f"\nThe channel owner asked for this change to the previous version: {p['instruction']}\n" if p.get("instruction") else "",
            transcript=" ".join(w["w"].strip() for w in words) or "(no speech)",
        )
        tags = list(dict.fromkeys(t for t in (clean_tag(x) for x in out.tags) if t and t not in fixed))[:15]
        result = {
            "titles": [t.strip()[:100] for t in out.titles],
            "description": out.description.strip()[:4500],
            "tags": tags,
            "hashtags": list(dict.fromkeys(h for h in (clean_hashtag(x) for x in out.hashtags) if h))[:5],
        }
        thumb_text = out.thumbnail_text.strip()[:40] or thumb_text
    await ctx.progress(60)

    if p.get("frameKey"):
        frame = ctx.storage.download(p["frameKey"], ctx.workdir / "frame.jpg")
        thumb = await make_thumbnail(frame, ctx.workdir / "thumb.jpg", thumb_text, int(p["width"]), int(p["height"]))
        result["thumbnailKey"] = ctx.storage.upload(thumb, ctx.clip_key("thumb.jpg"), "image/jpeg")
    return result
