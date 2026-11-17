import { getLocales } from 'expo-localization';
import { useCallback } from 'react';
import { usePrefs } from '../stores/prefs';
import { en } from './en';
import { tr, type Dict } from './tr';

export type Lang = 'tr' | 'en';
const dicts: Record<Lang, Dict> = { tr, en };

export function deviceLang(): Lang {
  return getLocales()[0]?.languageCode === 'tr' ? 'tr' : 'en';
}
export function useLang(): Lang {
  const pref = usePrefs((s) => s.lang);
  return pref === 'system' ? deviceLang() : pref;
}

export function translate(lang: Lang, path: string, params?: Record<string, string | number | null | undefined>): string {
  let cur: unknown = dicts[lang];
  for (const part of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part];
  if (typeof cur !== 'string') {
    // Eksik anahtar: diğer dile, o da yoksa anahtarın kendisine düşer.
    let alt: unknown = dicts[lang === 'tr' ? 'en' : 'tr'];
    for (const part of path.split('.')) alt = (alt as Record<string, unknown> | undefined)?.[part];
    cur = typeof alt === 'string' ? alt : path;
  }
  return (cur as string).replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? ''));
}

export function useT() {
  const lang = useLang();
  return useCallback((path: string, params?: Record<string, string | number | null | undefined>) => translate(lang, path, params), [lang]);
}

export function localeTag(lang: Lang) {
  return lang === 'tr' ? 'tr-TR' : 'en-US';
}
