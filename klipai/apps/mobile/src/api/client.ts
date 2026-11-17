import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../config';
import type { ApiErrorBody, Session } from './types';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly errors?: ApiErrorBody['errors']) {
    super(message);
  }
  get isNetwork() {
    return this.code === 'NETWORK';
  }
}

const ACCESS = 'klipai.access';
const REFRESH = 'klipai.refresh';
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export const setSessionLostHandler = (fn: () => void) => { onSessionLost = fn; };
export const getAccessToken = () => accessToken;

export async function loadTokens(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS);
  return !!(await SecureStore.getItemAsync(REFRESH));
}
export async function saveSession(s: Pick<Session, 'accessToken' | 'refreshToken'>) {
  accessToken = s.accessToken;
  await Promise.all([SecureStore.setItemAsync(ACCESS, s.accessToken), SecureStore.setItemAsync(REFRESH, s.refreshToken)]);
}
export async function clearSession() {
  accessToken = null;
  await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]);
}
export const getRefreshToken = () => SecureStore.getItemAsync(REFRESH);

let refreshing: Promise<boolean> | null = null;
/** Aynı anda gelen 401'ler tek bir yenileme isteğini paylaşır. */
async function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const token = await getRefreshToken();
    if (!token) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: token }) });
      if (!res.ok) {
        // Ağ dışı ret (süresi dolmuş / çalıntı): oturum kapanır. 5xx geçicidir, oturum korunur.
        if (res.status < 500) await clearSession();
        return false;
      }
      await saveSession((await res.json()) as Session);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null; // beklemekte olan çağıranlar kendi referanslarından sonucu alır; yeni 401'ler yeni yenileme başlatır
    }
  })();
  return refreshing;
}

export interface RequestOptions { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined | null>; auth?: boolean; idempotencyKey?: string; signal?: AbortSignal }

export async function api<T = unknown>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const { method = 'GET', body, query, auth = true, idempotencyKey, signal } = opts;
  const qs = query ? Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const usedToken = accessToken;
  if (auth && usedToken) headers.Authorization = `Bearer ${usedToken}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs ? `?${qs}` : ''}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Sunucuya ulaşılamadı');
  }
  if (res.status === 401 && auth && !retried) {
    // İstek sürerken başka bir çağrı belirteci zaten yenilemişse tekrar yenilemeye gerek yok.
    if ((accessToken && accessToken !== usedToken) || (await refresh())) return api<T>(path, opts, true);
    onSessionLost?.();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const b = (json ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, b.code ?? 'INTERNAL', b.detail ?? b.title ?? `HTTP ${res.status}`, b.errors);
  }
  return json as T;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
