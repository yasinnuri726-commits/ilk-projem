// Yol: klipai/apps/api/test/env.ts
// Testler gerçek Postgres, Redis ve S3 uyumlu depolamaya karşı çalışır.
// Adresler TEST_* değişkenleriyle değiştirilebilir (CI'da servis konteynerleri).
process.env.NODE_ENV = 'test';
process.env.ROLE = 'all';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://klipai:klipai@localhost:5432/klipai_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:5005';
process.env.S3_PUBLIC_ENDPOINT = '';
process.env.S3_BUCKET = process.env.TEST_S3_BUCKET ?? 'klipai-test';
process.env.S3_ACCESS_KEY_ID = process.env.TEST_S3_ACCESS_KEY_ID ?? 'test';
process.env.S3_SECRET_ACCESS_KEY = process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'test';
process.env.S3_FORCE_PATH_STYLE = 'true';
process.env.TOKEN_ENC_KEYS = '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=,2:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
process.env.OWNER_EMAILS = 'owner@klipai.test';
process.env.GOOGLE_CLIENT_IDS = 'test-client-id';
process.env.PIPELINE_STUB = '1';
process.env.SMTP_URL = '';
process.env.SENTRY_DSN = '';
