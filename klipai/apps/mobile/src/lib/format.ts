export const pad = (n: number) => String(n).padStart(2, '0');
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
export function compact(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
export function dateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
export const scoreColor = (score: number | null): 'success' | 'warning' | 'danger' | 'textMuted' => (score === null ? 'textMuted' : score >= 75 ? 'success' : score >= 55 ? 'warning' : 'danger');
