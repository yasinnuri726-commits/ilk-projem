// Yol: klipai/apps/api/src/modules/pipeline/orchestrator.service.ts
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  type AnalyzeResult,
  type CandidatesResult,
  type IngestResult,
  type JobCost,
  JOB_ERRORS,
  type JobErrorCode,
  parseJobError,
  PROJECT_STAGE_PROGRESS,
  PROJECT_STAGE_QUEUE,
  PROJECT_STAGE_RESULT,
  PROJECT_STAGE_STATUS,
  PROJECT_STAGES,
  type ProjectStage,
  projectJobId,
  type ScoreResult,
  type StageProgress,
  TranscriptSegmentFileSchema,
  weightedScore,
} from '@klipai/shared';
import { AppConfig } from '../../config/app-config';
import type { ProjectStatus } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../infra/prisma.service';
import { QueueService } from '../../infra/queue.service';
import { StorageService } from '../../infra/storage.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PipelineService, type StoredAnalysisKeys } from './pipeline.service';

const TX = { timeout: 30_000, maxWait: 10_000 };

/** Aşama sonucu uygulandıktan sonra ne yapılacağı. */
type Next =
  | { kind: 'enqueue'; stage: ProjectStage }
  | { kind: 'done'; event?: { type: string; data: Record<string, unknown> } }
  | { kind: 'failed' }
  /** Sonuç yok sayıldı: iş zaten işlenmiş ya da proje iptal edilmiş. */
  | { kind: 'skip' };

/**
 * Proje hattının olay tarafı. Worker'ların (Python) iş sonuçlarını BullMQ
 * olaylarından dinler, Postgres'e yazar, durum makinesini ilerletir ve bir
 * sonraki aşamayı kuyruğa alır.
 *
 * Her sonuç tek bir işlemde "sahiplenilir" (PipelineJob QUEUED/ACTIVE →
 * SUCCEEDED koşullu güncellemesi), bu sayede birden çok orkestratör örneği
 * çalışsa da ya da aynı olay iki kez gelse de sonuç bir kez uygulanır.
 */
