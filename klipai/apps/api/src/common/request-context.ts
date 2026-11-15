// Yol: klipai/apps/api/src/common/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppLocale } from '@klipai/shared';

export interface RequestContext {
  traceId: string;
  locale: AppLocale;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentTraceId(): string {
  return storage.getStore()?.traceId ?? randomUUID();
}

export function localeOf(req: Request): AppLocale {
  const header = (req.headers['accept-language'] ?? '').toString().toLowerCase();
  return header.startsWith('en') ? 'en' : 'tr';
}

/** Her isteğe traceId atar; log satırlarına ve kuyruk işlerine taşınır. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const traceId =
    typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', traceId);
  storage.run({ traceId, locale: localeOf(req) }, next);
}

export interface AuthUser {
  id: string;
  familyId: string;
  /** Erişim token'ının bitiş zamanı (epoch saniye). */
  exp: number;
}

export type AuthedRequest = Request & { user?: AuthUser };
