// Yol: klipai/apps/api/src/modules/pipeline/maintenance.service.ts
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  PROJECT_STAGE_QUEUE,
  PROJECT_STAGE_STATUS,
  PROJECT_STAGES,
  type ProjectStage,
  projectJobId,
  QUEUES,
} from '@klipai/shared';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma.service';
import { QueueService } from '../../infra/queue.service';
import { StorageService } from '../../infra/storage.service';
import { OrchestratorService } from './orchestrator.service';
import { PipelineService } from './pipeline.service';

const RECONCILE_EVERY_MS = 60_000;
const CLEANUP_EVERY_MS = 3_600_000;
const STALE_AFTER_MS = 90_000;
const UPLOAD_TTL_MS = 48 * 3_600_000;

/**
 * Zamanlanmış bakım işleri.
 *  - reconcile: orkestratör kapalıyken ya da çökme anında kaçan kuyruk
 *    olaylarını telafi eder; hat hiçbir durumda yarıda takılı kalmaz.
 *  - cleanup-uploads: 48 saatte tamamlanmayan parçalı yüklemeleri kapatır.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Maintenance');

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly storage: StorageService,
    private readonly orchestrator: OrchestratorService,
    private readonly pipeline: PipelineService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.runsWorkers) return;
    const queue = this.queues.queue(QUEUES.MAINTENANCE);
    await queue.upsertJobScheduler('reconcile', { every: RECONCILE_EVERY_MS }, { name: 'reconcile' });
    await queue.upsertJobScheduler('cleanup-uploads', { every: CLEANUP_EVERY_MS }, { name: 'cleanup-uploads' });
    this.queues.worker(QUEUES.MAINTENANCE, async (job) => {
      if (job.name === 'reconcile') return { repaired: await this.reconcile() };
      if (job.name === 'cleanup-uploads') return { aborted: await this.cleanupUploads() };
      return null;
    });
  }

  /** Takılı görünen projelerin kuyruk işine bakar ve eksik adımı tamamlar. */
  async reconcile(staleAfterMs = STALE_AFTER_MS): Promise<number> {
    const stuck = await this.prisma.project.findMany({
      where: {
        status: { in: Object.values(PROJECT_STAGE_STATUS) },
        updatedAt: { lt: new Date(Date.now() - staleAfterMs) },
      },
      select: { id: true, status: true },
      take: 200,
    });
    let repaired = 0;
    for (const project of stuck) {
      const stage = PROJECT_STAGES.find((s) => PROJECT_STAGE_STATUS[s] === project.status) as ProjectStage;
      const jobId = projectJobId(stage, project.id);
      try {
        const job = await this.queues.queue(PROJECT_STAGE_QUEUE[stage]).getJob(jobId);
        const state = job ? await job.getState() : 'missing';
        if (state === 'missing') {
          await this.pipeline.enqueue(project.id, stage);
        } else if (state === 'completed') {
          await this.orchestrator.onCompleted(stage, jobId);
        } else if (state === 'failed') {
          await this.orchestrator.onFailed(stage, jobId, job!.failedReason);
        } else {
          continue;
        }
        repaired += 1;
        this.logger.warn({ projectId: project.id, stage, state }, 'Takılı proje onarıldı');
      } catch (error) {
        this.logger.error({ err: error, projectId: project.id, stage }, 'Proje onarılamadı');
      }
    }
    return repaired;
  }

  async cleanupUploads(): Promise<number> {
    const stale = await this.prisma.sourceVideo.findMany({
      where: { status: 'UPLOADING', updatedAt: { lt: new Date(Date.now() - UPLOAD_TTL_MS) } },
      take: 200,
    });
    for (const source of stale) {
      if (source.storageKey && source.uploadId) await this.storage.abortMultipart(source.storageKey, source.uploadId);
      await this.prisma.sourceVideo.update({
        where: { id: source.id },
        data: { status: 'FAILED', uploadId: null, errorCode: 'UPLOAD_EXPIRED' },
      });
    }
    return stale.length;
  }
}
