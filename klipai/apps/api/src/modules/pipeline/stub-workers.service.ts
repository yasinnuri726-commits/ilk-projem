// Yol: klipai/apps/api/src/modules/pipeline/stub-workers.service.ts
//
// YALNIZCA GELİŞTİRME / TEST (PIPELINE_STUB=1). Video servisi (3. aşama)
// çalışmıyorken hattın uçtan uca denenebilmesi için kuyrukları tüketir ve
// sözleşmeye uygun SAHTE sonuçlar üretir: medya işlenmez, yapay zeka
// çağrılmaz. Üretimde açılması AppConfig tarafından engellenir.
import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import {
  type AnalyzePayload,
  type AnalyzeResult,
  type CandidatesPayload,
  type CandidatesResult,
  type IngestPayload,
  type IngestResult,
  QUEUES,
  type ScorePayload,
  type ScoreResult,
  type TranscriptSegmentFile,
} from '@klipai/shared';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma.service';
import { QueueService } from '../../infra/queue.service';
import { StorageService } from '../../infra/storage.service';

const COST = { gpuSeconds: 0, cpuSeconds: 0, llmInputTokens: 0, llmOutputTokens: 0, ttsCharacters: 0, costUsd: 0 };

/** Kimlikten türetilen, her çalıştırmada aynı kalan 0-100 arası sayı. */
function pseudo(seed: string, salt: string): number {
  return createHash('sha256').update(`${seed}:${salt}`).digest().readUInt16BE(0) % 101;
}

@Injectable()
export class StubWorkersService implements OnApplicationBootstrap {
  private readonly logger = new Logger('StubWorkers');

  constructor(
    private readonly config: AppConfig,
    private readonly queues: QueueService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.pipelineStub || !this.config.runsWorkers) return;
    this.logger.warn('PIPELINE_STUB açık: hat sahte sonuçlarla çalışıyor, medya işlenmiyor');
    this.queues.worker<IngestPayload, IngestResult>(QUEUES.INGEST, (job) => this.ingest(job));
    this.queues.worker<AnalyzePayload, AnalyzeResult>(QUEUES.ANALYZE, (job) => this.analyze(job));
    this.queues.worker<CandidatesPayload, CandidatesResult>(QUEUES.CANDIDATES, (job) => this.candidates(job));
    this.queues.worker<ScorePayload, ScoreResult>(QUEUES.SCORE, (job) => this.score(job));
  }

  private async ingest(job: Job<IngestPayload>): Promise<IngestResult> {
    const { projectId, outputPrefix, storageKey } = job.data;
    const source = await this.prisma.sourceVideo.findUniqueOrThrow({ where: { projectId } });
    // Hata yolunu denemek için: adı "stub-fail" içeren dosya kalıcı hatayla reddedilir.
    if (source.originalName?.includes('stub-fail')) {
      throw new UnrecoverableError('SOURCE_UNREADABLE: dosya çözülemedi (sahte hata)');
    }
    await job.updateProgress({ percent: 50 });
    const head = job.data.source.type === 'UPLOAD' ? await this.storage.head(storageKey) : null;
    return {
      storageKey,
      proxyKey: `${outputPrefix}proxy.mp4`,
      audioKey: `${outputPrefix}audio.wav`,
      thumbnailKey: null,
      durationMs: source.declaredDurationMs ?? 10 * 60_000,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      sizeBytes: head?.size ?? 1,
      sha256: createHash('sha256').update(projectId).digest('hex'),
      mimeType: source.mimeType ?? 'video/mp4',
      cost: COST,
    };
  }

  private async analyze(job: Job<AnalyzePayload>): Promise<AnalyzeResult> {
    const { outputPrefix, durationMs } = job.data;
    const segments: TranscriptSegmentFile['segments'] = [];
    for (let start = 0, i = 0; start + 4000 <= durationMs; start += 5000, i += 1) {
      segments.push({
        startMs: start,
        endMs: start + 4000,
        speaker: i % 2 === 0 ? 'S1' : 'S2',
        text: `Sahte transkript cümlesi ${i + 1}.`,
      });
    }
    const segmentsKey = `${outputPrefix}analysis/segments.json`;
    await this.storage.putJson(segmentsKey, { segments });
    await job.updateProgress({ percent: 60, etaSec: 1 });
    return {
      language: 'tr',
      model: 'stub',
      wordsKey: `${outputPrefix}analysis/words.json.gz`,
      segmentsKey,
      wordCount: segments.length * 3,
      speakerCount: 2,
      analysisKeys: {
        scenes: `${outputPrefix}analysis/scenes.json`,
        audioEnergy: `${outputPrefix}analysis/energy.json`,
        diarization: `${outputPrefix}analysis/diarization.json`,
        faces: `${outputPrefix}analysis/faces.json`,
      },
      cost: COST,
    };
  }

  private async candidates(job: Job<CandidatesPayload>): Promise<CandidatesResult> {
    const { durationMs, minDurationSec, maxDurationSec, maxCandidates, segmentsKey } = job.data;
    const { segments } = await this.storage.getJson<TranscriptSegmentFile>(segmentsKey);
    const length = Math.round(((minDurationSec + maxDurationSec) / 2) * 1000);
    const out: CandidatesResult['candidates'] = [];
    for (let start = 0; start + length <= durationMs && out.length < maxCandidates; start += length * 2) {
      const text = segments
        .filter((s) => s.startMs >= start && s.endMs <= start + length)
        .map((s) => s.text)
        .join(' ');
      if (!text) continue;
      out.push({
        startMs: start,
        endMs: start + length,
        text,
        signals: { audioEnergy: 0.5, sceneCuts: 2, speakerTurns: 3, faceRatio: 0.8 },
      });
    }
    return { candidates: out, cost: COST };
  }

  private async score(job: Job<ScorePayload>): Promise<ScoreResult> {
    return {
      promptVersion: 'stub',
      scores: job.data.candidates.map((c) => ({
        id: c.id,
        breakdown: {
          hook: pseudo(c.id, 'hook'),
          emotion: pseudo(c.id, 'emotion'),
          standalone: pseudo(c.id, 'standalone'),
          curiosity: pseudo(c.id, 'curiosity'),
          shareability: pseudo(c.id, 'shareability'),
        },
        rationale: 'Sahte puanlama (PIPELINE_STUB).',
        hookText: 'Bunu kimse beklemiyordu',
        suggestedFormat: 'NONE' as const,
      })),
      cost: COST,
    };
  }
}
