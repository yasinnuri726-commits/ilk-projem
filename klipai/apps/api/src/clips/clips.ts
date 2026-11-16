import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Query } from '@nestjs/common';
import type { Clip, Prisma, PublishJob } from '@prisma/client';
import { z } from 'zod';
import { CLIP_STATUSES, DEFAULT_EDIT_SPEC, editSpecSchema, PUBLISH_STATUSES, YOUTUBE_PRIVACIES } from '@klipai/shared';
import { ChannelsService } from '../channels/channels.service';
import { AppError, invalidState, notFound } from '../common/errors';
import { AuthUser, CurrentUser, cursorArgs, toPage, Zod } from '../common/http';
import { assertTransition, CLIP_TRANSITIONS } from '../common/state-machine';
import { PrismaService } from '../infra/infra.module';
import { StorageService } from '../infra/storage.service';
import { Orchestrator } from '../pipeline/orchestrator.service';
import { PublishingService } from '../publishing/publishing.service';

const listSchema = z.object({
  cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20), channelId: z.string().optional(), projectId: z.string().optional(), status: z.enum(CLIP_STATUSES).optional(),
});
const patchSchema = z.object({
  version: z.number().int().min(1),
  startSec: z.number().min(0).optional(),
  endSec: z.number().min(0).optional(),
  editSpec: editSpecSchema.optional(),
  hookText: z.string().max(80).optional(),
  commentaryScript: z.string().max(2000).optional(),
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  hashtags: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
  archived: z.boolean().optional(),
});
const regenSchema = z.object({ part: z.enum(['COMMENTARY', 'METADATA', 'THUMBNAIL']), instruction: z.string().max(500).optional() });
const scheduleSchema = z.object({ scheduledAt: z.coerce.date().optional(), now: z.boolean().optional(), privacy: z.enum(YOUTUBE_PRIVACIES).optional() });
const publishListSchema = z.object({ channelId: z.string().optional(), from: z.coerce.date(), to: z.coerce.date(), status: z.enum(PUBLISH_STATUSES).optional() });
const rescheduleSchema = z.object({ scheduledAt: z.coerce.date().optional(), privacy: z.enum(YOUTUBE_PRIVACIES).optional() });

const ACTIVE_PUBLISH: PublishJob['status'][] = ['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED', 'UPLOADING', 'RETRY_WAIT', 'PROCESSING', 'PUBLISHED', 'FAILED'];

@Injectable()
export class ClipsService {
  constructor(
    private readonly db: PrismaService,
    private readonly channels: ChannelsService,
    private readonly orchestrator: Orchestrator,
    private readonly publishing: PublishingService,
    private readonly storage: StorageService,
  ) {}

