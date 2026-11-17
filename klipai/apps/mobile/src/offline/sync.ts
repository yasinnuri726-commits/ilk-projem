import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { qk } from '../api/hooks';
import type { Clip } from '../api/types';
import { useAuth } from '../stores/auth';
import { useDrafts } from '../stores/drafts';

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)), []);
  return online;
}

/** Tek bir klip taslağını gönderir. Sürüm çakışmasında yerel değişiklik silinmez, çakışma olarak işaretlenir. */
export async function pushClipDraft(id: string): Promise<'synced' | 'conflict' | 'failed'> {
  const draft = useDrafts.getState().clips[id];
  if (!draft || draft.conflict) return draft?.conflict ? 'conflict' : 'synced';
  try {
    await api<Clip>(`/clips/${id}`, { method: 'PATCH', body: { ...draft.patch, version: draft.baseVersion } });
    useDrafts.getState().dropClip(id);
    return 'synced';
  } catch (e) {
    if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
      useDrafts.getState().markConflict(id);
      return 'conflict';
    }
    if (e instanceof ApiError && (e.status === 404 || e.status === 403 || e.status === 409)) {
      useDrafts.getState().dropClip(id); // klip silinmiş veya düzenlenemez durumda
      return 'synced';
    }
    return 'failed';
  }
}

/** Çevrimiçi olunca bekleyen klip taslaklarını eşitler. Kök düzende bir kez bağlanır. */
export function useDraftSync() {
  const qc = useQueryClient();
  const online = useOnline();
  const authed = useAuth((s) => s.status === 'authed');
  useEffect(() => {
    if (!online || !authed) return;
    let cancelled = false;
    (async () => {
      for (const id of Object.keys(useDrafts.getState().clips)) {
        if (cancelled) return;
        if ((await pushClipDraft(id)) !== 'failed') await qc.invalidateQueries({ queryKey: qk.clip(id) });
      }
    })();
    return () => { cancelled = true; };
  }, [online, authed, qc]);
}
