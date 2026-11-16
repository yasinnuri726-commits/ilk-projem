import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import * as jwt from 'jsonwebtoken';
import { z } from 'zod';
import { LOCALES } from '@klipai/shared';
import { randomToken, sha256 } from '../common/crypto';
import { AppError } from '../common/errors';
import { AuthedRequest, IS_PUBLIC } from '../common/http';
import { verifyAccessToken } from '../common/jwt';
import { env } from '../config';
import { MailService, PrismaService } from '../infra/infra.module';
import { EntitlementsService } from '../billing/entitlements.service';

export const registerSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(80),
  locale: z.enum(LOCALES).optional(),
  timezone: z.string().max(64).optional(),
});
export const loginSchema = z.object({
  /** E-posta veya kullanıcı adı. */
  email: z.string().min(1).max(254).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});
export const googleSchema = z.object({ idToken: z.string().min(10) });
export const refreshSchema = z.object({ refreshToken: z.string().min(10) });
export const forgotSchema = z.object({ email: z.string().email().transform((v) => v.trim().toLowerCase()) });
export const resetSchema = z.object({ token: z.string().min(10), password: z.string().min(8).max(128) });

export interface Meta {
  ip?: string;
  userAgent?: string;
}

const INVALID = () => new AppError(401, 'INVALID_CREDENTIALS', 'E-posta/kullanıcı adı veya parola hatalı');

@Injectable()
export class AuthService {
  private readonly google = new OAuth2Client();

