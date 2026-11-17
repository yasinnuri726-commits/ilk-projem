import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Çevrimdışı klip taslağı: sunucudaki `version` tabanına karşı bekleyen değişiklikler. */
export interface ClipDraft {
  baseVersion: number;
  patch: Record<string, unknown>;
  updatedAt: number;
  conflict?: boolean;
}
/** Yeni proje sihirbazı taslağı (dosya yolu dâhil; yükleme çevrimiçi olunca yapılır). */
export interface ProjectDraft {
  step: number; channelId: string | null; title: string; sourceType: 'UPLOAD' | 'LINK';
  file: { uri: string; name: string; size: number; mime: string } | null; url: string;
  basis: 'OWN_CONTENT' | 'LICENSED' | 'PUBLIC_DOMAIN' | 'PERMITTED' | null; details: string; accepted: boolean;
  minScore: number; maxClips: number; updatedAt: number;
}

interface DraftsState {
  clips: Record<string, ClipDraft>; project: ProjectDraft | null;
  saveClip: (id: string, baseVersion: number, patch: Record<string, unknown>) => void;
  markConflict: (id: string) => void; dropClip: (id: string) => void;
  saveProject: (d: ProjectDraft) => void; dropProject: () => void;
}

export const useDrafts = create<DraftsState>()(
  persist(
    (set) => ({
      clips: {}, project: null,
      saveClip: (id, baseVersion, patch) =>
        set((s) => ({ clips: { ...s.clips, [id]: { baseVersion: s.clips[id]?.baseVersion ?? baseVersion, patch: { ...s.clips[id]?.patch, ...patch }, updatedAt: Date.now() } } })),
      markConflict: (id) => set((s) => (s.clips[id] ? { clips: { ...s.clips, [id]: { ...s.clips[id], conflict: true } } } : s)),
      dropClip: (id) => set((s) => { const { [id]: _, ...rest } = s.clips; return { clips: rest }; }),
      saveProject: (project) => set({ project }), dropProject: () => set({ project: null }),
    }),
    { name: 'klipai.drafts', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
