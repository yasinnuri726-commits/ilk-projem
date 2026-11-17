import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
  private readonly extra: Redis[] = [];

  /** BullMQ ve Socket.IO adaptörü için ayrı bağlantı (bloklayan komutlar paylaşılmaz). */
  duplicate(): Redis {
    const c = this.client.duplicate();
    this.extra.push(c);
    return c;
  }

  /** Atomik sayaç: sınır aşılmıyorsa artırır ve true döner. */
  async incrIfBelow(key: string, by: number, limit: number, ttlSec: number): Promise<boolean> {
    const res = await this.client.eval(
      `local c = tonumber(redis.call('GET', KEYS[1]) or '0')
       if c + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 0 end
       redis.call('INCRBY', KEYS[1], ARGV[1])
       if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
       return 1`,
      1, key, by, limit, ttlSec,
    );
    return res === 1;
  }

  /** Soket adaptörü kapandıktan sonra (dispose sonrası) bağlantılar kapatılır. */
  async onApplicationShutdown() {
    await Promise.all([this.client, ...this.extra].map((c) => c.quit().catch(() => undefined)));
  }
}
