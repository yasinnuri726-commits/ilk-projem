// Yol: klipai/packages/shared/src/error-codes.ts
//
// Kararlı hata kodları. İstemci metne değil koda göre davranır; başlıklar
// Accept-Language'e göre TR/EN döner.

export const ERRORS = {
  VALIDATION_FAILED: { status: 422, tr: 'Gönderilen veriler geçersiz', en: 'Validation failed' },
  UNAUTHORIZED: { status: 401, tr: 'Oturum açmanız gerekiyor', en: 'Authentication required' },
  INVALID_CREDENTIALS: { status: 401, tr: 'E-posta veya parola hatalı', en: 'Invalid email or password' },
  GOOGLE_TOKEN_INVALID: { status: 401, tr: 'Google oturumu doğrulanamadı', en: 'Google sign-in could not be verified' },
  TOKEN_INVALID: { status: 401, tr: 'Oturum süresi doldu, yeniden giriş yapın', en: 'Session expired, please sign in again' },
  TOKEN_REUSED: { status: 401, tr: 'Güvenlik nedeniyle oturum kapatıldı', en: 'Session was closed for security reasons' },
  ONE_TIME_TOKEN_INVALID: { status: 400, tr: 'Bağlantı geçersiz veya süresi dolmuş', en: 'Link is invalid or expired' },
  EMAIL_TAKEN: { status: 409, tr: 'Bu e-posta adresi zaten kayıtlı', en: 'This email is already registered' },
  FORBIDDEN: { status: 403, tr: 'Bu işlem için yetkiniz yok', en: 'You are not allowed to do this' },
  NOT_FOUND: { status: 404, tr: 'Kayıt bulunamadı', en: 'Not found' },
  INVALID_STATE: { status: 409, tr: 'Bu işlem şu anki durumda yapılamaz', en: 'Not allowed in the current state' },
  VERSION_CONFLICT: { status: 412, tr: 'Kayıt başka biri tarafından değiştirildi', en: 'The record was changed by someone else' },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, tr: 'Aynı istek hâlâ işleniyor', en: 'The same request is still in progress' },
  RATE_LIMITED: { status: 429, tr: 'Çok fazla istek gönderildi', en: 'Too many requests' },
  PAYLOAD_TOO_LARGE: { status: 413, tr: 'İstek çok büyük', en: 'Payload too large' },
  PLAN_CLIP_LIMIT: { status: 402, tr: 'Aylık klip hakkınız doldu', en: 'Monthly clip limit reached' },
  PLAN_CHANNEL_LIMIT: { status: 402, tr: 'Planınızın kanal sınırına ulaştınız', en: 'Channel limit of your plan reached' },
  PLAN_FEATURE_LOCKED: { status: 402, tr: 'Bu özellik planınızda yok', en: 'This feature is not in your plan' },
  INSUFFICIENT_CREDITS: { status: 402, tr: 'Yeterli krediniz yok', en: 'Not enough credits' },
  RIGHTS_TERMS_OUTDATED: { status: 422, tr: 'Hak beyanı metni güncellendi, yeniden onaylayın', en: 'Rights terms were updated, please accept again' },
  UNSUPPORTED_SOURCE: { status: 422, tr: 'Bu bağlantı desteklenmiyor', en: 'This link is not supported' },
  UPLOAD_INCOMPLETE: { status: 422, tr: 'Yükleme tamamlanmamış', en: 'Upload is incomplete' },
  UPLOAD_MISMATCH: { status: 422, tr: 'Yüklenen dosya beyan edilenle uyuşmuyor', en: 'Uploaded file does not match the declaration' },
  YOUTUBE_QUOTA_EXHAUSTED: { status: 429, tr: 'Günlük YouTube kotası doldu', en: 'Daily YouTube quota exhausted' },
  CHANNEL_REAUTH_REQUIRED: { status: 409, tr: 'Kanalı yeniden bağlamanız gerekiyor', en: 'Channel must be reconnected' },
  INTERNAL: { status: 500, tr: 'Beklenmeyen bir hata oluştu', en: 'Unexpected error' },
} as const;

export type ErrorCode = keyof typeof ERRORS;
export type AppLocale = 'tr' | 'en';

export function errorTitle(code: ErrorCode, locale: AppLocale): string {
  return ERRORS[code][locale];
}

/** Worker'ların iş hatalarında kullandığı kodlar ("KOD: açıklama" biçiminde fırlatılır). */
export const JOB_ERRORS = {
  SOURCE_UNREADABLE: { retryable: false },
  SOURCE_TOO_LONG: { retryable: false },
  SOURCE_NO_AUDIO: { retryable: false },
  SOURCE_FETCH_FAILED: { retryable: true },
  SOURCE_FETCH_BLOCKED: { retryable: false },
  INSUFFICIENT_CREDITS: { retryable: false },
  WORKER_CONTRACT_VIOLATION: { retryable: true },
  WORKER_FAILED: { retryable: true },
} as const;
export type JobErrorCode = keyof typeof JOB_ERRORS;

export function parseJobError(reason: string | undefined): { code: JobErrorCode; message: string } {
  const match = /^([A-Z_]+):\s*(.*)$/s.exec(reason ?? '');
  if (match && match[1]! in JOB_ERRORS) {
    return { code: match[1] as JobErrorCode, message: match[2] ?? '' };
  }
  return { code: 'WORKER_FAILED', message: (reason ?? 'unknown').slice(0, 500) };
}
