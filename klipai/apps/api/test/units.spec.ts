// Yol: klipai/apps/api/test/units.spec.ts
import {
  applySettingsPatch,
  assertTransition,
  CLIP_TRANSITIONS,
  DEFAULT_SETTINGS,
  InvalidTransitionError,
  normalizeSettings,
  parseJobError,
  PROJECT_TRANSITIONS,
  weightedScore,
} from '@klipai/shared';
import { AppConfig } from '../src/config/app-config';
import { CryptoService, safeEqual } from '../src/infra/crypto.service';
import { assertIngestableUrl, isPublicAddress } from '../src/modules/projects/url-guard';

describe('CryptoService', () => {
  const crypto = new CryptoService(new AppConfig());

  it('şifreler, çözer ve her seferinde farklı çıktı üretir', () => {
    const a = crypto.seal('ya29.gizli-token', 'channel-1');
    const b = crypto.seal('ya29.gizli-token', 'channel-1');
    expect(a.data.equals(b.data)).toBe(false);
    expect(a.data.toString('utf8')).not.toContain('gizli');
    expect(crypto.open(a, 'channel-1')).toBe('ya29.gizli-token');
    expect(a.keyVersion).toBe(2); // en büyük sürümle şifrelenir
  });

  it('başka satıra taşınan ya da değiştirilen veriyi çözmez', () => {
    const sealed = crypto.seal('token', 'channel-1');
    expect(() => crypto.open(sealed, 'channel-2')).toThrow();
    const tampered = Buffer.from(sealed.data);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => crypto.open({ ...sealed, data: tampered }, 'channel-1')).toThrow();
  });

  it('eski anahtar sürümüyle şifrelenmiş kaydı çözer', () => {
    const old = new CryptoService(
      new AppConfig({ ...process.env, TOKEN_ENC_KEYS: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }),
    );
    const sealed = old.seal('eski', 'x');
    expect(sealed.keyVersion).toBe(1);
    expect(crypto.open(sealed, 'x')).toBe('eski');
    expect(crypto.isCurrent(sealed.keyVersion)).toBe(false);
  });

  it('sabit zamanlı karşılaştırma', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('AppConfig', () => {
  it('eksik değişkenleri adıyla bildirir ve üretimde sahte hattı engeller', () => {
    expect(() => new AppConfig({})).toThrow(/DATABASE_URL/);
    expect(() => new AppConfig({ ...process.env, NODE_ENV: 'production', PIPELINE_STUB: '1' })).toThrow(/PIPELINE_STUB/);
  });
});

describe('bağlantı denetimi', () => {
  const resolveTo =
    (...addresses: string[]) =>
    async () =>
      addresses;

  it('genel adresi kabul eder', async () => {
    const url = await assertIngestableUrl('https://cdn.ornek.com/a/video.mp4', resolveTo('93.184.216.34'));
    expect(url.hostname).toBe('cdn.ornek.com');
  });

  it('iç ağa çözülen alan adını reddeder (kayıtlardan biri bile özelse)', async () => {
    await expect(assertIngestableUrl('https://ic.ornek.com/v.mp4', resolveTo('10.0.0.5'))).rejects.toThrow();
    await expect(
      assertIngestableUrl('https://karisik.ornek.com/v.mp4', resolveTo('93.184.216.34', '192.168.1.1')),
    ).rejects.toThrow();
    await expect(assertIngestableUrl('https://alt.youtube.com/v.mp4', resolveTo('93.184.216.34'))).rejects.toThrow();
    await expect(assertIngestableUrl('https://ornek.com:8443/v.mp4', resolveTo('93.184.216.34'))).rejects.toThrow();
  });

  it('özel adres aralıklarını tanır', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:10.0.0.1', '0.0.0.0', '100.64.0.1']) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, false]);
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, true]);
    }
  });
});

describe('ortak paket', () => {
  it('puanı ağırlıklarla hesaplar', () => {
    expect(weightedScore({ hook: 100, emotion: 0, standalone: 0, curiosity: 0, shareability: 0 })).toBe(30);
    expect(weightedScore({ hook: 80, emotion: 60, standalone: 90, curiosity: 40, shareability: 70 })).toBe(70);
  });

  it('geçersiz durum geçişini reddeder', () => {
    expect(() => assertTransition('clip', CLIP_TRANSITIONS, 'READY', 'SCHEDULED')).not.toThrow();
    expect(() => assertTransition('clip', CLIP_TRANSITIONS, 'CANDIDATE', 'PUBLISHED')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('project', PROJECT_TRANSITIONS, 'CANCELED', 'INGESTING')).toThrow();
  });

  it('ayar yamasını gruplarda derin birleştirir ve tutarsız değeri reddeder', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { minScore: 90, audio: { musicGenre: 'LOFI' } });
    expect(next.minScore).toBe(90);
    expect(next.audio).toMatchObject({ musicGenre: 'LOFI', ducking: true });
    expect(DEFAULT_SETTINGS.audio.musicGenre).toBe('NONE');
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { minDurationSec: 80, maxDurationSec: 30 })).toThrow();
    expect(normalizeSettings({ bilinmeyen: 1 })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ dailyClipCount: 5 }).dailyClipCount).toBe(5);
  });

  it('worker hata metninden kodu ayırır', () => {
    expect(parseJobError('SOURCE_NO_AUDIO: ses izi yok')).toEqual({ code: 'SOURCE_NO_AUDIO', message: 'ses izi yok' });
    expect(parseJobError('Connection reset').code).toBe('WORKER_FAILED');
    expect(parseJobError(undefined).code).toBe('WORKER_FAILED');
  });
});
