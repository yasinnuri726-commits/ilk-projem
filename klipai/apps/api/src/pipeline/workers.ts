import { Body, Controller, Get, Headers, HttpCode, Injectable, Logger, OnModuleDestroy, OnModuleInit, Param, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import * as Sentry from '@sentry/node';
import { Job, Worker } from 'bullmq';
import { verifyServiceSignature } from '../common/crypto';
import { AppError } from '../common/errors';
import { AuthedRequest, Public, Zod } from '../common/http';
import { env } from '../config';
import { PrismaService } from '../infra/infra.module';
import { RedisService } from '../infra/redis.service';
import { StorageService } from '../infra/storage.service';
import { LearningService } from '../learning/learning.service';
import { PublishProcessor } from '../publishing/publish.processor';
import { PublishingService } from '../publishing/publishing.service';
import { UsersService } from '../users/users';
import { JobEvent, jobEventSchema, Orchestrator } from './orchestrator.service';
import { QueuesService } from './queues';

/** Video servisinin ilerleme/sonuç bildirdiği iç uç (HMAC imzalı, yalnızca özel ağ). */
@Public()
@SkipThrottle()
@Controller('internal')
export class InternalController {
  constructor(private readonly orchestrator: Orchestrator) {}

  @Post('jobs/:jobId/events')
  @HttpCode(204)
  async event(@Param('jobId') jobId: string, @Headers('x-timestamp') ts: string, @Headers('x-signature') sig: string, @Req() req: AuthedRequest, @Body(new Zod(jobEventSchema)) ev: JobEvent) {
    if (!req.rawBody || !verifyServiceSignature(req.rawBody, ts, sig, env().INTERNAL_HMAC_SECRET)) throw new AppError(401, 'UNAUTHENTICATED', 'İmza geçersiz');
    await this.orchestrator.handleEvent(jobId, ev);
  }
}

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaService, private readonly redis: RedisService, private readonly storage: StorageService) {}

  @Get()
  async health() {
    const check = async (fn: () => Promise<unknown>) => fn().then(() => 'ok', () => 'fail');
    const checks = {
      db: await check(() => this.db.$queryRaw`SELECT 1`),
      redis: await check(() => this.redis.client.ping()),
      storage: await check(() => this.storage.ping()),
    };
    return { status: Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'degraded', checks };
  }
}

/** API sürecinde çalışan kuyruk tüketicileri: yayın, öğrenme ve bakım. */
@Injectable()
export class Workers implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Workers');
  private workers: Worker[] = [];

  constructor(
    private readonly redis: RedisService,
    private readonly queues: QueuesService,
    private readonly db: PrismaService,
    private readonly storage: StorageService,
    private readonly publish: PublishProcessor,
    private readonly publishing: PublishingService,
    private readonly learning: LearningService,
    private readonly users: UsersService,
  ) {}

  async onModuleInit() {
    if (!env().RUN_WORKERS) return;
    const make = (name: string, fn: (job: Job) => Promise<void>, concurrency: number) => {
      const w = new Worker(name, fn, { connection: this.redis.duplicate(), concurrency });
      w.on('failed', (job, err) => {
        this.log.error(`${name} işi başarısız (${job?.id}): ${err.message}`);
        Sentry.captureException(err, { tags: { queue: name } });
      });
      this.workers.push(w);
    };
    make('publish', (job) => this.publish.process(job.data.publishJobId), 4);
    make('learn', (job) => this.learning.collect(job.data.clipId, job.data.window), 4);
    make('maintenance', (job) => (job.name === 'export' ? this.users.runExport(job.data.requestId) : this.sweep()), 1);
    await this.queues.get('maintenance').upsertJobScheduler('sweep', { every: 5 * 60_000 }, { name: 'sweep' });
  }

  /** Beş dakikada bir: kaçmış yayınları yakalar, süresi dolan yüklemeleri ve silinmesi gereken hesapları temizler. */
  async sweep(): Promise<void> {
    const now = new Date();
    const due = await this.db.publishJob.findMany({
      where: { OR: [{ status: 'SCHEDULED', scheduledAt: { lte: now } }, { status: 'RETRY_WAIT', nextAttemptAt: { lte: now } }, { status: 'UPLOADING', updatedAt: { lte: new Date(now.getTime() - 15 * 60_000) } }] },
      take: 100,
    });
    // Zaman damgası 5 dk'lık kovaya yuvarlanır: aynı süpürme penceresinde iş bir kez eklenir.
    for (const j of due) await this.publishing.enqueue(j, new Date(Math.floor(now.getTime() / 300_000) * 300_000));

    const stale = await this.db.uploadSession.findMany({ where: { status: { in: ['INITIATED', 'IN_PROGRESS'] }, expiresAt: { lte: now } }, take: 100 });
    for (const u of stale) {
      await this.storage.abortMultipart(u.storageKey, u.s3UploadId);
      await this.db.uploadSession.update({ where: { id: u.id }, data: { status: 'EXPIRED' } });
    }
    await this.db.refreshToken.deleteMany({ where: { expiresAt: { lte: new Date(now.getTime() - 7 * 86_400_000) } } });
    await this.db.oneTimeToken.deleteMany({ where: { expiresAt: { lte: now } } });
    await this.users.purgeDue(now);
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
