import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import type { WsEnvelope, WsEvents, WsEventType } from '@klipai/shared';
import { verifyAccessToken } from '../common/jwt';
import { bigintReplacer } from '../common/http';
import { PrismaService } from '../infra/infra.module';
import { RedisService } from '../infra/redis.service';

const STREAM_MAXLEN = 200;
const REPLAY_WINDOW_MS = 5 * 60_000;

/** Olayları kullanıcı odalarına yayar ve yeniden bağlanma için Redis Stream'de 5 dk tutar. */
@Injectable()
export class RealtimeService {
  server?: Server;
  constructor(private readonly redis: RedisService, private readonly db: PrismaService) {}

  async toUser<T extends WsEventType>(userId: string, type: T, data: WsEvents[T]): Promise<void> {
    const ts = new Date().toISOString();
    const payload = JSON.stringify({ type, ts, data }, bigintReplacer);
    const id = (await this.redis.client.xadd(`ws:user:${userId}`, 'MAXLEN', '~', STREAM_MAXLEN, '*', 'e', payload)) as string;
    await this.redis.client.expire(`ws:user:${userId}`, 600);
    this.server?.to(`user:${userId}`).emit('event', { id, ...JSON.parse(payload) } as WsEnvelope<T>);
  }

  /** Kanalın sahibi ve kabul etmiş tüm üyeleri. */
  async channelUserIds(channelId: string): Promise<string[]> {
    const cacheKey = `ws:members:${channelId}`;
    const cached = await this.redis.client.get(cacheKey);
    if (cached) return JSON.parse(cached);
    const ch = await this.db.channel.findUnique({ where: { id: channelId }, select: { ownerId: true, members: { where: { acceptedAt: { not: null }, userId: { not: null } }, select: { userId: true } } } });
    const ids = ch ? [...new Set([ch.ownerId, ...ch.members.map((m) => m.userId!)])] : [];
    await this.redis.client.set(cacheKey, JSON.stringify(ids), 'EX', 60);
    return ids;
  }
  async invalidateChannel(channelId: string) {
    await this.redis.client.del(`ws:members:${channelId}`);
  }

  async toChannel<T extends WsEventType>(channelId: string, type: T, data: WsEvents[T]): Promise<void> {
    const ids = await this.channelUserIds(channelId);
    await Promise.all(ids.map((id) => this.toUser(id, type, data)));
  }

  /** İlerleme olayları iş başına saniyede en çok bir kez yayılır. */
  async throttled(key: string): Promise<boolean> {
    return (await this.redis.client.set(`ws:thr:${key}`, '1', 'PX', 1000, 'NX')) === 'OK';
  }

  /** Verilen süre içinde anahtar başına yalnızca bir kez true döner. */
  async throttledFor(key: string, seconds: number): Promise<boolean> {
    return (await this.redis.client.set(`ws:thr:${key}`, '1', 'EX', seconds, 'NX')) === 'OK';
  }

  async replay(userId: string, lastEventId: string): Promise<WsEnvelope[]> {
    if (!/^\d+-\d+$/.test(lastEventId)) return [];
    if (Date.now() - Number(lastEventId.split('-')[0]) > REPLAY_WINDOW_MS) return [];
    const rows = await this.redis.client.xrange(`ws:user:${userId}`, `(${lastEventId}`, '+');
    return rows.map(([id, fields]) => ({ id, ...JSON.parse(fields[1]) }));
  }
}

@WebSocketGateway({ path: '/ws', transports: ['websocket'], cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server: Server;

  constructor(private readonly realtime: RealtimeService, private readonly redis: RedisService) {}

  afterInit(server: Server) {
    server.adapter(createAdapter(this.redis.duplicate(), this.redis.duplicate()));
    this.realtime.server = server;
  }

  async handleConnection(socket: Socket) {
    try {
      const user = verifyAccessToken(String(socket.handshake.auth?.token ?? ''));
      socket.data.userId = user.id;
      await socket.join(`user:${user.id}`);
      const last = socket.handshake.auth?.lastEventId;
      if (typeof last === 'string') {
        const missed = await this.realtime.replay(user.id, last);
        // Pencere dışında kalındıysa istemci önbelleğini tazeler.
        if (!missed.length && Date.now() - Number(last.split('-')[0]) > REPLAY_WINDOW_MS) socket.emit('resync');
        for (const e of missed) socket.emit('event', e);
      }
    } catch {
      socket.emit('auth.expired');
      socket.disconnect(true);
    }
  }
}
