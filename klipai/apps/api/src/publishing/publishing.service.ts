import { Injectable } from '@nestjs/common';
import type { Clip, PublishJob, YoutubePrivacy } from '@prisma/client';
import { ChannelsService } from '../channels/channels.service';
import { AppError, invalidState, notFound } from '../common/errors';
import { assertTransition, PUBLISH_TRANSITIONS } from '../common/state-machine';
import { PrismaService } from '../infra/infra.module';
import { StorageService } from '../infra/storage.service';
import { NotificationsService } from '../notifications/notifications';
import { QueuesService } from '../pipeline/queues';
import { RealtimeService } from '../realtime/realtime';
import { SchedulerService } from './scheduler.service';

export interface ScheduleInput {
  scheduledAt?: Date;
  now?: boolean;
  privacy?: YoutubePrivacy;
}

/** Açıklama şablonu: {title} {description} {hashtags} yer tutucuları doldurulur. */
export function renderDescription(template: string | null, clip: Pick<Clip, 'title' | 'description' | 'hashtags'>): string {
  const hashtags = clip.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
  if (!template) return [clip.description ?? '', hashtags].filter(Boolean).join('\n\n');
  return template.replaceAll('{title}', clip.title ?? '').replaceAll('{description}', clip.description ?? '').replaceAll('{hashtags}', hashtags).trim();
}

