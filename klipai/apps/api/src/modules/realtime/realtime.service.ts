// Yol: klipai/apps/api/src/modules/realtime/realtime.service.ts
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Server } from 'socket.io';
import { REALTIME_CHANNEL, type RealtimeEnvelope, realtimeStreamKey } from '@klipai/shared';
import { AppConfig } from '../../config/app-config';
import { randomToken } from '../../infra/crypto.service';
import { RedisService } from '../../infra/redis.service';

const STREAM_MAX = 200;
const STREAM_TTL_SEC = 3600;
const TICKET_TTL_SEC = 30;

export interface TicketSession {
  userId: string;
  /** Erişim token'ının bitişi (epoch saniye); bağlantı bu anda kapatılır. */
  exp: number;
}

/** Redis akış kimliklerini ("ms-sıra") karşılaştırır. */
function compareIds(a: string, b: string): number {
  const [am, as] = a.split('-').map((n) => BigInt(n || '0'));
  const [bm, bs] = b.split('-').map((n) => BigInt(n || '0'));
  if (am !== bm) return am! < bm! ? -1 : 1;
  if (as !== bs) return as! < bs! ? -1 : 1;
  return 0;
}

/**
 * Canlı olay dağıtımı. Olay konu başına bir Redis Stream'e yazılır (yeniden
 * bağlanan istemciye tekrar oynatmak için) ve pub/sub ile tüm API örneklerine
 * duyurulur; her örnek kendi bağlı soketlerine iletir. Worker süreçleri de
 * aynı yolla yayın yapar.
 */
@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly logger = new Logger('Realtime');
  private server?: Server;

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.role === 'worker') return;
    const subscriber = this.redis.duplicate();
    await subscriber.subscribe(REALTIME_CHANNEL);
    subscriber.on('message', (_channel, message) => {
      try {
        const envelope = JSON.parse(message) as RealtimeEnvelope;
        this.server?.to(envelope.topic).emit('event', envelope);
      } catch (error) {
        this.logger.error({ err: error }, 'Canlı olay iletilemedi');
      }
    });
  }

  attach(server: Server): void {
    this.server = server;
  }

  async publish(topics: string[], type: string, data: unknown): Promise<void> {
    const at = new Date().toISOString();
    try {
      for (const topic of topics) {
        const key = realtimeStreamKey(topic);
        const body = JSON.stringify({ type, at, data });
        const id = (await this.redis.client.xadd(key, 'MAXLEN', '~', STREAM_MAX, '*', 'e', body)) as string;
        await this.redis.client.expire(key, STREAM_TTL_SEC);
        const envelope: RealtimeEnvelope = { id, topic, type, at, data };
        await this.redis.client.publish(REALTIME_CHANNEL, JSON.stringify(envelope));
      }
    } catch (error) {
      // Canlı olay yalnızca tazeleme sinyalidir; yayın hatası işi başarısız kılmaz.
      this.logger.error({ err: error, type }, 'Canlı olay yayınlanamadı');
    }
  }

  /**
   * lastEventId'den sonraki olayları döndürür. Akış kırpılmış ya da süresi
   * dolmuşsa null döner: istemci REST'ten yeniden eşitlemelidir.
   */
  async replay(topic: string, lastEventId: string): Promise<RealtimeEnvelope[] | null> {
    if (!/^\d+-\d+$/.test(lastEventId)) return null;
    const key = realtimeStreamKey(topic);
    const first = await this.redis.client.xrange(key, '-', '+', 'COUNT', 1);
    if (first.length === 0 || compareIds(lastEventId, first[0]![0]) < 0) return null;
    const entries = await this.redis.client.xrange(key, `(${lastEventId}`, '+', 'COUNT', STREAM_MAX);
    return entries.map(([id, fields]) => {
      const body = JSON.parse(fields[1]!) as { type: string; at: string; data: unknown };
      return { id, topic, ...body };
    });
  }

  async createTicket(session: TicketSession): Promise<{ ticket: string; url: string; expiresAt: string }> {
    const ticket = randomToken(24);
    await this.redis.client.set(`klipai:rt:ticket:${ticket}`, JSON.stringify(session), 'EX', TICKET_TTL_SEC);
    return {
      ticket,
      url: this.config.publicWsUrl,
      expiresAt: new Date(Date.now() + TICKET_TTL_SEC * 1000).toISOString(),
    };
  }

  /** Bilet tek kullanımlıktır. */
  async consumeTicket(ticket: unknown): Promise<TicketSession | null> {
    if (typeof ticket !== 'string' || !/^[\w-]{20,64}$/.test(ticket)) return null;
    const raw = await this.redis.client.getdel(`klipai:rt:ticket:${ticket}`);
    return raw ? (JSON.parse(raw) as TicketSession) : null;
  }
}
