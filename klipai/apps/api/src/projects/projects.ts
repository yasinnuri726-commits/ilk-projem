import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { ClipCandidate, Prisma, Project, SourceVideo } from '@prisma/client';
import type { Request } from 'express';
import { isIP } from 'net';
import { z } from 'zod';
import { PROJECT_STATUSES, RIGHTS_ATTESTATION, RIGHTS_ATTESTATION_VERSION, RIGHTS_BASES, settingsPatchSchema } from '@klipai/shared';
import { ChannelsService } from '../channels/channels.service';
import { AppError, invalidState, notFound } from '../common/errors';
import { AuthUser, CurrentUser, cursorArgs, toPage, Zod } from '../common/http';
import { assertTransition, PROJECT_TRANSITIONS } from '../common/state-machine';
import { PrismaService } from '../infra/infra.module';
import { StorageService } from '../infra/storage.service';
import { Orchestrator } from '../pipeline/orchestrator.service';

const createSchema = z.object({
  channelId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('UPLOAD'), uploadId: z.string().min(1) }),
    z.object({ type: z.literal('LINK'), url: z.string().url().max(2000) }),
  ]),
  rights: z.object({
    basis: z.enum(RIGHTS_BASES),
    details: z.string().max(1000).optional(),
    evidenceUploadId: z.string().optional(),
    attestationVersion: z.literal(RIGHTS_ATTESTATION_VERSION),
    accepted: z.literal(true),
  }),
  settingsOverride: settingsPatchSchema.optional(),
  autoStart: z.boolean().default(true),
});
const listSchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20), channelId: z.string().optional(), status: z.enum(PROJECT_STATUSES).optional() });
const patchSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional() });
const retrySchema = z.object({ stage: z.enum(['INGEST', 'ANALYZE', 'CANDIDATES', 'SCORE']).optional() });
const candidatesQuery = z.object({ minScore: z.coerce.number().int().min(0).max(100).optional(), status: z.enum(['PENDING_SCORE', 'SCORED', 'ACCEPTED', 'REJECTED', 'BELOW_THRESHOLD']).optional() });
const acceptSchema = z.object({ startSec: z.number().min(0).optional(), endSec: z.number().min(0).optional() });

const MEDIA_EXT = /\.(mp4|mov|mkv|webm|m4v|mp3|wav|m4a)$/i;

/**
 * Link kaynağı yalnızca doğrudan medya dosyası olabilir (https, bilinen uzantı, genel ağ adresi).
 * Platform sayfalarından indirme desteklenmez; özel ağ adresleri SSRF'ye karşı reddedilir (worker DNS çözümünden sonra da denetler).
 */
