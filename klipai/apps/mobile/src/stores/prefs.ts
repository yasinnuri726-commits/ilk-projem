import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Lang = 'system' | 'tr' | 'en';

interface Prefs {
  theme: ThemeMode; lang: Lang; channelId: string | null; hydrated: boolean;
  setTheme: (t: ThemeMode) => void; setLang: (l: Lang) => void; setChannel: (id: string | null) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      theme: 'system', lang: 'system', channelId: null, hydrated: false,
      setTheme: (theme) => set({ theme }), setLang: (lang) => set({ lang }), setChannel: (channelId) => set({ channelId }),
    }),
    {
      name: 'klipai.prefs', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ theme: s.theme, lang: s.lang, channelId: s.channelId }),
      onRehydrateStorage: () => () => usePrefs.setState({ hydrated: true }),
    },
  ),
);
