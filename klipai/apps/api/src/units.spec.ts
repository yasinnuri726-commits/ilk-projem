import { randomBytes } from 'crypto';
import { computeNextSlot, quotaWindow } from './publishing/scheduler.service';
import { backoffMs } from './publishing/publish.processor';
import { renderDescription } from './publishing/publishing.service';
import { buildInsight } from './learning/learning.service';
import { creditsForDuration, rollPeriod, PERIOD_MS } from './billing/entitlements.service';
import { planFrom } from './billing/billing';
import { assertDirectMediaUrl } from './projects/projects';
import { partSizeFor } from './uploads/uploads';
import { CLIP_TRANSITIONS, canTransition, PROJECT_TRANSITIONS, PUBLISH_TRANSITIONS } from './common/state-machine';
import { decrypt, encrypt, hmacHex, verifyServiceSignature } from './common/crypto';
import { limitsFor, outputSize, weightedScore, clampResolution, settingsPatchSchema, DEFAULT_SETTINGS } from '@klipai/shared';

describe('zamanlayıcı', () => {
  const s = { dailyClipCount: 2, timeSlots: [{ start: '12:00', end: '14:00' }, { start: '19:00', end: '22:00' }], timezone: 'Europe/Istanbul', useBestTimes: false };
  const now = new Date('2026-11-17T06:00:00Z'); // 09:00 İstanbul

  it('ilk uygun dilimi seçer', () => {
    expect(computeNextSlot(s, [], now)?.toISOString()).toBe('2026-11-17T09:00:00.000Z'); // 12:00 TRT
  });
  it('alınmış zamana 60 dk\'dan yakın olanı atlar', () => {
    const next = computeNextSlot(s, [new Date('2026-11-17T09:00:00Z')], now)!;
    expect(next.toISOString()).toBe('2026-11-17T10:00:00.000Z'); // 13:00 TRT
  });
  it('günlük adet dolunca ertesi güne geçer', () => {
    const taken = [new Date('2026-11-17T09:00:00Z'), new Date('2026-11-17T16:00:00Z')];
    expect(computeNextSlot(s, taken, now)?.toISOString()).toBe('2026-11-18T09:00:00.000Z');
  });
  it('en iyi saat önceliklidir', () => {
    expect(computeNextSlot({ ...s, useBestTimes: true }, [], now, [20])?.toISOString()).toBe('2026-11-17T17:00:00.000Z'); // 20:00 TRT
  });
  it('plan boşsa null', () => {
    expect(computeNextSlot({ ...s, dailyClipCount: 0 }, [], now)).toBeNull();
    expect(computeNextSlot({ ...s, timeSlots: [] }, [], now)).toBeNull();
  });
  it('kota Pasifik gece yarısı sıfırlanır', () => {
    const w = quotaWindow(new Date('2026-11-17T07:30:00Z'));
    expect(w.resetAt.toISOString()).toBe('2026-11-17T08:00:00.000Z');
    expect(w.key).toBe('yt:quota:2026-11-16');
  });
});

describe('yayın', () => {
  it('üstel geri çekilme 5-10-20 dk', () => {
    expect([1, 2, 3].map((a) => backoffMs(a) / 60000)).toEqual([5, 10, 20]);
  });
  it('açıklama şablonu', () => {
    const clip = { title: 'T', description: 'Açıklama', hashtags: ['komik', '#anlar'] };
    expect(renderDescription(null, clip)).toBe('Açıklama\n\n#komik #anlar');
    expect(renderDescription('{description}\n{hashtags}\n#shorts', clip)).toBe('Açıklama\n#komik #anlar\n#shorts');
  });
});

describe('öğrenme', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
    views: 1000 - i * 90, avgViewPct: 80 - i, durationSec: 20 + i * 5, hookText: `kanca ${i}`, commentaryFormat: i % 2 ? 'NONE' : 'REACTION',
    scores: { hook: 90 - i * 5, emotion: 60, standalone: 50, curiosity: 70 - i, shareability: 50 },
  }));
  it('az veriyle içgörü üretmez', () => expect(buildInsight(rows(4))).toBeNull());
  it('kazananları özetler', () => {
    const r = buildInsight(rows(10))!;
    expect(r.summary).toContain('10 published clips');
    expect(r.summary).toContain('"hook"');
    expect(r.features.sampleSize).toBe(10);
  });
});

describe('kredi ve abonelik', () => {
  it('dakika yukarı yuvarlanır, en az 1', () => {
    expect([1, 60, 61, 3600].map(creditsForDuration)).toEqual([1, 1, 2, 60]);
  });
  it('dönem ileri sarılır', () => {
    const s = new Date('2026-01-01T00:00:00Z');
    const r = rollPeriod(s, new Date(s.getTime() + PERIOD_MS), new Date(s.getTime() + PERIOD_MS * 2.5));
    expect(r.end.getTime()).toBe(s.getTime() + PERIOD_MS * 3);
  });
  it('plan çözümleme', () => {
    expect(planFrom(['pro'])).toBe('PRO');
    expect(planFrom([], 'klipai_agency_monthly')).toBe('AGENCY');
    expect(planFrom()).toBe('FREE');
  });
  it('planlar ve geliştirici sınırları', () => {
    expect(limitsFor('FREE', 'USER')).toMatchObject({ clipsPerMonth: 5, maxResolution: 'HD_720', watermark: true });
    expect(limitsFor('PRO', 'USER')).toMatchObject({ clipsPerMonth: 150, maxChannels: 1 });
    expect(limitsFor('AGENCY', 'USER')).toMatchObject({ clipsPerMonth: null, maxChannels: 10, maxResolution: 'UHD_4K' });
    expect(limitsFor('FREE', 'DEVELOPER')).toMatchObject({ clipsPerMonth: null, creditsPerMonth: null, maxChannels: null, watermark: false, maxResolution: 'UHD_4K' });
  });
});

