import { Body, Controller, Get, HttpCode, Injectable, Logger, Post, Query } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { z } from 'zod';
import { AuthUser, CurrentUser, cursorArgs, toPage, Zod } from '../common/http';
import { PrismaService } from '../infra/infra.module';
import { RealtimeService } from '../realtime/realtime';

type Params = Record<string, string | number | null | undefined>;
type Text = { title: string; body: string };

/** Push metinleri sunucuda kullanıcının diline çevrilir; bildirim merkezi aynı anahtarları istemcide çevirir. */
const TEXTS: Record<NotificationType, { TR: (p: Params) => Text; EN: (p: Params) => Text }> = {
  PROJECT_READY: { TR: (p) => ({ title: 'Analiz tamamlandı', body: `"${p.title}" için ${p.count} kesit hazır.` }), EN: (p) => ({ title: 'Analysis complete', body: `${p.count} clips are ready for "${p.title}".` }) },
  PROJECT_FAILED: { TR: (p) => ({ title: 'Analiz başarısız', body: `"${p.title}" işlenemedi. Yeniden deneyebilirsiniz.` }), EN: (p) => ({ title: 'Analysis failed', body: `"${p.title}" could not be processed. You can retry.` }) },
  CLIP_READY: { TR: (p) => ({ title: 'Klip hazır', body: `"${p.title}" yayına hazır.` }), EN: (p) => ({ title: 'Clip ready', body: `"${p.title}" is ready to publish.` }) },
  CLIP_NEEDS_APPROVAL: { TR: (p) => ({ title: 'Onayınız bekleniyor', body: `"${p.title}" yayın için onay bekliyor.` }), EN: (p) => ({ title: 'Approval needed', body: `"${p.title}" is waiting for your approval.` }) },
  CLIP_PUBLISHED: { TR: (p) => ({ title: 'Yayında', body: `"${p.title}" YouTube'da yayınlandı.` }), EN: (p) => ({ title: 'Published', body: `"${p.title}" is live on YouTube.` }) },
  PUBLISH_FAILED: { TR: (p) => ({ title: 'Yükleme başarısız', body: `"${p.title}" yüklenemedi.` }), EN: (p) => ({ title: 'Upload failed', body: `"${p.title}" could not be uploaded.` }) },
  QUOTA_WARNING: { TR: () => ({ title: 'YouTube kotası doldu', body: 'Planlı yüklemeler kota sıfırlanınca devam edecek.' }), EN: () => ({ title: 'YouTube quota reached', body: 'Scheduled uploads resume when the quota resets.' }) },
  CHANNEL_TOKEN_EXPIRED: { TR: (p) => ({ title: 'Kanal bağlantısı koptu', body: `"${p.title}" kanalını yeniden bağlayın.` }), EN: (p) => ({ title: 'Channel disconnected', body: `Reconnect the channel "${p.title}".` }) },
  CREDITS_LOW: { TR: (p) => ({ title: 'Krediniz azalıyor', body: `Bu dönem ${p.remaining} dakika krediniz kaldı.` }), EN: (p) => ({ title: 'Credits running low', body: `${p.remaining} minutes of credit left this period.` }) },
  SUBSCRIPTION_CHANGED: { TR: (p) => ({ title: 'Abonelik güncellendi', body: `Planınız: ${p.plan}` }), EN: (p) => ({ title: 'Subscription updated', body: `Your plan: ${p.plan}` }) },
  TEAM_INVITE: { TR: (p) => ({ title: 'Ekip daveti', body: `"${p.title}" kanalına davet edildiniz.` }), EN: (p) => ({ title: 'Team invite', body: `You were invited to "${p.title}".` }) },
};

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');
  constructor(private readonly db: PrismaService, private readonly realtime: RealtimeService) {}

  async notify(userId: string, type: NotificationType, params: Params, deepLink?: string): Promise<void> {
    const n = await this.db.notification.create({ data: { userId, type, params: params as object, deepLink } });
    await this.realtime.toUser(userId, 'notification.created', { id: n.id, type, params: params as Record<string, unknown>, deepLink: deepLink ?? null, createdAt: n.createdAt.toISOString() });
    await this.push(userId, type, params, deepLink).catch((e) => this.log.warn(`push gönderilemedi: ${e}`));
    await this.db.notification.update({ where: { id: n.id }, data: { pushedAt: new Date() } });
  }

  async notifyChannel(channelId: string, type: NotificationType, params: Params, deepLink?: string): Promise<void> {
    const ids = await this.realtime.channelUserIds(channelId);
    await Promise.all(ids.map((id) => this.notify(id, type, params, deepLink)));
  }

  private async push(userId: string, type: NotificationType, params: Params, deepLink?: string) {
    const devices = await this.db.device.findMany({ where: { userId } });
    if (!devices.length) return;
    const messages = devices.map((d) => ({ to: d.pushToken, sound: 'default', ...TEXTS[type][d.locale](params), data: { type, deepLink, ...params } }));
    const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(messages) });
    if (!res.ok) throw new Error(`Expo push ${res.status}`);
    const body = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    // Kaldırılmış uygulamaların token'ları temizlenir.
    const dead = devices.filter((_, i) => body.data?.[i]?.details?.error === 'DeviceNotRegistered').map((d) => d.id);
    if (dead.length) await this.db.device.deleteMany({ where: { id: { in: dead } } });
  }
}

const listQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20), unread: z.enum(['true', 'false']).optional() });
const readBody = z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() });

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query(new Zod(listQuery)) q: z.infer<typeof listQuery>) {
    const where = { userId: user.id, ...(q.unread === 'true' ? { readAt: null } : {}) };
    const [rows, unreadCount] = await Promise.all([
      this.db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...cursorArgs(q.cursor, q.limit) }),
      this.db.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { ...toPage(rows, q.limit), unreadCount };
  }

  @Post('read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Body(new Zod(readBody)) body: z.infer<typeof readBody>) {
    await this.db.notification.updateMany({ where: { userId: user.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) }, data: { readAt: new Date() } });
  }
}
