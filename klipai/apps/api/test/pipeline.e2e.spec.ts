// Yol: klipai/apps/api/test/pipeline.e2e.spec.ts
//
// Proje → yükleme → kuyruk hattı → adaylar akışı. Kuyruklar gerçek BullMQ +
// Redis üzerinde çalışır; video servisi yerine PIPELINE_STUB worker'ları
// sözleşmeye uygun sahte sonuç üretir.
import { io, type Socket } from 'socket.io-client';
import { projectJobId, QUEUES, RIGHTS_TERMS } from '@klipai/shared';
import { QueueService } from '../src/infra/queue.service';
import { StorageService } from '../src/infra/storage.service';
import { EntitlementsService } from '../src/modules/billing/entitlements.service';
import { MaintenanceService } from '../src/modules/pipeline/maintenance.service';
import {
  clearRateLimits,
  createChannel,
  createHarness,
  createProject,
  type Harness,
  registerUser,
  RIGHTS,
  type TestUser,
  uploadSource,
  waitForStatus,
} from './harness';

async function connect(h: Harness, user: TestUser): Promise<Socket> {
  const ticket = await h.http.post('/v1/realtime/ticket').set(user.auth);
  const socket = io(h.url, { path: '/v1/ws', auth: { ticket: ticket.body.ticket }, transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', reject);
  });
  return socket;
}