@Injectable()
export class OrchestratorService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Orchestrator');

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly storage: StorageService,
    private readonly entitlements: EntitlementsService,
    private readonly realtime: RealtimeService,
    private readonly pipeline: PipelineService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.runsWorkers) return;
    for (const stage of PROJECT_STAGES) {
      const events = this.queues.events(PROJECT_STAGE_QUEUE[stage]);
      const guard = (label: string, run: () => Promise<void>): void => {
        run().catch((error: unknown) => this.logger.error({ err: error, stage, label }, 'Olay işlenemedi'));
      };
      events.on('active', ({ jobId }) => guard('active', () => this.onActive(stage, jobId)));
      events.on('progress', ({ jobId, data }) =>
        guard('progress', () => this.onProgress(stage, jobId, data as number | StageProgress)),
      );
      events.on('completed', ({ jobId }) => guard('completed', () => this.onCompleted(stage, jobId)));
      events.on('failed', ({ jobId, failedReason }) =>
        guard('failed', () => this.onFailed(stage, jobId, failedReason)),
      );
    }
    this.logger.log('Orkestratör kuyruk olaylarını dinliyor');
  }

  private projectIdOf(stage: ProjectStage, jobId: string): string | null {
    const prefix = projectJobId(stage, '');
    return jobId.startsWith(prefix) ? jobId.slice(prefix.length) : null;
  }

  private async topics(projectId: string): Promise<string[]> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { channelId: true } });
    return project ? [`project:${projectId}`, `channel:${project.channelId}`] : [];
  }

  async onActive(stage: ProjectStage, jobId: string): Promise<void> {
    const projectId = this.projectIdOf(stage, jobId);
    if (!projectId) return;
    const updated = await this.prisma.pipelineJob.updateMany({
      where: { projectId, stage, status: { in: ['QUEUED', 'ACTIVE'] } },
      data: { status: 'ACTIVE', startedAt: new Date(), attempt: { increment: 1 } },
    });
    if (updated.count === 0) return;
    const job = await this.prisma.pipelineJob.findUnique({ where: { projectId_stage: { projectId, stage } } });
    await this.realtime.publish(await this.topics(projectId), 'project.stage', {
      projectId,
      stage,
      status: 'ACTIVE',
      progress: job?.progress ?? 0,
      attempt: job?.attempt ?? 1,
    });
  }

  async onProgress(stage: ProjectStage, jobId: string, data: number | StageProgress): Promise<void> {
    const projectId = this.projectIdOf(stage, jobId);
    if (!projectId) return;
    const raw = typeof data === 'number' ? data : data?.percent;
    if (typeof raw !== 'number' || Number.isNaN(raw)) return;
    const percent = Math.round(Math.min(100, Math.max(0, raw)));
    const [from, to] = PROJECT_STAGE_PROGRESS[stage];

    const updated = await this.prisma.pipelineJob.updateMany({
      where: { projectId, stage, status: 'ACTIVE' },
      data: { progress: percent },
    });
    if (updated.count === 0) return;
    await this.prisma.project.updateMany({
      where: { id: projectId, status: PROJECT_STAGE_STATUS[stage] },
      data: { progress: Math.round(from + ((to - from) * percent) / 100) },
    });
    await this.realtime.publish(await this.topics(projectId), 'project.stage', {
      projectId,
      stage,
      status: 'ACTIVE',
      progress: percent,
      ...(typeof data === 'object' && data.etaSec !== undefined ? { etaSec: data.etaSec } : {}),
    });
  }

  async onCompleted(stage: ProjectStage, jobId: string): Promise<void> {
    const projectId = this.projectIdOf(stage, jobId);
    if (!projectId) return;
    const job = await this.queues.queue(PROJECT_STAGE_QUEUE[stage]).getJob(jobId);
    if (!job) return;

    const parsed = PROJECT_STAGE_RESULT[stage].safeParse(job.returnvalue);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      await this.fail(stage, projectId, 'WORKER_CONTRACT_VIOLATION', detail.slice(0, 500));
      return;
    }

    let next: Next;
    try {
      switch (stage) {
        case 'INGEST':
          next = await this.applyIngest(projectId, parsed.data as IngestResult);
          break;
        case 'ANALYZE':
          next = await this.applyAnalyze(projectId, parsed.data as AnalyzeResult);
          break;
        case 'CANDIDATES':
          next = await this.applyCandidates(projectId, parsed.data as CandidatesResult);
          break;
        case 'SCORE':
          next = await this.applyScore(projectId, parsed.data as ScoreResult);
          break;
      }
    } catch (error) {
      this.logger.error({ err: error, projectId, stage }, 'Aşama sonucu uygulanamadı');
      await this.fail(stage, projectId, 'WORKER_CONTRACT_VIOLATION', (error as Error).message.slice(0, 500));
      return;
    }

    if (next.kind === 'skip') return;
    const topics = await this.topics(projectId);
    await this.realtime.publish(topics, 'project.stage', { projectId, stage, status: 'SUCCEEDED', progress: 100 });
    if (next.kind === 'enqueue') await this.pipeline.enqueue(projectId, next.stage);
    if (next.kind === 'done' && next.event) await this.realtime.publish(topics, next.event.type, next.event.data);
    await this.pipeline.publishStatus(projectId);
  }

  async onFailed(stage: ProjectStage, jobId: string, failedReason: string): Promise<void> {
    const projectId = this.projectIdOf(stage, jobId);
    if (!projectId) return;
    const job = await this.queues.queue(PROJECT_STAGE_QUEUE[stage]).getJob(jobId);
    const error = parseJobError(failedReason);

    // Denemesi kalan iş BullMQ tarafından yeniden çalıştırılır; proje başarısız sayılmaz.
    if (job && (await job.getState()) !== 'failed') {
      await this.realtime.publish(await this.topics(projectId), 'project.stage', {
        projectId,
        stage,
        status: 'QUEUED',
        progress: 0,
        attempt: job.attemptsMade,
        error: { ...error, retryable: true },
      });
      return;
    }
    await this.fail(stage, projectId, error.code, error.message);
  }

  /** Aşamayı ve projeyi kalıcı olarak başarısız işaretler. */
  private async fail(stage: ProjectStage, projectId: string, code: JobErrorCode, message: string): Promise<void> {
    const failed = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.pipelineJob.updateMany({
        where: { projectId, stage, status: { in: ['QUEUED', 'ACTIVE'] } },
        data: { status: 'FAILED', errorCode: code, errorMessage: message, finishedAt: new Date() },
      });
      if (claimed.count === 0) return false;
      await tx.project.updateMany({
        where: { id: projectId, status: PROJECT_STAGE_STATUS[stage] },
        data: { status: 'FAILED', errorCode: code, errorMessage: message },
      });
      return true;
    }, TX);
    if (!failed) return;
    this.logger.warn({ projectId, stage, code, message }, 'Aşama başarısız');
    await this.realtime.publish(await this.topics(projectId), 'project.stage', {
      projectId,
      stage,
      status: 'FAILED',
      progress: 0,
      error: { code, message, retryable: JOB_ERRORS[code].retryable },
    });
    await this.pipeline.publishStatus(projectId);
  }

  // ───────────── Ortak yardımcılar ─────────────

  /** Sonucu sahiplenir; false dönerse iş zaten işlenmiş ya da iptal edilmiştir. */
  private async claim(tx: Tx, projectId: string, stage: ProjectStage, cost: JobCost, summary: object): Promise<boolean> {
    const claimed = await tx.pipelineJob.updateMany({
      where: { projectId, stage, status: { in: ['QUEUED', 'ACTIVE'] } },
      data: {
        status: 'SUCCEEDED',
        progress: 100,
        finishedAt: new Date(),
        result: { ...summary, cost },
        costUsd: cost.costUsd.toFixed(6),
        gpuSeconds: cost.gpuSeconds,
      },
    });
    return claimed.count === 1;
  }

  private async advance(
    tx: Tx,
    projectId: string,
    from: ProjectStatus,
    data: { status: ProjectStatus; progress: number; completedAt?: Date },
  ): Promise<boolean> {
    const moved = await tx.project.updateMany({ where: { id: projectId, status: from }, data });
    return moved.count === 1;
  }

  // ───────────── 1. Alım ─────────────

  private applyIngest(projectId: string, r: IngestResult): Promise<Next> {
    return this.prisma.$transaction(async (tx): Promise<Next> => {
      const { cost, ...probe } = r;
      if (!(await this.claim(tx, projectId, 'INGEST', cost, { durationMs: r.durationMs }))) return { kind: 'skip' };
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { channel: { select: { ownerId: true } } },
      });
      await tx.sourceVideo.update({
        where: { projectId },
        data: { ...probe, sizeBytes: BigInt(probe.sizeBytes), status: 'READY', uploadId: null, errorCode: null },
      });

      // Kesin süre artık belli: kredi burada düşülür.
      const charged = await this.entitlements.chargeMinutes(tx, {
        userId: project.channel.ownerId,
        projectId,
        channelId: project.channelId,
        durationMs: r.durationMs,
      });
      if (!charged) {
        await tx.pipelineJob.update({
          where: { projectId_stage: { projectId, stage: 'INGEST' } },
          data: { status: 'FAILED', errorCode: 'INSUFFICIENT_CREDITS', errorMessage: 'Kredi yetersiz' },
        });
        await tx.project.updateMany({
          where: { id: projectId, status: 'INGESTING' },
          data: { status: 'FAILED', errorCode: 'INSUFFICIENT_CREDITS', errorMessage: 'Kredi yetersiz' },
        });
        return { kind: 'failed' };
      }
      const moved = await this.advance(tx, projectId, 'INGESTING', {
        status: 'ANALYZING',
        progress: PROJECT_STAGE_PROGRESS.INGEST[1],
      });
      return moved ? { kind: 'enqueue', stage: 'ANALYZE' } : { kind: 'skip' };
    }, TX);
  }

  // ───────────── 2. Analiz ─────────────

  private async applyAnalyze(projectId: string, r: AnalyzeResult): Promise<Next> {
    const file = TranscriptSegmentFileSchema.parse(await this.storage.getJson(r.segmentsKey));
    return this.prisma.$transaction(async (tx): Promise<Next> => {
      const summary = { language: r.language, wordCount: r.wordCount, segments: file.segments.length };
      if (!(await this.claim(tx, projectId, 'ANALYZE', r.cost, summary))) return { kind: 'skip' };
      const source = await tx.sourceVideo.findUniqueOrThrow({ where: { projectId } });

      await tx.transcript.deleteMany({ where: { sourceVideoId: source.id } });
      const transcript = await tx.transcript.create({
        data: {
          sourceVideoId: source.id,
          language: r.language,
          model: r.model,
          wordsKey: r.wordsKey,
          wordCount: r.wordCount,
          speakerCount: r.speakerCount,
        },
      });
      for (let offset = 0; offset < file.segments.length; offset += 500) {
        await tx.transcriptSegment.createMany({
          data: file.segments.slice(offset, offset + 500).map((segment, i) => ({
            transcriptId: transcript.id,
            index: offset + i,
            ...segment,
          })),
        });
      }
      const keys: StoredAnalysisKeys = { ...r.analysisKeys, segments: r.segmentsKey };
      await tx.sourceVideo.update({ where: { id: source.id }, data: { analysisKeys: keys } });

      const moved = await this.advance(tx, projectId, 'ANALYZING', {
        status: 'GENERATING_CANDIDATES',
        progress: PROJECT_STAGE_PROGRESS.ANALYZE[1],
      });
      return moved ? { kind: 'enqueue', stage: 'CANDIDATES' } : { kind: 'skip' };
    }, TX);
  }

  // ───────────── 3. Aday üretimi ─────────────

  private applyCandidates(projectId: string, r: CandidatesResult): Promise<Next> {
    return this.prisma.$transaction(async (tx): Promise<Next> => {
      const valid = r.candidates.filter((c) => c.endMs > c.startMs);
      if (!(await this.claim(tx, projectId, 'CANDIDATES', r.cost, { count: valid.length }))) return { kind: 'skip' };

      await tx.clipCandidate.deleteMany({ where: { projectId, status: 'PROPOSED' } });
      await tx.clipCandidate.createMany({ data: valid.map((c) => ({ projectId, ...c })) });

      if (valid.length === 0) {
        const done = await this.advance(tx, projectId, 'GENERATING_CANDIDATES', {
          status: 'COMPLETED',
          progress: 100,
          completedAt: new Date(),
        });
        return done
          ? { kind: 'done', event: { type: 'project.candidates_ready', data: { projectId, count: 0, topScore: null } } }
          : { kind: 'skip' };
      }
      const moved = await this.advance(tx, projectId, 'GENERATING_CANDIDATES', {
        status: 'SCORING',
        progress: PROJECT_STAGE_PROGRESS.CANDIDATES[1],
      });
      return moved ? { kind: 'enqueue', stage: 'SCORE' } : { kind: 'skip' };
    }, TX);
  }

  // ───────────── 4. Puanlama ─────────────

  private applyScore(projectId: string, r: ScoreResult): Promise<Next> {
    return this.prisma.$transaction(async (tx): Promise<Next> => {
      if (!(await this.claim(tx, projectId, 'SCORE', r.cost, { scored: r.scores.length }))) return { kind: 'skip' };

      for (const s of r.scores) {
        // Toplam puan worker'a bırakılmaz; ağırlıklar tek yerde (shared) uygulanır.
        await tx.clipCandidate.updateMany({
          where: { id: s.id, projectId, status: 'PROPOSED' },
          data: {
            status: 'SCORED',
            score: weightedScore(s.breakdown),
            breakdown: s.breakdown,
            rationale: s.rationale,
            hookText: s.hookText,
            suggestedFormat: s.suggestedFormat,
            promptVersion: r.promptVersion,
          },
        });
      }
      const ranked = await tx.clipCandidate.findMany({
        where: { projectId, status: 'SCORED' },
        orderBy: [{ score: 'desc' }, { startMs: 'asc' }],
        select: { id: true, score: true },
      });
      for (const [index, candidate] of ranked.entries()) {
        await tx.clipCandidate.update({ where: { id: candidate.id }, data: { rank: index + 1 } });
      }

      // Otomasyon moduna göre otomatik aday seçimi klip hattıyla birlikte 3. aşamada eklenir.
      const moved = await this.advance(tx, projectId, 'SCORING', { status: 'AWAITING_SELECTION', progress: 100 });
      return moved
        ? {
            kind: 'done',
            event: {
              type: 'project.candidates_ready',
              data: { projectId, count: ranked.length, topScore: ranked[0]?.score ?? null },
            },
          }
        : { kind: 'skip' };
    }, TX);
  }
}
