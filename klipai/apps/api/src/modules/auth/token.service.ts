// Yol: klipai/apps/api/src/modules/auth/token.service.ts
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../../common/app-exception';
import { AppConfig } from '../../config/app-config';
import { randomToken, sha256 } from '../../infra/crypto.service';
import { PrismaService } from '../../infra/prisma.service';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

/**
 * Erişim JWT'si (kısa ömürlü) + döner refresh token.
 * Refresh token'ın yalnızca SHA-256 özeti saklanır. Her yenilemede token
 * değişir; kullanılmış bir token yeniden gelirse çalınmış sayılır ve aynı
 * aileden (familyId) tüm token'lar iptal edilir.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async issue(userId: string, client: ClientInfo, familyId: string = randomUUID()): Promise<SessionTokens> {
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        userAgent: client.userAgent?.slice(0, 300),
        ip: client.ip,
        expiresAt: new Date(Date.now() + this.config.refreshTtlDays * 86_400_000),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, fam: familyId });
    return { accessToken, refreshToken, expiresIn: this.config.accessTtlSec };
  }

  async rotate(refreshToken: string, client: ClientInfo): Promise<{ userId: string; tokens: SessionTokens }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row) throw new AppException('TOKEN_INVALID');

    if (row.rotatedAt || row.revokedAt) {
      await this.revokeFamily(row.familyId);
      this.logger.warn({ userId: row.userId, familyId: row.familyId }, 'Refresh token yeniden kullanıldı');
      throw new AppException('TOKEN_REUSED');
    }
    if (row.expiresAt <= new Date()) throw new AppException('TOKEN_INVALID');

    // Koşullu güncelleme: aynı token ile eşzamanlı iki istekten yalnızca biri kazanır.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(row.familyId);
      throw new AppException('TOKEN_REUSED');
    }
    return { userId: row.userId, tokens: await this.issue(row.userId, client, row.familyId) };
  }

  async revokeByToken(refreshToken: string, userId: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (row && row.userId === userId) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
