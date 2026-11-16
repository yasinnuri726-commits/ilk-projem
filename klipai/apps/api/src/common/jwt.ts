import * as jwt from 'jsonwebtoken';
import { env } from '../config';
import { AppError } from './errors';
import type { AuthUser } from './http';

/** Erişim belirtecini doğrular (HTTP koruması ve WebSocket el sıkışması ortak kullanır). */
export function verifyAccessToken(token: string): AuthUser {
  try {
    const p = jwt.verify(token, env().JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as { sub: string; role: AuthUser['role'] };
    return { id: p.sub, role: p.role };
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Erişim belirteci geçersiz veya süresi dolmuş');
  }
}
