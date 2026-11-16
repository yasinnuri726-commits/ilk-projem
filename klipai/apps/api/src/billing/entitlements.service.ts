import { Injectable } from '@nestjs/common';
import type { Prisma, Subscription, UsageKind } from '@prisma/client';
import { clampResolution, limitsFor, Plan, PLAN_LIMITS, PlanLimits, Resolution, UserRole } from '@klipai/shared';
import { AppError } from '../common/errors';
import { PrismaService } from '../infra/infra.module';
import { RealtimeService } from '../realtime/realtime';

export const PERIOD_MS = 30 * 86_400_000;

export interface Entitlement {
  plan: Plan;
  role: UserRole;
  limits: PlanLimits;
  sub: Subscription;
}

/** Sonraki dönemin başlangıç/bitişini hesaplar (saf fonksiyon; testlerde kullanılır). */
export function rollPeriod(start: Date, end: Date, now: Date): { start: Date; end: Date } {
  let s = start;
  let e = end;
  while (e <= now) {
    s = e;
    e = new Date(e.getTime() + PERIOD_MS);
  }
  return { start: s, end: e };
}

export const creditsForDuration = (durationSec: number) => Math.max(1, Math.ceil(durationSec / 60));

@Injectable()
export class EntitlementsService {
  constructor(private readonly db: PrismaService, private readonly realtime: RealtimeService) {}

