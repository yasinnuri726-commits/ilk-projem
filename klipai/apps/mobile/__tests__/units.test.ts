import { QueryClient } from '@tanstack/react-query';
import { en } from '../src/i18n/en';
import { tr } from '../src/i18n/tr';
import { translate } from '../src/i18n';
import { errorMessage } from '../src/i18n/errors';
import { ApiError, api, clearSession, saveSession, getAccessToken } from '../src/api/client';
import { applyEvent } from '../src/realtime/socket';
import { useDrafts } from '../src/stores/drafts';
import { dayKey, mmss, scoreColor, splitList } from '../src/lib/format';

const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

describe('i18n', () => {
  it('TR ve EN anahtarları birebir aynı', () => expect(keys(en).sort()).toEqual(keys(tr).sort()));
  it('parametre doldurur, eksik anahtarda anahtarı döner', () => {
    expect(translate('tr', 'notif.PROJECT_READY', { title: 'Film', count: 3 })).toBe('“Film” için 3 kesit hazır');
    expect(translate('en', 'notif.CREDITS_LOW', { remaining: 5 })).toBe('5 min of credit left');
    expect(translate('en', 'yok.boyle.anahtar')).toBe('yok.boyle.anahtar');
  });
  it('API hata kodunu kullanıcı diline çevirir', () => {
    const t = (p: string) => translate('tr', p);
    expect(errorMessage(new ApiError(402, 'CREDITS_EXHAUSTED', 'x'), t)).toContain('kredi');
    expect(errorMessage(new ApiError(0, 'NETWORK', 'x'), t)).toContain('ulaşılamadı');
    expect(errorMessage(new Error('boom'), t)).toBe(translate('tr', 'err.INTERNAL'));
  });
});

describe('api istemcisi', () => {
  const realFetch = global.fetch;
  afterEach(async () => { global.fetch = realFetch; await clearSession(); });
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body }) as Response;

  it('401 alınca bir kez yeniler ve isteği tekrarlar', async () => {
    await saveSession({ accessToken: 'old', refreshToken: 'r1' });
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url).replace(/^.*\/v1/, '')} ${(init?.headers as Record<string, string>)?.Authorization ?? ''}`);
      if (String(url).endsWith('/auth/refresh')) return json(200, { accessToken: 'new', refreshToken: 'r2' });
      return (init?.headers as Record<string, string>).Authorization === 'Bearer new' ? json(200, { ok: 1 }) : json(401, { code: 'UNAUTHENTICATED' });
    }) as typeof fetch;
    expect(await api('/me')).toEqual({ ok: 1 });
    expect(calls).toEqual(['GET /me Bearer old', 'POST /auth/refresh ', 'GET /me Bearer new']);
    expect(getAccessToken()).toBe('new');
  });

  it('eşzamanlı 401\'ler tek yenileme paylaşır', async () => {
    await saveSession({ accessToken: 'old', refreshToken: 'r1' });
    let refreshes = 0;
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/auth/refresh')) { refreshes++; await new Promise((r) => setTimeout(r, 20)); return json(200, { accessToken: 'new', refreshToken: 'r2' }); }
      return (init?.headers as Record<string, string>).Authorization === 'Bearer new' ? json(200, {}) : json(401, {});
    }) as typeof fetch;
    await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(refreshes).toBe(1);
  });

  it('hata gövdesini ApiError\'a çevirir; ağ hatası NETWORK olur', async () => {
    global.fetch = jest.fn(async () => json(409, { code: 'VERSION_CONFLICT', detail: 'çakışma' })) as typeof fetch;
    await expect(api('/x', { auth: false })).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as typeof fetch;
    await expect(api('/x', { auth: false })).rejects.toMatchObject({ code: 'NETWORK', isNetwork: true });
  });
});

describe('gerçek zamanlı olaylar önbelleğe işlenir', () => {
  it('proje ilerlemesini yerinde günceller, klip olayında sorguları geçersiz kılar', () => {
    const qc = new QueryClient();
    qc.setQueryData(['project', 'p1'], { id: 'p1', status: 'INGESTING', progress: 1 });
    applyEvent(qc, { type: 'project.progress', data: { projectId: 'p1', status: 'ANALYZING', stage: 'ANALYZE', stageProgress: 10, progress: 22 } });
    expect(qc.getQueryData(['project', 'p1'])).toMatchObject({ status: 'ANALYZING', currentStage: 'ANALYZE', progress: 22 });

    qc.setQueryData(['clip', 'c1'], { id: 'c1' });
    applyEvent(qc, { type: 'clip.updated', data: { clipId: 'c1', status: 'READY', qcStatus: 'PASSED', version: 3 } });
    expect(qc.getQueryState(['clip', 'c1'])?.isInvalidated).toBe(true);
  });
});

describe('çevrimdışı taslaklar', () => {
  beforeEach(() => useDrafts.setState({ clips: {}, project: null }));
  it('değişiklikleri birleştirir ve ilk sürümü taban alır', () => {
    useDrafts.getState().saveClip('c1', 4, { title: 'A' });
    useDrafts.getState().saveClip('c1', 9, { hookText: 'B' });
    expect(useDrafts.getState().clips.c1).toMatchObject({ baseVersion: 4, patch: { title: 'A', hookText: 'B' } });
  });
  it('çakışmayı işaretler, taslağı silmez', () => {
    useDrafts.getState().saveClip('c1', 1, { title: 'A' });
    useDrafts.getState().markConflict('c1');
    expect(useDrafts.getState().clips.c1).toMatchObject({ conflict: true, patch: { title: 'A' } });
    useDrafts.getState().dropClip('c1');
    expect(useDrafts.getState().clips.c1).toBeUndefined();
  });
});

describe('biçimleme', () => {
  it('yardımcılar', () => {
    expect(mmss(125)).toBe('2:05');
    expect(splitList(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
    expect(dayKey(new Date(2026, 10, 5))).toBe('2026-11-05');
    expect([80, 60, 20, null].map(scoreColor)).toEqual(['success', 'warning', 'danger', 'textMuted']);
  });
});
