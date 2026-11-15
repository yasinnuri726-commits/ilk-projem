// Yol: klipai/apps/api/src/common/idempotency.interceptor.ts
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { type Observable, of, tap } from 'rxjs';
import { RedisService } from '../infra/redis.service';
import { AppException } from './app-exception';
import type { AuthedRequest } from './request-context';

const TTL_SEC = 24 * 60 * 60;
const PENDING = 'pending';

/**
 * `Idempotency-Key` başlıklı POST isteklerinin yanıtını 24 saat saklar; aynı
 * anahtarla gelen tekrar aynı yanıtı alır, işlem ikinci kez çalışmaz.
 * Hatalı sonuçlar saklanmaz (istemci yeniden deneyebilir).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly redis: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (req.method !== 'POST' || typeof key !== 'string' || !req.user) return next.handle();
    if (!/^[\w-]{8,64}$/.test(key)) {
      throw new AppException('VALIDATION_FAILED', 'Idempotency-Key biçimi geçersiz');
    }

    const redisKey = `klipai:idem:${req.user.id}:${req.path}:${key}`;
    const acquired = await this.redis.client.set(redisKey, PENDING, 'EX', TTL_SEC, 'NX');
    if (acquired !== 'OK') {
      const stored = await this.redis.client.get(redisKey);
      if (!stored || stored === PENDING) throw new AppException('IDEMPOTENCY_IN_PROGRESS');
      const { status, body } = JSON.parse(stored) as { status: number; body: unknown };
      res.status(status);
      res.setHeader('Idempotent-Replayed', 'true');
      return of(body);
    }

    return next.handle().pipe(
      tap({
        next: (body) => {
          void this.redis.client.set(
            redisKey,
            JSON.stringify({ status: res.statusCode, body: body ?? null }),
            'EX',
            TTL_SEC,
          );
        },
        error: () => {
          void this.redis.client.del(redisKey);
        },
      }),
    );
  }
}
