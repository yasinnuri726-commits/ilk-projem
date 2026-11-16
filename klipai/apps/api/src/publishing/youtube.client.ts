import { Injectable, Logger } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import { decrypt, encrypt } from '../common/crypto';
import { AppError } from '../common/errors';
import { env } from '../config';
import { PrismaService } from '../infra/infra.module';

export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];
/** Kota maliyetleri (birim). */
export const QUOTA_COST = { insert: 1600, thumbnail: 50, list: 1 } as const;

export class YoutubeError extends Error {
  constructor(readonly status: number, readonly reason: string, message: string) {
    super(message);
  }
  /** Geçici hata: yeniden denenebilir. */
  get retryable() {
    return this.status >= 500 || this.status === 429 || this.status === 408 || this.status === 0;
  }
  get quota() {
    return this.status === 403 && /quotaExceeded|dailyLimitExceeded|rateLimitExceeded|uploadLimitExceeded/.test(this.reason);
  }
}

async function parseError(res: Response): Promise<YoutubeError> {
  const text = await res.text().catch(() => '');
  let reason = '';
  let message = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    reason = j.error?.errors?.[0]?.reason ?? j.error ?? '';
    message = j.error?.message ?? j.error_description ?? message;
  } catch {
    /* gövde JSON değil */
  }
  return new YoutubeError(res.status, String(reason), message);
}

async function call(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new YoutubeError(0, 'network', String(e));
  }
  return res;
}

export interface VideoMeta {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacy: 'public' | 'unlisted' | 'private';
  madeForKids: boolean;
  defaultLanguage?: string;
}

@Injectable()
export class YoutubeClient {
  private readonly log = new Logger('YouTube');
  constructor(private readonly db: PrismaService) {}

