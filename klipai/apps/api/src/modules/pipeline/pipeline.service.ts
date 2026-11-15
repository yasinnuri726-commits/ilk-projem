// Yol: klipai/apps/api/src/modules/pipeline/pipeline.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  type AnalysisKeys,
  cancelKey,
  normalizeSettings,
  PROJECT_STAGE_QUEUE,
  PROJECT_STAGE_STATUS,
  PROJECT_STAGES,
  type ProjectStage,
  type ProjectStagePayloads,
  projectJobId,
} from '@klipai/shared';
import { AppException } from '../../common/app-exception';
import { currentTraceId } from '../../common/request-context';
import { Prisma, type ProjectStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { QueueService } from '../../infra/queue.service';
import { RedisService } from '../../infra/redis.service';
import { StorageService } from '../../infra/storage.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { RealtimeService } from '../realtime/realtime.service';

export const MAX_SOURCE_DURATION_MS = 4 * 3_600_000;
export const MAX_SOURCE_BYTES = 20 * 1024 ** 3;

const RUNNING: ProjectStatus[] = ['INGESTING', 'ANALYZING', 'GENERATING_CANDIDATES', 'SCORING'];
const CANCELABLE: ProjectStatus[] = ['DRAFT', ...RUNNING, 'AWAITING_SELECTION', 'PRODUCING', 'FAILED'];

export function projectPrefix(projectId: string): string {
  return `projects/${projectId}/`;
}

/** Saklanan analiz anahtarları: sözleşmedeki AnalysisKeys + cümle bölütleri dosyası. */
export type StoredAnalysisKeys = AnalysisKeys & { segments: string };

/** Proje hattının komut tarafı: aşama işi kuyruğa alma, iptal, yeniden deneme. */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger('Pipeline');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly entitlements: EntitlementsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Kaynak hazır olduğunda hattı başlatır (DRAFT → INGESTING). */
  async start(projectId: string): Promise<void> {
    const claimed = await this.prisma.project.updateMany({
      where: { id: projectId, status: 'DRAFT' },
      data: { status: 'INGESTING', progress: 0, errorCode: null, errorMessage: null },
    });
    if (claimed.count === 0) throw new AppException('INVALID_STATE');
    await this.enqueue(projectId, 'INGEST');
    await this.publishStatus(projectId);
  }

  /**
   * Aşama işini kuyruğa alır. Aynı iş zaten bekliyor ya da çalışıyorsa hiçbir
   * şey yapmaz; bitmiş/başarısız eski iş kaldırılıp yenisi eklenir.
   */
  async enqueue(projectId: string, stage: ProjectStage): Promise<void> {
    const queueName = PROJECT_STAGE_QUEUE[stage];
    const queue = this.queues.queue(queueName);
    const jobId = projectJobId(stage, projectId);

    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed') return;
      await existing.remove();
    }

    const { payload, ownerId } = await this.buildPayload(projectId, stage);
    const reset = {
      status: 'QUEUED' as const,
      queueJobId: jobId,
      attempt: 0,
      progress: 0,
      result: Prisma.DbNull,
      errorCode: null,
      errorMessage: null,
      queuedAt: new Date(),
      startedAt: null,
      finishedAt: null,
    };
    await this.prisma.pipelineJob.upsert({
      where: { projectId_stage: { projectId, stage } },
      create: { projectId, stage, ...reset },
      update: reset,
    });

    const access = await this.entitlements.accessFor(ownerId);
    await queue.add(
      stage,
      payload,
      this.queues.jobOptions(queueName, { jobId, priority: access.entitlements.priority }),
    );
    this.logger.log({ projectId, stage, jobId }, 'Aşama kuyruğa alındı');
  }

  private async buildPayload<S extends ProjectStage>(
    projectId: string,
    stage: S,
  ): Promise<{ payload: ProjectStagePayloads[S]; ownerId: string }> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        channel: { select: { ownerId: true, insight: true } },
        sourceVideo: { include: { transcript: true } },
      },
    });
    const source = project.sourceVideo;
    if (!source?.storageKey) throw new Error(`Projenin kaynağı yok: ${projectId}`);
    const settings = normalizeSettings(project.settingsSnapshot);
    const base = {
      projectId,
      channelId: project.channelId,
      traceId: currentTraceId(),
      outputPrefix: projectPrefix(projectId),
    };
    const keys = source.analysisKeys as Partial<StoredAnalysisKeys>;
    let payload: ProjectStagePayloads[ProjectStage];

    switch (stage as ProjectStage) {
      case 'INGEST':
        payload = {
          ...base,
          source:
            source.ingestType === 'UPLOAD'
              ? { type: 'UPLOAD', storageKey: source.storageKey }
              : { type: 'LINK', url: source.sourceUrl!, maxBytes: MAX_SOURCE_BYTES },
          storageKey: source.storageKey,
          maxDurationMs: MAX_SOURCE_DURATION_MS,
        };
        break;
      case 'ANALYZE':
        payload = {
          ...base,
          proxyKey: source.proxyKey!,
          audioKey: source.audioKey!,
          durationMs: source.durationMs!,
          languageHint: null,
        };
        break;
      case 'CANDIDATES':
        payload = {
          ...base,
          durationMs: source.durationMs!,
          wordsKey: source.transcript!.wordsKey,
          segmentsKey: keys.segments!,
          analysisKeys: {
            scenes: keys.scenes!,
            audioEnergy: keys.audioEnergy!,
            diarization: keys.diarization ?? null,
            faces: keys.faces!,
          },
          minDurationSec: settings.minDurationSec,
          maxDurationSec: settings.maxDurationSec,
          maxCandidates: Math.min(60, Math.max(20, settings.maxClipsPerVideo * 4)),
        };
        break;
      case 'SCORE': {
        const candidates = await this.prisma.clipCandidate.findMany({
          where: { projectId, status: 'PROPOSED' },
          orderBy: { startMs: 'asc' },
          select: { id: true, startMs: true, endMs: true, text: true, signals: true },
        });
        payload = {
          ...base,
          language: source.transcript!.language,
          candidates,
          promptAddendum: project.channel.insight?.promptAddendum ?? '',
          tone: settings.commentary.tone,
        };
        break;
      }
    }
    return { payload: payload as ProjectStagePayloads[S], ownerId: project.channel.ownerId };
  }

  /**
   * Projeyi iptal eder. Bekleyen işler kuyruktan silinir; çalışan işler iptal
   * bayrağını görünce durur, sonuçları yok sayılır. Analizi tamamlanmamış
   * projenin kredisi iade edilir.
   */
  async cancel(projectId: string, options: { allowTerminal?: boolean } = {}): Promise<void> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { sourceVideo: true },
    });
    if (!CANCELABLE.includes(project.status)) {
      if (options.allowTerminal) return;
      throw new AppException('INVALID_STATE');
    }

    await this.redis.client.set(cancelKey(projectId), '1', 'EX', 24 * 3600);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.project.updateMany({
        where: { id: projectId, status: project.status },
        data: { status: 'CANCELED' },
      });
      if (claimed.count === 0) throw new AppException('INVALID_STATE');
      await tx.pipelineJob.updateMany({
        where: { projectId, status: { in: ['QUEUED', 'ACTIVE'] } },
        data: { status: 'CANCELED', finishedAt: new Date() },
      });
      const scored = await tx.pipelineJob.count({ where: { projectId, stage: 'SCORE', status: 'SUCCEEDED' } });
      if (scored === 0) await this.entitlements.refundProject(tx, projectId);
    });

    for (const stage of PROJECT_STAGES) {
      const job = await this.queues.queue(PROJECT_STAGE_QUEUE[stage]).getJob(projectJobId(stage, projectId));
      // Çalışan iş kilitlidir ve silinemez; iptal bayrağıyla durur.
      await job?.remove().catch(() => undefined);
    }
    const source = project.sourceVideo;
    if (source?.status === 'UPLOADING' && source.storageKey && source.uploadId) {
      await this.storage.abortMultipart(source.storageKey, source.uploadId);
    }
    await this.publishStatus(projectId);
  }

  /** Başarısız projeyi kaldığı aşamadan sürdürür; tamamlanan aşamalar yeniden çalışmaz. */
  async retry(projectId: string): Promise<void> {
    const failed = await this.prisma.pipelineJob.findFirst({
      where: { projectId, status: 'FAILED' },
      orderBy: { queuedAt: 'desc' },
    });
    const stage = PROJECT_STAGES.find((s) => s === failed?.stage);
    if (!stage) throw new AppException('INVALID_STATE');

    const claimed = await this.prisma.project.updateMany({
      where: { id: projectId, status: 'FAILED' },
      data: { status: PROJECT_STAGE_STATUS[stage], errorCode: null, errorMessage: null },
    });
    if (claimed.count === 0) throw new AppException('INVALID_STATE');
    await this.redis.client.del(cancelKey(projectId));
    await this.enqueue(projectId, stage);
    await this.publishStatus(projectId);
  }

  async publishStatus(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, channelId: true, status: true, progress: true },
    });
    if (!project) return;
    const currentStage =
      (Object.entries(PROJECT_STAGE_STATUS).find(([, status]) => status === project.status)?.[0] as
        | ProjectStage
        | undefined) ?? null;
    await this.realtime.publish(
      [`project:${project.id}`, `channel:${project.channelId}`],
      'project.status',
      { projectId: project.id, status: project.status, progress: project.progress, currentStage },
    );
  }
}
