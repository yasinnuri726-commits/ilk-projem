import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import type { WsEnvelope } from '@klipai/shared';
import { getAccessToken, api } from '../api/client';
import { qk } from '../api/hooks';
import { WS_URL } from '../config';
import { useAuth } from '../stores/auth';

let lastEventId: string | undefined;

/** Gelen olayı React Query önbelleğine yansıtır: ilgili sorguları geçersiz kılar (ilerleme için kayıtları yerinde günceller). */
export function applyEvent(qc: QueryClient, e: Pick<WsEnvelope, 'type' | 'data'>) {
  const d = e.data as Record<string, unknown> & { projectId?: string; clipId?: string; channelId?: string };
  const inv = (key: readonly unknown[]) => qc.invalidateQueries({ queryKey: key as unknown[] });
  switch (e.type) {
    case 'project.progress':
      qc.setQueryData(qk.project(d.projectId as string), (old: Record<string, unknown> | undefined) => (old ? { ...old, status: d.status, currentStage: d.stage, progress: d.progress } : old));
      inv(['dashboard']);
      break;
    case 'project.ready':
    case 'project.failed':
      inv(qk.project(d.projectId as string)); inv(qk.candidates(d.projectId as string)); inv(['projects']); inv(['dashboard']);
      break;
    case 'candidate.scored' as never:
      inv(qk.candidates(d.projectId as string));
      break;
    case 'clip.progress':
      qc.setQueryData(qk.clip(d.clipId as string), (old: Record<string, unknown> | undefined) => (old ? { ...old, renderStage: d.stage, renderProgress: d.progress } : old));
      break;
    case 'clip.updated':
    case 'clip.ready':
    case 'clip.failed':
      inv(qk.clip(d.clipId as string)); inv(['clips']); inv(['dashboard']); inv(['publish']);
      break;
    case 'publish.updated':
    case 'publish.published':
    case 'publish.failed':
      inv(['publish']); inv(['dashboard']); if (d.clipId) inv(qk.clip(d.clipId as string));
      break;
    case 'quota.updated':
      inv(['quota']);
      break;
    case 'credits.updated':
      inv(qk.sub); inv(['dashboard']);
      break;
    case 'notification.created':
      inv(qk.notifications); inv(['unread']);
      break;
  }
}

/** Oturum açıkken WebSocket'e bağlanır; kopunca yeniden bağlanır, kaçan olayları sunucudan tekrar oynatır. */
export function useRealtime() {
  const qc = useQueryClient();
  const status = useAuth((s) => s.status);

  useEffect(() => {
    if (status !== 'authed') return;
    let socket: Socket | null = null;
    socket = io(WS_URL, {
      path: '/ws', transports: ['websocket'], reconnection: true, reconnectionDelayMax: 15_000,
      // Her yeniden bağlanmada güncel belirteç ve son olay kimliği gönderilir.
      auth: (cb) => cb({ token: getAccessToken(), lastEventId }),
    });
    socket.on('event', (e: WsEnvelope) => {
      lastEventId = e.id;
      applyEvent(qc, e);
    });
    socket.on('resync', () => void qc.invalidateQueries());
    socket.on('auth.expired', () => {
      // Belirteç süresi dolmuş: bir API çağrısı yenilemeyi tetikler, ardından yeniden bağlanılır.
      void api('/me').catch(() => undefined).finally(() => socket?.connect());
    });
    socket.on('connect_error', () => {
      void api('/me').catch(() => undefined);
    });
    return () => { socket?.close(); };
  }, [status, qc]);
}
