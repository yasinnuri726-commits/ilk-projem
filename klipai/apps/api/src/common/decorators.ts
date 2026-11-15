// Yol: klipai/apps/api/src/common/decorators.ts
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthedRequest, AuthUser } from './request-context';

export const IS_PUBLIC = 'klipai:public';
/** Kimlik doğrulaması gerektirmeyen uç. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user as AuthUser;
});

export interface RateLimitOptions {
  /** Sayaç adı; aynı adı paylaşan uçlar aynı kovayı kullanır. */
  name: string;
  limit: number;
  windowSec: number;
  /** 'ip': istemci adresine göre; 'user': kullanıcıya göre (oturum yoksa IP). */
  by: 'ip' | 'user';
}
export const RATE_LIMIT = 'klipai:rate-limit';
export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT, options);
