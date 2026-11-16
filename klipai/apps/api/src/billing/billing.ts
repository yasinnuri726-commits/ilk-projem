import { Body, Controller, Get, Headers, HttpCode, Injectable, Logger, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';
import { Plan, PLAN_LIMITS } from '@klipai/shared';
import { safeEqual } from '../common/crypto';
import { AppError } from '../common/errors';
import { AuthUser, CurrentUser, cursorArgs, Public, toPage, Zod } from '../common/http';
import { env } from '../config';
import { PrismaService } from '../infra/infra.module';
import { NotificationsService } from '../notifications/notifications';
import { EntitlementsService, PERIOD_MS } from './entitlements.service';

/** RevenueCat yetki (entitlement) ya da ürün kimliğinden plan. */
export function planFrom(entitlements: string[] = [], productId = ''): Plan {
  const all = [...entitlements, productId].join(' ').toLowerCase();
  if (all.includes('agency') || all.includes('ajans')) return 'AGENCY';
  if (all.includes('pro')) return 'PRO';
  return 'FREE';
}

interface RcEvent {
  id: string;
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  new_product_id?: string;
  entitlement_ids?: string[] | null;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  store?: string;
  period_type?: string;
}

@Injectable()
export class BillingService {
  private readonly log = new Logger('Billing');
  constructor(private readonly db: PrismaService, private readonly entitlements: EntitlementsService, private readonly notifications: NotificationsService) {}

  async view(userId: string) {
    const e = await this.entitlements.get(userId);
    const channelsUsed = await this.db.channel.count({ where: { ownerId: userId, status: { not: 'DISCONNECTED' } } });
    return {
      plan: e.plan, role: e.role, status: e.sub.status, willRenew: e.sub.willRenew, currentPeriodEnd: e.sub.currentPeriodEnd, limits: e.limits,
      usage: { clipsUsed: e.sub.clipsUsed, creditsUsed: e.sub.creditsUsed, creditsGranted: e.limits.creditsPerMonth === null ? null : e.sub.creditsGranted, channelsUsed },
    };
  }

  /** Yeni plan/dönem uygular. Dönem başlangıcı değiştiyse sayaçlar sıfırlanır ve kredi tanımlanır. */
  private async apply(userId: string, next: { plan: Plan; status: SubscriptionStatus; start?: Date; end?: Date; willRenew: boolean; store?: string; productId?: string; eventId?: string }) {
    const sub = await this.entitlements.ensureSubscription(userId);
    const start = next.start ?? sub.currentPeriodStart;
    const newPeriod = next.plan !== sub.plan || start.getTime() !== sub.currentPeriodStart.getTime();
    const granted = PLAN_LIMITS[next.plan].creditsPerMonth ?? 0;
    // Dönem ortasında yükseltmede kullanılan kredi korunur, tavan yeni plana çıkar.
    const upgradeSamePeriod = next.plan !== sub.plan && start.getTime() === sub.currentPeriodStart.getTime();
    await this.db.subscription.update({
      where: { id: sub.id },
      data: {
        plan: next.plan, status: next.status, willRenew: next.willRenew, store: next.store ?? sub.store, productId: next.productId ?? sub.productId,
        currentPeriodStart: start, currentPeriodEnd: next.end ?? new Date(start.getTime() + PERIOD_MS), lastEventId: next.eventId ?? sub.lastEventId,
        ...(newPeriod ? { creditsGranted: granted, ...(upgradeSamePeriod ? {} : { creditsUsed: 0, clipsUsed: 0 }) } : {}),
      },
    });
    if (newPeriod) {
      await this.db.usageLog.create({ data: { userId, kind: 'CREDIT_GRANT', credits: granted, idempotencyKey: `grant:${userId}:${next.plan}:${start.toISOString()}` } }).catch(() => undefined);
    }
    if (next.plan !== sub.plan) await this.notifications.notify(userId, 'SUBSCRIPTION_CHANGED', { plan: next.plan }, '/subscription');
  }

  async handleWebhook(ev: RcEvent): Promise<void> {
    if (!ev?.id || !ev.type) throw new AppError(422, 'VALIDATION_FAILED', 'Geçersiz olay');
    const ids = [ev.app_user_id, ev.original_app_user_id, ...(ev.aliases ?? [])].filter((v): v is string => !!v);
    const user = await this.db.user.findFirst({ where: { revenueCatId: { in: ids } }, include: { subscription: true } });
    if (!user) {
      this.log.warn(`RevenueCat olayı bilinmeyen kullanıcı için: ${ev.app_user_id}`);
      return;
    }
    if (user.subscription?.lastEventId === ev.id) return; // yinelenen teslimat
    const plan = planFrom(ev.entitlement_ids ?? [], ev.new_product_id ?? ev.product_id);
    const start = ev.purchased_at_ms ? new Date(ev.purchased_at_ms) : undefined;
    const end = ev.expiration_at_ms ? new Date(ev.expiration_at_ms) : undefined;
    const base = { store: ev.store?.toLowerCase(), productId: ev.new_product_id ?? ev.product_id, eventId: ev.id };
    const current = user.subscription?.plan ?? 'FREE';

    switch (ev.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'NON_RENEWING_PURCHASE':
        await this.apply(user.id, { ...base, plan, status: ev.period_type === 'TRIAL' ? 'TRIALING' : 'ACTIVE', start, end, willRenew: ev.type !== 'NON_RENEWING_PURCHASE' });
        break;
      case 'UNCANCELLATION':
        await this.apply(user.id, { ...base, plan: current, status: 'ACTIVE', end, willRenew: true });
        break;
      case 'CANCELLATION':
        await this.apply(user.id, { ...base, plan: current, status: 'CANCELED', end, willRenew: false }); // dönem sonuna kadar erişim sürer
        break;
      case 'BILLING_ISSUE':
        await this.apply(user.id, { ...base, plan: current, status: 'IN_GRACE', end, willRenew: true });
        break;
      case 'EXPIRATION':
        await this.apply(user.id, { ...base, plan: 'FREE', status: 'EXPIRED', start: new Date(), willRenew: false });
        break;
      default:
        await this.db.subscription.updateMany({ where: { userId: user.id }, data: { lastEventId: ev.id } });
    }
  }

  /** Satın alma sonrası istemci çağırır: webhook gecikse de durum RevenueCat'ten çekilir. */
  async sync(userId: string) {
    if (!env().REVENUECAT_API_KEY) throw new AppError(502, 'UPSTREAM_ERROR', 'RevenueCat yapılandırılmamış');
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.revenueCatId)}`, { headers: { Authorization: `Bearer ${env().REVENUECAT_API_KEY}` } }).catch(() => null);
    if (!res?.ok) throw new AppError(502, 'UPSTREAM_ERROR', 'RevenueCat durumu alınamadı');
    const body = (await res.json()) as { subscriber: { entitlements: Record<string, { expires_date: string | null; purchase_date: string; product_identifier: string }>; subscriptions: Record<string, { unsubscribe_detected_at: string | null; store: string }> } };
    const active = Object.entries(body.subscriber.entitlements).filter(([, e]) => !e.expires_date || new Date(e.expires_date) > new Date());
    const plan = planFrom(active.map(([k]) => k));
    const best = active.find(([k]) => planFrom([k]) === plan)?.[1];
    if (plan === 'FREE' || !best) {
      const sub = await this.entitlements.ensureSubscription(userId);
      if (sub.plan !== 'FREE') await this.apply(userId, { plan: 'FREE', status: 'EXPIRED', start: new Date(), willRenew: false });
    } else {
      const store = body.subscriber.subscriptions[best.product_identifier];
      await this.apply(userId, { plan, status: 'ACTIVE', start: new Date(best.purchase_date), end: best.expires_date ? new Date(best.expires_date) : undefined, willRenew: !store?.unsubscribe_detected_at, store: store?.store, productId: best.product_identifier });
    }
    return this.view(userId);
  }
}

const usageQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService, private readonly db: PrismaService) {}

  @Get('subscription')
  get(@CurrentUser() u: AuthUser) {
    return this.billing.view(u.id);
  }

  @Post('subscription/sync')
  @HttpCode(200)
  sync(@CurrentUser() u: AuthUser) {
    return this.billing.sync(u.id);
  }

  @Get('usage')
  async usage(@CurrentUser() u: AuthUser, @Query(new Zod(usageQuery)) q: z.infer<typeof usageQuery>) {
    // Maliyet satırları iç kayıttır; kullanıcıya yalnızca kredi hareketleri gösterilir.
    const rows = await this.db.usageLog.findMany({
      where: { userId: u.id, kind: { in: ['CREDIT_GRANT', 'CREDIT_CONSUME', 'CREDIT_REFUND', 'CLIP_RENDER'] } }, include: { project: { select: { title: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q.cursor, q.limit),
    });
    const page = toPage(rows, q.limit);
    return { items: page.items.map((r) => ({ id: r.id, kind: r.kind, credits: r.credits, projectId: r.projectId, projectTitle: r.project?.title ?? null, createdAt: r.createdAt })), nextCursor: page.nextCursor };
  }

  @Public()
  @SkipThrottle()
  @Post('webhooks/revenuecat')
  @HttpCode(200)
  async webhook(@Headers('authorization') auth: string | undefined, @Body() body: { event?: RcEvent }) {
    const secret = env().REVENUECAT_WEBHOOK_SECRET;
    if (!secret || !auth || !safeEqual(auth, `Bearer ${secret}`)) throw new AppError(401, 'UNAUTHENTICATED', 'Webhook yetkisi geçersiz');
    await this.billing.handleWebhook(body.event as RcEvent);
    return { ok: true };
  }
}
