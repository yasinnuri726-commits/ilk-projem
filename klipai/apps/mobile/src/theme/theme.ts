import { useColorScheme } from 'react-native';
import { usePrefs } from '../stores/prefs';

export interface Palette {
  bg: string; surface: string; surface2: string; border: string; text: string; textMuted: string; primary: string; onPrimary: string; accent: string;
  success: string; warning: string; danger: string; overlay: string;
}
export const light: Palette = {
  bg: '#F6F5FB', surface: '#FFFFFF', surface2: '#EFEDF8', border: '#E1DEF0', text: '#14121F', textMuted: '#5E5A72', primary: '#6A47F5', onPrimary: '#FFFFFF', accent: '#E0A100',
  success: '#12805C', warning: '#9A6200', danger: '#C62839', overlay: 'rgba(20,18,31,0.45)',
};
export const dark: Palette = {
  bg: '#0B0B12', surface: '#15141F', surface2: '#1E1C2C', border: '#2C2A3F', text: '#F4F3FB', textMuted: '#A5A1BC', primary: '#8B6DFF', onPrimary: '#0B0B12', accent: '#FFC53D',
  success: '#3DD6A0', warning: '#FFB84D', danger: '#FF6B7A', overlay: 'rgba(0,0,0,0.6)',
};
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export function useIsDark(): boolean {
  const system = useColorScheme();
  const mode = usePrefs((s) => s.theme);
  return mode === 'system' ? system === 'dark' : mode === 'dark';
}
export const useTheme = (): Palette => (useIsDark() ? dark : light);