  constructor(
    private readonly db: PrismaService,
    private readonly mail: MailService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async register(dto: z.infer<typeof registerSchema>, meta: Meta) {
    if (await this.db.user.findUnique({ where: { email: dto.email } })) throw new AppError(409, 'EMAIL_TAKEN', 'Bu e-posta zaten kayıtlı');
    const user = await this.db.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
        locale: dto.locale ?? 'TR',
        timezone: dto.timezone ?? 'Europe/Istanbul',
        identities: { create: { provider: 'EMAIL', providerUserId: dto.email } },
      },
    });
    await this.entitlements.ensureSubscription(user.id);
    await this.sendOneTime(user, 'verify_email');
    return this.issueSession(user, meta);
  }

  async login(dto: z.infer<typeof loginSchema>, meta: Meta) {
    const user = await this.db.user.findFirst({ where: { OR: [{ email: dto.email }, { username: dto.email }], deletedAt: null } });
    // Kullanıcı yoksa da sabit süreli doğrulama yapılır (hesap varlığı sızdırılmaz).
    const ok = user?.passwordHash ? await argon2.verify(user.passwordHash, dto.password).catch(() => false) : await argon2.hash(dto.password).then(() => false);
    if (!user || !ok) throw INVALID();
    return this.issueSession(user, meta);
  }

  async loginWithGoogle(idToken: string, meta: Meta) {
    const audiences = [env().GOOGLE_CLIENT_ID, ...env().GOOGLE_EXTRA_AUDIENCES.split(',')].map((s) => s.trim()).filter(Boolean);
    const payload = await this.google.verifyIdToken({ idToken, audience: audiences }).then((t) => t.getPayload()).catch(() => undefined);
    if (!payload?.sub || !payload.email || !payload.email_verified) throw new AppError(401, 'INVALID_CREDENTIALS', 'Google kimliği doğrulanamadı');
    const email = payload.email.toLowerCase();

    const identity = await this.db.authIdentity.findUnique({ where: { provider_providerUserId: { provider: 'GOOGLE', providerUserId: payload.sub } }, include: { user: true } });
    let user = identity?.user;
    if (!user) {
      const existing = await this.db.user.findUnique({ where: { email } });
      user = existing
        ? await this.db.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), identities: { create: { provider: 'GOOGLE', providerUserId: payload.sub } } } })
        : await this.db.user.create({
            data: { email, displayName: payload.name ?? email.split('@')[0], avatarUrl: payload.picture, emailVerifiedAt: new Date(), identities: { create: { provider: 'GOOGLE', providerUserId: payload.sub } } },
          });
      await this.entitlements.ensureSubscription(user.id);
    }
    if (user.deletedAt) throw INVALID();
    return this.issueSession(user, meta);
  }

  /** Refresh token rotasyonu; iptal edilmiş token yeniden gelirse tüm aile kapatılır. */
  async refresh(refreshToken: string, meta: Meta) {
    const row = await this.db.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!row) throw new AppError(401, 'UNAUTHENTICATED', 'Oturum geçersiz');
    if (row.revokedAt) {
      await this.db.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new AppError(401, 'TOKEN_REUSED', 'Oturum güvenlik nedeniyle kapatıldı');
    }
    if (row.expiresAt < new Date() || row.user.deletedAt) throw new AppError(401, 'UNAUTHENTICATED', 'Oturum süresi doldu');
    return this.issueSession(row.user, meta, row);
  }

  async logout(refreshToken: string) {
    await this.db.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async forgotPassword(email: string) {
    const user = await this.db.user.findFirst({ where: { email, deletedAt: null } });
    if (user) await this.sendOneTime(user, 'reset_password');
  }

  async resetPassword(token: string, password: string) {
    const row = await this.consumeOneTime(token, 'reset_password');
    await this.db.$transaction([
      this.db.user.update({ where: { id: row.userId }, data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } }),
      this.db.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async verifyEmail(token: string) {
    const row = await this.consumeOneTime(token, 'verify_email');
    await this.db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  }

  async publicUser(user: User) {
    const sub = await this.entitlements.ensureSubscription(user.id);
    return {
      id: user.id, email: user.email, username: user.username, role: user.role, emailVerified: !!user.emailVerifiedAt, displayName: user.displayName,
      avatarUrl: user.avatarUrl, locale: user.locale, timezone: user.timezone, plan: sub.plan, revenueCatId: user.revenueCatId, createdAt: user.createdAt,
    };
  }

  private async issueSession(user: User, meta: Meta, previous?: { id: string; familyId: string }) {
    const e = env();
    const refreshToken = randomToken(48);
    const created = await this.db.refreshToken.create({
      data: {
        userId: user.id, familyId: previous?.familyId ?? randomToken(12), tokenHash: sha256(refreshToken),
        userAgent: meta.userAgent?.slice(0, 255), ip: meta.ip, expiresAt: new Date(Date.now() + e.REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    if (previous) await this.db.refreshToken.update({ where: { id: previous.id }, data: { revokedAt: new Date(), replacedBy: created.id } });
    const accessToken = jwt.sign({ role: user.role }, e.JWT_ACCESS_SECRET, { subject: user.id, expiresIn: e.JWT_ACCESS_TTL_SEC, algorithm: 'HS256' });
    return { accessToken, refreshToken, expiresIn: e.JWT_ACCESS_TTL_SEC, user: await this.publicUser(user) };
  }

  private async sendOneTime(user: User, purpose: 'verify_email' | 'reset_password') {
    const token = randomToken(32);
    await this.db.oneTimeToken.create({ data: { userId: user.id, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + (purpose === 'reset_password' ? 3_600_000 : 86_400_000)) } });
    const link = `${env().APP_SCHEME}://${purpose === 'reset_password' ? 'reset-password' : 'verify-email'}?token=${token}`;
    const tr = user.locale === 'TR';
    const subject = purpose === 'reset_password' ? (tr ? 'KlipAI parola sıfırlama' : 'Reset your KlipAI password') : tr ? 'KlipAI e-posta doğrulama' : 'Verify your KlipAI email';
    const body = tr ? `Merhaba ${user.displayName},\n\nDevam etmek için bağlantıyı açın:\n${link}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayın.` : `Hi ${user.displayName},\n\nOpen this link to continue:\n${link}\n\nIf you did not request this, ignore this email.`;
    await this.mail.send(user.email, subject, body);
  }

  private async consumeOneTime(token: string, purpose: string) {
    const row = await this.db.oneTimeToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) throw new AppError(400, 'VALIDATION_FAILED', 'Bağlantı geçersiz veya süresi dolmuş');
    await this.db.oneTimeToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row;
  }
}

/** Genel JWT koruması; `@Public()` ile işaretli uçlar hariç. */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Kimlik doğrulaması gerekli');
    req.user = verifyAccessToken(header.slice(7));
    return true;
  }
}
