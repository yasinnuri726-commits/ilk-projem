// Yol: klipai/apps/api/test/harness.ts
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RIGHTS_TERMS } from '@klipai/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AppException } from '../src/common/app-exception';
import { MailService } from '../src/infra/mail.service';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { GoogleVerifier } from '../src/modules/auth/google.verifier';

export interface Harness {
  app: NestExpressApplication;
  http: ReturnType<typeof request>;
  url: string;
  prisma: PrismaService;
  redis: RedisService;
  /** Gönderilen e-postalardaki bağlantılar. */
  mails: { to: string; template: string; token: string }[];
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const mails: Harness['mails'] = [];
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({
      link: (_path: string, token: string) => token,
      send: async (to: string, template: string, _locale: string, token: string) => {
        mails.push({ to, template, token });
      },
    })
    .overrideProvider(GoogleVerifier)
    .useValue({
      // "google:<sub>:<e-posta>" biçimindeki sahte ID token'ı kabul eder.
      verify: async (idToken: string) => {
        const [prefix, sub, email] = idToken.split(':');
        if (prefix !== 'google' || !sub || !email) throw new AppException('GOOGLE_TOKEN_INVALID');
        return { sub, email, emailVerified: true, name: 'Google Kullanıcısı' };
      },
    })
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  await redis.client.flushdb();

  return {
    app,
    http: request(app.getHttpServer()),
    url: `http://127.0.0.1:${port}`,
    prisma,
    redis,
    mails,
    close: () => app.close(),
  };
}

export async function clearRateLimits(h: Harness): Promise<void> {
  const keys = await h.redis.client.keys('klipai:rl:*');
  if (keys.length) await h.redis.client.del(...keys);
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  auth: { Authorization: string };
}

export async function registerUser(h: Harness, email: string, password = 'cok-gizli-parola-1'): Promise<TestUser> {
  const res = await h.http.post('/v1/auth/register').send({ email, password, displayName: 'Test Kullanıcısı' });
  if (res.status !== 201) throw new Error(`Kayıt başarısız: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    id: res.body.user.id,
    email,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    auth: { Authorization: `Bearer ${res.body.accessToken}` },
  };
}

export async function createChannel(h: Harness, ownerId: string, title = 'Test Kanalı'): Promise<string> {
  const channel = await h.prisma.channel.create({
    data: {
      ownerId,
      youtubeChannelId: `test-${Math.random().toString(36).slice(2)}`,
      title,
      quotaResetAt: new Date(Date.now() + 86_400_000),
      members: { create: { userId: ownerId, role: 'OWNER' } },
    },
  });
  return channel.id;
}

export const RIGHTS = { basis: 'OWN_CONTENT', termsVersion: RIGHTS_TERMS.version, accepted: true };

export async function createProject(
  h: Harness,
  user: TestUser,
  channelId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await h.http
    .post('/v1/projects')
    .set(user.auth)
    .send({ channelId, title: 'Test Projesi', rights: RIGHTS, ...extra });
  if (res.status !== 201) throw new Error(`Proje oluşturulamadı: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

/** Tek parçalı küçük bir dosyayı gerçek imzalı adresle yükler ve tamamlar. */
export async function uploadSource(
  h: Harness,
  user: TestUser,
  projectId: string,
  options: { fileName?: string; durationMs?: number; declaredSize?: number } = {},
): Promise<request.Response> {
  const body = Buffer.alloc(2048, 7);
  const init = await h.http
    .post(`/v1/projects/${projectId}/source/upload`)
    .set(user.auth)
    .send({
      fileName: options.fileName ?? 'video.mp4',
      contentType: 'video/mp4',
      sizeBytes: options.declaredSize ?? body.length,
      durationMs: options.durationMs ?? 10 * 60_000,
    });
  if (init.status !== 201) return init;
  const signed = await h.http
    .post(`/v1/projects/${projectId}/source/upload/parts`)
    .set(user.auth)
    .send({ partNumbers: [1] });
  const put = await fetch(signed.body.parts[0].url, { method: 'PUT', body });
  if (!put.ok) throw new Error(`Parça yüklenemedi: ${put.status} ${await put.text()}`);
  return h.http
    .post(`/v1/projects/${projectId}/source/upload/complete`)
    .set(user.auth)
    .send({ parts: [{ partNumber: 1, etag: put.headers.get('etag') }] });
}

export async function waitForStatus(
  h: Harness,
  user: TestUser,
  projectId: string,
  wanted: string[],
  timeoutMs = 20_000,
): Promise<Record<string, any>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, any> = {};
  while (Date.now() < deadline) {
    last = (await h.http.get(`/v1/projects/${projectId}`).set(user.auth)).body;
    if (wanted.includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Proje ${wanted.join('/')} durumuna ulaşmadı; son durum: ${JSON.stringify(last)}`);
}
