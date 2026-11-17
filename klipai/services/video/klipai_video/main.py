"""FastAPI: sağlık ve hazır olma uçları (konteyner orkestratörü için). İşler `worker.py` içinde tüketilir."""
from __future__ import annotations

import shutil

from fastapi import FastAPI

from .core import settings

app = FastAPI(title="KlipAI Video Service", docs_url=None, redoc_url=None)


@app.get("/health")
async def health() -> dict:
    s = settings()
    checks = {"ffmpeg": "ok" if shutil.which("ffmpeg") else "fail", "ffprobe": "ok" if shutil.which("ffprobe") else "fail"}
    try:
        import redis.asyncio as redis

        r = redis.from_url(s.redis_url)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "fail"
    return {"status": "ok" if all(v == "ok" for v in checks.values()) else "degraded", "checks": checks, "queues": list(s.queues), "encoder": s.video_encoder}
