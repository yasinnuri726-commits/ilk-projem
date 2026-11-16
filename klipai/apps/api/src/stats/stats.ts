import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { TEMPLATE_KINDS } from '@klipai/shared';
import { BillingService } from '../billing/billing';
import { ChannelsService } from '../channels/channels.service';
import { ClipsService } from '../clips/clips';
import { forbidden, notFound } from '../common/errors';
import { AuthUser, CurrentUser, Zod } from '../common/http';
import { PrismaService } from '../infra/infra.module';
import { StorageService } from '../infra/storage.service';
import { ProjectsService } from '../projects/projects';
import { PublishingService } from '../publishing/publishing.service';

const overviewQuery = z.object({ channelId: z.string().min(1), range: z.enum(['7d', '28d', '90d']).default('28d') });

@Controller()
export class StatsController {
  constructor(
    private readonly db: PrismaService,
    private readonly channels: ChannelsService,
    private readonly projects: ProjectsService,
    private readonly clips: ClipsService,
    private readonly publishing: PublishingService,
    private readonly billing: BillingService,
    private readonly storage: StorageService,
  ) {}

  /** Ana panel: günlük özet + aktif kuyruk tek istekte. */
  @Get('dashboard')
  async dashboard(@CurrentUser() u: AuthUser, @Query('channelId') channelId?: string) {
    const ids = channelId ? [(await this.channels.access(u.id, channelId)).channel.id] : await this.channels.accessibleIds(u.id);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: u.id } });
    const dayStart = DateTime.now().setZone(user.timezone).startOf('day').toJSDate();
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const inCh = { channelId: { in: ids } };
    const [published, scheduled, awaitingApproval, failed, views, projects, rendering, upcoming, sub] = await Promise.all([
      this.db.publishJob.count({ where: { ...inCh, status: 'PUBLISHED', publishedAt: { gte: dayStart, lt: dayEnd } } }),
      this.db.publishJob.count({ where: { ...inCh, status: { in: ['SCHEDULED', 'QUOTA_DEFERRED', 'RETRY_WAIT', 'UPLOADING'] }, scheduledAt: { gte: dayStart, lt: dayEnd } } }),
      this.db.publishJob.count({ where: { ...inCh, status: 'PENDING_APPROVAL' } }),
      this.db.clip.count({ where: { ...inCh, status: 'FAILED' } }),
      this.db.clipStats.aggregate({ where: { window: 'H24', capturedAt: { gte: new Date(Date.now() - 86_400_000) }, clip: inCh }, _sum: { views: true } }),
      this.db.project.findMany({ where: { ...inCh, status: { in: ['INGESTING', 'ANALYZING', 'GENERATING', 'SCORING'] } }, include: { sourceVideo: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.db.clip.findMany({ where: { ...inCh, status: 'EDITING' }, select: { id: true }, orderBy: { updatedAt: 'desc' }, take: 10 }),
      this.db.publishJob.findMany({ where: { ...inCh, status: { in: ['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED', 'RETRY_WAIT', 'UPLOADING'] } }, orderBy: { scheduledAt: 'asc' }, take: 10 }),
      this.billing.view(u.id),
    ]);
    return {
      today: { published, scheduled, awaitingApproval, failed, views24h: views._sum.views ?? 0 },
      queue: {
        projects: await Promise.all(projects.map((p) => this.projects.view(p))),
        rendering: await Promise.all(rendering.map(async (c) => this.clips.view(await this.clips.load(u.id, c.id), false))),
        upcoming: await Promise.all(upcoming.map((j) => this.publishing.view(j))),
      },
      credits: { used: sub.usage.creditsUsed, granted: sub.usage.creditsGranted, clipsUsed: sub.usage.clipsUsed, clipLimit: sub.limits.clipsPerMonth },
    };
  }

  @Get('stats/overview')
  async overview(@CurrentUser() u: AuthUser, @Query(new Zod(overviewQuery)) q: z.infer<typeof overviewQuery>) {
    await this.channels.access(u.id, q.channelId);
    const settings = await this.channels.getSettings(q.channelId);
    const days = Number(q.range.replace('d', ''));
    const since = new Date(Date.now() - days * 86_400_000);
    const jobs = await this.db.publishJob.findMany({
      where: { channelId: q.channelId, status: 'PUBLISHED', publishedAt: { gte: since } },
      include: { clip: { select: { id: true, title: true, thumbnailKey: true, stats: true, candidate: { select: { score: true } } } } },
    });
    // Her klip için en güncel (en geniş) pencere kullanılır.
    const order = { D28: 3, D7: 2, H24: 1 } as const;
    const rows = jobs.map((j) => ({ job: j, stat: [...j.clip.stats].sort((a, b) => order[b.window] - order[a.window])[0] }));
    const sum = (f: (s: NonNullable<(typeof rows)[number]['stat']>) => number) => rows.reduce((t, r) => t + (r.stat ? f(r.stat) : 0), 0);
    const pct = rows.map((r) => r.stat?.avgViewPct).filter((v): v is number => v != null);

    const series = new Map<string, { views: number; clipsPublished: number }>();
    for (let d = days - 1; d >= 0; d--) series.set(DateTime.now().setZone(settings.timezone).minus({ days: d }).toISODate()!, { views: 0, clipsPublished: 0 });
    for (const r of rows) {
      const day = series.get(DateTime.fromJSDate(r.job.publishedAt!, { zone: settings.timezone }).toISODate()!);
      if (day) {
        day.clipsPublished += 1;
        day.views += r.stat?.views ?? 0; // izlenmeler klibin yayın gününe yazılır
      }
    }
    const top = [...rows].sort((a, b) => (b.stat?.views ?? 0) - (a.stat?.views ?? 0)).slice(0, 5);
    const insight = await this.db.learningInsight.findFirst({ where: { channelId: q.channelId, active: true }, orderBy: { version: 'desc' } });
    return {
      totals: { views: sum((s) => s.views), likes: sum((s) => s.likes), comments: sum((s) => s.comments), subscribersGained: sum((s) => s.subscribersGained), clipsPublished: rows.length, avgViewPct: pct.length ? Math.round((pct.reduce((a, b) => a + b, 0) / pct.length) * 10) / 10 : null },
      series: [...series.entries()].map(([date, v]) => ({ date, ...v })),
      topClips: await Promise.all(top.map(async (r) => ({ clipId: r.job.clip.id, title: r.job.title, thumbnailUrl: await this.storage.signGetOrNull(r.job.clip.thumbnailKey), views: r.stat?.views ?? 0, score: r.job.clip.candidate?.score ?? null }))),
      insight: insight?.summary ?? null,
    };
  }

  @Get('clips/:id/stats')
  async clipStats(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.clips.load(u.id, id);
    const items = await this.db.clipStats.findMany({ where: { clipId: id }, orderBy: { capturedAt: 'asc' } });
    return { items: items.map(({ id: _id, clipId: _c, ...s }) => s) };
  }
}

const templateSchema = z.object({ kind: z.enum(TEMPLATE_KINDS), name: z.string().trim().min(1).max(60), channelId: z.string().nullable().optional(), config: z.record(z.string(), z.unknown()) });
const templateQuery = z.object({ kind: z.enum(TEMPLATE_KINDS).optional(), channelId: z.string().optional() });

@Controller('templates')
export class TemplatesController {
  constructor(private readonly db: PrismaService, private readonly channels: ChannelsService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query(new Zod(templateQuery)) q: z.infer<typeof templateQuery>) {
    const channelIds = await this.channels.accessibleIds(u.id);
    const items = await this.db.template.findMany({
      where: { kind: q.kind, OR: [{ isSystem: true }, { ownerId: u.id }, { channelId: { in: q.channelId ? channelIds.filter((c) => c === q.channelId) : channelIds } }] },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    });
    return { items };
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new Zod(templateSchema)) dto: z.infer<typeof templateSchema>) {
    if (dto.channelId) await this.channels.access(u.id, dto.channelId, 'EDITOR');
    return this.db.template.create({ data: { ownerId: u.id, kind: dto.kind, name: dto.name, channelId: dto.channelId ?? null, config: dto.config as Prisma.InputJsonObject } });
  }

  private async owned(userId: string, id: string) {
    const t = await this.db.template.findUnique({ where: { id } });
    if (!t) throw notFound('Şablon');
    if (t.isSystem || t.ownerId !== userId) throw forbidden('Bu şablon değiştirilemez');
    return t;
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new Zod(templateSchema.partial())) dto: Partial<z.infer<typeof templateSchema>>) {
    await this.owned(u.id, id);
    return this.db.template.update({ where: { id }, data: { name: dto.name, config: dto.config as Prisma.InputJsonObject | undefined } });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.owned(u.id, id);
    await this.db.template.delete({ where: { id } });
  }
}
