"""Ortak altyapı: yapılandırma, depolama, API geri çağrısı, maliyet kaydı ve iş bağlamı."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import socket
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

log = logging.getLogger("klipai")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    redis_url: str = field(default_factory=lambda: _env("REDIS_URL", "redis://localhost:6379"))
    api_url: str = field(default_factory=lambda: _env("API_INTERNAL_URL", "http://localhost:3000/v1").rstrip("/"))
    hmac_secret: str = field(default_factory=lambda: _env("INTERNAL_HMAC_SECRET"))
    s3_endpoint: str = field(default_factory=lambda: _env("S3_ENDPOINT"))
    s3_region: str = field(default_factory=lambda: _env("S3_REGION", "us-east-1"))
    s3_bucket: str = field(default_factory=lambda: _env("S3_BUCKET", "klipai-dev"))
    s3_access_key: str = field(default_factory=lambda: _env("S3_ACCESS_KEY"))
    s3_secret_key: str = field(default_factory=lambda: _env("S3_SECRET_KEY"))
    s3_path_style: bool = field(default_factory=lambda: _env("S3_FORCE_PATH_STYLE", "false") == "true")
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL", "claude-opus-5-5"))
    elevenlabs_key: str = field(default_factory=lambda: _env("ELEVENLABS_API_KEY"))
    elevenlabs_voice: str = field(default_factory=lambda: _env("ELEVENLABS_DEFAULT_VOICE_ID"))
    hf_token: str = field(default_factory=lambda: _env("HF_TOKEN"))
    whisper_model: str = field(default_factory=lambda: _env("WHISPER_MODEL", "large-v3"))
    whisper_device: str = field(default_factory=lambda: _env("WHISPER_DEVICE", "cuda"))
    video_encoder: str = field(default_factory=lambda: _env("VIDEO_ENCODER", "libx264"))  # GPU'da: h264_nvenc
    font_dir: str = field(default_factory=lambda: _env("FONT_DIR", "/usr/share/fonts"))
    face_model: str = field(default_factory=lambda: _env("FACE_MODEL_PATH", "/opt/models/face_detection_yunet_2023mar.onnx"))
    queues: tuple[str, ...] = field(default_factory=lambda: tuple(q.strip() for q in _env("WORKER_QUEUES", "ingest,analyze,candidates,score,commentary,edit,metadata,qc").split(",") if q.strip()))
    worker_id: str = field(default_factory=lambda: f"{socket.gethostname()}-{os.getpid()}")
    # Maliyet takibi (USD)
    gpu_usd_per_hour: float = field(default_factory=lambda: float(_env("GPU_USD_PER_HOUR", "0.60")))
    llm_usd_in_per_mtok: float = field(default_factory=lambda: float(_env("LLM_USD_IN_PER_MTOK", "4")))
    llm_usd_out_per_mtok: float = field(default_factory=lambda: float(_env("LLM_USD_OUT_PER_MTOK", "20")))
    tts_usd_per_kchar: float = field(default_factory=lambda: float(_env("TTS_USD_PER_KCHAR", "0.18")))


_settings: Settings | None = None


def settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


class StageError(Exception):
    """Aşama hatası. `retryable=False` ise kuyruk yeniden denemez (ör. bozuk dosya)."""

    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


# ───────────── Depolama ─────────────
class Storage:
    def __init__(self) -> None:
        import boto3
        from botocore.config import Config

        s = settings()
        self.bucket = s.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint or None,
            region_name=s.s3_region,
            aws_access_key_id=s.s3_access_key or None,
            aws_secret_access_key=s.s3_secret_key or None,
            config=Config(s3={"addressing_style": "path" if s.s3_path_style else "auto"}, retries={"max_attempts": 5, "mode": "adaptive"}),
        )

    def download(self, key: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(dest))
        return dest

    def upload(self, src: Path, key: str, content_type: str) -> str:
        self.client.upload_file(str(src), self.bucket, key, ExtraArgs={"ContentType": content_type})
        return key

    def get_json(self, key: str) -> Any:
        return json.loads(self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read())

    def put_json(self, key: str, data: Any) -> str:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode(), ContentType="application/json")
        return key

    def sign_get(self, key: str, expires: int = 6 * 3600) -> str:
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires)

    def list_keys(self, prefix: str) -> list[str]:
        out: list[str] = []
        for page in self.client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            out += [o["Key"] for o in page.get("Contents", [])]
        return out


# ───────────── API geri çağrısı (HMAC) ─────────────
def sign(body: bytes, secret: str, timestamp: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


class Callback:
    def __init__(self) -> None:
        import httpx

        self.http = httpx.AsyncClient(timeout=30)

    async def send(self, job_id: str, event: dict[str, Any]) -> None:
        s = settings()
        body = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode()
        last: Exception | None = None
        for attempt in range(5):
            ts = str(int(time.time()))
            try:
                r = await self.http.post(
                    f"{s.api_url}/internal/jobs/{job_id}/events", content=body,
                    headers={"Content-Type": "application/json", "X-Timestamp": ts, "X-Signature": sign(body, s.hmac_secret, ts)},
                )
                if r.status_code < 500:
                    if r.status_code >= 400:
                        log.error("geri çağrı reddedildi %s: %s", r.status_code, r.text[:300])
                    return
                last = RuntimeError(f"API {r.status_code}")
            except Exception as e:  # ağ hatası: tekrar dene
                last = e
            await asyncio.sleep(min(2**attempt, 15))
        raise StageError("CALLBACK_FAILED", f"API'ye ulaşılamadı: {last}")


# ───────────── İş bağlamı ─────────────
@dataclass
class Ctx:
    job_id: str
    kind: str
    stage: str
    project_id: str
    clip_id: str | None
    payload: dict[str, Any]
    storage: Storage
    workdir: Path
    _progress: Callable[[int], Awaitable[None]]
    usage: list[dict[str, Any]] = field(default_factory=list)
    _last_progress: float = 0.0

    async def progress(self, pct: float) -> None:
        """İlerleme bildirir; saniyede en çok bir kez gönderilir."""
        now = time.monotonic()
        if now - self._last_progress >= 1.0 or pct >= 100:
            self._last_progress = now
            await self._progress(max(0, min(100, int(pct))))

    # Maliyet kayıtları: API tarafında UsageLog satırı olur.
    def add_llm_usage(self, input_tokens: int, output_tokens: int) -> None:
        s = settings()
        cost = (input_tokens * s.llm_usd_in_per_mtok + output_tokens * s.llm_usd_out_per_mtok) / 1e6
        self.usage.append({"kind": "COST_LLM", "provider": "anthropic", "quantity": input_tokens + output_tokens, "unit": "token", "costMicroUsd": round(cost * 1e6)})

    def add_gpu_usage(self, seconds: float) -> None:
        cost = seconds / 3600 * settings().gpu_usd_per_hour
        self.usage.append({"kind": "COST_GPU", "provider": "gpu", "quantity": round(seconds, 2), "unit": "second", "costMicroUsd": round(cost * 1e6)})

    def add_tts_usage(self, chars: int) -> None:
        cost = chars / 1000 * settings().tts_usd_per_kchar
        self.usage.append({"kind": "COST_TTS", "provider": "elevenlabs", "quantity": chars, "unit": "char", "costMicroUsd": round(cost * 1e6)})

    # Depo anahtarı kuralları
    def project_key(self, name: str) -> str:
        return f"projects/{self.project_id}/{name}"

    def clip_key(self, name: str) -> str:
        return f"clips/{self.clip_id}/v{self.payload.get('version', 1)}/{name}"


def new_workdir(job_id: str) -> tempfile.TemporaryDirectory[str]:
    return tempfile.TemporaryDirectory(prefix=f"klipai-{job_id}-")
