// Yol: klipai/apps/api/src/common/auth.guard.ts
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppException } from './app-exception';
import { IS_PUBLIC } from './decorators';
import type { AuthedRequest } from './request-context';

export interface AccessTokenPayload {
  sub: string;
  fam: string;
  exp: number;
}

/** Tüm uçlarda varsayılan: geçerli erişim JWT'si. @Public() ile kapatılır. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw new AppException('UNAUTHORIZED');
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      req.user = { id: payload.sub, familyId: payload.fam, exp: payload.exp };
    } catch {
      if (isPublic) return true;
      throw new AppException('UNAUTHORIZED');
    }
    return true;
  }
}