describe('Proje ve kuyruk hattı', () => {
  let h: Harness;
  let user: TestUser;
  let channelId: string;

  beforeAll(async () => {
    h = await createHarness();
    user = await registerUser(h, 'uretici@ornek.com');
    channelId = await createChannel(h, user.id);
  });
  afterAll(() => h.close());
  beforeEach(() => clearRateLimits(h));

  describe('proje oluşturma ve hak beyanı', () => {
    it('beyanı IP, cihaz ve metin özetiyle kaydeder; kanal ayarlarının kopyasını alır', async () => {
      const res = await h.http
        .post('/v1/projects')
        .set(user.auth)
        .set('User-Agent', 'KlipAI-Test/1.0')
        .send({
          channelId,
          title: '  Podcast Bölüm 12  ',
          rights: { ...RIGHTS, basis: 'LICENSED', note: 'Lisans no: ABC-123' },
          settingsOverride: { minScore: 85, subtitle: { highlightColor: '#00FF00' } },
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ title: 'Podcast Bölüm 12', status: 'DRAFT', progress: 0, clipCount: 0 });

      const rights = await h.prisma.rightsDeclaration.findUniqueOrThrow({ where: { projectId: res.body.id } });
      expect(rights).toMatchObject({
        basis: 'LICENSED',
        note: 'Lisans no: ABC-123',
        termsVersion: RIGHTS_TERMS.version,
        userAgent: 'KlipAI-Test/1.0',
        userId: user.id,
      });
      expect(rights.termsHash).toMatch(/^[a-f0-9]{64}$/);
      expect(rights.ip).toBeTruthy();

      const project = await h.prisma.project.findUniqueOrThrow({ where: { id: res.body.id } });
      const snapshot = project.settingsSnapshot as Record<string, any>;
      expect(snapshot.minScore).toBe(85);
      expect(snapshot.subtitle.highlightColor).toBe('#00FF00');
      expect(snapshot.subtitle.fontSize).toBe(72); // dokunulmayan alan varsayılanda kalır
      expect(snapshot.watermark).toBe(true); // Ücretsiz plan
    });

    it('beyan değiştirilemez ve silinemez (veritabanı tetikleyicisi)', async () => {
      const projectId = await createProject(h, user, channelId);
      await expect(
        h.prisma.rightsDeclaration.update({ where: { projectId }, data: { basis: 'PUBLIC_DOMAIN' } }),
      ).rejects.toThrow();
      await expect(h.prisma.rightsDeclaration.delete({ where: { projectId } })).rejects.toThrow();
    });

    it('eksik ya da eski beyanı reddeder', async () => {
      const post = (rights: object) =>
        h.http.post('/v1/projects').set(user.auth).send({ channelId, title: 'X', rights });
      const noNote = await post({ ...RIGHTS, basis: 'PERMITTED' });
      expect(noNote.status).toBe(422);
      expect(noNote.body.errors[0].path).toBe('rights.note');
      expect((await post({ ...RIGHTS, accepted: false })).status).toBe(422);
      const outdated = await post({ ...RIGHTS, termsVersion: '2020-01-01' });
      expect(outdated.status).toBe(422);
      expect(outdated.body.code).toBe('RIGHTS_TERMS_OUTDATED');
    });

    it('üye olmayan kanalı göremez; izleyici rolü proje açamaz', async () => {
      const stranger = await registerUser(h, 'yabanci@ornek.com');
      const projectId = await createProject(h, user, channelId);
      expect((await h.http.get(`/v1/projects/${projectId}`).set(stranger.auth)).status).toBe(404);
      expect((await h.http.get(`/v1/channels/${channelId}`).set(stranger.auth)).status).toBe(404);
      const denied = await h.http
        .post('/v1/projects')
        .set(stranger.auth)
        .send({ channelId, title: 'X', rights: RIGHTS });
      expect(denied.status).toBe(404);

      await h.prisma.channelMember.create({ data: { channelId, userId: stranger.id, role: 'VIEWER' } });
      expect((await h.http.get(`/v1/projects/${projectId}`).set(stranger.auth)).status).toBe(200);
      const viewer = await h.http
        .post('/v1/projects')
        .set(stranger.auth)
        .send({ channelId, title: 'X', rights: RIGHTS });
      expect(viewer.status).toBe(403);
      expect(viewer.body.code).toBe('FORBIDDEN');
    });

    it('aynı Idempotency-Key ile gelen tekrar yeni proje açmaz', async () => {
      const key = '6f0c1d6e-1111-4222-8333-444455556666';
      const send = () =>
        h.http
          .post('/v1/projects')
          .set(user.auth)
          .set('Idempotency-Key', key)
          .send({ channelId, title: 'Tekrar', rights: RIGHTS });
      const first = await send();
      const second = await send();
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(await h.prisma.project.count({ where: { title: 'Tekrar' } })).toBe(1);
    });

    it('projeleri yeniden eskiye, imleçle sayfalar', async () => {
      const page1 = await h.http.get('/v1/projects').query({ channelId, limit: 2 }).set(user.auth);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.nextCursor).toBeTruthy();
      const page2 = await h.http
        .get('/v1/projects')
        .query({ channelId, limit: 2, cursor: page1.body.nextCursor })
        .set(user.auth);
      const ids = [...page1.body.items, ...page2.body.items].map((p: { id: string }) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort().reverse()).toEqual(ids);
    });
  });

  describe('yükleme ve hat', () => {
    it('parçalı yüklemeyi tamamlar, dört aşamayı çalıştırır, adayları puanlar ve krediyi düşer', async () => {
      const projectId = await createProject(h, user, channelId);
      const socket = await connect(h, user);
      const events: { id: string; type: string; data: any }[] = [];
      socket.on('event', (e) => events.push(e));
      const ack = await socket.emitWithAck('subscribe', { topic: `project:${projectId}` });
      expect(ack).toEqual({ ok: true });

      const done = await uploadSource(h, user, projectId, { durationMs: 10 * 60_000 });
      expect(done.status).toBe(202);
      expect(done.body.status).toBe('INGESTING');

      const project = await waitForStatus(h, user, projectId, ['AWAITING_SELECTION', 'FAILED']);
      expect(project.status).toBe('AWAITING_SELECTION');
      expect(project.progress).toBe(100);
      expect(project.durationMs).toBe(600_000);
      expect(project.jobs.map((j: any) => [j.stage, j.status])).toEqual([
        ['INGEST', 'SUCCEEDED'],
        ['ANALYZE', 'SUCCEEDED'],
        ['CANDIDATES', 'SUCCEEDED'],
        ['SCORE', 'SUCCEEDED'],
      ]);
      expect(project.source).toMatchObject({ status: 'READY', width: 1920, sizeBytes: 2048 });
      expect(project.creditsCharged).toBe(10);
      expect(project.candidateCount).toBeGreaterThan(0);

      // Adaylar: puan ağırlıklı toplamdır, sıra puana göredir.
      const candidates = await h.prisma.clipCandidate.findMany({ where: { projectId }, orderBy: { rank: 'asc' } });
      expect(candidates.every((c) => c.status === 'SCORED')).toBe(true);
      for (const c of candidates) {
        const b = c.breakdown as Record<string, number>;
        const expected = Math.round(
          b.hook! * 0.3 + b.emotion! * 0.25 + b.standalone! * 0.2 + b.curiosity! * 0.15 + b.shareability! * 0.1,
        );
        expect(c.score).toBe(expected);
        expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(15_000);
      }
      const scores = candidates.map((c) => c.score!);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);

      // Transkript
      const transcript = await h.http
        .get(`/v1/projects/${projectId}/transcript`)
        .query({ fromMs: 0, toMs: 20_000 })
        .set(user.auth);
      expect(transcript.status).toBe(200);
      expect(transcript.body.language).toBe('tr');
      expect(transcript.body.segments.length).toBeGreaterThan(0);
      expect(transcript.body.segments.every((s: any) => s.startMs <= 20_000)).toBe(true);
      expect(transcript.body.wordsUrl).toContain('X-Amz-Signature');

      // Kredi defteri
      const sub = await h.prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
      expect(sub.creditsUsed).toBe(10);
      const log = await h.prisma.usageLog.findUniqueOrThrow({ where: { idempotencyKey: `minutes:${projectId}` } });
      expect(log).toMatchObject({ kind: 'MINUTES_PROCESSED', credits: -10 });

      // Canlı olaylar
      await new Promise((r) => setTimeout(r, 300));
      const types = events.map((e) => e.type);
      expect(types).toContain('project.stage');
      expect(types).toContain('project.candidates_ready');
      const last = events.filter((e) => e.type === 'project.status').pop();
      expect(last?.data).toMatchObject({ projectId, status: 'AWAITING_SELECTION', progress: 100 });

      // Yeniden bağlanma: ilk olaydan sonrası tekrar oynatılır.
      const second = await connect(h, user);
      const replayed: string[] = [];
      second.on('event', (e) => replayed.push(e.id));
      const replayAck = await second.emitWithAck('subscribe', {
        topic: `project:${projectId}`,
        lastEventId: events[0]!.id,
      });
      expect(replayAck).toEqual({ ok: true });
      await new Promise((r) => setTimeout(r, 200));
      expect(replayed).toEqual(events.slice(1).map((e) => e.id));
      const stale = await second.emitWithAck('subscribe', { topic: `project:${projectId}`, lastEventId: '1-0' });
      expect(stale).toEqual({ ok: false, code: 'RESYNC_REQUIRED' });

      socket.close();
      second.close();
    });

    it('yarım kalan yüklemede hangi parçaların yüklendiğini bildirir ve oturumu iptal eder', async () => {
      const projectId = await createProject(h, user, channelId);
      const size = 20 * 1024 * 1024; // 16 MiB + 4 MiB → 2 parça
      const init = await h.http
        .post(`/v1/projects/${projectId}/source/upload`)
        .set(user.auth)
        .send({ fileName: 'buyuk.mp4', contentType: 'video/mp4', sizeBytes: size, durationMs: 60_000 });
      expect(init.status).toBe(201);
      expect(init.body).toMatchObject({ partSize: 16 * 1024 * 1024, partCount: 2, uploadedParts: [] });

      const signed = await h.http
        .post(`/v1/projects/${projectId}/source/upload/parts`)
        .set(user.auth)
        .send({ partNumbers: [1, 2] });
      expect(signed.body.parts).toHaveLength(2);
      const tooHigh = await h.http
        .post(`/v1/projects/${projectId}/source/upload/parts`)
        .set(user.auth)
        .send({ partNumbers: [3] });
      expect(tooHigh.status).toBe(422);

      await fetch(signed.body.parts[0].url, { method: 'PUT', body: Buffer.alloc(16 * 1024 * 1024, 1) });
      const resume = await h.http.get(`/v1/projects/${projectId}/source/upload`).set(user.auth);
      expect(resume.body.uploadedParts).toHaveLength(1);
      expect(resume.body.uploadedParts[0]).toMatchObject({ partNumber: 1, size: 16 * 1024 * 1024 });

      // Eksik parçayla tamamlanamaz.
      const incomplete = await h.http
        .post(`/v1/projects/${projectId}/source/upload/complete`)
        .set(user.auth)
        .send({ parts: [{ partNumber: 1, etag: resume.body.uploadedParts[0].etag }] });
      expect(incomplete.status).toBe(422);
      expect(incomplete.body.code).toBe('UPLOAD_INCOMPLETE');

      expect((await h.http.delete(`/v1/projects/${projectId}/source/upload`).set(user.auth)).status).toBe(204);
      expect((await h.http.get(`/v1/projects/${projectId}/source/upload`).set(user.auth)).status).toBe(404);
    });

    it('beyan edilen boyutla uyuşmayan dosyayı reddeder', async () => {
      const projectId = await createProject(h, user, channelId);
      const res = await uploadSource(h, user, projectId, { declaredSize: 4096 });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('UPLOAD_MISMATCH');
      const project = await h.http.get(`/v1/projects/${projectId}`).set(user.auth);
      expect(project.body.status).toBe('DRAFT');
      expect(project.body.source.status).toBe('FAILED');
    });

    it('kalıcı hatada projeyi başarısız işaretler; yeniden deneme kaldığı aşamadan sürer ve krediyi bir kez düşer', async () => {
      const projectId = await createProject(h, user, channelId);
      await uploadSource(h, user, projectId, { fileName: 'stub-fail.mp4', durationMs: 120_000 });
      const failed = await waitForStatus(h, user, projectId, ['FAILED', 'AWAITING_SELECTION']);
      expect(failed.status).toBe('FAILED');
      expect(failed.error).toMatchObject({ code: 'SOURCE_UNREADABLE', retryable: false });
      expect(failed.jobs[0]).toMatchObject({ stage: 'INGEST', status: 'FAILED' });
      expect(failed.creditsCharged).toBe(0);

      // Başarısız olmayan proje yeniden denenemez.
      const other = await createProject(h, user, channelId);
      expect((await h.http.post(`/v1/projects/${other}/retry`).set(user.auth)).status).toBe(409);

      await h.prisma.sourceVideo.update({ where: { projectId }, data: { originalName: 'duzeldi.mp4' } });
      const retry = await h.http.post(`/v1/projects/${projectId}/retry`).set(user.auth);
      expect(retry.status).toBe(202);
      expect(retry.body.status).toBe('INGESTING');
      const ok = await waitForStatus(h, user, projectId, ['FAILED', 'AWAITING_SELECTION']);
      expect(ok.status).toBe('AWAITING_SELECTION');
      expect(ok.error).toBeNull();
      expect(ok.creditsCharged).toBe(2);
      expect(await h.prisma.usageLog.count({ where: { projectId, kind: 'MINUTES_PROCESSED' } })).toBe(1);
    });

    it('kaçan kuyruk olayını bakım işi telafi eder', async () => {
      const projectId = await createProject(h, user, channelId);
      // Orkestratör olayı hiç görmemiş gibi: proje INGESTING'de ama kuyrukta iş yok.
      await h.prisma.sourceVideo.create({
        data: {
          projectId,
          ingestType: 'UPLOAD',
          status: 'UPLOADED',
          storageKey: `projects/${projectId}/source/original.mp4`,
          declaredDurationMs: 60_000,
          originalName: 'kayip.mp4',
        },
      });
      await h.prisma.project.update({ where: { id: projectId }, data: { status: 'INGESTING' } });
      const queue = h.app.get(QueueService).queue(QUEUES.INGEST);
      expect(await queue.getJob(projectJobId('INGEST', projectId))).toBeUndefined();

      const repaired = await h.app.get(MaintenanceService).reconcile(0);
      expect(repaired).toBeGreaterThanOrEqual(1);
      const project = await waitForStatus(h, user, projectId, ['AWAITING_SELECTION', 'FAILED']);
      expect(project.status).toBe('AWAITING_SELECTION');
    });
  });

  describe('plan ve kredi', () => {
    it('Ücretsiz planda krediyi aşan videoyu ve 4K isteğini reddeder', async () => {
      const free = await registerUser(h, 'ucretsiz@ornek.com');
      const freeChannel = await createChannel(h, free.id);
      const projectId = await createProject(h, free, freeChannel);
      const tooLong = await uploadSource(h, free, projectId, { durationMs: 61 * 60_000 });
      expect(tooLong.status).toBe(402);
      expect(tooLong.body.code).toBe('INSUFFICIENT_CREDITS');

      const fourK = await h.http
        .post('/v1/projects')
        .set(free.auth)
        .send({ channelId: freeChannel, title: '4K', rights: RIGHTS, settingsOverride: { resolution: 'UHD_4K' } });
      expect(fourK.status).toBe(402);
      expect(fourK.body.code).toBe('PLAN_FEATURE_LOCKED');
    });

    it('sahip hesabı (OWNER_EMAILS) abonelik olmadan sınırsız kullanır', async () => {
      const owner = await registerUser(h, 'owner@klipai.test');
      const ownerChannel = await createChannel(h, owner.id);
      const projectId = await createProject(h, owner, ownerChannel, { settingsOverride: { resolution: 'UHD_4K' } });
      const snapshot = (await h.prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .settingsSnapshot as Record<string, unknown>;
      expect(snapshot.watermark).toBe(false);

      // 3 saatlik video: Ücretsiz planın 60 kredisini çok aşar.
      const res = await uploadSource(h, owner, projectId, { durationMs: 180 * 60_000 });
      expect(res.status).toBe(202);
      const project = await waitForStatus(h, owner, projectId, ['AWAITING_SELECTION', 'FAILED']);
      expect(project.status).toBe('AWAITING_SELECTION');
      const access = await h.app.get(EntitlementsService).accessFor(owner.id);
      expect(access).toMatchObject({ isOwner: true, creditsRemaining: null });
      expect(access.entitlements.monthlyClips).toBeNull();
    });

    it('iade krediyi geri verir ve iki kez uygulanmaz', async () => {
      const payer = await registerUser(h, 'iade@ornek.com');
      const payerChannel = await createChannel(h, payer.id);
      const projectId = await createProject(h, payer, payerChannel);
      const entitlements = h.app.get(EntitlementsService);
      const input = { userId: payer.id, projectId, channelId: payerChannel, durationMs: 25 * 60_000 };

      expect(await h.prisma.$transaction((tx) => entitlements.chargeMinutes(tx, input))).toBe(true);
      expect(await h.prisma.$transaction((tx) => entitlements.chargeMinutes(tx, input))).toBe(true);
      expect((await entitlements.accessFor(payer.id)).creditsRemaining).toBe(35);

      // Bakiyeyi aşan düşüm reddedilir, defter değişmez.
      const other = await createProject(h, payer, payerChannel);
      const over = { ...input, projectId: other, durationMs: 40 * 60_000 };
      expect(await h.prisma.$transaction((tx) => entitlements.chargeMinutes(tx, over))).toBe(false);

      await h.prisma.$transaction((tx) => entitlements.refundProject(tx, projectId));
      await h.prisma.$transaction((tx) => entitlements.refundProject(tx, projectId));
      expect((await entitlements.accessFor(payer.id)).creditsRemaining).toBe(60);
      const kinds = (await h.prisma.usageLog.findMany({ where: { projectId } })).map((l) => l.kind).sort();
      expect(kinds).toEqual(['MINUTES_PROCESSED', 'REFUND']);
    });
  });

  describe('bağlantıdan alım', () => {
    it('video platformu, HTTP ve iç ağ adreslerini reddeder', async () => {
      const projectId = await createProject(h, user, channelId);
      for (const url of [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        'http://ornek.com/video.mp4',
        'https://127.0.0.1/video.mp4',
        'https://169.254.169.254/latest/meta-data',
        'https://kullanici:parola@ornek.com/video.mp4',
        'https://[::1]/video.mp4',
      ]) {
        const res = await h.http.post(`/v1/projects/${projectId}/source/link`).set(user.auth).send({ url });
        expect([url, res.status, res.body.code]).toEqual([url, 422, 'UNSUPPORTED_SOURCE']);
      }
      expect((await h.http.get(`/v1/projects/${projectId}`).set(user.auth)).body.status).toBe('DRAFT');
    });
  });

  describe('iptal ve silme', () => {
    it('taslak projeyi iptal eder; iptal edilen proje yeniden iptal edilemez', async () => {
      const projectId = await createProject(h, user, channelId);
      const res = await h.http.post(`/v1/projects/${projectId}/cancel`).set(user.auth);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELED');
      expect((await h.http.post(`/v1/projects/${projectId}/cancel`).set(user.auth)).status).toBe(409);
      // İptal edilmiş projeye kaynak eklenemez.
      expect((await uploadSource(h, user, projectId)).status).toBe(409);
    });

    it('projeyi silince depolamadaki dosyalar gider, hak beyanı kalır', async () => {
      const projectId = await createProject(h, user, channelId);
      await uploadSource(h, user, projectId, { durationMs: 60_000 });
      await waitForStatus(h, user, projectId, ['AWAITING_SELECTION']);
      const storage = h.app.get(StorageService);
      const key = `projects/${projectId}/source/original.mp4`;
      expect(await storage.head(key)).not.toBeNull();

      expect((await h.http.delete(`/v1/projects/${projectId}`).set(user.auth)).status).toBe(204);
      expect(await storage.head(key)).toBeNull();
      expect(await storage.head(`projects/${projectId}/analysis/segments.json`)).toBeNull();
      expect((await h.http.get(`/v1/projects/${projectId}`).set(user.auth)).status).toBe(404);
      expect(await h.prisma.clipCandidate.count({ where: { projectId } })).toBe(0);

      const rights = await h.prisma.rightsDeclaration.findMany({ where: { userId: user.id, projectId: null } });
      expect(rights.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('canlı bağlantı yetkisi', () => {
    it('biletsiz bağlantıyı ve yetkisiz konuyu reddeder; bilet tek kullanımlıktır', async () => {
      const bad = io(h.url, { path: '/v1/ws', auth: { ticket: 'gecersiz-bilet-gecersiz-bilet' }, transports: ['websocket'] });
      await expect(
        new Promise((resolve, reject) => {
          bad.on('connect', () => resolve(null));
          bad.on('connect_error', (e) => reject(e));
        }),
      ).rejects.toThrow('UNAUTHORIZED');
      bad.close();

      const ticket = (await h.http.post('/v1/realtime/ticket').set(user.auth)).body.ticket;
      const first = io(h.url, { path: '/v1/ws', auth: { ticket }, transports: ['websocket'] });
      await new Promise<void>((resolve) => first.on('connect', () => resolve()));
      const reused = io(h.url, { path: '/v1/ws', auth: { ticket }, transports: ['websocket'] });
      await expect(
        new Promise((resolve, reject) => {
          reused.on('connect', () => resolve(null));
          reused.on('connect_error', (e) => reject(e));
        }),
      ).rejects.toThrow('UNAUTHORIZED');
      reused.close();

      const outsider = await registerUser(h, 'disarida@ornek.com');
      const projectId = await createProject(h, user, channelId);
      const socket = await connect(h, outsider);
      expect(await socket.emitWithAck('subscribe', { topic: `project:${projectId}` })).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(await socket.emitWithAck('subscribe', { topic: `user:${user.id}` })).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(await socket.emitWithAck('subscribe', { topic: 'baska:bir-sey' })).toEqual({ ok: false, code: 'INVALID_TOPIC' });
      expect(await first.emitWithAck('subscribe', { topic: `channel:${channelId}` })).toEqual({ ok: true });
      socket.close();
      first.close();
    });
  });
});
