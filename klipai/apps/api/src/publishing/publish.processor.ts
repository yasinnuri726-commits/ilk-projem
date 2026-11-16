import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { AppError } from '../common/errors';
import { PrismaService } from '../infra/infra.module';
import { StorageService } from '../infra/storage.service';
import { NotificationsService } from '../notifications/notifications';
import { QueuesService } from '../pipeline/queues';
import { RealtimeService } from '../realtime/realtime';
import { ChannelsService } from '../channels/channels.service';
import { PublishingService } from './publishing.service';
import { SchedulerService } from './scheduler.service';
import { QUOTA_COST, YoutubeClient, YoutubeError } from './youtube.client';

const CHUNK = 16 * 1024 * 1024; // 256 KB'nin katı olmalı
const BACKOFF_BASE_MS = 5 * 60_000;

/** n. başarısız denemeden sonraki bekleme: 5 dk, 10 dk, 20 dk… */
export const backoffMs = (attempt: number) => BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1);

@Injectable()
export class PublishProcessor {
  private readonly log = new Logger('Publish');

  constructor(
    private readonly db: PrismaService,
    private readonly youtube: YoutubeClient,
    private readonly storage: StorageService,
    private readonly scheduler: SchedulerService,
    private readonly publishing: PublishingService,
    private readonly channels: ChannelsService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly queues: QueuesService,
  ) {}

  async process(publishJobId: string): Promise<void> {
    let job = await this.db.publishJob.findUnique({ where: { id: publishJobId }, include: { clip: true, channel: true } });
    if (!job || !['SCHEDULED', 'RETRY_WAIT', 'UPLOADING'].includes(job.status)) return;
    const due = job.status === 'RETRY_WAIT' ? job.nextAttemptAt ?? job.scheduledAt : job.scheduledAt;
    if (due.getTime() > Date.now() + 30_000) return; // yeniden planlanmış; yeni gecikmeli iş devralır
    const { clip, channel } = job;
    if (!clip.outputKey) return this.fail(job.id, 'INVALID_STATE', 'Klip çıktısı yok', false);

    // Kota: yalnızca yeni yükleme oturumu açılırken ayrılır (devam eden oturum zaten ödenmiştir).
    if (!job.uploadUrl) {
      const cost = QUOTA_COST.insert + QUOTA_COST.thumbnail;
      if (!(await this.scheduler.reserveQuota(channel.id, cost))) return this.deferForQuota(job.id, channel.id);
    }

    // Aynı işi iki worker'ın almasını önleyen atomik geçiş.
    const claimed = await this.db.publishJob.updateMany({ where: { id: job.id, status: job.status }, data: { status: 'UPLOADING', attempt: { increment: 1 }, nextAttemptAt: null } });
    if (claimed.count === 0) return;
    await this.emit(job.id, 0);

    try {
      const token = await this.youtube.accessToken(channel);
      const head = await this.storage.head(clip.outputKey);
      if (!head) throw new AppError(409, 'INVALID_STATE', 'Klip dosyası depoda bulunamadı');
      const total = head.size;
      const settings = await this.channels.getSettings(channel.id);

      let offset = 0;
      let videoId: string | undefined;
      let uploadUrl = job.uploadUrl;
      if (uploadUrl) {
        const state = await this.youtube.queryOffset(uploadUrl, total);
        if (!state) uploadUrl = null; // oturumun süresi dolmuş: baştan
        else if (state.done) videoId = state.videoId;
        else offset = state.nextOffset;
      }
      if (!uploadUrl) {
        uploadUrl = await this.youtube.startResumable(token, {
          title: job.title, description: job.description, tags: job.tags, categoryId: job.categoryId,
          privacy: job.privacy.toLowerCase() as 'public', madeForKids: settings.madeForKids, defaultLanguage: settings.titleLanguage.toLowerCase(),
        }, total);
        await this.db.publishJob.update({ where: { id: job.id }, data: { uploadUrl, bytesUploaded: 0 } });
      }

      while (!videoId) {
        const end = Math.min(offset + CHUNK, total) - 1;
        const res = await this.youtube.uploadChunk(uploadUrl, await this.storage.getRange(clip.outputKey, offset, end), offset, total);
        if (res.done) videoId = res.videoId;
        else offset = res.nextOffset;
        await this.db.publishJob.update({ where: { id: job.id }, data: { bytesUploaded: BigInt(res.done ? total : offset) } });
        if (await this.realtime.throttled(`pub:${job.id}`)) await this.emit(job.id, Math.round(((res.done ? total : offset) / total) * 100));
      }

      await this.db.publishJob.update({ where: { id: job.id }, data: { status: 'PROCESSING', youtubeVideoId: videoId, bytesUploaded: BigInt(total) } });
      if (clip.thumbnailKey) {
        // Kapak başarısız olsa da video yayındadır; hata yayını geri almaz.
        const thumb = await this.storage.head(clip.thumbnailKey);
        if (thumb) await this.youtube.setThumbnail(token, videoId, await this.storage.getRange(clip.thumbnailKey, 0, thumb.size - 1)).catch((e) => this.log.warn(`kapak ayarlanamadı: ${e}`));
      }

      const now = new Date();
      await this.db.$transaction([
        this.db.publishJob.update({ where: { id: job.id }, data: { status: 'PUBLISHED', publishedAt: now, errorCode: null, errorMessage: null } }),
        this.db.clip.update({ where: { id: clip.id }, data: { status: 'PUBLISHED' } }),
      ]);
      const url = `https://youtube.com/shorts/${videoId}`;
      await this.realtime.toChannel(channel.id, 'publish.published', { publishJobId: job.id, clipId: clip.id, youtubeVideoId: videoId, youtubeUrl: url });
      await this.realtime.toChannel(channel.id, 'clip.updated', { clipId: clip.id, status: 'PUBLISHED', qcStatus: clip.qcStatus, version: clip.version });
      await this.notifications.notifyChannel(channel.id, 'CLIP_PUBLISHED', { title: job.title }, `/clip/${clip.id}`);
      const q = await this.scheduler.quota(channel.id);
      await this.realtime.toChannel(channel.id, 'quota.updated', { channelId: channel.id, used: q.used, limit: q.limit, resetAt: q.resetAt.toISOString() });

      // Öğrenme döngüsü: 24 saat, 7 gün ve 28 gün sonra istatistik çekilir.
      for (const [window, hours] of [['H24', 24], ['D7', 168], ['D28', 672]] as const) {
        await this.queues.add('learn', 'stats', { clipId: clip.id, window }, { jobId: `learn-${clip.id}-${window}`, delay: hours * 3_600_000, attempts: 5, backoff: { type: 'exponential', delay: 600_000 } });
      }
    } catch (e) {
      await this.onError(job.id, e);
    }
  }

