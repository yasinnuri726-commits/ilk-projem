import { File } from 'expo-file-system';
import { api } from '../api/client';
import type { UploadSession } from '../api/types';

export interface PickedFile { uri: string; name: string; size: number; mime: string }
const PARTS_PER_SIGN = 8;
const PUT_RETRIES = 4;

async function putPart(url: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < PUT_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: bytes as unknown as BodyInit, signal });
      if (res.ok) {
        const etag = res.headers.get('ETag') ?? res.headers.get('etag');
        if (!etag) throw new Error('Depo ETag döndürmedi (CORS ExposeHeaders: ETag gerekli)');
        return etag;
      }
      last = new Error(`PUT ${res.status}`);
      if (res.status === 403) throw last; // imzalı URL süresi dolmuş: çağıran yeniden imzalatır
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      last = e;
    }
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  throw last;
}

/**
 * Parçalı, devam ettirilebilir yükleme.
 * - `existing` verilirse sunucudaki tamamlanmış parçalar atlanır (uygulama yeniden açıldığında kaldığı yerden sürer).
 * - Her parça dosyadan yalnızca kendi aralığı kadar okunur; bellekte tek parça tutulur.
 */
export async function uploadFile(file: PickedFile, opts: { existingUploadId?: string; purpose?: 'source' | 'asset'; onProgress?: (pct: number) => void; onSession?: (id: string) => void; signal?: AbortSignal } = {}): Promise<string> {
  const { onProgress, signal } = opts;
  let session: UploadSession | null = null;
  if (opts.existingUploadId) {
    session = await api<UploadSession>(`/uploads/${opts.existingUploadId}`).catch(() => null);
    if (session && !['INITIATED', 'IN_PROGRESS'].includes(session.status)) {
      if (session.status === 'COMPLETED') return session.id;
      session = null;
    }
  }
  if (!session) {
    session = await api<UploadSession>('/uploads', { method: 'POST', body: { fileName: file.name, contentType: file.mime, sizeBytes: file.size, purpose: opts.purpose ?? 'source' } });
  }
  opts.onSession?.(session.id);

  const done = new Map<number, string>();
  const doneNumbers = new Set(session.completedParts ?? []);
  const handle = new File(file.uri).open();
  try {
    const total = session.partCount;
    const todo = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !doneNumbers.has(n));
    let finished = doneNumbers.size;
    onProgress?.((finished / total) * 100);

    for (let i = 0; i < todo.length; i += PARTS_PER_SIGN) {
      const batch = todo.slice(i, i + PARTS_PER_SIGN);
      let signed = (await api<{ parts: { partNumber: number; url: string }[] }>(`/uploads/${session.id}/parts`, { method: 'POST', body: { partNumbers: batch } })).parts;
      for (const part of signed) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const offset = (part.partNumber - 1) * session.partSize;
        handle.offset = offset;
        const bytes = handle.readBytes(Math.min(session.partSize, file.size - offset));
        let etag: string;
        try {
          etag = await putPart(part.url, bytes, signal);
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
          // URL süresi dolmuş olabilir: yalnızca bu parça için yeniden imza alınır.
          const fresh = (await api<{ parts: { partNumber: number; url: string }[] }>(`/uploads/${session.id}/parts`, { method: 'POST', body: { partNumbers: [part.partNumber] } })).parts[0];
          etag = await putPart(fresh.url, bytes, signal);
        }
        done.set(part.partNumber, etag);
        finished += 1;
        onProgress?.((finished / total) * 100);
      }
      signed = [];
    }
    // Sunucu, tamamlama sırasında ETag'leri S3'ten kendisi okur; burada yalnızca bu oturumda yüklenenler gönderilir.
    await api(`/uploads/${session.id}/complete`, { method: 'POST', body: { parts: [...done.entries()].map(([partNumber, etag]) => ({ partNumber, etag })) } });
    return session.id;
  } finally {
    handle.close();
  }
}
