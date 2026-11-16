import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, StatsWindow } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../infra/infra.module';
import { YoutubeClient } from '../publishing/youtube.client';

export interface InsightRow {
  views: number;
  avgViewPct: number | null;
  durationSec: number;
  hookText: string | null;
  commentaryFormat: string;
  scores: { hook: number; emotion: number; standalone: number; curiosity: number; shareability: number } | null;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const CRITERIA = ['hook', 'emotion', 'standalone', 'curiosity', 'shareability'] as const;

/**
 * Yayınlanmış kliplerin 7 günlük performansından puanlama promptuna eklenecek özet üretir (saf fonksiyon).
 * En çok izlenen çeyrek ile geri kalan karşılaştırılır.
 */
export function buildInsight(rows: InsightRow[]): { summary: string; features: Record<string, unknown> } | null {
  if (rows.length < 5) return null;
  const sorted = [...rows].sort((a, b) => b.views - a.views);
  const cut = Math.max(1, Math.floor(sorted.length / 4));
  const top = sorted.slice(0, cut);
  const rest = sorted.slice(cut);

  const durTop = top.map((r) => r.durationSec).sort((a, b) => a - b);
  const bestDurationRange = [Math.round(durTop[0]), Math.round(durTop[durTop.length - 1])];
  const deltas = CRITERIA.map((k) => ({
    criterion: k,
    delta: avg(top.filter((r) => r.scores).map((r) => r.scores![k])) - avg(rest.filter((r) => r.scores).map((r) => r.scores![k])),
  })).sort((a, b) => b.delta - a.delta);
  const formats = new Map<string, number[]>();
  for (const r of rows) formats.set(r.commentaryFormat, [...(formats.get(r.commentaryFormat) ?? []), r.views]);
  const bestFormat = [...formats.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => ({ format: k, avgViews: avg(v) })).sort((a, b) => b.avgViews - a.avgViews)[0]?.format ?? null;
  const topHooks = top.map((r) => r.hookText).filter((h): h is string => !!h).slice(0, 5);
  const retention = avg(top.map((r) => r.avgViewPct).filter((v): v is number => v !== null));

  const lines = [
    `Based on ${rows.length} published clips (7-day stats) for this channel:`,
    `- Top-quartile clips run ${bestDurationRange[0]}–${bestDurationRange[1]} seconds (median views ${Math.round(top[Math.floor(top.length / 2)].views)} vs ${Math.round(avg(rest.map((r) => r.views)))} average for the rest).`,
  ];
  if (deltas[0].delta > 3) lines.push(`- "${deltas[0].criterion}" separates winners most (+${deltas[0].delta.toFixed(0)} points on average); weigh evidence for it carefully.`);
  if (deltas[deltas.length - 1].delta < -3) lines.push(`- High "${deltas[deltas.length - 1].criterion}" scores did not translate into views here; be stricter when awarding them.`);
  if (retention) lines.push(`- Winners hold ${retention.toFixed(0)}% average view percentage.`);
  if (bestFormat && bestFormat !== 'NONE') lines.push(`- The ${bestFormat.toLowerCase()} commentary format performs best.`);
  if (topHooks.length) lines.push(`- Hooks that worked: ${topHooks.map((h) => `"${h}"`).join('; ')}.`);

  return { summary: lines.join('\n'), features: { sampleSize: rows.length, bestDurationRange, criterionDeltas: deltas, bestFormat, topHooks, topAvgViewPct: retention || null } };
}

@Injectable()
export class LearningService {
  private readonly log = new Logger('Learning');
  constructor(private readonly db: PrismaService, private readonly youtube: YoutubeClient) {}

  /** Bir klibin istatistiklerini çeker; 7. günde kanalın içgörüsünü yeniler. */
  async collect(clipId: string, window: StatsWindow): Promise<void> {
    const clip = await this.db.clip.findUnique({ where: { id: clipId }, include: { channel: true, publishJobs: { where: { status: 'PUBLISHED' }, take: 1 } } });
    const job = clip?.publishJobs[0];
    if (!clip || !job?.youtubeVideoId || !job.publishedAt || clip.channel.status !== 'ACTIVE') return;
    const token = await this.youtube.accessToken(clip.channel);
    const [basic] = await this.youtube.videoStats(token, [job.youtubeVideoId]);
    if (!basic) return; // video silinmiş
    const start = DateTime.fromJSDate(job.publishedAt).toISODate()!;
    const end = DateTime.now().toISODate()!;
    const an = await this.youtube.analytics(token, job.youtubeVideoId, start, end).catch((e) => {
      this.log.warn(`analytics alınamadı (${clipId}): ${e}`);
      return null;
    });
    const data = { views: basic.views, likes: basic.likes, comments: basic.comments, shares: an?.shares ?? 0, avgViewPct: an?.avgViewPct ?? null, avgViewSec: an?.avgViewSec ?? null, subscribersGained: an?.subscribersGained ?? 0, capturedAt: new Date() };
    await this.db.clipStats.upsert({ where: { clipId_window: { clipId, window } }, update: data, create: { clipId, window, ...data } });
    if (window === 'D7') await this.refreshInsight(clip.channelId);
  }

  async refreshInsight(channelId: string): Promise<void> {
    const stats = await this.db.clipStats.findMany({
      where: { window: 'D7', clip: { channelId } }, orderBy: { capturedAt: 'desc' }, take: 200,
      include: { clip: { select: { durationSec: true, hookText: true, commentaryFormat: true, candidate: true } } },
    });
    const insight = buildInsight(stats.map((s) => ({
      views: s.views, avgViewPct: s.avgViewPct, durationSec: s.clip.durationSec ?? 0, hookText: s.clip.hookText, commentaryFormat: s.clip.commentaryFormat,
      scores: s.clip.candidate?.score != null
        ? { hook: s.clip.candidate.hookScore ?? 0, emotion: s.clip.candidate.emotionScore ?? 0, standalone: s.clip.candidate.standaloneScore ?? 0, curiosity: s.clip.candidate.curiosityScore ?? 0, shareability: s.clip.candidate.shareabilityScore ?? 0 }
        : null,
    })));
    if (!insight) return;
    const last = await this.db.learningInsight.findFirst({ where: { channelId }, orderBy: { version: 'desc' } });
    await this.db.$transaction([
      this.db.learningInsight.updateMany({ where: { channelId, active: true }, data: { active: false } }),
      this.db.learningInsight.create({ data: { channelId, version: (last?.version ?? 0) + 1, sampleSize: stats.length, summary: insight.summary, features: insight.features as Prisma.InputJsonObject } }),
    ]);
  }
}