  private async onError(jobId: string, e: unknown) {
    const job = await this.db.publishJob.findUniqueOrThrow({ where: { id: jobId } });
    if (e instanceof AppError && e.code === 'CHANNEL_TOKEN_EXPIRED') {
      const ch = await this.db.channel.findUniqueOrThrow({ where: { id: job.channelId } });
      await this.notifications.notifyChannel(job.channelId, 'CHANNEL_TOKEN_EXPIRED', { title: ch.title }, '/settings');
      return this.fail(jobId, e.code, e.message, false);
    }
    if (e instanceof YoutubeError && e.quota) {
      await this.db.publishJob.update({ where: { id: jobId }, data: { status: 'SCHEDULED', uploadUrl: null } });
      return this.deferForQuota(jobId, job.channelId);
    }
    const retryable = e instanceof YoutubeError ? e.retryable : !(e instanceof AppError);
    const code = e instanceof YoutubeError ? `YOUTUBE_${e.status}_${e.reason || 'error'}`.slice(0, 60) : e instanceof AppError ? e.code : 'UPSTREAM_ERROR';
    const message = e instanceof Error ? e.message.slice(0, 500) : String(e);
    if (!(e instanceof YoutubeError) && !(e instanceof AppError)) Sentry.captureException(e);
    this.log.warn(`yayın hatası ${jobId} (deneme ${job.attempt}/${job.maxAttempts}): ${code} ${message}`);

    if (retryable && job.attempt < job.maxAttempts) {
      const next = new Date(Date.now() + backoffMs(job.attempt));
      const updated = await this.db.publishJob.update({ where: { id: jobId }, data: { status: 'RETRY_WAIT', nextAttemptAt: next, errorCode: code, errorMessage: message } });
      await this.publishing.enqueue(updated, next);
      await this.realtime.toChannel(job.channelId, 'publish.updated', { publishJobId: jobId, clipId: job.clipId, status: 'RETRY_WAIT', uploadProgress: 0, nextAttemptAt: next.toISOString() });
      return;
    }
    await this.fail(jobId, code, message, true);
  }

  private async fail(jobId: string, code: string, message: string, notify: boolean) {
    const job = await this.db.publishJob.update({ where: { id: jobId }, data: { status: 'FAILED', errorCode: code, errorMessage: message, uploadUrl: null } });
    const clip = await this.db.clip.update({ where: { id: job.clipId }, data: { status: 'FAILED', errorCode: code, errorMessage: message } });
    await this.realtime.toChannel(job.channelId, 'publish.failed', { publishJobId: jobId, clipId: job.clipId, error: { code, message } });
    await this.realtime.toChannel(job.channelId, 'clip.updated', { clipId: clip.id, status: 'FAILED', qcStatus: clip.qcStatus, version: clip.version });
    if (notify) await this.notifications.notifyChannel(job.channelId, 'PUBLISH_FAILED', { title: job.title }, `/clip/${job.clipId}`);
  }

  /** Kota doluysa iş, kota sıfırlandıktan sonraki ilk uygun dilime ertelenir. */
  private async deferForQuota(jobId: string, channelId: string) {
    const { resetAt } = await this.scheduler.quota();
    const slot = (await this.scheduler.nextSlot(channelId, resetAt)) ?? new Date(resetAt.getTime() + 5 * 60_000);
    const updated = await this.db.publishJob.update({ where: { id: jobId }, data: { status: 'SCHEDULED', scheduledAt: slot, errorCode: 'QUOTA_EXCEEDED', errorMessage: 'YouTube günlük kotası doldu; sonraki pencereye ertelendi' } });
    await this.publishing.enqueue(updated, slot);
    await this.realtime.toChannel(channelId, 'publish.updated', { publishJobId: jobId, clipId: updated.clipId, status: 'QUOTA_DEFERRED', uploadProgress: 0, nextAttemptAt: slot.toISOString() });
    // Günde bir kez uyarı.
    if (await this.realtime.throttledFor(`quota-warn:${channelId}`, 86_400)) await this.notifications.notifyChannel(channelId, 'QUOTA_WARNING', {}, '/calendar');
  }

  private async emit(jobId: string, uploadProgress: number) {
    const j = await this.db.publishJob.findUniqueOrThrow({ where: { id: jobId } });
    await this.realtime.toChannel(j.channelId, 'publish.updated', { publishJobId: j.id, clipId: j.clipId, status: j.status, uploadProgress, nextAttemptAt: j.nextAttemptAt?.toISOString() ?? null });
  }
}
