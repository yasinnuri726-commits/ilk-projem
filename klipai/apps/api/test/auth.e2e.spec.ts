// Yol: klipai/apps/api/test/auth.e2e.spec.ts
import { clearRateLimits, createHarness, type Harness, registerUser } from './harness';

describe('Kimlik', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  beforeEach(() => clearRateLimits(h));

  it('kayıt olur, e-postayı doğrular ve profili okur', async () => {
    const user = await registerUser(h, 'Ayse@Ornek.com');
    const mail = h.mails.find((m) => m.to === 'ayse@ornek.com' && m.template === 'VERIFY_EMAIL');
    expect(mail).toBeDefined();

    let me = await h.http.get('/v1/me').set(user.auth);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'ayse@ornek.com', emailVerified: false, locale: 'TR' });

    expect((await h.http.post('/v1/auth/email/verify').send({ token: mail!.token })).status).toBe(204);
    // Bağlantı tek kullanımlıktır.
    expect((await h.http.post('/v1/auth/email/verify').send({ token: mail!.token })).status).toBe(400);

    me = await h.http.get('/v1/me').set(user.auth);
    expect(me.body.emailVerified).toBe(true);

    const sub = await h.prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(sub).toMatchObject({ plan: 'FREE', creditsGranted: 60, creditsUsed: 0 });
  });

  it('aynı e-postayı (harf büyüklüğü farklı olsa da) ikinci kez kabul etmez', async () => {
    await registerUser(h, 'tekrar@ornek.com');
    const res = await h.http
      .post('/v1/auth/register')
      .send({ email: 'TEKRAR@ornek.com', password: 'cok-gizli-parola-1', displayName: 'X' });
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ code: 'EMAIL_TAKEN', status: 409, title: 'Bu e-posta adresi zaten kayıtlı' });
    expect(res.body.traceId).toBeTruthy();
  });

  it('geçersiz gövdeyi alan hatalarıyla reddeder ve başlığı dile göre verir', async () => {
    const res = await h.http
      .post('/v1/auth/register')
      .set('Accept-Language', 'en-US')
      .send({ email: 'bozuk', password: 'kisa', displayName: '', fazladan: 1 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.title).toBe('Validation failed');
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'password', 'displayName']));
  });

  it('yanlış parolayı ve olmayan hesabı aynı hatayla reddeder', async () => {
    await registerUser(h, 'giris@ornek.com');
    const wrong = await h.http.post('/v1/auth/login').send({ email: 'giris@ornek.com', password: 'yanlis-parola-1' });
    const missing = await h.http.post('/v1/auth/login').send({ email: 'yok@ornek.com', password: 'yanlis-parola-1' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(missing.body.code).toBe('INVALID_CREDENTIALS');

    const ok = await h.http.post('/v1/auth/login').send({ email: 'giris@ornek.com', password: 'cok-gizli-parola-1' });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
  });

  it('oturumsuz ve bozuk token ile korumalı uca erişilemez', async () => {
    expect((await h.http.get('/v1/me')).status).toBe(401);
    expect((await h.http.get('/v1/me').set('Authorization', 'Bearer bozuk.token.degeri')).status).toBe(401);
  });

  it('refresh token döner; eski token yeniden kullanılırsa tüm oturum zinciri kapanır', async () => {
    const user = await registerUser(h, 'rotasyon@ornek.com');
    const first = await h.http.post('/v1/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(user.refreshToken);

    // Çalınmış (zaten kullanılmış) token ikinci kez gelir.
    const reuse = await h.http.post('/v1/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('TOKEN_REUSED');

    // Meşru istemcinin yeni token'ı da artık geçersizdir.
    const after = await h.http.post('/v1/auth/refresh').send({ refreshToken: first.body.refreshToken });
    expect(after.status).toBe(401);
  });

  it('veritabanında refresh token ve parola açık metin olarak durmaz', async () => {
    const user = await registerUser(h, 'ozet@ornek.com');
    const rows = await h.prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(user.refreshToken);
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('çıkış yapınca refresh token geçersiz olur', async () => {
    const user = await registerUser(h, 'cikis@ornek.com');
    const out = await h.http.post('/v1/auth/logout').set(user.auth).send({ refreshToken: user.refreshToken });
    expect(out.status).toBe(204);
    expect((await h.http.post('/v1/auth/refresh').send({ refreshToken: user.refreshToken })).status).toBe(401);
  });

  it('parola sıfırlama parolayı değiştirir ve açık oturumları kapatır', async () => {
    const user = await registerUser(h, 'sifirla@ornek.com');
    expect((await h.http.post('/v1/auth/password/forgot').send({ email: 'sifirla@ornek.com' })).status).toBe(202);
    // Olmayan hesap için de aynı yanıt.
    expect((await h.http.post('/v1/auth/password/forgot').send({ email: 'hic-yok@ornek.com' })).status).toBe(202);

    const mail = h.mails.find((m) => m.to === 'sifirla@ornek.com' && m.template === 'PASSWORD_RESET');
    const reset = await h.http
      .post('/v1/auth/password/reset')
      .send({ token: mail!.token, password: 'yepyeni-parola-22' });
    expect(reset.status).toBe(204);

    expect((await h.http.post('/v1/auth/refresh').send({ refreshToken: user.refreshToken })).status).toBe(401);
    const oldLogin = await h.http.post('/v1/auth/login').send({ email: 'sifirla@ornek.com', password: 'cok-gizli-parola-1' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await h.http.post('/v1/auth/login').send({ email: 'sifirla@ornek.com', password: 'yepyeni-parola-22' });
    expect(newLogin.status).toBe(200);
  });

  it('Google ile giriş hesap açar, ikinci girişte aynı hesabı kullanır, var olan e-postaya bağlanır', async () => {
    const first = await h.http.post('/v1/auth/google').send({ idToken: 'google:sub-12345678:gmail@ornek.com' });
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({ email: 'gmail@ornek.com', emailVerified: true });
    const second = await h.http.post('/v1/auth/google').send({ idToken: 'google:sub-12345678:gmail@ornek.com' });
    expect(second.body.user.id).toBe(first.body.user.id);

    const existing = await registerUser(h, 'bagla@ornek.com');
    const linked = await h.http.post('/v1/auth/google').send({ idToken: 'google:sub-87654321:bagla@ornek.com' });
    expect(linked.body.user.id).toBe(existing.id);

    const bad = await h.http.post('/v1/auth/google').send({ idToken: 'gecersiz-bir-kimlik-belirteci' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('profili günceller, push cihazını kaydeder ve siler', async () => {
    const user = await registerUser(h, 'profil@ornek.com');
    const patch = await h.http
      .patch('/v1/me')
      .set(user.auth)
      .send({ displayName: 'Yeni Ad', locale: 'EN', theme: 'DARK', timezone: 'America/New_York' });
    expect(patch.body).toMatchObject({ displayName: 'Yeni Ad', locale: 'EN', theme: 'DARK' });
    const badTz = await h.http.patch('/v1/me').set(user.auth).send({ timezone: 'Mars/Olympus' });
    expect(badTz.status).toBe(422);

    const device = await h.http
      .post('/v1/me/devices')
      .set(user.auth)
      .send({ platform: 'IOS', pushToken: 'ExponentPushToken[abcdefghij]' });
    expect(device.status).toBe(200);
    const again = await h.http
      .post('/v1/me/devices')
      .set(user.auth)
      .send({ platform: 'IOS', pushToken: 'ExponentPushToken[abcdefghij]' });
    expect(again.body.id).toBe(device.body.id);
    expect((await h.http.delete(`/v1/me/devices/${device.body.id}`).set(user.auth)).status).toBe(204);
    expect(await h.prisma.device.count({ where: { userId: user.id } })).toBe(0);
  });

  it('kimlik uçlarını IP başına dakikada 10 istekle sınırlar', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await h.http.post('/v1/auth/login').send({ email: 'sinir@ornek.com', password: 'yanlis-parola-1' });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.body.code).toBe('RATE_LIMITED');
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      }
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('sağlık ucu veritabanı ve Redis durumunu bildirir', async () => {
    const res = await h.http.get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });
});