@Injectable()
export class PublishingService {
  constructor(
    private readonly db: PrismaService,
    private readonly queues: QueuesService,
    private readonly scheduler: SchedulerService,
    private readonly channels: ChannelsService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  async view(j: PublishJob) {
    const clip = await this.db.clip.findUnique({ where: { id: j.clipId }, select: { thumbnailKey: true, sizeBytes: true } });
    const size = Number(clip?.sizeBytes ?? 0);
    return {
      id: j.id, clipId: j.clipId, channelId: j.channelId, status: j.status, scheduledAt: j.scheduledAt, privacy: j.privacy, title: j.title,
      thumbnailUrl: await this.storage.signGetOrNull(clip?.thumbnailKey), attempt: j.attempt, nextAttemptAt: j.nextAttemptAt,
      uploadProgress: j.status === 'PUBLISHED' ? 100 : size ? Math.min(100, Math.round((Number(j.bytesUploaded) / size) * 100)) : 0,
      youtubeVideoId: j.youtubeVideoId, youtubeUrl: j.youtubeVideoId ? `https://youtube.com/shorts/${j.youtubeVideoId}` : null, publishedAt: j.publishedAt,
      error: j.errorCode ? { code: j.errorCode, message: j.errorMessage ?? '' } : null,
    };
  }

  async enqueue(job: Pick<PublishJob, 'id'>, at: Date) {
    await this.queues.add('publish', 'publish', { publishJobId: job.id }, { jobId: `pub-${job.id}-${at.getTime()}`, delay: Math.max(0, at.getTime() - Date.now()) });
  }

  private async emit(job: PublishJob) {
    await this.realtime.toChannel(job.channelId, 'publish.updated', { publishJobId: job.id, clipId: job.clipId, status: job.status, uploadProgress: 0, nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null });
  }

  /** Kullanıcı planlaması (onaylı modda aynı zamanda onaydır). */
  async schedule(userId: string, clipId: string, input: ScheduleInput) {
    const clip = await this.db.clip.findUnique({ where: { id: clipId } });
    if (!clip) throw notFound('Klip');
    await this.channels.access(userId, clip.channelId, 'EDITOR');
    return this.view(await this.plan(clip, input, userId, true));
  }

  /**
   * Klip hazır olduğunda otomasyon moduna göre davranır:
   * tam otomatik → planlanır; onaylı → onay bekleyen taslak plan + bildirim; sadece taslak → yalnızca bildirim.
   */
  async autoPlan(clip: Clip, ownerId: string): Promise<void> {
    const settings = await this.channels.getSettings(clip.channelId);
    const params = { title: clip.title ?? '' };
    const link = `/clip/${clip.id}`;
    if (clip.qcStatus === 'FLAGGED' || settings.automationMode === 'DRAFT_ONLY') {
      await this.notifications.notifyChannel(clip.channelId, 'CLIP_READY', params, link);
      await this.realtime.toChannel(clip.channelId, 'clip.ready', { clipId: clip.id, needsApproval: false });
      return;
    }
    const approved = settings.automationMode === 'FULL_AUTO';
    try {
      await this.plan(clip, {}, ownerId, approved);
    } catch (e) {
      if (!(e instanceof AppError)) throw e; // plan kurulamadıysa (ör. günlük adet 0) klip taslak kalır
    }
    await this.notifications.notifyChannel(clip.channelId, approved ? 'CLIP_READY' : 'CLIP_NEEDS_APPROVAL', params, link);
    await this.realtime.toChannel(clip.channelId, 'clip.ready', { clipId: clip.id, needsApproval: !approved });
  }

  private async plan(clip: Clip, input: ScheduleInput, userId: string, approved: boolean): Promise<PublishJob> {
    if (!clip.outputKey || !clip.title) throw invalidState('Klip henüz kurgulanmadı');
    const pending = await this.db.publishJob.findFirst({ where: { clipId: clip.id, status: { in: ['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED'] } } });
    if (!pending && clip.status !== 'READY' && clip.status !== 'FAILED') throw invalidState(`Klip ${clip.status} durumunda planlanamaz`);
    const channel = await this.db.channel.findUniqueOrThrow({ where: { id: clip.channelId } });
    if (channel.status !== 'ACTIVE') throw new AppError(409, 'CHANNEL_TOKEN_EXPIRED', 'Kanal bağlantısı etkin değil');
    const settings = await this.channels.getSettings(clip.channelId);

    let at: Date | null;
    if (input.now) at = new Date();
    else if (input.scheduledAt) {
      if (input.scheduledAt.getTime() < Date.now() - 60_000) throw new AppError(422, 'VALIDATION_FAILED', 'Plan zamanı geçmişte olamaz');
      at = input.scheduledAt;
    } else at = pending?.scheduledAt && pending.scheduledAt > new Date() ? pending.scheduledAt : await this.scheduler.nextSlot(clip.channelId);
    if (!at) throw new AppError(409, 'INVALID_STATE', 'Kanal planında uygun yayın zamanı yok');

    const data = {
      status: approved ? ('SCHEDULED' as const) : ('PENDING_APPROVAL' as const), scheduledAt: at, privacy: input.privacy ?? pending?.privacy ?? settings.defaultPrivacy,
      title: clip.title, description: renderDescription(settings.descriptionTemplate, clip), tags: [...new Set([...settings.fixedTags, ...clip.tags])].slice(0, 30),
      categoryId: settings.youtubeCategoryId, errorCode: null, errorMessage: null,
    };
    const job = pending
      ? await this.db.publishJob.update({ where: { id: pending.id }, data })
      : await this.db.publishJob.create({ data: { ...data, clipId: clip.id, channelId: clip.channelId, createdById: userId } });
    if (approved) {
      await this.db.clip.update({ where: { id: clip.id }, data: { status: 'SCHEDULED', approvedAt: new Date(), approvedById: userId, errorCode: null, errorMessage: null } });
      await this.enqueue(job, at);
      await this.realtime.toChannel(clip.channelId, 'clip.updated', { clipId: clip.id, status: 'SCHEDULED', qcStatus: clip.qcStatus, version: clip.version });
    }
    await this.emit(job);
    return job;
  }

  private async load(userId: string, id: string) {
    const job = await this.db.publishJob.findUnique({ where: { id } });
    if (!job) throw notFound('Yayın işi');
    await this.channels.access(userId, job.channelId, 'EDITOR');
    return job;
  }

  async reschedule(userId: string, id: string, input: { scheduledAt?: Date; privacy?: YoutubePrivacy }) {
    const job = await this.load(userId, id);
    if (!['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED'].includes(job.status)) throw invalidState('Yükleme başladıktan sonra plan değiştirilemez');
    if (input.scheduledAt && input.scheduledAt.getTime() < Date.now() - 60_000) throw new AppError(422, 'VALIDATION_FAILED', 'Plan zamanı geçmişte olamaz');
    const updated = await this.db.publishJob.update({
      where: { id }, data: { scheduledAt: input.scheduledAt ?? job.scheduledAt, privacy: input.privacy ?? job.privacy, status: job.status === 'QUOTA_DEFERRED' ? 'SCHEDULED' : job.status },
    });
    if (updated.status === 'SCHEDULED') await this.enqueue(updated, updated.scheduledAt); // eski gecikmeli iş, zamanı uymadığı için kendini atlar
    await this.emit(updated);
    return this.view(updated);
  }

  async cancel(userId: string, id: string) {
    const job = await this.load(userId, id);
    assertTransition(PUBLISH_TRANSITIONS, job.status, 'CANCELED', 'Yayın işi');
    const updated = await this.db.publishJob.update({ where: { id }, data: { status: 'CANCELED' } });
    await this.db.clip.updateMany({ where: { id: job.clipId, status: 'SCHEDULED' }, data: { status: 'READY' } });
    await this.emit(updated);
  }

  async retry(userId: string, id: string) {
    const job = await this.load(userId, id);
    assertTransition(PUBLISH_TRANSITIONS, job.status, 'SCHEDULED', 'Yayın işi');
    const at = new Date();
    const updated = await this.db.publishJob.update({ where: { id }, data: { status: 'SCHEDULED', attempt: 0, scheduledAt: at, nextAttemptAt: null, errorCode: null, errorMessage: null } });
    await this.db.clip.update({ where: { id: job.clipId }, data: { status: 'SCHEDULED', errorCode: null, errorMessage: null } });
    await this.enqueue(updated, at);
    await this.emit(updated);
    return this.view(updated);
  }

  async list(userId: string, q: { channelId?: string; from: Date; to: Date; status?: PublishJob['status'] }) {
    if (q.to.getTime() - q.from.getTime() > 62 * 86_400_000) throw new AppError(422, 'VALIDATION_FAILED', 'Aralık en çok 62 gün olabilir');
    const ids = q.channelId ? [(await this.channels.access(userId, q.channelId)).channel.id] : await this.channels.accessibleIds(userId);
    const rows = await this.db.publishJob.findMany({
      where: { channelId: { in: ids }, scheduledAt: { gte: q.from, lte: q.to }, status: q.status ?? { not: 'CANCELED' } }, orderBy: { scheduledAt: 'asc' }, take: 500,
    });
    return { items: await Promise.all(rows.map((r) => this.view(r))) };
  }
}
