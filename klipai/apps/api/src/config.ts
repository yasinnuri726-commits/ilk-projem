import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
  APP_SCHEME: z.string().default('klipai'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  /** 32 baytlık anahtar, base64. OAuth token'larını şifreler. */
  TOKEN_ENC_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'TOKEN_ENC_KEY 32 bayt (base64) olmalı'),
  INTERNAL_HMAC_SECRET: z.string().min(32),
  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('klipai-dev'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool.default(false),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  /** Google ID token'ı için kabul edilen ek istemci kimlikleri (iOS/Android), virgülle ayrılmış. */
  GOOGLE_EXTRA_AUDIENCES: z.string().default(''),
  YOUTUBE_DAILY_QUOTA: z.coerce.number().default(10000),
  REVENUECAT_WEBHOOK_SECRET: z.string().default(''),
  REVENUECAT_API_KEY: z.string().default(''),
  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default('KlipAI <no-reply@klipai.app>'),
  SENTRY_DSN: z.string().default(''),
  RUN_WORKERS: bool.default(true),
  CORS_ORIGINS: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Geçersiz ortam değişkenleri:\n${lines}`);
    }
    cached = parsed.data;
  }
  return cached;
}
export function resetEnvCache() {
  cached = undefined;
}
