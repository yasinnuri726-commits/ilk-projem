import { ApiError } from '../api/client';

/** API hatasını kullanıcının dilinde mesaja çevirir. */
export function errorMessage(e: unknown, t: (p: string) => string): string {
  if (e instanceof ApiError) {
    const key = `err.${e.code}`;
    const msg = t(key);
    if (msg !== key && msg) return msg;
    if (e.errors?.length) return e.errors.map((x) => x.message).join('\n');
    return e.status >= 500 ? t('err.INTERNAL') : e.message;
  }
  return t('err.INTERNAL');
}
