"""BullMQ tüketicileri: her kuyruk bir aşamaya bağlanır.

Çalıştırma: `python -m klipai_video.worker`
GPU havuzu için:  WORKER_QUEUES=analyze,edit   VIDEO_ENCODER=h264_nvenc
CPU havuzu için:  WORKER_QUEUES=ingest,candidates,score,commentary,metadata,qc
"""
from __future__ import annotations

import asyncio
import logging
import signal
from pathlib import Path
from typing import Any, Awaitable, Callable

from .core import Callback, Ctx, StageError, Storage, log, new_workdir, settings
from .stages import candidates, edit_qc, ingest_analyze, llm_stages

Handler = Callable[[Ctx], Awaitable[dict[str, Any]]]

HANDLERS: dict[str, Handler] = {
    "ingest": ingest_analyze.ingest,
    "analyze": ingest_analyze.analyze,
    "candidates": candidates.run,
    "score": llm_stages.score,
    "commentary": llm_stages.commentary,
    "edit": edit_qc.edit,
    "metadata": llm_stages.metadata,
    "qc": edit_qc.qc,
}

# Kuyruk başına eşzamanlılık. GPU işleri süreç başına sınırlıdır; ölçekleme süreç/pod sayısıyla yapılır.
CONCURRENCY = {"ingest": 2, "analyze": 1, "candidates": 4, "score": 4, "commentary": 4, "edit": 2, "metadata": 4, "qc": 2}


def make_processor(queue: str, storage: Storage, callback: Callback):
    handler = HANDLERS[queue]

    async def process(job: Any, token: str) -> dict[str, Any]:
        data = job.data
        job_id = data["jobId"]
        attempt = job.attemptsMade + 1
        max_attempts = int(job.opts.get("attempts", 1))
        base = {"kind": data["kind"], "stage": data["stage"]}

        async def send_progress(pct: int) -> None:
            try:
                await callback.send(job_id, {**base, "type": "PROGRESS", "progress": pct})
            except StageError:
                pass  # ilerleme bildirimi kaybolabilir; iş durmaz

        await callback.send(job_id, {**base, "type": "STARTED", "attempt": attempt, "workerId": settings().worker_id})
        with new_workdir(job_id) as tmp:
            ctx = Ctx(job_id=job_id, kind=data["kind"], stage=data["stage"], project_id=data["projectId"], clip_id=data.get("clipId"),
                      payload=data["payload"], storage=storage, workdir=Path(tmp), _progress=send_progress)
            try:
                output = await handler(ctx)
            except Exception as e:
                err = e if isinstance(e, StageError) else StageError("INTERNAL", f"{type(e).__name__}: {e}"[:1500])
                if not isinstance(e, StageError):
                    log.exception("aşama hatası %s/%s", queue, job_id)
                final = (not err.retryable) or attempt >= max_attempts
                await callback.send(job_id, {**base, "type": "FAILED", "final": final, "attempt": attempt, "usage": ctx.usage,
                                             "error": {"code": err.code, "message": str(err)[:1900], "retryable": err.retryable}})
                if not err.retryable:
                    from bullmq import UnrecoverableError

                    raise UnrecoverableError(str(err)) from e  # kuyruk yeniden denemez
                raise
        await callback.send(job_id, {**base, "type": "SUCCEEDED", "output": output, "usage": ctx.usage})
        return {"ok": True}

    return process


async def main() -> None:
    from bullmq import Worker

    logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","lvl":"%(levelname)s","msg":"%(message)s"}')
    s = settings()
    if not s.hmac_secret:
        raise SystemExit("INTERNAL_HMAC_SECRET tanımlı değil")
    storage, callback = Storage(), Callback()
    workers = [
        Worker(q, make_processor(q, storage, callback), {"connection": s.redis_url, "concurrency": CONCURRENCY[q], "lockDuration": 120_000})
        for q in s.queues if q in HANDLERS
    ]
    log.info("worker hazır: %s (%s)", ", ".join(s.queues), s.worker_id)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()
    log.info("kapanıyor: süren işler tamamlanıyor")
    await asyncio.gather(*(w.close() for w in workers))


if __name__ == "__main__":
    asyncio.run(main())
