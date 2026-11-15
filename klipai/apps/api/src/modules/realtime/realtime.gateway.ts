// Yol: klipai/apps/api/src/modules/realtime/realtime.gateway.ts
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../infra/prisma.service';
import { ChannelAccessService } from '../channels/channel-access.service';
import { RealtimeService } from './realtime.service';

const TOPIC = /^(project|clip|channel|user):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

type Ack = { ok: true } | { ok: false; code: 'INVALID_TOPIC' | 'FORBIDDEN' | 'RESYNC_REQUIRED' };

/**
 * Sözleşme: docs/api/websocket.md
 * Soket yolu REST önekinden (/v1/realtime/...) ayrıdır: engine.io kendi yolunun
 * altındaki tüm istekleri sahiplendiği için bilet ucu aynı önekte olamaz.
 */
@WebSocketGateway({ path: '/v1/ws', transports: ['websocket'], cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger('Realtime');

  constructor(
    private readonly realtime: RealtimeService,
    private readonly access: ChannelAccessService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
    // Kimlik doğrulama bağlantı kurulmadan önce yapılır; biletsiz soket hiç açılmaz.
    server.use((socket, next) => {
      this.realtime
        .consumeTicket(socket.handshake.auth?.ticket)
        .then((session) => {
          if (!session) return next(new Error('UNAUTHORIZED'));
          socket.data.userId = session.userId;
          void socket.join(`user:${session.userId}`);
          const remainingMs = Math.max(0, session.exp * 1000 - Date.now());
          const timer = setTimeout(() => {
            socket.emit('auth:expired', {});
            socket.disconnect(true);
          }, remainingMs);
          socket.on('disconnect', () => clearTimeout(timer));
          next();
        })
        .catch((error: unknown) => {
          this.logger.error({ err: error }, 'Bilet doğrulanamadı');
          next(new Error('UNAUTHORIZED'));
        });
    });
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { topic?: unknown; lastEventId?: unknown },
  ): Promise<Ack> {
    const topic = typeof body?.topic === 'string' ? body.topic : '';
    const match = TOPIC.exec(topic);
    if (!match) return { ok: false, code: 'INVALID_TOPIC' };
    if (!(await this.allowed(socket.data.userId as string, match[1]!, match[2]!))) {
      return { ok: false, code: 'FORBIDDEN' };
    }

    await socket.join(topic);
    if (typeof body.lastEventId === 'string') {
      const missed = await this.realtime.replay(topic, body.lastEventId);
      if (missed === null) return { ok: false, code: 'RESYNC_REQUIRED' };
      for (const envelope of missed) socket.emit('event', envelope);
    }
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { topic?: unknown },
  ): Promise<Ack> {
    if (typeof body?.topic === 'string' && body.topic !== `user:${socket.data.userId}`) {
      await socket.leave(body.topic);
    }
    return { ok: true };
  }

  private async allowed(userId: string, kind: string, id: string): Promise<boolean> {
    if (kind === 'user') return id === userId;
    let channelId: string | undefined = id;
    if (kind === 'project') {
      channelId = (await this.prisma.project.findUnique({ where: { id }, select: { channelId: true } }))?.channelId;
    } else if (kind === 'clip') {
      channelId = (await this.prisma.clip.findUnique({ where: { id }, select: { channelId: true } }))?.channelId;
    }
    if (!channelId) return false;
    try {
      await this.access.require(userId, channelId, 'channel.read');
      return true;
    } catch {
      return false;
    }
  }
}
