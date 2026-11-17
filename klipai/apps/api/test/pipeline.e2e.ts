import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { hmacHex } from '../src/common/crypto';
import { ProblemFilter } from '../src/common/errors';
import { env } from '../src/config';
import { RIGHTS_ATTESTATION_VERSION } from '@klipai/shared';

const db = new PrismaClient();
let app: NestExpressApplication;
let http: ReturnType<typeof request>;
const suffix = randomUUID().slice(0, 8);

async function boot() {
  app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: false });
  app.setGlobalPrefix('v1');
  await app.init();
  http = request(app.getHttpServer());
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Video servisini taklit eder: aynı imza şemasıyla iç uca olay yollar. */
async function workerEvent(jobId: string, body: object) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'sha256=' + hmacHex(Buffer.concat([Buffer.from(`${ts}.`), Buffer.from(raw)]), env().INTERNAL_HMAC_SECRET);
  return http.post(`/v1/internal/jobs/${jobId}/events`).set({ 'Content-Type': 'application/json', 'X-Timestamp': ts, 'X-Signature': sig }).send(raw);
}

async function register(tag: string) {
  const res = await http.post('/v1/auth/register').send({ email: `${tag}-${suffix}@test.dev`, password: 'Sifre12345', displayName: tag }).expect(201);
  return res.body as { accessToken: string; refreshToken: string; user: { id: string } };
}

async function makeChannel(ownerId: string, tag: string) {
  return db.channel.create({
    data: {
      ownerId, youtubeChannelId: `UC-${tag}-${suffix}`, title: `Kanal ${tag}`, accessTokenEnc: 'x', refreshTokenEnc: 'x', tokenExpiresAt: new Date(Date.now() + 3600_000), scopes: [],
      settings: { create: { automationMode: 'APPROVAL', minScore: 60, maxClipsPerVideo: 2, commentaryFormat: 'NONE' } },
    },
  });
}

const rights = { basis: 'OWN_CONTENT', attestationVersion: RIGHTS_ATTESTATION_VERSION, accepted: true };

beforeAll(boot);
afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: `-${suffix}@test.dev` } } });
  await app.close();
  await db.$disconnect();
});

describe('kimlik', () => {
  it('kayıt, giriş, yenileme rotasyonu ve çalıntı token tespiti', async () => {
    const s = await register('kimlik');
    await http.post('/v1/auth/register').send({ email: `kimlik-${suffix}@test.dev`, password: 'Sifre12345', displayName: 'x' }).expect(409);
    await http.post('/v1/auth/login').send({ email: `kimlik-${suffix}@test.dev`, password: 'yanlis-parola' }).expect(401);
    const me = await http.get('/v1/me').set(auth(s.accessToken)).expect(200);
    expect(me.body).toMatchObject({ plan: 'FREE', role: 'USER' });
    await http.get('/v1/me').expect(401);

    const r1 = await http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    // Eski token yeniden kullanılırsa tüm aile kapanır.
    const reuse = await http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    expect(reuse.body.code).toBe('TOKEN_REUSED');
    await http.post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
  });

  it('geliştirici hesabı kullanıcı adıyla girer ve sınırsızdır', async () => {
    const dev = await db.user.create({ data: { email: `dev-${suffix}@test.dev`, username: `dev${suffix}`, role: 'DEVELOPER', displayName: 'dev', passwordHash: await argon2.hash('DevSifre123') } });
    const res = await http.post('/v1/auth/login').send({ email: `DEV${suffix}`, password: 'DevSifre123' }).expect(200);
    expect(res.body.user.id).toBe(dev.id);
    const sub = await http.get('/v1/subscription').set(auth(res.body.accessToken)).expect(200);
    expect(sub.body.limits).toMatchObject({ clipsPerMonth: null, creditsPerMonth: null, maxChannels: null, maxResolution: 'UHD_4K', watermark: false });
  });
});