  async ensureSubscription(userId: string): Promise<Subscription> {
    const now = new Date();
    let sub = await this.db.subscription.findUnique({ where: { userId } });
    if (!sub) {
      sub = await this.db.subscription.upsert({
        where: { userId }, update: {},
        create: { userId, plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() + PERIOD_MS), creditsGranted: PLAN_LIMITS.FREE.creditsPerMonth ?? 0 },
      });
      await this.log(userId, 'CREDIT_GRANT', { credits: sub.creditsGranted, idempotencyKey: `grant:${userId}:${sub.currentPeriodStart.toISOString()}` });
    }
    if (sub.currentPeriodEnd <= now) sub = await this.startNewPeriod(sub, now);
    return sub;
  }

  /** Dönem bittiyse sayaçları sıfırlar. Süresi dolmuş ücretli plan ücretsize düşer (mağaza yenilemesi webhook ile gelir). */
  private async startNewPeriod(sub: Subscription, now: Date): Promise<Subscription> {
    const lapsed = sub.plan !== 'FREE' && (!sub.willRenew || now.getTime() - sub.currentPeriodEnd.getTime() > 3 * 86_400_000);
    const plan: Plan = lapsed ? 'FREE' : sub.plan;
    const { start, end } = rollPeriod(sub.currentPeriodStart, sub.currentPeriodEnd, now);
    const granted = PLAN_LIMITS[plan].creditsPerMonth ?? 0;
    const updated = await this.db.subscription.update({
      where: { id: sub.id },
      data: { plan, status: lapsed ? 'EXPIRED' : sub.status, currentPeriodStart: start, currentPeriodEnd: end, creditsGranted: granted, creditsUsed: 0, clipsUsed: 0 },
    });
    await this.log(sub.userId, 'CREDIT_GRANT', { credits: granted, idempotencyKey: `grant:${sub.userId}:${start.toISOString()}` });
    return updated;
  }

  async get(userId: string): Promise<Entitlement> {
    const [user, sub] = await Promise.all([this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } }), this.ensureSubscription(userId)]);
    return { plan: sub.plan, role: user.role, limits: limitsFor(sub.plan, user.role), sub };
  }

  remainingCredits(e: Entitlement): number | null {
    return e.limits.creditsPerMonth === null ? null : Math.max(0, e.sub.creditsGranted - e.sub.creditsUsed);
  }

  async assertHasCredits(userId: string): Promise<Entitlement> {
    const e = await this.get(userId);
    if (this.remainingCredits(e) === 0) throw new AppError(402, 'CREDITS_EXHAUSTED', 'Bu dönem için işleme krediniz bitti');
    return e;
  }

  /** İşlenen dakika kadar kredi düşer. Yetersizse false döner; iş kimliğiyle idempotenttir. */
  async consumeCredits(userId: string, projectId: string, durationSec: number): Promise<{ ok: boolean; credits: number }> {
    const credits = creditsForDuration(durationSec);
    const e = await this.get(userId);
    const key = `consume:${projectId}`;
    if (await this.db.usageLog.findUnique({ where: { idempotencyKey: key } })) return { ok: true, credits };
    if (e.limits.creditsPerMonth !== null) {
      const res = await this.db.subscription.updateMany({ where: { id: e.sub.id, creditsUsed: { lte: e.sub.creditsGranted - credits } }, data: { creditsUsed: { increment: credits } } });
      if (res.count === 0) return { ok: false, credits };
    }
    await this.log(userId, 'CREDIT_CONSUME', { credits: -credits, quantity: durationSec / 60, unit: 'minute', projectId, idempotencyKey: key });
    await this.db.project.update({ where: { id: projectId }, data: { creditsConsumed: credits } });
    await this.emit(userId);
    return { ok: true, credits };
  }

  /** Aday üretilemeden başarısız olan veya iptal edilen projede kredi iade edilir. */
  async refundCredits(userId: string, projectId: string): Promise<void> {
    const consumed = await this.db.usageLog.findUnique({ where: { idempotencyKey: `consume:${projectId}` } });
    if (!consumed || (await this.db.usageLog.findUnique({ where: { idempotencyKey: `refund:${projectId}` } }))) return;
    const credits = -consumed.credits;
    await this.log(userId, 'CREDIT_REFUND', { credits, projectId, idempotencyKey: `refund:${projectId}` });
    await this.db.subscription.updateMany({ where: { userId, creditsUsed: { gte: credits } }, data: { creditsUsed: { decrement: credits } } });
    await this.db.project.update({ where: { id: projectId }, data: { creditsConsumed: 0 } }).catch(() => undefined);
    await this.emit(userId);
  }

  /** Aylık klip hakkından bir adet düşer. */
  async consumeClip(userId: string, clipId: string, projectId: string): Promise<Entitlement> {
    const e = await this.get(userId);
    if (e.limits.clipsPerMonth !== null) {
      const res = await this.db.subscription.updateMany({ where: { id: e.sub.id, clipsUsed: { lt: e.limits.clipsPerMonth } }, data: { clipsUsed: { increment: 1 } } });
      if (res.count === 0) throw new AppError(402, 'CLIP_LIMIT_REACHED', 'Bu dönem için klip hakkınız doldu');
    } else {
      await this.db.subscription.update({ where: { id: e.sub.id }, data: { clipsUsed: { increment: 1 } } });
    }
    await this.log(userId, 'CLIP_RENDER', { quantity: 1, unit: 'clip', projectId, clipId, idempotencyKey: `clip:${clipId}` });
    await this.emit(userId);
    return e;
  }

  async hasClipQuota(userId: string): Promise<boolean> {
    const e = await this.get(userId);
    return e.limits.clipsPerMonth === null || e.sub.clipsUsed < e.limits.clipsPerMonth;
  }

  resolution(e: Entitlement, wanted: Resolution): Resolution {
    return clampResolution(wanted, e.limits.maxResolution);
  }

  async assertChannelSlot(userId: string): Promise<void> {
    const e = await this.get(userId);
    if (e.limits.maxChannels === null) return;
    const count = await this.db.channel.count({ where: { ownerId: userId, status: { not: 'DISCONNECTED' } } });
    if (count >= e.limits.maxChannels) throw new AppError(403, 'CHANNEL_LIMIT_REACHED', `Planınız en çok ${e.limits.maxChannels} kanala izin veriyor`);
  }

  /** Worker'ların bildirdiği iş başına maliyet. */
  async logCost(userId: string, kind: UsageKind, data: { projectId?: string; clipId?: string; provider?: string; quantity: number; unit?: string; costMicroUsd: number }) {
    await this.log(userId, kind, { ...data, costMicroUsd: BigInt(Math.round(data.costMicroUsd)) });
  }

  private log(userId: string, kind: UsageKind, data: Omit<Prisma.UsageLogUncheckedCreateInput, 'userId' | 'kind'>) {
    return this.db.usageLog.create({ data: { userId, kind, ...data } }).catch((err: { code?: string }) => {
      if (err.code !== 'P2002') throw err; // aynı idempotencyKey: zaten kayıtlı
    });
  }

  private async emit(userId: string) {
    const e = await this.get(userId);
    await this.realtime.toUser(userId, 'credits.updated', { used: e.sub.creditsUsed, granted: e.limits.creditsPerMonth === null ? null : e.sub.creditsGranted, clipsUsed: e.sub.clipsUsed });
  }
}
