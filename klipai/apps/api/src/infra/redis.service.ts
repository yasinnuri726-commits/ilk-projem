// Yol: klipai/apps/api/src/infra/redis.service.ts
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  /** Genel amaçlı bağlantı (önbellek, sayaç, yayın). */
  readonly client: Redis;
  private readonly extra: Redis[] = [];

  constructor(private readonly config: AppConfig) {
    this.client = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  }

  /**
   * Ayrı bağlantı açar. BullMQ worker / QueueEvents ve pub/sub aboneliği
   * engelleyici komut kullandığı için kendi bağlantısına ihtiyaç duyar.
   */
  duplicate(): Redis {
    const connection = new Redis(this.config.redisUrl, { maxRetriesPerRequest: null });
    this.extra.push(connection);
    return connection;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client, ...this.extra].map((c) => c.quit()));
  }
}
