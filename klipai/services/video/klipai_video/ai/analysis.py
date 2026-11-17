"""Analiz modelleri: Whisper (transkript + kelime zaman damgası), sahne tespiti, ses enerjisi,
konuşmacı ayrımı ve yüz tespiti. Ağır kütüphaneler ilk kullanımda yüklenir; modeller süreç boyunca bellekte kalır."""
from __future__ import annotations

import wave
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from ..core import log, settings

# ───────────── Transkript ─────────────

@lru_cache
def _whisper():
    from faster_whisper import BatchedInferencePipeline, WhisperModel

    s = settings()
    model = WhisperModel(s.whisper_model, device=s.whisper_device, compute_type="float16" if s.whisper_device == "cuda" else "int8")
    # Toplu çıkarım: ses VAD ile parçalanır ve parçalar GPU'da birlikte çözülür.
    # 60 dakikalık ses tek bir modern GPU'da birkaç dakikada biter (10 dk analiz hedefinin dayanağı).
    return BatchedInferencePipeline(model=model)


def transcribe(audio: Path, language: str | None) -> dict[str, Any]:
    segments, info = _whisper().transcribe(str(audio), language=language, word_timestamps=True, batch_size=16, vad_filter=True)
    words: list[dict[str, Any]] = []
    segs: list[dict[str, Any]] = []
    for i, seg in enumerate(segments):
        segs.append({"id": i, "start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text.strip(), "speaker": None})
        for w in seg.words or []:
            if w.word.strip():
                words.append({"w": w.word.strip(), "s": round(float(w.start), 3), "e": round(float(w.end), 3), "p": round(float(w.probability), 3)})
    return {"language": info.language, "segments": segs, "words": words}


# ───────────── Konuşmacı ayrımı ─────────────

@lru_cache
def _diarizer():
    import torch
    from pyannote.audio import Pipeline

    pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=settings().hf_token)
    if torch.cuda.is_available():
        pipe.to(torch.device("cuda"))
    return pipe


def diarize(audio: Path) -> list[dict[str, Any]]:
    """[{start, end, speaker}] döner. HF_TOKEN yoksa ayrım atlanır ve tek konuşmacı varsayılır."""
    if not settings().hf_token:
        return []
    try:
        result = _diarizer()(str(audio))
    except Exception as e:  # ayrım yardımcı bir sinyaldir; başarısızlığı analizi durdurmaz
        log.warning("konuşmacı ayrımı başarısız: %s", e)
        return []
    return [{"start": round(t.start, 3), "end": round(t.end, 3), "speaker": spk} for t, _, spk in result.itertracks(yield_label=True)]


def assign_speakers(words: list[dict[str, Any]], segments: list[dict[str, Any]], turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Her kelimeye, orta noktasını kapsayan konuşma turunun konuşmacısını atar. Konuşmacı özetini döner."""
    if not turns:
        for w in words:
            w["spk"] = "S1"
        for s in segments:
            s["speaker"] = "S1"
        total = sum(w["e"] - w["s"] for w in words)
        return [{"id": "S1", "label": "Konuşmacı 1", "totalSec": round(total, 1)}]
    labels: dict[str, str] = {}
    starts = np.array([t["start"] for t in turns])
    totals: dict[str, float] = {}

    def at(t: float) -> str:
        i = int(np.searchsorted(starts, t, side="right")) - 1
        # Tur dışında kalan kelime en yakın tura bağlanır.
        best = min(range(max(0, i), min(len(turns), i + 2)), key=lambda k: 0 if turns[k]["start"] <= t <= turns[k]["end"] else min(abs(turns[k]["start"] - t), abs(turns[k]["end"] - t)))
        raw = turns[best]["speaker"]
        return labels.setdefault(raw, f"S{len(labels) + 1}")

    for w in words:
        w["spk"] = at((w["s"] + w["e"]) / 2)
        totals[w["spk"]] = totals.get(w["spk"], 0.0) + (w["e"] - w["s"])
    for s in segments:
        s["speaker"] = at((s["start"] + s["end"]) / 2)
    return [{"id": sid, "label": f"Konuşmacı {sid[1:]}", "totalSec": round(sec, 1)} for sid, sec in sorted(totals.items())]


# ───────────── Sahne tespiti ─────────────

def detect_scenes(video: Path) -> list[float]:
    """Sahne kesim zamanları (saniye)."""
    from scenedetect import ContentDetector, detect

    scenes = detect(str(video), ContentDetector(threshold=27.0, min_scene_len=15))
    return [round(start.get_seconds(), 3) for start, _ in scenes[1:]]


# ───────────── Ses enerjisi ─────────────

def audio_energy(wav: Path, hop: float = 0.5) -> dict[str, Any]:
    """16 kHz mono WAV için pencere başına RMS zarfı."""
    with wave.open(str(wav), "rb") as f:
        rate = f.getframerate()
        win = int(rate * hop)
        rms: list[float] = []
        while True:
            buf = f.readframes(win)
            if not buf:
                break
            x = np.frombuffer(buf, dtype=np.int16).astype(np.float32) / 32768.0
            rms.append(round(float(np.sqrt(np.mean(x * x))) if x.size else 0.0, 5))
    return {"hop": hop, "rms": rms}


# ───────────── Yüz tespiti ─────────────

def detect_faces(video: Path, sample_fps: float = 2.0) -> dict[str, Any]:
    """Proxy videoda saniyede `sample_fps` kare örnekleyip yüz kutularını (0-1 normalize) döner.
    YuNet modeli varsa o, yoksa OpenCV ile gelen Haar basamaklı sınıflandırıcı kullanılır."""
    import cv2

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        return {"fps": sample_fps, "width": 0, "height": 0, "frames": []}
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, round(fps / sample_fps))

    model = Path(settings().face_model)
    yunet = cv2.FaceDetectorYN.create(str(model), "", (w, h), score_threshold=0.7) if model.exists() else None
    haar = None if yunet else cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    frames: list[dict[str, Any]] = []
    idx = 0
    while True:
        if not cap.grab():
            break
        if idx % step == 0:
            ok, img = cap.retrieve()
            if not ok:
                break
            faces: list[dict[str, float]] = []
            if yunet is not None:
                _, det = yunet.detect(img)
                for d in det if det is not None else []:
                    faces.append({"x": float(d[0]) / w, "y": float(d[1]) / h, "w": float(d[2]) / w, "h": float(d[3]) / h, "score": round(float(d[14]), 3)})
            else:
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                for (x, y, fw, fh) in haar.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(w // 20, w // 20)):
                    faces.append({"x": x / w, "y": y / h, "w": fw / w, "h": fh / h, "score": 0.8})
            frames.append({"t": round(idx / fps, 3), "faces": [{k: round(v, 4) for k, v in f.items()} for f in faces]})
        idx += 1
    cap.release()
    return {"fps": sample_fps, "width": w, "height": h, "frames": frames}