  private readonly include = {
    candidate: { select: { score: true } },
    publishJobs: { where: { status: { in: ACTIVE_PUBLISH } }, orderBy: { createdAt: 'desc' as const }, take: 1 },
    renderJobs: { where: { status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] as const } }, orderBy: { queuedAt: 'desc' as const }, take: 1 },
  } satisfies Prisma.ClipInclude;

  async view(c: Prisma.ClipGetPayload<{ include: ClipsService['include'] }>, full = true) {
    const job = c.publishJobs[0];
    return {
      id: c.id, projectId: c.projectId, channelId: c.channelId, candidateId: c.candidateId, status: c.status, qcStatus: c.qcStatus, qcReport: full ? c.qcReport : undefined,
      version: c.version, score: c.candidate?.score ?? null, startSec: c.startSec, endSec: c.endSec, durationSec: c.durationSec, aspectRatio: c.aspectRatio, resolution: c.resolution,
      watermarked: c.watermarked, editSpec: full ? { ...DEFAULT_EDIT_SPEC, ...(c.editSpec as object) } : undefined, hookText: c.hookText,
      commentaryFormat: c.commentaryFormat, commentaryScript: full ? c.commentaryScript : undefined,
      title: c.title, titleAlternatives: c.titleAlternatives, description: full ? c.description : undefined, tags: c.tags, hashtags: c.hashtags,
      videoUrl: full ? await this.storage.signGetOrNull(c.outputKey, 7200) : null, thumbnailUrl: await this.storage.signGetOrNull(c.thumbnailKey ?? c.frameKey, 7200),
      renderStage: c.renderJobs[0]?.stage ?? null, renderProgress: c.renderJobs[0]?.progress ?? null,
      publishJob: job ? await this.publishing.view(job) : null,
      error: c.errorCode ? { code: c.errorCode, message: c.errorMessage ?? '' } : null, createdAt: c.createdAt, updatedAt: c.updatedAt,
    };
  }

  async load(userId: string, id: string, min: 'VIEWER' | 'EDITOR' = 'VIEWER') {
    const c = await this.db.clip.findUnique({ where: { id }, include: this.include });
    if (!c) throw notFound('Klip');
    await this.channels.access(userId, c.channelId, min);
    return c;
  }

  async list(userId: string, q: z.infer<typeof listSchema>) {
    const ids = q.channelId ? [(await this.channels.access(userId, q.channelId)).channel.id] : await this.channels.accessibleIds(userId);
    const rows = await this.db.clip.findMany({
      where: { channelId: { in: ids }, projectId: q.projectId, status: q.status ?? { not: 'ARCHIVED' } }, include: this.include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q.cursor, q.limit),
    });
    const page = toPage(rows, q.limit);
    return { items: await Promise.all(page.items.map((c) => this.view(c, false))), nextCursor: page.nextCursor };
  }

  /** Editör kaydı; iyimser kilitle korunur. Çevrimdışı taslaklar da bu uçla eşitlenir. */
  async patch(userId: string, id: string, dto: z.infer<typeof patchSchema>) {
    const c = await this.load(userId, id, 'EDITOR');
    if (c.version !== dto.version) throw new AppError(409, 'VERSION_CONFLICT', `Klip başka bir yerde güncellendi (sunucu sürümü ${c.version})`);
    const { version, archived, editSpec, ...rest } = dto;
    const touchesRender = editSpec !== undefined || rest.startSec !== undefined || rest.endSec !== undefined || rest.hookText !== undefined || rest.commentaryScript !== undefined;
    if (touchesRender && !['READY', 'FAILED', 'CANDIDATE'].includes(c.status)) throw invalidState(`Klip ${c.status} durumunda düzenlenemez`);
    const start = rest.startSec ?? c.startSec;
    const end = rest.endSec ?? c.endSec;
    if (end - start < 5 || end - start > 180) throw new AppError(422, 'VALIDATION_FAILED', 'Klip süresi 5–180 sn aralığında olmalı');

    const data: Prisma.ClipUpdateManyMutationInput = { ...rest, version: { increment: 1 } };
    if (editSpec) {
      data.editSpec = editSpec as unknown as Prisma.InputJsonObject;
      if (rest.hookText === undefined) data.hookText = editSpec.hook.text || null;
    }
    // Seslendirme metni elle değiştiyse eski ses geçersizdir; sonraki kurguda yeniden üretilir.
    if (rest.commentaryScript !== undefined && rest.commentaryScript !== c.commentaryScript) data.commentaryAudioKey = null;
    if (archived) {
      assertTransition(CLIP_TRANSITIONS, c.status, 'ARCHIVED', 'Klip');
      data.status = 'ARCHIVED';
    }
    const res = await this.db.clip.updateMany({ where: { id, version }, data });
    if (res.count === 0) throw new AppError(409, 'VERSION_CONFLICT', 'Klip başka bir yerde güncellendi');
    return this.view(await this.load(userId, id));
  }

  async remove(userId: string, id: string) {
    const c = await this.load(userId, id, 'EDITOR');
    if (c.publishJobs[0] && ['UPLOADING', 'PROCESSING'].includes(c.publishJobs[0].status)) throw invalidState('Yükleme sürerken klip silinemez');
    await this.db.clip.delete({ where: { id } });
    await this.storage.deletePrefix(`clips/${id}/`);
  }

  async render(userId: string, id: string) {
    await this.load(userId, id, 'EDITOR');
    await this.orchestrator.startClipPipeline(id);
    return this.view(await this.load(userId, id));
  }

  async regenerate(userId: string, id: string, dto: z.infer<typeof regenSchema>) {
    const c = await this.load(userId, id, 'EDITOR');
    if (dto.part === 'COMMENTARY') {
      if (c.commentaryFormat === 'NONE') throw invalidState('Bu klipte yorum formatı kapalı');
      await this.orchestrator.startClipPipeline(id, { regenerateCommentary: true });
    } else {
      await this.orchestrator.regenerateMetadata(id, dto.instruction, dto.part === 'THUMBNAIL');
    }
    return this.view(await this.load(userId, id));
  }

  async download(userId: string, id: string) {
    const c = await this.load(userId, id);
    if (!c.outputKey) throw invalidState('Klip henüz kurgulanmadı');
    return { url: await this.storage.signGet(c.outputKey, 600, `klipai-${c.id}.mp4`), expiresAt: new Date(Date.now() + 600_000) };
  }
}

@Controller()
export class ClipsController {
  constructor(private readonly clips: ClipsService, private readonly publishing: PublishingService) {}

  @Get('clips')
  list(@CurrentUser() u: AuthUser, @Query(new Zod(listSchema)) q: z.infer<typeof listSchema>) {
    return this.clips.list(u.id, q);
  }

  @Get('clips/:id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.clips.view(await this.clips.load(u.id, id));
  }

  @Patch('clips/:id')
  patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(patchSchema)) dto: z.infer<typeof patchSchema>) {
    return this.clips.patch(u.id, id, dto);
  }

  @Delete('clips/:id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.clips.remove(u.id, id);
  }

  @Post('clips/:id/render')
  @HttpCode(202)
  render(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.clips.render(u.id, id);
  }

  @Post('clips/:id/regenerate')
  @HttpCode(202)
  regenerate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(regenSchema)) dto: z.infer<typeof regenSchema>) {
    return this.clips.regenerate(u.id, id, dto);
  }

  @Post('clips/:id/schedule')
  schedule(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(scheduleSchema)) dto: z.infer<typeof scheduleSchema>) {
    return this.publishing.schedule(u.id, id, dto);
  }

  @Get('clips/:id/download')
  download(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.clips.download(u.id, id);
  }

  @Get('publish-jobs')
  publishJobs(@CurrentUser() u: AuthUser, @Query(new Zod(publishListSchema)) q: z.infer<typeof publishListSchema>) {
    return this.publishing.list(u.id, q);
  }

  @Patch('publish-jobs/:id')
  reschedule(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(rescheduleSchema)) dto: z.infer<typeof rescheduleSchema>) {
    return this.publishing.reschedule(u.id, id, dto);
  }

  @Delete('publish-jobs/:id')
  @HttpCode(204)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.publishing.cancel(u.id, id);
  }

  @Post('publish-jobs/:id/retry')
  @HttpCode(202)
  retry(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.publishing.retry(u.id, id);
  }
}