export function assertDirectMediaUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const bad = (m: string) => new AppError(422, 'VALIDATION_FAILED', m);
  if (url.protocol !== 'https:') throw bad('Yalnızca https bağlantıları kabul edilir');
  if (url.username || url.password) throw bad('Kimlik bilgisi içeren bağlantı kabul edilmez');
  if (!MEDIA_EXT.test(url.pathname)) throw bad('Bağlantı doğrudan bir medya dosyasına (mp4, mov, mkv, webm, mp3, wav) işaret etmeli');
  if (isIP(host.replace(/^\[|\]$/g, '')) || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) throw bad('Bu adres kabul edilmiyor');
  return url;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: PrismaService,
    private readonly channels: ChannelsService,
    private readonly orchestrator: Orchestrator,
    private readonly storage: StorageService,
  ) {}

  async view(p: Project & { sourceVideo?: SourceVideo | null; _count?: { candidates: number; clips: number } }) {
    return {
      id: p.id, channelId: p.channelId, title: p.title, status: p.status, currentStage: p.currentStage, progress: p.progress,
      thumbnailUrl: await this.storage.signGetOrNull(p.sourceVideo?.thumbnailKey), durationSec: p.sourceVideo?.durationSec ?? null,
      candidateCount: p._count?.candidates ?? 0, clipCount: p._count?.clips ?? 0, creditsConsumed: p.creditsConsumed,
      error: p.errorCode ? { code: p.errorCode, message: p.errorMessage ?? '' } : null, createdAt: p.createdAt, completedAt: p.completedAt,
    };
  }

  private readonly include = { sourceVideo: true, _count: { select: { candidates: { where: { status: { in: ['SCORED', 'ACCEPTED'] as ClipCandidate['status'][] } } }, clips: true } } };

  async load(userId: string, id: string, min: 'VIEWER' | 'EDITOR' | 'OWNER' = 'VIEWER') {
    const p = await this.db.project.findUnique({ where: { id }, include: this.include });
    if (!p) throw notFound('Proje');
    await this.channels.access(userId, p.channelId, min);
    return p;
  }

  async create(userId: string, dto: z.infer<typeof createSchema>, meta: { ip: string; userAgent: string }) {
    const { channel } = await this.channels.access(userId, dto.channelId, 'EDITOR');
    if (channel.status === 'DISCONNECTED') throw invalidState('Kanal bağlı değil');
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const settings = { ...(await this.channels.getSettings(dto.channelId)), ...(dto.settingsOverride ?? {}) };
    if (settings.minDurationSec > settings.maxDurationSec) throw new AppError(422, 'VALIDATION_FAILED', 'En kısa süre en uzun süreden büyük olamaz');

    let source: Prisma.SourceVideoCreateWithoutProjectInput;
    let sourceRef: string;
    if (dto.source.type === 'UPLOAD') {
      const upload = await this.db.uploadSession.findFirst({ where: { id: dto.source.uploadId, userId }, include: { sourceVideo: true } });
      if (!upload || upload.status !== 'COMPLETED' || !upload.storageKey.startsWith('uploads/')) throw new AppError(422, 'VALIDATION_FAILED', 'Yükleme tamamlanmamış');
      if (upload.sourceVideo) throw new AppError(409, 'INVALID_STATE', 'Bu yükleme başka bir projede kullanılmış');
      source = { type: 'UPLOAD', storageKey: upload.storageKey, sizeBytes: upload.sizeBytes, uploadSession: { connect: { id: upload.id } } };
      sourceRef = upload.storageKey;
    } else {
      const url = assertDirectMediaUrl(dto.source.url).toString();
      source = { type: 'LINK', sourceUrl: url };
      sourceRef = url;
    }
    let evidenceKey: string | undefined;
    if (dto.rights.evidenceUploadId) {
      const ev = await this.db.uploadSession.findFirst({ where: { id: dto.rights.evidenceUploadId, userId, status: 'COMPLETED' } });
      if (!ev) throw new AppError(422, 'VALIDATION_FAILED', 'Hak belgesi yüklemesi bulunamadı');
      evidenceKey = ev.storageKey;
    }

    const project = await this.db.project.create({
      data: {
        userId, channelId: dto.channelId, title: dto.title, settingsSnapshot: settings as unknown as Prisma.InputJsonObject,
        sourceVideo: {
          create: {
            ...source,
            // Hak beyanı: kullanıcının onayladığı metin, IP ve istemci bilgisiyle değiştirilemez biçimde kaydedilir.
            rights: {
              create: {
                userId, basis: dto.rights.basis, details: dto.rights.details, evidenceKey, projectTitle: dto.title, sourceRef,
                attestationText: RIGHTS_ATTESTATION[user.locale], attestationVersion: dto.rights.attestationVersion, ip: meta.ip, userAgent: meta.userAgent.slice(0, 500),
              },
            },
          },
        },
      },
    });
    if (dto.autoStart) await this.orchestrator.startProject(project.id);
    return this.view(await this.load(userId, project.id));
  }

  async list(userId: string, q: z.infer<typeof listSchema>) {
    const ids = q.channelId ? [(await this.channels.access(userId, q.channelId)).channel.id] : await this.channels.accessibleIds(userId);
    const rows = await this.db.project.findMany({
      where: { channelId: { in: ids }, status: q.status ?? { not: 'ARCHIVED' } }, include: this.include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q.cursor, q.limit),
    });
    const page = toPage(rows, q.limit);
    return { items: await Promise.all(page.items.map((p) => this.view(p))), nextCursor: page.nextCursor };
  }

  async detail(userId: string, id: string) {
    const p = await this.load(userId, id);
    const jobs = await this.db.pipelineJob.findMany({ where: { projectId: id }, orderBy: { queuedAt: 'asc' } });
    const latest = new Map(jobs.map((j) => [j.stage, j]));
    const rights = p.sourceVideo ? await this.db.rightsDeclaration.findUnique({ where: { sourceVideoId: p.sourceVideo.id } }) : null;
    return {
      ...(await this.view(p)),
      source: p.sourceVideo ? { type: p.sourceVideo.type, status: p.sourceVideo.status, width: p.sourceVideo.width, height: p.sourceVideo.height, language: p.sourceVideo.language, rightsBasis: rights?.basis ?? null } : null,
      stages: (['INGEST', 'ANALYZE', 'CANDIDATES', 'SCORE'] as const).map((stage) => {
        const j = latest.get(stage);
        return { stage, status: j?.status ?? null, progress: j?.progress ?? 0, attempt: j?.attempt ?? 0, startedAt: j?.startedAt ?? null, finishedAt: j?.finishedAt ?? null };
      }),
    };
  }

  async patch(userId: string, id: string, dto: z.infer<typeof patchSchema>) {
    const p = await this.load(userId, id, 'EDITOR');
    const data: Prisma.ProjectUpdateInput = {};
    if (dto.title) data.title = dto.title;
    if (dto.archived !== undefined) {
      const to = dto.archived ? 'ARCHIVED' : 'READY';
      if (p.status !== to) {
        assertTransition(PROJECT_TRANSITIONS, p.status, to, 'Proje');
        data.status = to;
      }
    }
    await this.db.project.update({ where: { id }, data });
    return this.view(await this.load(userId, id));
  }

  async remove(userId: string, id: string) {
    const p = await this.load(userId, id, 'EDITOR');
    if (['INGESTING', 'ANALYZING', 'GENERATING', 'SCORING'].includes(p.status)) await this.orchestrator.cancelProject(id);
    const active = await this.db.publishJob.count({ where: { clip: { projectId: id }, status: { in: ['UPLOADING', 'PROCESSING'] } } });
    if (active) throw invalidState('Yüklemesi süren klip var; bitince tekrar deneyin');
    const clips = await this.db.clip.findMany({ where: { projectId: id }, select: { id: true } });
    await this.db.project.delete({ where: { id } }); // hak beyanı SetNull ile kalır
    await Promise.all([this.storage.deletePrefix(`projects/${id}/`), ...clips.map((c) => this.storage.deletePrefix(`clips/${c.id}/`))]);
    if (p.sourceVideo?.type === 'UPLOAD' && p.sourceVideo.storageKey) await this.storage.deletePrefix(p.sourceVideo.storageKey);
  }

  async transcript(userId: string, id: string) {
    await this.load(userId, id);
    const t = await this.db.transcript.findUnique({ where: { projectId: id } });
    if (!t) throw notFound('Transkript');
    return { language: t.language, speakers: t.speakers, segments: t.segments, wordsUrl: await this.storage.signGet(t.wordsKey) };
  }

  async candidateView(c: ClipCandidate & { clip?: { id: string } | null }, proxyUrl: string | null) {
    return {
      id: c.id, startSec: c.startSec, endSec: c.endSec, durationSec: c.durationSec, text: c.text, status: c.status, score: c.score, rank: c.rank,
      breakdown: c.score === null ? null : { hook: c.hookScore, emotion: c.emotionScore, standalone: c.standaloneScore, curiosity: c.curiosityScore, shareability: c.shareabilityScore },
      rationale: c.rationale, previewUrl: proxyUrl, clipId: c.clip?.id ?? null,
    };
  }

  async candidates(userId: string, id: string, q: z.infer<typeof candidatesQuery>) {
    const p = await this.load(userId, id);
    const rows = await this.db.clipCandidate.findMany({
      where: { projectId: id, status: q.status ?? { in: ['SCORED', 'ACCEPTED', 'REJECTED'] }, ...(q.minScore !== undefined ? { score: { gte: q.minScore } } : {}) },
      include: { clip: { select: { id: true } } }, orderBy: [{ score: 'desc' }, { startSec: 'asc' }],
    });
    // Önizleme: analiz proxy'si tek imzalı URL ile verilir; istemci startSec–endSec aralığını oynatır.
    const proxyUrl = await this.storage.signGetOrNull(p.sourceVideo?.proxyKey, 7200);
    return { items: await Promise.all(rows.map((c) => this.candidateView(c, proxyUrl))) };
  }

  private async loadCandidate(userId: string, id: string) {
    const c = await this.db.clipCandidate.findUnique({ where: { id }, include: { project: true } });
    if (!c) throw notFound('Aday');
    await this.channels.access(userId, c.project.channelId, 'EDITOR');
    return c;
  }

  async accept(userId: string, candidateId: string, range: z.infer<typeof acceptSchema>) {
    const c = await this.loadCandidate(userId, candidateId);
    return this.orchestrator.createClipFromCandidate(c, range);
  }

  async reject(userId: string, candidateId: string) {
    const c = await this.loadCandidate(userId, candidateId);
    if (c.status === 'ACCEPTED') throw invalidState('Kabul edilmiş aday reddedilemez');
    return this.candidateView(await this.db.clipCandidate.update({ where: { id: candidateId }, data: { status: 'REJECTED' } }), null);
  }
}

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService, private readonly orchestrator: Orchestrator) {}

  @Get('projects')
  list(@CurrentUser() u: AuthUser, @Query(new Zod(listSchema)) q: z.infer<typeof listSchema>) {
    return this.projects.list(u.id, q);
  }

  @Post('projects')
  create(@CurrentUser() u: AuthUser, @Body(new Zod(createSchema)) dto: z.infer<typeof createSchema>, @Req() req: Request) {
    return this.projects.create(u.id, dto, { ip: req.ip ?? 'unknown', userAgent: String(req.headers['user-agent'] ?? 'unknown') });
  }

  @Get('projects/:id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.detail(u.id, id);
  }

  @Patch('projects/:id')
  patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(patchSchema)) dto: z.infer<typeof patchSchema>) {
    return this.projects.patch(u.id, id, dto);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.remove(u.id, id);
  }

  @Post('projects/:id/start')
  @HttpCode(202)
  async start(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.projects.load(u.id, id, 'EDITOR');
    await this.orchestrator.startProject(id);
    return this.projects.view(await this.projects.load(u.id, id));
  }

  @Post('projects/:id/cancel')
  @HttpCode(202)
  async cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.projects.load(u.id, id, 'EDITOR');
    await this.orchestrator.cancelProject(id);
    return this.projects.view(await this.projects.load(u.id, id));
  }

  @Post('projects/:id/retry')
  @HttpCode(202)
  async retry(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(retrySchema)) dto: z.infer<typeof retrySchema>) {
    const p = await this.projects.load(u.id, id, 'EDITOR');
    if (p.status !== 'FAILED') throw invalidState('Yalnızca başarısız proje yeniden denenebilir');
    await this.orchestrator.startProject(id, dto.stage);
    return this.projects.view(await this.projects.load(u.id, id));
  }

  @Get('projects/:id/transcript')
  transcript(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.transcript(u.id, id);
  }

  @Get('projects/:id/candidates')
  candidates(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new Zod(candidatesQuery)) q: z.infer<typeof candidatesQuery>) {
    return this.projects.candidates(u.id, id, q);
  }

  @Post('candidates/:id/accept')
  async accept(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(acceptSchema)) dto: z.infer<typeof acceptSchema>) {
    const clip = await this.projects.accept(u.id, id, dto);
    return { id: clip.id, status: clip.status, projectId: clip.projectId };
  }

  @Post('candidates/:id/reject')
  @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.reject(u.id, id);
  }
}