describe('uçtan uca hat', () => {
  it('alım → analiz → aday → puan → kabul → kurgu → QC → onay bekleyen plan → onay', async () => {
    const s = await register('hat');
    const ch = await makeChannel(s.user.id, 'hat');
    const h = auth(s.accessToken);

    // Hak beyanı zorunlu
    await http.post('/v1/projects').set(h).send({ channelId: ch.id, title: 'Film', source: { type: 'LINK', url: 'https://cdn.example.com/f.mp4' } }).expect(422);
    // Platform sayfası reddedilir
    await http.post('/v1/projects').set(h).send({ channelId: ch.id, title: 'Film', source: { type: 'LINK', url: 'https://www.youtube.com/watch?v=abc' }, rights }).expect(422);

    const created = await http.post('/v1/projects').set(h).send({ channelId: ch.id, title: 'Podcast 42', source: { type: 'LINK', url: 'https://cdn.example.com/podcast.mp4' }, rights: { ...rights, details: 'Kendi yayınım' } }).expect(201);
    const pid = created.body.id as string;
    expect(created.body.status).toBe('INGESTING');

    // Hak beyanı kaydedildi (metin, IP, istemci)
    const decl = await db.rightsDeclaration.findFirstOrThrow({ where: { userId: s.user.id } });
    expect(decl).toMatchObject({ basis: 'OWN_CONTENT', projectTitle: 'Podcast 42', attestationVersion: RIGHTS_ATTESTATION_VERSION });
    expect(decl.attestationText.length).toBeGreaterThan(50);

    const stageJob = async (stage: string) => (await db.pipelineJob.findFirstOrThrow({ where: { projectId: pid, stage: stage as never }, orderBy: { queuedAt: 'desc' } })).id;

    // İmzasız / bozuk imzalı olay reddedilir
    await http.post(`/v1/internal/jobs/${await stageJob('INGEST')}/events`).send({ kind: 'PIPELINE', stage: 'INGEST', type: 'STARTED' }).expect(401);

    await workerEvent(await stageJob('INGEST'), { kind: 'PIPELINE', stage: 'INGEST', type: 'STARTED', attempt: 1 }).then((r) => expect(r.status).toBe(204));
    await workerEvent(await stageJob('INGEST'), { kind: 'PIPELINE', stage: 'INGEST', type: 'PROGRESS', progress: 50 });
    await workerEvent(await stageJob('INGEST'), {
      kind: 'PIPELINE', stage: 'INGEST', type: 'SUCCEEDED',
      output: { storageKey: `projects/${pid}/source.mp4`, proxyKey: `projects/${pid}/proxy.mp4`, audioKey: `projects/${pid}/audio.wav`, thumbnailKey: `projects/${pid}/thumb.jpg`, durationSec: 3600, width: 1920, height: 1080, fps: 25, sizeBytes: 1e9 },
      usage: [{ kind: 'COST_STORAGE', quantity: 1, costMicroUsd: 1200 }],
    });
    // 60 dk video 60 kredi ister: ücretsiz plan tam 60 kredi verir
    let proj = await db.project.findUniqueOrThrow({ where: { id: pid } });
    expect(proj.status).toBe('ANALYZING');
    expect(proj.creditsConsumed).toBe(60);

    await workerEvent(await stageJob('ANALYZE'), {
      kind: 'PIPELINE', stage: 'ANALYZE', type: 'SUCCEEDED',
      output: { language: 'tr', text: 'metin', segments: [], speakers: [{ id: 'S1', label: 'Konuşmacı 1', totalSec: 100 }], wordCount: 5000, wordsKey: `projects/${pid}/analysis/words.json`, scenesKey: 'a', audioEnergyKey: 'b', facesKey: 'c' },
      usage: [{ kind: 'COST_GPU', quantity: 300, unit: 'second', costMicroUsd: 50000 }],
    });
    await workerEvent(await stageJob('CANDIDATES'), {
      kind: 'PIPELINE', stage: 'CANDIDATES', type: 'SUCCEEDED',
      output: { candidates: [{ startSec: 10, endSec: 45, text: 'bir' }, { startSec: 100, endSec: 140, text: 'iki' }, { startSec: 300, endSec: 330, text: 'üç' }] },
    });
    const cands = await db.clipCandidate.findMany({ where: { projectId: pid }, orderBy: { startSec: 'asc' } });
    expect(cands).toHaveLength(3);
    const mk = (id: string, v: number) => ({ id, hook: v, emotion: v, standalone: v, curiosity: v, shareability: v, rationale: { summary: 's', suggestedHook: `Kanca ${v}` } });
    await workerEvent(await stageJob('SCORE'), { kind: 'PIPELINE', stage: 'SCORE', type: 'SUCCEEDED', output: { scores: [mk(cands[0].id, 90), mk(cands[1].id, 75), mk(cands[2].id, 30)], promptVersion: 'test' } });

    proj = await db.project.findUniqueOrThrow({ where: { id: pid } });
    expect(proj.status).toBe('READY');
    expect(proj.costMicroUsd).toBe(BigInt(51200));
    const list = await http.get(`/v1/projects/${pid}/candidates`).set(h).expect(200);
    expect(list.body.items.map((c: { score: number }) => c.score)).toEqual([90, 75]); // eşik altı (30 < 60) gizli
    // Onaylı modda eşik üstü en iyi aday otomatik kabul edildi (azami 2 klip)
    const clips = await db.clip.findMany({ where: { projectId: pid }, orderBy: { startSec: 'asc' } });
    expect(clips).toHaveLength(2);
    expect(clips.every((c) => c.status === 'EDITING' && c.watermarked && c.resolution === 'HD_720')).toBe(true);

    // Ücretsiz plan: 5 klip hakkından 2'si kullanıldı
    const sub = await http.get('/v1/subscription').set(h).expect(200);
    expect(sub.body.usage).toMatchObject({ clipsUsed: 2, creditsUsed: 60 });

    // Klip hattı: EDIT → METADATA → QC
    const clip = clips[0];
    const renderJob = async (stage: string) => (await db.renderJob.findFirstOrThrow({ where: { clipId: clip.id, stage: stage as never }, orderBy: { queuedAt: 'desc' } })).id;
    await workerEvent(await renderJob('EDIT'), { kind: 'RENDER', stage: 'EDIT', type: 'SUCCEEDED', output: { outputKey: `clips/${clip.id}/v1/output.mp4`, frameKey: `clips/${clip.id}/v1/frame.jpg`, durationSec: 35, sizeBytes: 9e6, loudnessLufs: -15.2 } });
    await workerEvent(await renderJob('METADATA'), { kind: 'RENDER', stage: 'METADATA', type: 'SUCCEEDED', output: { titles: ['Başlık 1', 'Başlık 2', 'Başlık 3'], description: 'Açıklama', tags: ['a', 'b'], hashtags: ['komik'], thumbnailKey: `clips/${clip.id}/v1/thumb.jpg` } });
    await workerEvent(await renderJob('QC'), { kind: 'RENDER', stage: 'QC', type: 'SUCCEEDED', output: { status: 'AUTO_FIXED', report: [{ check: 'LOUDNESS', passed: false, fixed: true, value: '-15.2 → -14.0 LUFS' }] } });

    const ready = await http.get(`/v1/clips/${clip.id}`).set(h).expect(200);
    expect(ready.body).toMatchObject({ status: 'READY', qcStatus: 'AUTO_FIXED', title: 'Başlık 1', titleAlternatives: ['Başlık 1', 'Başlık 2', 'Başlık 3'] });
    expect(ready.body.videoUrl).toContain('output.mp4');

    // Onaylı mod: plan onay bekler, klip hâlâ READY
    const pending = await db.publishJob.findFirstOrThrow({ where: { clipId: clip.id } });
    expect(pending.status).toBe('PENDING_APPROVAL');
    expect(pending.description).toContain('#komik');

    // Onay = planlama
    const sched = await http.post(`/v1/clips/${clip.id}/schedule`).set(h).send({}).expect(201);
    expect(sched.body).toMatchObject({ id: pending.id, status: 'SCHEDULED' });
    expect((await db.clip.findUniqueOrThrow({ where: { id: clip.id } })).status).toBe('SCHEDULED');

    // İptal → klip READY'e döner
    await http.delete(`/v1/publish-jobs/${pending.id}`).set(h).expect(204);
    expect((await db.clip.findUniqueOrThrow({ where: { id: clip.id } })).status).toBe('READY');

    // İyimser kilit
    const v = ready.body.version;
    await http.patch(`/v1/clips/${clip.id}`).set(h).send({ version: v, title: 'Yeni başlık' }).expect(200);
    const conflict = await http.patch(`/v1/clips/${clip.id}`).set(h).send({ version: v, title: 'Eski sürüm' }).expect(409);
    expect(conflict.body.code).toBe('VERSION_CONFLICT');

    // Dashboard tek istekte
    const dash = await http.get('/v1/dashboard').set(h).expect(200);
    expect(dash.body.queue.rendering.length).toBe(1);
  });

  it('yetkisiz kullanıcı başkasının kanalını göremez; izleyici yazamaz', async () => {
    const a = await register('sahip');
    const b = await register('yabanci');
    const ch = await makeChannel(a.user.id, 'yetki');
    await http.get(`/v1/channels/${ch.id}`).set(auth(b.accessToken)).expect(404);
    await http.patch(`/v1/channels/${ch.id}/settings`).set(auth(b.accessToken)).send({ minScore: 10 }).expect(404);
    await db.channelMember.create({ data: { channelId: ch.id, userId: b.user.id, role: 'VIEWER', invitedById: a.user.id, acceptedAt: new Date() } });
    await http.get(`/v1/channels/${ch.id}`).set(auth(b.accessToken)).expect(200);
    await http.patch(`/v1/channels/${ch.id}/settings`).set(auth(b.accessToken)).send({ minScore: 10 }).expect(403);
    await http.post('/v1/projects').set(auth(b.accessToken)).send({ channelId: ch.id, title: 'x', source: { type: 'LINK', url: 'https://cdn.example.com/a.mp4' }, rights }).expect(403);
    // Ücretsiz plan 4K ayarlayamaz
    await http.patch(`/v1/channels/${ch.id}/settings`).set(auth(a.accessToken)).send({ resolution: 'UHD_4K' }).expect(402);
  });

  it('kredi biterse proje başlatılamaz; başarısız alımda kredi iade edilir', async () => {
    const s = await register('kredi');
    const ch = await makeChannel(s.user.id, 'kredi');
    const h = auth(s.accessToken);
    const mk = () => http.post('/v1/projects').set(h).send({ channelId: ch.id, title: 'P', source: { type: 'LINK', url: 'https://cdn.example.com/p.mp4' }, rights }).expect(201);
    const p1 = (await mk()).body.id;
    const job = await db.pipelineJob.findFirstOrThrow({ where: { projectId: p1 } });
    await workerEvent(job.id, { kind: 'PIPELINE', stage: 'INGEST', type: 'SUCCEEDED', output: { storageKey: 'k', proxyKey: 'p', audioKey: 'a', durationSec: 120, width: 1280, height: 720, fps: 25, sizeBytes: 1 } });
    expect((await db.subscription.findUniqueOrThrow({ where: { userId: s.user.id } })).creditsUsed).toBe(2);
    await workerEvent((await db.pipelineJob.findFirstOrThrow({ where: { projectId: p1, stage: 'ANALYZE' } })).id, { kind: 'PIPELINE', stage: 'ANALYZE', type: 'FAILED', final: true, error: { code: 'X', message: 'bozuk' } });
    await http.post(`/v1/projects/${p1}/cancel`).set(h).expect(409); // FAILED iptal edilemez
    // Kredi tüketimi: 120 sn = 2 dk. 59 dk daha bir proje alırsa yeter, 60'ı aşan reddedilir.
    await db.subscription.update({ where: { userId: s.user.id }, data: { creditsUsed: 60 } });
    const res = await http.post('/v1/projects').set(h).send({ channelId: ch.id, title: 'Q', source: { type: 'LINK', url: 'https://cdn.example.com/q.mp4' }, rights }).expect(402);
    expect(res.body.code).toBe('CREDITS_EXHAUSTED');
  });
});

describe('KVKK', () => {
  it('silme isteği hesabı devre dışı bırakır ve oturumları kapatır', async () => {
    const s = await register('silinecek');
    await http.delete('/v1/me').set(auth(s.accessToken)).expect(202);
    await http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    await http.post('/v1/auth/login').send({ email: `silinecek-${suffix}@test.dev`, password: 'Sifre12345' }).expect(401);
    const req = await db.dataRequest.findFirstOrThrow({ where: { userId: s.user.id } });
    expect(req.type).toBe('DELETE');
    expect(req.scheduledFor!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });
});
