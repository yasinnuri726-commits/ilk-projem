import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { ErrorCode } from '@klipai/shared';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/** Uygulama hatası → RFC 9457 problem+json. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(detail ?? code);
  }
}

export const notFound = (what = 'Kayıt') => new AppError(404, 'NOT_FOUND', `${what} bulunamadı`);
export const forbidden = (detail = 'Bu işlem için yetkiniz yok') => new AppError(403, 'FORBIDDEN', detail);
export const invalidState = (detail: string) => new AppError(409, 'INVALID_STATE', detail);

const TITLES: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  413: 'Payload Too Large', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway',
};
const STATUS_CODE: Record<number, ErrorCode> = { 400: 'VALIDATION_FAILED', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'RATE_LIMITED' };

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(err: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const traceId = (req.headers['x-request-id'] as string) || randomUUID();

    let status = 500;
    let code: ErrorCode = 'INTERNAL';
    let detail: string | undefined;
    let errors: AppError['errors'];

    if (err instanceof AppError) {
      ({ status, code, detail, errors } = err);
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = STATUS_CODE[status] ?? 'INTERNAL';
      const body = err.getResponse();
      detail = typeof body === 'string' ? body : ((body as { message?: string | string[] }).message ?? err.message).toString();
    } else if ((err as { code?: string })?.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
    } else if ((err as { type?: string })?.type === 'entity.too.large') {
      status = 413;
      code = 'VALIDATION_FAILED';
    }

    if (status >= 500) {
      this.log.error({ traceId, path: req.url, err: err instanceof Error ? err.stack : String(err) });
      Sentry.captureException(err, { tags: { traceId } });
      detail = undefined; // iç ayrıntı sızdırılmaz
    }
    res
      .status(status)
      .type('application/problem+json')
      .send({ type: `https://klipai.app/errors/${code}`, title: TITLES[status] ?? 'Error', status, code, detail, traceId, errors });
  }
}
