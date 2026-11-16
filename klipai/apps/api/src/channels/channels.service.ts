import { Injectable } from '@nestjs/common';
import type { Channel, ChannelRole, Settings } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { ChannelSettings, ChannelSettingsPatch, clampResolution, DEFAULT_SETTINGS } from '@klipai/shared';
import { EntitlementsService } from '../billing/entitlements.service';
import { encrypt, randomToken, sha256 } from '../common/crypto';
import { AppError, forbidden, notFound } from '../common/errors';
import { env } from '../config';
import { MailService, PrismaService } from '../infra/infra.module';
import { NotificationsService } from '../notifications/notifications';
import { YoutubeClient } from '../publishing/youtube.client';
import { RealtimeService } from '../realtime/realtime';

const RANK: Record<ChannelRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

export function toSettings(s: Settings): ChannelSettings {
  return {
    automationMode: s.automationMode, dailyClipCount: s.dailyClipCount, timeSlots: s.timeSlots as ChannelSettings['timeSlots'], timezone: s.timezone, useBestTimes: s.useBestTimes,
    minDurationSec: s.minDurationSec, maxDurationSec: s.maxDurationSec, minScore: s.minScore, maxClipsPerVideo: s.maxClipsPerVideo,
    aspectRatio: s.aspectRatio, resolution: s.resolution,
    subtitle: { ...DEFAULT_SETTINGS.subtitle, ...(s.subtitle as object) },
    commentaryFormat: s.commentaryFormat, commentaryTone: s.commentaryTone, commentaryPrompt: s.commentaryPrompt, commentaryMaxSec: s.commentaryMaxSec,
    audio: { ...DEFAULT_SETTINGS.audio, ...(s.audio as object) },
    brand: { ...DEFAULT_SETTINGS.brand, ...(s.brand as object) },
    titleLanguage: s.titleLanguage, fixedTags: s.fixedTags, descriptionTemplate: s.descriptionTemplate, youtubeCategoryId: s.youtubeCategoryId,
    defaultPrivacy: s.defaultPrivacy, madeForKids: s.madeForKids,
  };
}

