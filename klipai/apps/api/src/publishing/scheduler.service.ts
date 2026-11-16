import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { ChannelSettings } from '@klipai/shared';
import { env } from '../config';
import { PrismaService } from '../infra/infra.module';
import { RedisService } from '../infra/redis.service';
import { ChannelsService } from '../channels/channels.service';
import { QUOTA_COST } from './youtube.client';

const STEP_MIN = 30;
const MIN_GAP_MIN = 60;
const LEAD_MIN = 10;

/**
 * Kanal planına göre sıradaki boş yayın zamanı (saf fonksiyon).
 * - Günlük adet dolmuş günler atlanır.
 * - Aday zamanlar dilimlerin içinde 30 dk adımlarla üretilir; alınmış zamanlara 60 dk'dan yakın olanlar elenir.
 * - `useBestTimes` açıksa en iyi saatlere denk gelen adaylar önceliklidir.
 */
export function computeNextSlot(
  s: Pick<ChannelSettings, 'dailyClipCount' | 'timeSlots' | 'timezone' | 'useBestTimes'>,
  taken: Date[],
  now: Date,
  bestHours: number[] = [],
): Date | null {
  if (s.dailyClipCount <= 0 || s.timeSlots.length === 0) return null;
  const zone = s.timezone;
  const earliest = DateTime.fromJSDate(now, { zone }).plus({ minutes: LEAD_MIN });
  const takenLocal = taken.map((t) => DateTime.fromJSDate(t, { zone }));

  for (let d = 0; d < 90; d++) {
    const day = earliest.startOf('day').plus({ days: d });
    if (takenLocal.filter((t) => t.hasSame(day, 'day')).length >= s.dailyClipCount) continue;

    const candidates: DateTime[] = [];
    for (const slot of s.timeSlots) {
      const [sh, sm] = slot.start.split(':').map(Number);
      const [eh, em] = slot.end.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em > startMin ? eh * 60 + em : 24 * 60; // gece yarısını aşan dilim gün sonunda kesilir
      for (let m = startMin; m < endMin; m += STEP_MIN) candidates.push(day.plus({ minutes: m }));
    }
    const free = candidates
      .filter((c) => c > earliest && takenLocal.every((t) => Math.abs(t.diff(c, 'minutes').minutes) >= MIN_GAP_MIN))
      .sort((a, b) => a.toMillis() - b.toMillis());
    if (!free.length) continue;
    if (s.useBestTimes && bestHours.length) {
      const rank = (c: DateTime) => { const i = bestHours.indexOf(c.hour); return i === -1 ? 99 : i; };
      free.sort((a, b) => rank(a) - rank(b) || a.toMillis() - b.toMillis());
    }
    return free[0].toUTC().toJSDate();
  }
  return null;
}

/** YouTube kotası Pasifik saatiyle gece yarısı sıfırlanır. */
export function quotaWindow(now = new Date()) {
  const pt = DateTime.fromJSDate(now, { zone: 'America/Los_Angeles' });
  return { key: `yt:quota:${pt.toISODate()}`, resetAt: pt.plus({ days: 1 }).startOf('day').toUTC().toJSDate() };
}

@Injectable()
export class SchedulerService {
  constructor(private readonly db: PrismaService, private readonly redis: RedisService, private readonly channels: ChannelsService) {}

  async quota(channelId?: string) {
    const { key, resetAt } = quotaWindow();
    const used = Number((await this.redis.client.get(key)) ?? 0);
    const limit = env().YOUTUBE_DAILY_QUOTA;
    const channelUsed = channelId ? Number((await this.redis.client.get(`${key}:${channelId}`)) ?? 0) : undefined;
    return { used, limit, channelUsed, resetAt, remainingUploads: Math.max(0, Math.floor((limit - used) / (QUOTA_COST.insert + QUOTA_COST.thumbnail))) };
  }

  /** Kota varsa ayırır. Kota proje geneli olduğundan tek sayaç kullanılır; kanal payı raporlama içindir. */
  async reserveQuota(channelId: string, cost: number): Promise<boolean> {
    const { key } = quotaWindow();
    const ok = await this.redis.incrIfBelow(key, cost, env().YOUTUBE_DAILY_QUOTA, 2 * 86_400);
    if (ok) {
      await this.redis.client.multi().incrby(`${key}:${channelId}`, cost).expire(`${key}:${channelId}`, 2 * 86_400).exec();
    }
    return ok;
  }

  async releaseQuota(channelId: string, cost: number): Promise<void> {
    const { key } = quotaWindow();
    await this.redis.client.multi().decrby(key, cost).decrby(`${key}:${channelId}`, cost).exec();
  }

  async nextSlot(channelId: string, after = new Date()): Promise<Date | null> {
    const settings = await this.channels.getSettings(channelId);
    const taken = await this.db.publishJob.findMany({
      where: { channelId, status: { in: ['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED', 'UPLOADING', 'RETRY_WAIT', 'PROCESSING', 'PUBLISHED'] }, scheduledAt: { gte: new Date(after.getTime() - 86_400_000) } },
      select: { scheduledAt: true },
    });
    const best = settings.useBestTimes ? (await this.bestTimes(channelId)).map((b) => b.hour) : [];
    return computeNextSlot(settings, taken.map((t) => t.scheduledAt), after, [...new Set(best)]);
  }

  /** Geçmiş performanstan en iyi saatler; veri azsa genel kısa video alışkanlıklarına dayalı varsayılanlar. */
  async bestTimes(channelId: string): Promise<{ weekday: number; hour: number; score: number }[]> {
    const settings = await this.channels.getSettings(channelId);
    const rows = await this.db.publishJob.findMany({
      where: { channelId, status: 'PUBLISHED', publishedAt: { not: null } },
      select: { publishedAt: true, clip: { select: { stats: { where: { window: { in: ['H24', 'D7'] } } } } } },
      orderBy: { publishedAt: 'desc' }, take: 300,
    });
    const samples = rows
      .map((r) => ({ at: DateTime.fromJSDate(r.publishedAt!, { zone: settings.timezone }), views: Math.max(0, ...r.clip.stats.map((s) => s.views)) }))
      .filter((r) => r.views > 0);
    if (samples.length < 8) {
      return [12, 18, 20, 21].flatMap((hour, i) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, hour, score: 1 - i * 0.1 })));
    }
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const s of samples) {
      const k = `${s.at.weekday % 7}:${s.at.hour}`;
      const b = buckets.get(k) ?? { sum: 0, n: 0 };
      b.sum += s.views;
      b.n += 1;
      buckets.set(k, b);
    }
    const max = Math.max(...[...buckets.values()].map((b) => b.sum / b.n));
    return [...buckets.entries()]
      .map(([k, b]) => ({ weekday: Number(k.split(':')[0]), hour: Number(k.split(':')[1]), score: Math.round((b.sum / b.n / max) * 100) / 100 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }
}
