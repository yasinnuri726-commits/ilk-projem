// Yol: klipai/apps/api/src/infra/queue.service.ts
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type JobsOptions, Queue, QueueEvents, Worker, type Processor } from 'bullmq';
import { QUEUE_POLICIES, QUEUES, type QueueName } from '@klipai/shared';
import { RedisService } from './redis.service';

/** BullMQ kuyruklarının tek sahibi. Kuyruklar ilk kullanımda açılır. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  private readonly closables: { close(): Promise<void> }[] = [];

  constructor(private readonly redis: RedisService) {}

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.redis.duplicate() });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** Kuyruğun politikasına (deneme, geri çekilme) göre iş seçenekleri. */
  jobOptions(name: QueueName, extra: JobsOptions = {}): JobsOptions {
    const policy = QUEUE_POLICIES[name];
    return {
      attempts: policy.attempts,
      backoff: policy.backoff,
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
      ...extra,
    };
  }

  events(name: QueueName): QueueEvents {
    const events = new QueueEvents(name, { connection: this.redis.duplicate() });
    this.closables.push(events);
    return events;
  }

  worker<T, R>(name: QueueName, processor: Processor<T, R>, concurrency = 1): Worker<T, R> {
    const worker = new Worker<T, R>(name, processor, {
      connection: this.redis.duplicate(),
      concurrency,
    });
    this.closables.push(worker);
    return worker;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      ...this.closables.map((c) => c.close()),
      ...[...this.queues.values()].map((q) => q.close()),
    ]);
  }

  /** Sağlık ve ölçüm için: kuyruk başına bekleyen / etkin / başarısız iş sayısı. */
  async depths(): Promise<Record<string, Record<string, number>>> {
    const out: Record<string, Record<string, number>> = {};
    for (const name of Object.values(QUEUES)) {
      out[name] = await this.queue(name).getJobCounts('waiting', 'active', 'delayed', 'failed');
    }
    return out;
  }
}
