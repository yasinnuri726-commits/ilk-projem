import { Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { LOCALES } from '@klipai/shared';
import { AuthService } from '../auth/auth.service';
import { AppError, notFound } from '../common/errors';
import { AuthUser, bigintReplacer, CurrentUser, Zod } from '../common/http';
import { PrismaService } from '../infra/infra.module';
import { StorageService } from '../infra/storage.service';
import { MailService } from '../infra/infra.module';
import { QueuesService } from '../pipeline/queues';
import { YoutubeClient } from '../publishing/youtube.client';

const patchSchema = z.object({ displayName: z.string().trim().min(1).max(80).optional(), locale: z.enum(LOCALES).optional(), timezone: z.string().min(1).max(64).optional() });
const deviceSchema = z.object({ platform: z.enum(['IOS', 'ANDROID']), pushToken: z.string().min(10).max(255), locale: z.enum(LOCALES).optional(), appVersion: z.string().max(20).optional() });
const DELETE_GRACE_MS = 30 * 86_400_000;

@Injectable()
export class UsersService {
  private readonly log = new Logger('Users');
  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
    private readonly queues: QueuesService,
    private readonly mail: MailService,
    private readonly youtube: YoutubeClient,
  ) {}

  private view(r: { id: string; type: string; status: string; scheduledFor: Date | null; createdAt: Date }) {
    return { id: r.id, type: r.type, status: r.status, scheduledFor: r.scheduledFor, createdAt: r.createdAt };
  }

  /** KVKK/GDPR dışa aktarma: günde bir istek. */
  async requestExport(userId: string) {
    const recent = await this.db.dataRequest.findFirst({ where: { userId, type: 'EXPORT', createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (recent) throw new AppError(429, 'RATE_LIMITED', 'Günde bir dışa aktarma isteği oluşturabilirsiniz');
    const req = await this.db.dataRequest.create({ data: { userId, type: 'EXPORT' } });
    await this.queues.add('maintenance', 'export', { requestId: req.id }, { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } });
    return this.view(req);
  }

  async runExport(requestId: string): Promise<void> {
    const req = await this.db.dataRequest.findUnique({ where: { id: requestId } });
    if (!req || req.status === 'COMPLETED') return;
    await this.db.dataRequest.update({ where: { id: requestId }, data: { status: 'PROCESSING' } });
    const userId = req.userId;
    const [user, identities, devices, subscription, channels, projects, clips, rights, usage, notifications] = await Promise.all([
      this.db.user.findUniqueOrThrow({ where: { id: userId }, omit: { passwordHash: true } }),
      this.db.authIdentity.findMany({ where: { userId } }),
      this.db.device.findMany({ where: { userId }, omit: { pushToken: true } }),
      this.db.subscription.findUnique({ where: { userId } }),
      this.db.channel.findMany({ where: { ownerId: userId }, omit: { accessTokenEnc: true, refreshTokenEnc: true }, include: { settings: true, members: true } }),
      this.db.project.findMany({ where: { userId }, include: { sourceVideo: true, transcript: { omit: { segments: true } }, candidates: true } }),
      this.db.clip.findMany({ where: { project: { userId } }, include: { publishJobs: { omit: { uploadUrl: true } }, stats: true } }),
      this.db.rightsDeclaration.findMany({ where: { userId } }),
      this.db.usageLog.findMany({ where: { userId, kind: { in: ['CREDIT_GRANT', 'CREDIT_CONSUME', 'CREDIT_REFUND', 'CLIP_RENDER'] } } }),
      this.db.notification.findMany({ where: { userId } }),
    ]);
    const key = `exports/${userId}/${requestId}.json`;
    const body = JSON.parse(JSON.stringify({ exportedAt: new Date(), user, identities, devices, subscription, channels, projects, clips, rightsDeclarations: rights, usage, notifications }, bigintReplacer));
    await this.storage.putJson(key, body);
    await this.db.dataRequest.update({ where: { id: requestId }, data: { status: 'COMPLETED', resultKey: key, completedAt: new Date() } });
    const url = await this.storage.signGet(key, 7 * 86_400, 'klipai-verilerim.json');
    await this.mail.send(user.email, user.locale === 'TR' ? 'KlipAI verileriniz hazır' : 'Your KlipAI data is ready', user.locale === 'TR' ? `Verilerinizi 7 gün içinde indirebilirsiniz:\n${url}` : `Download your data within 7 days:\n${url}`);
  }

  /** Hesap hemen devre dışı kalır; 30 gün sonra kalıcı silinir. */
  async requestDelete(userId: string) {
    const scheduledFor = new Date(Date.now() + DELETE_GRACE_MS);
    const [, , req] = await this.db.$transaction([
      this.db.user.update({ where: { id: userId }, data: { deletedAt: new Date() } }),
      this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.db.dataRequest.create({ data: { userId, type: 'DELETE', scheduledFor } }),
      this.db.device.deleteMany({ where: { userId } }),
      this.db.publishJob.updateMany({ where: { channel: { ownerId: userId }, status: { in: ['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED', 'RETRY_WAIT'] } }, data: { status: 'CANCELED' } }),
    ]);
    return this.view(req);
  }

  /** Bekleme süresi dolan hesapları kalıcı siler. Hak beyanları anonimleştirilerek saklanır (hukuki yükümlülük). */
  async purgeDue(now: Date): Promise<void> {
    const due = await this.db.dataRequest.findMany({ where: { type: 'DELETE', status: 'PENDING', scheduledFor: { lte: now } }, take: 20 });
    for (const req of due) {
      try {
        const userId = req.userId;
        const [channels, projects, clips] = await Promise.all([
          this.db.channel.findMany({ where: { ownerId: userId } }),
          this.db.project.findMany({ where: { OR: [{ userId }, { channel: { ownerId: userId } }] }, select: { id: true } }),
          this.db.clip.findMany({ where: { channel: { ownerId: userId } }, select: { id: true } }),
        ]);
        for (const ch of channels) if (ch.status !== 'DISCONNECTED') await this.youtube.revoke(ch);
        await Promise.all([
          this.storage.deletePrefix(`uploads/${userId}/`), this.storage.deletePrefix(`assets/${userId}/`), this.storage.deletePrefix(`exports/${userId}/`),
          ...projects.map((p) => this.storage.deletePrefix(`projects/${p.id}/`)), ...clips.map((c) => this.storage.deletePrefix(`clips/${c.id}/`)),
        ]);
        await this.db.rightsDeclaration.updateMany({ where: { userId }, data: { ip: 'anonymized', userAgent: 'anonymized' } });
        await this.db.user.delete({ where: { id: userId } }); // ilişkili kayıtlar cascade ile silinir; DataRequest de dahil
      } catch (e) {
        this.log.error(`hesap silinemedi (${req.userId}): ${e}`);
        await this.db.dataRequest.update({ where: { id: req.id }, data: { status: 'FAILED' } }).catch(() => undefined);
      }
    }
  }
}

@Controller('me')
export class UsersController {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly users: UsersService) {}

  @Get()
  async me(@CurrentUser() u: AuthUser) {
    return this.auth.publicUser(await this.db.user.findUniqueOrThrow({ where: { id: u.id } }));
  }

  @Patch()
  async patch(@CurrentUser() u: AuthUser, @Body(new Zod(patchSchema)) dto: z.infer<typeof patchSchema>) {
    return this.auth.publicUser(await this.db.user.update({ where: { id: u.id }, data: dto }));
  }

  @Delete()
  @HttpCode(202)
  remove(@CurrentUser() u: AuthUser) {
    return this.users.requestDelete(u.id);
  }

  @Post('export')
  @HttpCode(202)
  export(@CurrentUser() u: AuthUser) {
    return this.users.requestExport(u.id);
  }

  @Post('devices')
  async registerDevice(@CurrentUser() u: AuthUser, @Body(new Zod(deviceSchema)) dto: z.infer<typeof deviceSchema>) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: u.id } });
    const data = { userId: u.id, platform: dto.platform, locale: dto.locale ?? user.locale, appVersion: dto.appVersion, lastSeenAt: new Date() };
    const d = await this.db.device.upsert({ where: { pushToken: dto.pushToken }, update: data, create: { ...data, pushToken: dto.pushToken } });
    return { id: d.id };
  }

  @Delete('devices/:id')
  @HttpCode(204)
  async removeDevice(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const res = await this.db.device.deleteMany({ where: { id, userId: u.id } });
    if (!res.count) throw notFound('Cihaz');
  }
}
