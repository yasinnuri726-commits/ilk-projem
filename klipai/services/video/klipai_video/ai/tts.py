"""Seslendirme (ElevenLabs). Hız ayarı sağlayıcıdan bağımsız olarak ffmpeg `atempo` ile uygulanır."""
from __future__ import annotations

from pathlib import Path

from .. import ffmpeg
from ..core import Ctx, StageError, settings

API = "https://api.elevenlabs.io/v1/text-to-speech"


async def synthesize(ctx: Ctx, text: str, dest: Path, *, voice: str, speed: float = 1.0) -> Path:
    import httpx

    s = settings()
    voice_id = s.elevenlabs_voice if voice in ("", "default") else voice
    if not s.elevenlabs_key or not voice_id:
        raise StageError("TTS_NOT_CONFIGURED", "ELEVENLABS_API_KEY ve ses kimliği tanımlı değil", retryable=False)
    raw = dest.with_suffix(".raw.mp3")
    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post(
            f"{API}/{voice_id}", params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": s.elevenlabs_key, "Content-Type": "application/json"},
            json={"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": {"stability": 0.45, "similarity_boost": 0.8}},
        )
    if r.status_code >= 400:
        raise StageError(f"TTS_HTTP_{r.status_code}", r.text[:300], retryable=r.status_code >= 500 or r.status_code == 429)
    raw.write_bytes(r.content)
    ctx.add_tts_usage(len(text))
    if abs(speed - 1.0) < 0.01:
        raw.rename(dest)
    else:
        await ffmpeg.run(["-i", str(raw), "-af", f"atempo={speed:.2f}", str(dest)])
    return dest
