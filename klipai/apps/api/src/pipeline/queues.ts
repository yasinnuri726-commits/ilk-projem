import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import type { PipelineStage } from '@klipai/shared';
import { RedisService } from '../infra/redis.service';

export type QueueName = 'ingest' | 'analyze' | 'candidates' | 'score' | 'commentary' | 'edit' | 'metadata' | 'qc' | 'publish' | 'learn' | 'maintenance';

export const STAGE_QUEUE: Record<Exclude<PipelineStage, 'PUBLISH' | 'LEARN'>, QueueName> = {
  INGEST: 'ingest', ANALYZE: 'analyze', CANDIDATES: 'candidates', SCORE: 'score', COMMENTARY: 'commentary', EDIT: 'edit', METADATA: 'metadata', QC: 'qc',
};

/** Aşama başına deneme sayısı ve üstel geri çekilme başlangıcı (ms). */
export const STAGE_RETRY: Record<keyof typeof STAGE_QUEUE, { attempts: number; delay: number }> = {
  INGEST: { attempts: 3, delay: 30_000 },
  ANALYZE: { attempts: 3, delay: 60_000 },
  CANDIDATES: { attempts: 3, delay: 10_000 },
  SCORE: { attempts: 4, delay: 15_000 },
  COMMENTARY: { attempts: 3, delay: 15_000 },
  EDIT: { attempts: 3, delay: 60_000 },
  METADATA: { attempts: 3, delay: 15_000 },
  QC: { attempts: 2, delay: 10_000 },
};

export interface StageJobData {
  jobId: string;
  kind: 'PIPELINE' | 'RENDER';
  stage: PipelineStage;
  projectId: string;
  clipId?: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class QueuesService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  constructor(private readonly redis: RedisService) {}

  get(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.redis.duplicate(), defaultJobOptions: { removeOnComplete: { age: 86_400, count: 1000 }, removeOnFail: { age: 7 * 86_400 } } });
      this.queues.set(name, q);
    }
    return q;
  }

  addStage(data: StageJobData, priority: number) {
    const stage = data.stage as keyof typeof STAGE_QUEUE;
    const retry = STAGE_RETRY[stage];
    return this.get(STAGE_QUEUE[stage]).add(stage, data, { jobId: data.jobId, attempts: retry.attempts, backoff: { type: 'exponential', delay: retry.delay }, priority });
  }

  add(name: QueueName, jobName: string, data: unknown, opts: JobsOptions = {}) {
    return this.get(name).add(jobName, data, opts);
  }

  async remove(name: QueueName, jobId: string): Promise<void> {
    const job = await this.get(name).getJob(jobId);
    await job?.remove().catch(() => undefined); // çalışan iş kaldırılamaz; işleyici durumu kendisi denetler
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