  authUrl(state: string, redirectUri: string): string {
    const p = new URLSearchParams({
      client_id: env().GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: YT_SCOPES.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  async exchangeCode(code: string, redirectUri: string) {
    const res = await call('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ code, client_id: env().GOOGLE_CLIENT_ID, client_secret: env().GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
  }

  /** Geçerli erişim token'ı; süresi dolmak üzereyse yenilenir ve şifreli saklanır. */
  async accessToken(channel: Channel): Promise<string> {
    const key = env().TOKEN_ENC_KEY;
    if (channel.status === 'DISCONNECTED') throw new AppError(409, 'CHANNEL_TOKEN_EXPIRED', 'Kanal bağlantısı kesilmiş');
    if (channel.tokenExpiresAt.getTime() - Date.now() > 120_000) return decrypt(channel.accessTokenEnc, key);
    const res = await call('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: env().GOOGLE_CLIENT_ID, client_secret: env().GOOGLE_CLIENT_SECRET, refresh_token: decrypt(channel.refreshTokenEnc, key), grant_type: 'refresh_token' }),
    });
    if (!res.ok) {
      const err = await parseError(res);
      if (err.reason === 'invalid_grant') {
        await this.db.channel.update({ where: { id: channel.id }, data: { status: 'TOKEN_EXPIRED' } });
        throw new AppError(409, 'CHANNEL_TOKEN_EXPIRED', 'YouTube yetkisi geçersiz; kanalı yeniden bağlayın');
      }
      throw err;
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    await this.db.channel.update({ where: { id: channel.id }, data: { accessTokenEnc: encrypt(body.access_token, key), tokenExpiresAt: new Date(Date.now() + body.expires_in * 1000), status: 'ACTIVE' } });
    return body.access_token;
  }

  async revoke(channel: Channel): Promise<void> {
    const token = decrypt(channel.refreshTokenEnc, env().TOKEN_ENC_KEY);
    await call('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token }) }).catch((e) => this.log.warn(`revoke başarısız: ${e}`));
  }

  async myChannel(accessToken: string) {
    const res = await call('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw await parseError(res);
    const item = ((await res.json()) as { items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } }; statistics?: { subscriberCount?: string } }[] }).items?.[0];
    if (!item) throw new AppError(400, 'VALIDATION_FAILED', 'Bu Google hesabında YouTube kanalı yok');
    return { id: item.id, title: item.snippet.title, handle: item.snippet.customUrl ?? null, thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null, subscriberCount: item.statistics?.subscriberCount ? Number(item.statistics.subscriberCount) : null };
  }

  /** Devam ettirilebilir yükleme oturumu açar ve oturum URI'sini döner. */
  async startResumable(accessToken: string, meta: VideoMeta, sizeBytes: number): Promise<string> {
    const res = await call('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(sizeBytes), 'X-Upload-Content-Type': 'video/mp4' },
      body: JSON.stringify({
        snippet: { title: meta.title.slice(0, 100), description: meta.description.slice(0, 5000), tags: meta.tags, categoryId: meta.categoryId, defaultLanguage: meta.defaultLanguage },
        status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: meta.madeForKids },
      }),
    });
    const location = res.headers.get('location');
    if (!res.ok || !location) throw await parseError(res);
    return location;
  }

  /** Bir parçayı gönderir. 308 = devam, 200/201 = bitti. */
  async uploadChunk(uploadUrl: string, chunk: Buffer, start: number, total: number): Promise<{ done: true; videoId: string } | { done: false; nextOffset: number }> {
    const end = start + chunk.length - 1;
    const res = await call(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(chunk.length), 'Content-Range': `bytes ${start}-${end}/${total}` }, body: new Uint8Array(chunk) });
    if (res.status === 308) return { done: false, nextOffset: rangeEnd(res.headers.get('range')) };
    if (res.ok) return { done: true, videoId: ((await res.json()) as { id: string }).id };
    throw await parseError(res);
  }

  /** Kesilen oturumda sunucunun aldığı bayt sayısını sorar. Oturum ölmüşse null. */
  async queryOffset(uploadUrl: string, total: number): Promise<{ done: true; videoId: string } | { done: false; nextOffset: number } | null> {
    const res = await call(uploadUrl, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${total}` } });
    if (res.status === 308) return { done: false, nextOffset: rangeEnd(res.headers.get('range')) };
    if (res.ok) return { done: true, videoId: ((await res.json()) as { id: string }).id };
    if (res.status === 404 || res.status === 410) return null;
    throw await parseError(res);
  }

  async setThumbnail(accessToken: string, videoId: string, jpeg: Buffer): Promise<void> {
    const res = await call(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/jpeg' }, body: new Uint8Array(jpeg),
    });
    if (!res.ok) throw await parseError(res);
  }

  async videoStats(accessToken: string, ids: string[]) {
    const res = await call(`https://www.googleapis.com/youtube/v3/videos?part=statistics,status,processingDetails&id=${ids.join(',')}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw await parseError(res);
    const items = ((await res.json()) as { items?: { id: string; statistics?: Record<string, string>; status?: { uploadStatus?: string; rejectionReason?: string } }[] }).items ?? [];
    return items.map((i) => ({
      id: i.id, views: Number(i.statistics?.viewCount ?? 0), likes: Number(i.statistics?.likeCount ?? 0), comments: Number(i.statistics?.commentCount ?? 0),
      uploadStatus: i.status?.uploadStatus ?? 'unknown', rejectionReason: i.status?.rejectionReason ?? null,
    }));
  }

  /** YouTube Analytics: izlenme yüzdesi, paylaşım, kazanılan abone. Veri henüz yoksa null. */
  async analytics(accessToken: string, videoId: string, startDate: string, endDate: string) {
    const p = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate, metrics: 'views,averageViewPercentage,averageViewDuration,shares,subscribersGained', filters: `video==${videoId}` });
    const res = await call(`https://youtubeanalytics.googleapis.com/v2/reports?${p}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw await parseError(res);
    const row = ((await res.json()) as { rows?: number[][] }).rows?.[0];
    return row ? { views: row[0], avgViewPct: row[1], avgViewSec: row[2], shares: row[3], subscribersGained: row[4] } : null;
  }
}

function rangeEnd(header: string | null): number {
  // "bytes=0-12345" → sıradaki bayt 12346; başlık yoksa hiç bayt alınmamış.
  const m = header?.match(/-(\d+)$/);
  return m ? Number(m[1]) + 1 : 0;
}