@Injectable()
export class ChannelsService {
  constructor(
    private readonly db: PrismaService,
    private readonly youtube: YoutubeClient,
    private readonly entitlements: EntitlementsService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  /** Kullanıcının kanaldaki rolünü döner; yetki yetersizse hata fırlatır. */
  async access(userId: string, channelId: string, min: ChannelRole = 'VIEWER'): Promise<{ channel: Channel; role: ChannelRole }> {
    const channel = await this.db.channel.findUnique({ where: { id: channelId }, include: { members: { where: { userId, acceptedAt: { not: null } } } } });
    if (!channel) throw notFound('Kanal');
    const role: ChannelRole | undefined = channel.ownerId === userId ? 'OWNER' : channel.members[0]?.role;
    if (!role) throw notFound('Kanal'); // üye olmayanlara varlığı sızdırılmaz
    if (RANK[role] < RANK[min]) throw forbidden();
    return { channel, role };
  }

  /** Kullanıcının erişebildiği kanal kimlikleri. */
  async accessibleIds(userId: string): Promise<string[]> {
    const rows = await this.db.channel.findMany({
      where: { status: { not: 'DISCONNECTED' }, OR: [{ ownerId: userId }, { members: { some: { userId, acceptedAt: { not: null } } } }] },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  view(c: Channel, role: ChannelRole) {
    return { id: c.id, youtubeChannelId: c.youtubeChannelId, title: c.title, handle: c.handle, thumbnailUrl: c.thumbnailUrl, status: c.status, role, subscriberCount: c.subscriberCount, createdAt: c.createdAt };
  }

  async list(userId: string) {
    const rows = await this.db.channel.findMany({
      where: { status: { not: 'DISCONNECTED' }, OR: [{ ownerId: userId }, { members: { some: { userId, acceptedAt: { not: null } } } }] },
      include: { members: { where: { userId } } }, orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map((c) => this.view(c, c.ownerId === userId ? 'OWNER' : c.members[0].role)) };
  }

  // ── YouTube OAuth ──
  private redirectUri() {
    return `${env().PUBLIC_API_URL}/v1/channels/youtube/oauth/callback`;
  }

  async startOAuth(userId: string) {
    const state = jwt.sign({ purpose: 'yt-oauth', nonce: randomToken(8) }, env().JWT_ACCESS_SECRET, { subject: userId, expiresIn: 600 });
    return { authUrl: this.youtube.authUrl(state, this.redirectUri()), state };
  }

  /** Google'ın yönlendirdiği uç: kodu token'a çevirir, kanalı kaydeder, uygulamaya derin bağlantıyla döner. */
  async completeOAuth(code: string | undefined, state: string | undefined, error: string | undefined): Promise<string> {
    const back = (params: Record<string, string>) => `${env().APP_SCHEME}://oauth/youtube?${new URLSearchParams(params)}`;
    try {
      if (error || !code || !state) throw new AppError(400, 'VALIDATION_FAILED', error ?? 'Eksik parametre');
      let userId: string;
      try {
        const p = jwt.verify(state, env().JWT_ACCESS_SECRET) as { sub: string; purpose: string };
        if (p.purpose !== 'yt-oauth') throw new Error();
        userId = p.sub;
      } catch {
        throw new AppError(400, 'VALIDATION_FAILED', 'Geçersiz state');
      }
      const tokens = await this.youtube.exchangeCode(code, this.redirectUri());
      const yt = await this.youtube.myChannel(tokens.access_token);
      const existing = await this.db.channel.findUnique({ where: { youtubeChannelId: yt.id } });
      if (existing && existing.ownerId !== userId && existing.status !== 'DISCONNECTED') throw forbidden('Bu kanal başka bir hesaba bağlı');
      if (!existing || existing.status === 'DISCONNECTED') await this.entitlements.assertChannelSlot(userId);
      if (!tokens.refresh_token && !existing) throw new AppError(400, 'VALIDATION_FAILED', 'Google yenileme belirteci vermedi; izinleri kaldırıp tekrar deneyin');

      const key = env().TOKEN_ENC_KEY;
      const data = {
        ownerId: userId, title: yt.title, handle: yt.handle, thumbnailUrl: yt.thumbnailUrl, subscriberCount: yt.subscriberCount, status: 'ACTIVE' as const,
        accessTokenEnc: encrypt(tokens.access_token, key), tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000), scopes: tokens.scope.split(' '), lastSyncedAt: new Date(),
        ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token, key) } : {}),
      };
      const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
      const channel = await this.db.channel.upsert({
        where: { youtubeChannelId: yt.id },
        update: data,
        create: { ...data, refreshTokenEnc: encrypt(tokens.refresh_token!, key), youtubeChannelId: yt.id, settings: { create: { timezone: user.timezone, titleLanguage: user.locale } } },
      });
      await this.realtime.invalidateChannel(channel.id);
      return back({ status: 'ok', channelId: channel.id });
    } catch (e) {
      return back({ status: 'error', code: e instanceof AppError ? e.code : 'UPSTREAM_ERROR', message: e instanceof Error ? e.message.slice(0, 200) : '' });
    }
  }

  async disconnect(userId: string, channelId: string) {
    const { channel } = await this.access(userId, channelId, 'OWNER');
    await this.youtube.revoke(channel);
    await this.db.$transaction([
      this.db.publishJob.updateMany({ where: { channelId, status: { in: ['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED', 'RETRY_WAIT'] } }, data: { status: 'CANCELED' } }),
      this.db.clip.updateMany({ where: { channelId, status: 'SCHEDULED' }, data: { status: 'READY' } }),
      this.db.channel.update({ where: { id: channelId }, data: { status: 'DISCONNECTED' } }),
    ]);
    await this.realtime.invalidateChannel(channelId);
  }

  // ── Ayarlar ──
  async getSettings(channelId: string): Promise<ChannelSettings> {
    const row = await this.db.settings.upsert({ where: { channelId }, update: {}, create: { channelId } });
    return toSettings(row);
  }

  async updateSettings(userId: string, channelId: string, patch: ChannelSettingsPatch): Promise<ChannelSettings> {
    const { channel } = await this.access(userId, channelId, 'EDITOR');
    const current = await this.getSettings(channelId);
    const next = { ...current, ...patch };
    if (next.minDurationSec > next.maxDurationSec) throw new AppError(422, 'VALIDATION_FAILED', 'En kısa süre en uzun süreden büyük olamaz');
    if (patch.resolution) {
      const e = await this.entitlements.get(channel.ownerId);
      if (clampResolution(patch.resolution, e.limits.maxResolution) !== patch.resolution) throw new AppError(402, 'PLAN_REQUIRED', 'Bu çözünürlük için planınızı yükseltin');
    }
    const row = await this.db.settings.update({ where: { channelId }, data: patch });
    return toSettings(row);
  }

  // ── Üyeler ──
  async listMembers(userId: string, channelId: string) {
    const { channel } = await this.access(userId, channelId, 'VIEWER');
    const [owner, members] = await Promise.all([
      this.db.user.findUniqueOrThrow({ where: { id: channel.ownerId } }),
      this.db.channelMember.findMany({ where: { channelId }, include: { user: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      items: [
        { id: 'owner', userId: owner.id, email: owner.email, displayName: owner.displayName, role: 'OWNER' as ChannelRole, acceptedAt: channel.createdAt },
        ...members.map((m) => ({ id: m.id, userId: m.userId, email: m.user?.email ?? m.inviteEmail!, displayName: m.user?.displayName ?? null, role: m.role, acceptedAt: m.acceptedAt })),
      ],
    };
  }

  async invite(userId: string, channelId: string, email: string, role: 'EDITOR' | 'VIEWER') {
    const { channel } = await this.access(userId, channelId, 'OWNER');
    const e = await this.entitlements.get(userId);
    if (!e.limits.teamAccess) throw new AppError(402, 'PLAN_REQUIRED', 'Ekip erişimi Ajans planında kullanılabilir');
    const invitee = await this.db.user.findUnique({ where: { email } });
    if (invitee?.id === userId) throw new AppError(422, 'VALIDATION_FAILED', 'Kendinizi davet edemezsiniz');
    const token = randomToken(24);
    const data = { role, invitedById: userId, inviteTokenHash: sha256(token), acceptedAt: null };
    const member = invitee
      ? await this.db.channelMember.upsert({ where: { channelId_userId: { channelId, userId: invitee.id } }, update: data, create: { channelId, userId: invitee.id, ...data } })
      : await this.db.channelMember.upsert({ where: { channelId_inviteEmail: { channelId, inviteEmail: email } }, update: data, create: { channelId, inviteEmail: email, ...data } });
    const link = `${env().APP_SCHEME}://invite?token=${token}`;
    await this.mail.send(email, `KlipAI: "${channel.title}" kanalına davet`, `"${channel.title}" kanalına ${role === 'EDITOR' ? 'editör' : 'izleyici'} olarak davet edildiniz.\n\nKabul etmek için: ${link}`);
    if (invitee) await this.notifications.notify(invitee.id, 'TEAM_INVITE', { title: channel.title }, `/invite?token=${token}`);
    return { id: member.id, userId: member.userId, email, displayName: invitee?.displayName ?? null, role: member.role, acceptedAt: null };
  }

  async acceptInvite(userId: string, token: string) {
    const member = await this.db.channelMember.findUnique({ where: { inviteTokenHash: sha256(token) }, include: { channel: true } });
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!member || (member.userId && member.userId !== userId) || (!member.userId && member.inviteEmail !== user.email)) throw notFound('Davet');
    await this.db.channelMember.update({ where: { id: member.id }, data: { userId, inviteEmail: null, inviteTokenHash: null, acceptedAt: new Date() } });
    await this.realtime.invalidateChannel(member.channelId);
    return this.view(member.channel, member.role);
  }

  async updateMember(userId: string, channelId: string, memberId: string, role: 'EDITOR' | 'VIEWER') {
    await this.access(userId, channelId, 'OWNER');
    const m = await this.db.channelMember.findFirst({ where: { id: memberId, channelId }, include: { user: true } });
    if (!m) throw notFound('Üye');
    const u = await this.db.channelMember.update({ where: { id: memberId }, data: { role } });
    return { id: u.id, userId: u.userId, email: m.user?.email ?? m.inviteEmail!, displayName: m.user?.displayName ?? null, role: u.role, acceptedAt: u.acceptedAt };
  }

  async removeMember(userId: string, channelId: string, memberId: string) {
    const { role } = await this.access(userId, channelId, 'VIEWER');
    const m = await this.db.channelMember.findFirst({ where: { id: memberId, channelId } });
    if (!m) throw notFound('Üye');
    if (role !== 'OWNER' && m.userId !== userId) throw forbidden(); // üye yalnızca kendini çıkarabilir
    await this.db.channelMember.delete({ where: { id: memberId } });
    await this.realtime.invalidateChannel(channelId);
  }
}
