import { CallHandler, createParamDecorator, ExecutionContext, Injectable, NestInterceptor, PipeTransform, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, of, tap } from 'rxjs';
import { ZodType } from 'zod';
import { RedisService } from '../infra/redis.service';
import { AppError } from './errors';

export interface AuthUser {
  id: string;
  role: 'USER' | 'DEVELOPER';
}
export type AuthedRequest = Request & { user: AuthUser; rawBody?: Buffer };

export const IS_PUBLIC = 'isPublic';
/** JWT denetimini atlar (kimlik uçları, webhook'lar, sağlık). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<AuthedRequest>().user);

/** Gövde/sorgu doğrulaması: `@Body(new Zod(schema))`. */
export class Zod<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new AppError(422, 'VALIDATION_FAILED', 'Girdi doğrulanamadı', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return r.data;
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
/** `limit + 1` kayıt çekilmiş listeyi sayfaya çevirir. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}
export const cursorArgs = (cursor: string | undefined, limit: number) => ({
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

/** `Idempotency-Key` başlığı olan POST'ların yanıtını 24 saat saklar ve tekrarında aynısını döner. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly redis: RedisService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const key = req.headers['idempotency-key'];
    if (req.method !== 'POST' || typeof key !== 'string' || !key || key.length > 64 || !req.user) return next.handle();
    const redisKey = `idem:${req.user.id}:${req.path}:${key}`;
    const hit = await this.redis.client.get(redisKey);
    if (hit) return of(JSON.parse(hit));
    return next.handle().pipe(
      tap((body) => {
        void this.redis.client.set(redisKey, JSON.stringify(body ?? null, bigintReplacer), 'EX', 86400);
      }),
    );
  }
}

export const bigintReplacer = (_: string, v: unknown) => (typeof v === 'bigint' ? Number(v) : v);
