// Yol: klipai/apps/api/src/config/app-config.ts
import { z } from 'zod';

const bool = z
  .enum(['0', '1', 'true', 'false'])
  .default('0')
  .transform((v) => v === '1' || v === 'true');
const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  ROLE: z.enum(['http', 'worker', 'all']).default('all'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET en az 32 karakter olmalı'),
  ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  GOOGLE_CLIENT_IDS: csv,
  S3_ENDPOINT: optional,
  S3_PUBLIC_ENDPOINT: optional,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool,
  TOKEN_ENC_KEYS: z.string().min(1),
  OWNER_EMAILS: csv,
  APP_URL: z.string().default('klipai://'),
  SMTP_URL: optional,
  MAIL_FROM: z.string().default('KlipAI <no-reply@klipai.app>'),
  PUBLIC_WS_URL: z.string().default('ws://localhost:3000'),
  CORS_ORIGINS: csv,
  SENTRY_DSN: optional,
  PIPELINE_STUB: bool,
});

export class AppConfig {
  readonly env: 'development' | 'test' | 'staging' | 'production';
  readonly role: 'http' | 'worker' | 'all';
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly jwtSecret: string;
  readonly accessTtlSec: number;
  readonly refreshTtlDays: number;
  readonly googleClientIds: string[];
  readonly s3: {
    endpoint?: string;
    publicEndpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  readonly tokenEncKeys: string;
  readonly ownerEmails: string[];
  readonly appUrl: string;
  readonly smtpUrl?: string;
  readonly mailFrom: string;
  readonly publicWsUrl: string;
  readonly corsOrigins: string[];
  readonly sentryDsn?: string;
  readonly pipelineStub: boolean;

  constructor(source: NodeJS.ProcessEnv = process.env) {
    const parsed = EnvSchema.safeParse(source);
    if (!parsed.success) {
      const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
      throw new Error(`Ortam değişkenleri geçersiz:\n${lines.join('\n')}`);
    }
    const e = parsed.data;
    if (e.PIPELINE_STUB && e.NODE_ENV === 'production') {
      throw new Error('PIPELINE_STUB üretimde açılamaz');
    }
    this.env = e.NODE_ENV;
    this.role = e.ROLE;
    this.port = e.PORT;
    this.databaseUrl = e.DATABASE_URL;
    this.redisUrl = e.REDIS_URL;
    this.jwtSecret = e.JWT_SECRET;
    this.accessTtlSec = e.ACCESS_TTL_SEC;
    this.refreshTtlDays = e.REFRESH_TTL_DAYS;
    this.googleClientIds = e.GOOGLE_CLIENT_IDS;
    this.s3 = {
      endpoint: e.S3_ENDPOINT,
      publicEndpoint: e.S3_PUBLIC_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    };
    this.tokenEncKeys = e.TOKEN_ENC_KEYS;
    this.ownerEmails = e.OWNER_EMAILS.map((m) => m.toLowerCase());
    this.appUrl = e.APP_URL;
    this.smtpUrl = e.SMTP_URL;
    this.mailFrom = e.MAIL_FROM;
    this.publicWsUrl = e.PUBLIC_WS_URL;
    this.corsOrigins = e.CORS_ORIGINS;
    this.sentryDsn = e.SENTRY_DSN;
    this.pipelineStub = e.PIPELINE_STUB;
  }

  /** Bu süreç kuyruk işleyicilerini (orkestratör, bakım) çalıştırır mı? */
  get runsWorkers(): boolean {
    return this.role === 'worker' || this.role === 'all';
  }
}
