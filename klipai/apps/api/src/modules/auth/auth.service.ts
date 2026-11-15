// Yol: klipai/apps/api/src/modules/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { AppLocale } from '@klipai/shared';
import type { z } from 'zod';
import { AppException } from '../../common/app-exception';
import type { OneTimeTokenPurpose, User } from '../../generated/prisma/client';
import { randomToken, sha256 } from '../../infra/crypto.service';
import { MailService } from '../../infra/mail.service';
import { isUniqueViolation, PrismaService } from '../../infra/prisma.service';
import { EntitlementsService } from '../billing/entitlements.service';
import type { RegisterSchema } from './auth.schemas';
import { GoogleVerifier } from './google.verifier';
import { type ClientInfo, type SessionTokens, TokenService } from './token.service';

const ARGON: argon2.Options = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 3_600_000;

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  theme: string;
  timezone: string;
  emailVerified: boolean;
  deletionScheduledAt: string | null;
  createdAt: string;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    theme: user.theme,
    timezone: user.timezone,
    emailVerified: user.emailVerifiedAt !== null,
    deletionScheduledAt: user.deletionScheduledAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export type AuthSession = SessionTokens & { user: UserDto };

@Injectable()
export class AuthService {
  /** Kullanıcı bulunamadığında da aynı süreyi harcamak için sahte özet. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly google: GoogleVerifier,
    private readonly mail: MailService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async register(input: z.infer<typeof RegisterSchema>, client: ClientInfo): Promise<AuthSession> {
    const passwordHash = await argon2.hash(input.password, ARGON);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          locale: input.locale ?? 'TR',
          timezone: input.timezone ?? 'Europe/Istanbul',
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppException('EMAIL_TAKEN');
      throw error;
    }
    await this.entitlements.subscriptionFor(user.id);
    await this.sendOneTime(user, 'EMAIL_VERIFY');
    return this.session(user, client);
  }

  async login(email: string, password: string, client: ClientInfo): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const hash = user?.passwordHash ?? (await (this.dummyHash ??= argon2.hash('klipai-dummy', ARGON)));
    const valid = await argon2.verify(hash, password).catch(() => false);
    if (!user || !user.passwordHash || !valid) throw new AppException('INVALID_CREDENTIALS');
    return this.session(user, client);
  }

  async loginWithGoogle(idToken: string, client: ClientInfo): Promise<AuthSession> {
    const identity = await this.google.verify(idToken);
    let user = await this.prisma.user.findUnique({ where: { googleSub: identity.sub } });

    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: identity.email } });
      if (byEmail) {
        // Var olan hesaba yalnızca Google e-postayı doğrulamışsa bağlanır;
        // aksi hâlde başkasının adresiyle hesap ele geçirilebilir.
        if (!identity.emailVerified) throw new AppException('GOOGLE_TOKEN_INVALID');
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleSub: identity.sub,
            emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
            avatarUrl: byEmail.avatarUrl ?? identity.picture,
          },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: identity.email,
            googleSub: identity.sub,
            displayName: (identity.name ?? identity.email.split('@')[0]!).slice(0, 80),
            avatarUrl: identity.picture,
            emailVerifiedAt: identity.emailVerified ? new Date() : null,
          },
        });
        await this.entitlements.subscriptionFor(user.id);
      }
    }
    return this.session(user, client);
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<AuthSession> {
    const { userId, tokens } = await this.tokens.rotate(refreshToken, client);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppException('TOKEN_INVALID');
    return { ...tokens, user: toUserDto(user) };
  }

  async logout(userId: string, refreshToken: string, allDevices: boolean): Promise<void> {
    if (allDevices) await this.tokens.revokeAll(userId);
    else await this.tokens.revokeByToken(refreshToken, userId);
  }

  async verifyEmail(token: string): Promise<void> {
    const row = await this.consumeOneTime(token, 'EMAIL_VERIFY');
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  }

  /** Hesap var olsun olmasın aynı yanıt verilir (hesap sayımı engellenir). */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) await this.sendOneTime(user, 'PASSWORD_RESET');
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const row = await this.consumeOneTime(token, 'PASSWORD_RESET');
    await this.prisma.user.update({
      where: { id: row.userId },
      data: {
        passwordHash: await argon2.hash(password, ARGON),
        // Sıfırlama bağlantısı e-postaya gittiği için adres de doğrulanmış olur.
        emailVerifiedAt: new Date(),
      },
    });
    await this.tokens.revokeAll(row.userId);
  }

  private async session(user: User, client: ClientInfo): Promise<AuthSession> {
    const tokens = await this.tokens.issue(user.id, client);
    return { ...tokens, user: toUserDto(user) };
  }

  private async sendOneTime(user: User, purpose: OneTimeTokenPurpose): Promise<void> {
    const token = randomToken(32);
    await this.prisma.oneTimeToken.create({
      data: {
        userId: user.id,
        purpose,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + (purpose === 'EMAIL_VERIFY' ? VERIFY_TTL_MS : RESET_TTL_MS)),
      },
    });
    const locale = user.locale.toLowerCase() as AppLocale;
    if (purpose === 'EMAIL_VERIFY') {
      await this.mail.send(user.email, 'VERIFY_EMAIL', locale, this.mail.link('verify-email', token));
    } else {
      await this.mail.send(user.email, 'PASSWORD_RESET', locale, this.mail.link('reset-password', token));
    }
  }

  private async consumeOneTime(token: string, purpose: OneTimeTokenPurpose): Promise<{ userId: string }> {
    const claimed = await this.prisma.oneTimeToken.updateMany({
      where: { tokenHash: sha256(token), purpose, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw new AppException('ONE_TIME_TOKEN_INVALID');
    return this.prisma.oneTimeToken.findUniqueOrThrow({
      where: { tokenHash: sha256(token) },
      select: { userId: true },
    });
  }
}