describe('ortak', () => {
  it('puan ağırlıkları', () => {
    expect(weightedScore({ hook: 100, emotion: 100, standalone: 100, curiosity: 100, shareability: 100 })).toBe(100);
    expect(weightedScore({ hook: 100, emotion: 0, standalone: 0, curiosity: 0, shareability: 0 })).toBe(30);
    expect(weightedScore({ hook: 80, emotion: 60, standalone: 40, curiosity: 20, shareability: 0 })).toBe(50);
  });
  it('çıktı boyutları', () => {
    expect(outputSize('PORTRAIT_9_16', 'FHD_1080')).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('LANDSCAPE_16_9', 'UHD_4K')).toEqual({ width: 3840, height: 2160 });
    expect(outputSize('SQUARE_1_1', 'HD_720')).toEqual({ width: 720, height: 720 });
    expect(clampResolution('UHD_4K', 'HD_720')).toBe('HD_720');
  });
  it('ayar yaması doğrulanır', () => {
    expect(settingsPatchSchema.safeParse({ minScore: 101 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ minDurationSec: 80, maxDurationSec: 30 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ minScore: 60, subtitle: DEFAULT_SETTINGS.subtitle }).success).toBe(true);
  });
});

describe('durum makineleri', () => {
  it('klip akışı', () => {
    const path = ['CANDIDATE', 'EDITING', 'READY', 'SCHEDULED', 'PUBLISHED'] as const;
    path.slice(1).forEach((to, i) => expect(canTransition(CLIP_TRANSITIONS, path[i], to)).toBe(true));
    expect(canTransition(CLIP_TRANSITIONS, 'PUBLISHED', 'EDITING')).toBe(false);
    expect(canTransition(CLIP_TRANSITIONS, 'FAILED', 'EDITING')).toBe(true);
  });
  it('proje akışı', () => {
    expect(canTransition(PROJECT_TRANSITIONS, 'READY', 'INGESTING')).toBe(false);
    expect(canTransition(PROJECT_TRANSITIONS, 'FAILED', 'ANALYZING')).toBe(true);
  });
  it('yayın akışı', () => {
    expect(canTransition(PUBLISH_TRANSITIONS, 'UPLOADING', 'RETRY_WAIT')).toBe(true);
    expect(canTransition(PUBLISH_TRANSITIONS, 'PUBLISHED', 'SCHEDULED')).toBe(false);
    expect(canTransition(PUBLISH_TRANSITIONS, 'RETRY_WAIT', 'FAILED')).toBe(true);
  });
});

describe('güvenlik', () => {
  const key = randomBytes(32).toString('base64');
  it('AES-GCM gidiş-dönüş ve kurcalama tespiti', () => {
    const enc = encrypt('refresh-token', key);
    expect(enc).not.toContain('refresh-token');
    expect(decrypt(enc, key)).toBe('refresh-token');
    const [iv, tag, data] = enc.split('.');
    const tampered = [iv, tag, Buffer.from('x' + Buffer.from(data, 'base64').toString('latin1').slice(1), 'latin1').toString('base64')].join('.');
    expect(() => decrypt(tampered, key)).toThrow();
  });
  it('servis imzası: zaman penceresi ve gövde', () => {
    const body = Buffer.from('{"a":1}'); const secret = 's'.repeat(32); const now = 1_700_000_000_000; const ts = String(now / 1000);
    const sig = 'sha256=' + hmacHex(Buffer.concat([Buffer.from(`${ts}.`), body]), secret);
    expect(verifyServiceSignature(body, ts, sig, secret, now)).toBe(true);
    expect(verifyServiceSignature(Buffer.from('{"a":2}'), ts, sig, secret, now)).toBe(false);
    expect(verifyServiceSignature(body, ts, sig, secret, now + 6 * 60_000)).toBe(false);
    expect(verifyServiceSignature(body, undefined, sig, secret, now)).toBe(false);
  });
  it('link kaynağı yalnızca genel https medya dosyası', () => {
    expect(() => assertDirectMediaUrl('https://cdn.example.com/a/video.mp4')).not.toThrow();
    for (const bad of ['http://cdn.example.com/a.mp4', 'https://www.youtube.com/watch?v=x', 'https://127.0.0.1/a.mp4', 'https://localhost/a.mp4', 'https://u:p@cdn.example.com/a.mp4', 'https://10.0.0.5/a.mp4', 'https://intranet/a.mp4'])
      expect(() => assertDirectMediaUrl(bad)).toThrow();
  });
  it('yükleme parça boyutu 10.000 parçayı aşmaz', () => {
    const gb20 = 20 * 1024 ** 3;
    expect(Math.ceil(gb20 / partSizeFor(gb20))).toBeLessThanOrEqual(10000);
    expect(partSizeFor(100)).toBe(8 * 1024 * 1024);
  });
});
