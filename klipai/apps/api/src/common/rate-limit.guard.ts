// Yol: klipai/apps/api/src/common/rate-limit.guard.ts
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { RedisService } from '../infra/redis.service';
import { AppException } from './app-exception';
import { RATE_LIMIT, type RateLimitOptions } from './decorators';
import type { AuthedRequest } from './request-context';

const DEFAULT: RateLimitOptions = { name: 'default', limit: 300, windowSec: 60, by: 'user' };

// Kayan pencere sayacı: içinde bulunulan pencere + bir öncekinin ağırlıklı payı.
const SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
return {current, previous}
`;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const options =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    const subject =
      options.by === 'user' && req.user ? `u:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
    const windowMs = options.windowSec * 1000;
    const now = Date.now();
    const index = Math.floor(now / windowMs);
    const elapsed = (now % windowMs) / windowMs;
    const base = `klipai:rl:${options.name}:${subject}`;

    const [current, previous] = (await this.redis.client.eval(
      SCRIPT,
      2,
      `${base}:${index}`,
      `${base}:${index - 1}`,
      String(windowMs * 2),
    )) as [number, number];

    const used = Math.floor(previous * (1 - elapsed)) + current;
    const resetSec = Math.ceil((windowMs - (now % windowMs)) / 1000);
    res.setHeader('X-RateLimit-Limit', String(options.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.limit - used)));
    res.setHeader('X-RateLimit-Reset', String(resetSec));

    if (used > options.limit) {
      throw new AppException('RATE_LIMITED', undefined, undefined, {
        'Retry-After': String(resetSec),
      });
    }
    return true;
  }
}
