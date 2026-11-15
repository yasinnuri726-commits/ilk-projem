// Yol: klipai/apps/api/src/modules/billing/entitlements.service.ts
import { Injectable } from '@nestjs/common';
import { ENTITLEMENTS, type Entitlements, OWNER_ENTITLEMENTS, type Plan } from '@klipai/shared';
import { AppException } from '../../common/app-exception';
import { AppConfig } from '../../config/app-config';
import type { Subscription } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../infra/prisma.service';

export interface Access {
  plan: Plan;
  /** OWNER_EMAILS içindeki hesap: abonelik gerekmez, sınır uygulanmaz. */
  isOwner: boolean;
  entitlements: Entitlements;
  subscription: Subscription;
  /** null = sınırsız */
  creditsRemaining: number | null;
}

export function periodKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addMonth(date: Date): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export function creditsFor(durationMs: number): number {
  return Math.max(1, Math.ceil(durationMs / 60_000));
}

/**
 * Plan hakları ve kredi defteri. Mağaza abonelikleri (RevenueCat) 6. aşamada
 * bu servisin üzerine eklenir; buradaki kurallar plandan bağımsızdır.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Abonelik satırını getirir (yoksa Ücretsiz açar) ve süresi dolan dönemi yeniler. */
  async subscriptionFor(userId: string, db: Tx = this.prisma): Promise<Subscription> {
    const now = new Date();
    let sub = await db.subscription.findUnique({ where: { userId } });
    if (!sub) {
      sub = await db.subscription.upsert({
        where: { userId },
        update: {},
        create: {
          userId,
          plan: 'FREE',
          status: 'ACTIVE',
          rcAppUserId: userId,
          periodStart: now,
          periodEnd: addMonth(now),
          creditsGranted: ENTITLEMENTS.FREE.monthlyCredits ?? 0,
        },
      });
      await this.logGrant(db, sub);
    }
    // Mağaza abonelikleri RevenueCat olaylarıyla yenilenir; yalnızca mağazasız
    // (Ücretsiz / promosyon) dönemler burada tembel olarak döndürülür.
    if (sub.periodEnd <= now && (sub.store === null || sub.store === 'PROMOTIONAL')) {
      let start = sub.periodEnd;
      while (addMonth(start) <= now) start = addMonth(start);
      const rolled = await db.subscription.updateMany({
        where: { userId, periodEnd: sub.periodEnd },
        data: {
          periodStart: start,
          periodEnd: addMonth(start),
          creditsUsed: 0,
          clipsUsed: 0,
          creditsGranted: ENTITLEMENTS[sub.plan].monthlyCredits ?? 0,
        },
      });
      sub = await db.subscription.findUniqueOrThrow({ where: { userId } });
      if (rolled.count === 1) await this.logGrant(db, sub);
    }
    return sub;
  }

  private async logGrant(db: Tx, sub: Subscription): Promise<void> {
    const key = `grant:${sub.userId}:${sub.periodStart.toISOString()}`;
    const exists = await db.usageLog.findUnique({ where: { idempotencyKey: key } });
    if (exists) return;
    await db.usageLog.create({
      data: {
        userId: sub.userId,
        kind: 'CREDIT_GRANT',
        credits: sub.creditsGranted,
        periodKey: periodKeyOf(sub.periodStart),
        idempotencyKey: key,
        meta: { plan: sub.plan },
      },
    });
  }

  async accessFor(userId: string, db: Tx = this.prisma): Promise<Access> {
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new AppException('NOT_FOUND');
    const subscription = await this.subscriptionFor(userId, db);
    const isOwner = this.config.ownerEmails.includes(user.email.toLowerCase());
    const active = ['ACTIVE', 'TRIALING', 'GRACE_PERIOD', 'CANCELED'].includes(subscription.status);
    const plan: Plan = active ? subscription.plan : 'FREE';
    const entitlements = isOwner ? OWNER_ENTITLEMENTS : ENTITLEMENTS[plan];
    const creditsRemaining =
      entitlements.monthlyCredits === null
        ? null
        : Math.max(0, subscription.creditsGranted - subscription.creditsUsed);
    return { plan: isOwner ? 'AGENCY' : plan, isOwner, entitlements, subscription, creditsRemaining };
  }

  /** İş başlamadan önce: bakiye yetmiyorsa 402. */
  async assertCredits(userId: string, durationMs: number): Promise<void> {
    const access = await this.accessFor(userId);
    if (access.creditsRemaining !== null && access.creditsRemaining < creditsFor(durationMs)) {
      throw new AppException('INSUFFICIENT_CREDITS');
    }
  }

  /**
   * Kesin süre belli olunca krediyi düşer. Proje başına bir kez (yeniden
   * denemede tekrar düşülmez). Bakiye yetmiyorsa false döner, hiçbir şey yazmaz.
   */
  async chargeMinutes(
    db: Tx,
    input: { userId: string; projectId: string; channelId: string; durationMs: number },
  ): Promise<boolean> {
    const key = `minutes:${input.projectId}`;
    if (await db.usageLog.findUnique({ where: { idempotencyKey: key } })) return true;

    const access = await this.accessFor(input.userId, db);
    const credits = creditsFor(input.durationMs);
    if (access.creditsRemaining !== null && access.creditsRemaining < credits) return false;

    await db.usageLog.create({
      data: {
        userId: input.userId,
        channelId: input.channelId,
        projectId: input.projectId,
        kind: 'MINUTES_PROCESSED',
        credits: -credits,
        minutes: (input.durationMs / 60_000).toFixed(3),
        periodKey: periodKeyOf(access.subscription.periodStart),
        idempotencyKey: key,
        meta: { unlimited: access.creditsRemaining === null },
      },
    });
    await db.subscription.update({
      where: { userId: input.userId },
      data: { creditsUsed: { increment: credits } },
    });
    return true;
  }

  /** Analizi tamamlanmadan iptal edilen / silinen projenin kredisini geri verir. */
  async refundProject(db: Tx, projectId: string): Promise<void> {
    const charge = await db.usageLog.findUnique({ where: { idempotencyKey: `minutes:${projectId}` } });
    if (!charge) return;
    const key = `refund:${projectId}`;
    if (await db.usageLog.findUnique({ where: { idempotencyKey: key } })) return;

    const credits = -charge.credits;
    await db.usageLog.create({
      data: {
        userId: charge.userId,
        channelId: charge.channelId,
        projectId,
        kind: 'REFUND',
        credits,
        minutes: charge.minutes,
        periodKey: charge.periodKey,
        idempotencyKey: key,
      },
    });
    // Sayaç yalnızca düşümün yapıldığı dönem hâlâ sürüyorsa düzeltilir.
    const sub = await db.subscription.findUnique({ where: { userId: charge.userId } });
    if (sub && periodKeyOf(sub.periodStart) === charge.periodKey) {
      await db.subscription.update({
        where: { userId: charge.userId },
        data: { creditsUsed: Math.max(0, sub.creditsUsed - credits) },
      });
    }
  }
}
