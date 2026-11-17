"""Aşama 3 — Aday üretimi: 15-90 sn arası, cümle ortasında kesilmeyen kesitler.

Girdi: kelime zaman damgaları, sahne kesimleri, ses enerjisi.
Yöntem: kelimeler cümlelere ayrılır; her cümle başlangıcından, süre aralığına uyan cümle sonlarına kadar
pencereler kurulur; pencereler sezgisel bir ön puanla sıralanır ve çakışanlar elenir (NMS).
Buradaki ön puan yalnızca LLM'e gidecek aday sayısını sınırlar; nihai puanı LLM verir.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..core import Ctx, StageError

SENTENCE_END = (".", "!", "?", "…", "。", "？", "！")
PAUSE_SPLIT = 0.7  # noktalama yoksa bu kadar sessizlik cümle sonu sayılır
MAX_SENTENCE_SEC = 25.0  # noktalamasız uzun konuşmalarda zorunlu bölme (duraklamada)
PAD_START = 0.15
PAD_END = 0.30


@dataclass
class Sentence:
    start: float
    end: float
    text: str
    speakers: set[str]
    gap_after: float = 0.0


def split_sentences(words: list[dict[str, Any]]) -> list[Sentence]:
    out: list[Sentence] = []
    cur: list[dict[str, Any]] = []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        gap = (nxt["s"] - w["e"]) if nxt else 99.0
        long = w["e"] - cur[0]["s"] >= MAX_SENTENCE_SEC and gap >= 0.25
        speaker_change = bool(nxt and w.get("spk") and nxt.get("spk") and w["spk"] != nxt["spk"])
        if w["w"].strip().endswith(SENTENCE_END) or gap >= PAUSE_SPLIT or long or speaker_change or nxt is None:
            out.append(Sentence(cur[0]["s"], w["e"], " ".join(x["w"].strip() for x in cur).strip(), {x["spk"] for x in cur if x.get("spk")}, 0.0 if nxt is None else max(0.0, gap)))
            cur = []
    return out


def _mean_energy(energy: dict[str, Any] | None, start: float, end: float) -> float:
    if not energy or not energy.get("rms"):
        return 0.0
    hop = energy["hop"]
    seg = energy["rms"][int(start / hop): max(int(start / hop) + 1, int(end / hop))]
    return sum(seg) / len(seg) if seg else 0.0


def _face_coverage(faces: dict[str, Any] | None, start: float, end: float) -> float:
    if not faces or not faces.get("frames"):
        return 0.0
    frames = [f for f in faces["frames"] if start <= f["t"] <= end]
    return sum(1 for f in frames if f["faces"]) / len(frames) if frames else 0.0


def iou(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = max(a[1], b[1]) - min(a[0], b[0])
    return inter / union if union > 0 else 0.0


def generate(
    words: list[dict[str, Any]],
    scenes: list[float],
    energy: dict[str, Any] | None,
    faces: dict[str, Any] | None,
    *,
    min_sec: float,
    max_sec: float,
    max_candidates: int,
    duration: float,
) -> list[dict[str, Any]]:
    sentences = split_sentences(words)
    if not sentences:
        return []
    global_energy = _mean_energy(energy, 0, duration) or 1e-9
    windows: list[dict[str, Any]] = []

    for i, first in enumerate(sentences):
        per_start: list[dict[str, Any]] = []
        for j in range(i, len(sentences)):
            last = sentences[j]
            dur = last.end - first.start
            if dur > max_sec:
                break
            if dur < min_sec:
                continue
            n_words = sum(len(s.text.split()) for s in sentences[i: j + 1])
            wps = n_words / dur
            energy_ratio = _mean_energy(energy, first.start, last.end) / global_energy
            # Temiz bitiş: sondan sonra duraklama ya da sahne kesimi varsa klip "tamamlanmış" hisseder.
            end_cut = any(abs(c - last.end) <= 0.6 for c in scenes)
            boundary = min(1.0, last.gap_after / 1.0) * 0.6 + (0.4 if end_cut else 0.0)
            # Güçlü açılış: soru/ünlem içeren ilk cümle iyi bir kanca adayıdır.
            opener = 1.0 if first.text.rstrip().endswith(("?", "!")) else 0.0
            # Çok seyrek konuşma (uzun sessizlikler) kısa videoda zayıftır.
            density = min(1.0, wps / 2.5)
            pre = 0.35 * min(1.5, energy_ratio) / 1.5 + 0.30 * density + 0.25 * boundary + 0.10 * opener
            per_start.append({
                "startSec": first.start, "endSec": last.end, "pre": pre,
                "text": " ".join(s.text for s in sentences[i: j + 1]),
                "features": {
                    "sceneCuts": sum(1 for c in scenes if first.start < c < last.end),
                    "energyRatio": round(energy_ratio, 3),
                    "wordsPerSec": round(wps, 2),
                    "speakerCount": len(set().union(*(s.speakers for s in sentences[i: j + 1]))) or 1,
                    "faceCoverage": round(_face_coverage(faces, first.start, last.end), 2),
                    "sentenceCount": j - i + 1,
                    "endsOnPause": last.gap_after >= 0.5,
                },
            })
        # Aynı başlangıç için en iyi iki bitiş yeter.
        windows += sorted(per_start, key=lambda w: w["pre"], reverse=True)[:2]

    windows.sort(key=lambda w: w["pre"], reverse=True)
    kept: list[dict[str, Any]] = []
    for w in windows:
        if all(iou((w["startSec"], w["endSec"]), (k["startSec"], k["endSec"])) < 0.4 for k in kept):
            kept.append(w)
        if len(kept) >= max_candidates:
            break

    out = []
    for w in sorted(kept, key=lambda w: w["startSec"]):
        # Kelime başı/sonu kırpılmasın diye küçük pay; komşu kelimeye taşmaz.
        prev_end = max((x["e"] for x in words if x["e"] <= w["startSec"]), default=0.0)
        next_start = min((x["s"] for x in words if x["s"] >= w["endSec"]), default=duration)
        start = max(0.0, prev_end, w["startSec"] - PAD_START)
        end = min(duration, next_start, w["endSec"] + PAD_END)
        out.append({"startSec": round(start, 3), "endSec": round(end, 3), "text": w["text"], "features": {**w["features"], "preScore": round(w["pre"], 3)}})
    return out


async def run(ctx: Ctx) -> dict[str, Any]:
    p = ctx.payload
    words = ctx.storage.get_json(ctx.project_key("analysis/words.json"))
    if len(words) < 20:
        raise StageError("NO_SPEECH", "Videoda yeterli konuşma bulunamadı", retryable=False)
    scenes = ctx.storage.get_json(ctx.project_key("analysis/scenes.json"))
    energy = ctx.storage.get_json(ctx.project_key("analysis/energy.json"))
    faces = ctx.storage.get_json(ctx.project_key("analysis/faces.json"))
    await ctx.progress(30)
    candidates = generate(
        words, scenes, energy, faces,
        min_sec=float(p["minDurationSec"]), max_sec=float(p["maxDurationSec"]), max_candidates=int(p["maxCandidates"]),
        duration=float(p.get("durationSec") or words[-1]["e"]),
    )
    return {"candidates": candidates}
