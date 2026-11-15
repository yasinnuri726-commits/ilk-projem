// Yol: klipai/apps/api/src/common/problem.filter.ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Response } from 'express';
import { ERRORS, type ErrorCode, errorTitle } from '@klipai/shared';
import { AppException } from './app-exception';
import { type AuthedRequest, currentTraceId, localeOf } from './request-context';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/** Tüm hataları RFC 9457 application/problem+json biçimine çevirir. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const http = host.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();
    const locale = localeOf(req);
    const traceId = currentTraceId();

    let code: ErrorCode = 'INTERNAL';
    let status = 500;
    let detail: string | undefined;
    let errors: AppException['errors'];

    if (exception instanceof AppException) {
      code = exception.code;
      status = exception.status;
      detail = exception.detail;
      errors = exception.errors;
      for (const [name, value] of Object.entries(exception.headers ?? {})) res.setHeader(name, value);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      if (status < 500) detail = exception.message;
    } else if ((exception as { type?: string })?.type === 'entity.too.large') {
      code = 'PAYLOAD_TOO_LARGE';
      status = 413;
    } else if ((exception as { type?: string })?.type === 'entity.parse.failed') {
      code = 'VALIDATION_FAILED';
      status = ERRORS.VALIDATION_FAILED.status;
      detail = 'Gövde geçerli JSON değil';
    }

    if (status >= 500) {
      this.logger.error(
        { traceId, path: req.originalUrl, userId: req.user?.id, err: exception },
        'İşlenmeyen hata',
      );
      Sentry.captureException(exception, { tags: { traceId } });
    }

    res
      .status(status)
      .type('application/problem+json')
      .send(
        JSON.stringify({
          type: `https://klipai.app/problems/${code.toLowerCase().replace(/_/g, '-')}`,
          title: errorTitle(code, locale),
          status,
          code,
          ...(detail ? { detail } : {}),
          traceId,
          ...(errors?.length ? { errors } : {}),
        }),
      );
  }
}
