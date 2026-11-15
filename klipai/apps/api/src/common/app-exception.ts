// Yol: klipai/apps/api/src/common/app-exception.ts
import { ERRORS, type ErrorCode } from '@klipai/shared';

export interface FieldError {
  path: string;
  message: string;
}

export class AppException extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly errors?: FieldError[],
    /** Yanıta eklenecek başlıklar (ör. Retry-After). */
    readonly headers?: Record<string, string>,
  ) {
    super(detail ?? code);
    this.name = 'AppException';
    this.status = ERRORS[code].status;
  }
}
