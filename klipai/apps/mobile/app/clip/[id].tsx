import DateTimePicker from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, Stack } from 'expo-router';
import * as Linking from 'expo-linking';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { api } from '../../src/api/client';
import { qk, useClip } from '../../src/api/hooks';
import type { Clip, EditSpec } from '../../src/api/types';
import { Badge, Button, Card, ErrorState, Field, H2, Loading, ProgressBar, Row, Screen, Segmented, Stepper, T } from '../../src/components/ui';
import { localeTag, useLang, useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';
import { dateTime, mmss, splitList } from '../../src/lib/format';
import { pushClipDraft, useOnline } from '../../src/offline/sync';
import { useDrafts } from '../../src/stores/drafts';
import { space } from '../../src/theme/theme';

const RENDER_FIELDS = ['startSec', 'endSec', 'editSpec', 'hookText', 'commentaryScript'];

function Player({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => { p.loop = true; });
  return <VideoView player={player} style={{ width: '100%', aspectRatio: 9 / 16, maxHeight: 460, borderRadius: 14, backgroundColor: '#000', alignSelf: 'center' }} nativeControls contentFit="contain" accessibilityLabel="Clip preview" />;
}

export default function ClipEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const online = useOnline();
  const q = useClip(id);
  const clip = q.data;
  const draft = useDrafts((s) => s.clips[id]);
  const [privacy, setPrivacy] = useState<'PUBLIC' | 'UNLISTED' | 'PRIVATE'>('PUBLIC');
  const [when, setWhen] = useState<Date | null>(null);
  const [busy, setBusy] = useState('');
  const [wordsText, setWordsText] = useState<string | null>(null);

  // Düzenleme alanları: sunucu değeri, üzerine bekleyen taslak yazılır.
  const view = useMemo(() => (clip ? { ...clip, ...(draft?.patch as Partial<Clip>) } : null), [clip, draft]);
  const words = (view?.editSpec as EditSpec | undefined)?.subtitles?.words ?? [];
  const wordsJoined = words.map((w) => w.text).join(' ');
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => { setWordsText(null); }, [clip?.version]);

  const edit = (patch: Record<string, unknown>) => { if (clip) useDrafts.getState().saveClip(id, clip.version, patch); };
  const editSpec = (fn: (s: EditSpec) => EditSpec) => { if (view?.editSpec) edit({ editSpec: fn(view.editSpec as EditSpec) }); };
  const fail = (e: unknown) => Alert.alert(t('common.error'), errorMessage(e, t));
  const refresh = () => { void qc.invalidateQueries({ queryKey: qk.clip(id) }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); void qc.invalidateQueries({ queryKey: ['publish'] }); };
  const editable = clip && ['READY', 'FAILED', 'CANDIDATE'].includes(clip.status);
  const dirty = !!draft && Object.keys(draft.patch).length > 0;
  const needsRender = !!draft && Object.keys(draft.patch).some((k) => RENDER_FIELDS.includes(k));

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setBusy('save');
    const r = await pushClipDraft(id);
    setBusy('');
    if (r === 'synced') { refresh(); return true; }
    if (r === 'failed') Alert.alert(t('common.error'), t('common.offline'));
    return false;
  };

  const run = (name: string, fn: () => Promise<unknown>) => async () => {
    setBusy(name);
    try { if (await save()) { await fn(); refresh(); } } catch (e) { fail(e); } finally { setBusy(''); }
  };

  const resolveKeepMine = async () => {
    const fresh = await api<Clip>(`/clips/${id}`);
    useDrafts.setState((s) => ({ clips: { ...s.clips, [id]: { ...s.clips[id], baseVersion: fresh.version, conflict: false } } }));
    await pushClipDraft(id); refresh();
  };

  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (!clip || !view) return <Screen><ErrorState message={errorMessage(q.error, t)} onRetry={() => void q.refetch()} /></Screen>;
  const pj = clip.publishJob;
  const canSchedule = clip.status === 'READY' || clip.status === 'FAILED' || pj?.status === 'PENDING_APPROVAL';

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: t('clip.title'), headerBackTitle: t('common.back') }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Badge text={t(`clip.status_${clip.status}`)} tone={clip.status === 'READY' ? 'success' : clip.status === 'FAILED' ? 'danger' : 'primary'} />
        {clip.score !== null ? <Badge text={`${t('cand.score')} ${clip.score}`} /> : null}
        {draft ? <Badge text={draft.conflict ? '⚠' : online ? '⟳' : t('clip.pendingDraft')} tone="warning" /> : <Badge text={t('clip.synced')} tone="muted" />}
      </Row>

      {clip.status === 'EDITING' ? (
        <Card>
          <T weight="700">{t('clip.renderingNow')}{clip.renderStage ? ` · ${t(`stage.${clip.renderStage}`)}` : ''}</T>
          <ProgressBar value={clip.renderProgress ?? 5} />
          <T size={12} muted>{t('project.inBackground')}</T>
        </Card>
      ) : null}
      {clip.error ? <T tone="danger" accessibilityRole="alert">{t(`err.${clip.error.code}`) !== `err.${clip.error.code}` ? t(`err.${clip.error.code}`) : clip.error.message}</T> : null}
      {clip.videoUrl ? <Player url={clip.videoUrl} /> : null}
      {clip.watermarked ? <T size={12} muted>{t('clip.watermark')}</T> : null}

      {draft?.conflict ? (
        <Card>
          <T tone="warning" weight="700">{t('clip.conflict')}</T>
          <Row><Button small title={t('clip.keepMine')} onPress={() => void resolveKeepMine().catch(fail)} /><Button small variant="secondary" title={t('clip.useServer')} onPress={() => { useDrafts.getState().dropClip(id); refresh(); }} /></Row>
        </Card>
      ) : null}

      {clip.qcReport?.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}><T weight="700">{t('clip.qc')}</T><Badge text={t(`clip.qc_${clip.qcStatus}`)} tone={clip.qcStatus === 'FLAGGED' ? 'danger' : 'success'} /></Row>
          {clip.qcReport.map((r) => <T key={r.check} size={13} muted>{`${r.passed || r.fixed ? '✓' : '✗'} ${t(`clip.check_${r.check}`)} — ${r.value}`}</T>)}
        </Card>
      ) : null}

      {editable ? (
        <>
          <H2>{t('clip.trim')}</H2>
          <Stepper label={t('clip.start')} value={view.startSec} step={0.5} min={0} format={mmss} onChange={(v) => edit({ startSec: v })} />
          <Stepper label={t('clip.end')} value={view.endSec} step={0.5} min={view.startSec + 5} format={mmss} onChange={(v) => edit({ endSec: v })} />
          <T size={12} muted>{`${Math.round(view.endSec - view.startSec)}${t('common.sec')}`}</T>

          <Field label={t('clip.hookText')} value={view.hookText ?? ''} onChangeText={(v) => { edit({ hookText: v }); editSpec((s) => ({ ...s, hook: { ...s.hook, text: v } })); }} maxLength={80} />

          {words.length ? (
            <>
              <Field label={t('clip.subtitles')} value={wordsText ?? wordsJoined} multiline onChangeText={(v) => {
                setWordsText(v);
                const tokens = v.split(/\s+/).filter(Boolean);
                // Zamanlama kelime sayısına bağlıdır: yalnızca sayı korunuyorsa kabul edilir.
                if (tokens.length === words.length) editSpec((s) => ({ ...s, subtitles: { ...s.subtitles, words: s.subtitles.words.map((w, i) => ({ ...w, text: tokens[i] })) } }));
              }} />
              <T size={12} muted>{wordsText !== null && wordsText.split(/\s+/).filter(Boolean).length !== words.length ? `${t('clip.subtitlesHint')} (${words.length})` : t('clip.subtitlesHint')}</T>
            </>
          ) : null}

          {clip.commentaryFormat !== 'NONE' ? <Field label={`${t('clip.commentary')} — ${t('clip.commentaryHint')}`} value={view.commentaryScript ?? ''} multiline onChangeText={(v) => edit({ commentaryScript: v })} maxLength={2000} /> : null}
        </>
      ) : null}

      <H2>{t('clip.titleLabel')}</H2>
      <Field value={view.title ?? ''} onChangeText={(v) => edit({ title: v })} maxLength={100} />
      {clip.titleAlternatives.length > 1 ? (
        <>
          <T size={13} muted>{t('clip.alternatives')}</T>
          <Segmented value={view.title ?? ''} onChange={(v) => edit({ title: v })} options={clip.titleAlternatives.map((a) => ({ value: a, label: a.length > 38 ? `${a.slice(0, 36)}…` : a }))} />
        </>
      ) : null}
      <Field label={t('clip.description')} value={view.description ?? ''} onChangeText={(v) => edit({ description: v })} multiline maxLength={5000} />
      <Field label={t('clip.tags')} value={view.tags.join(', ')} onChangeText={(v) => edit({ tags: splitList(v).slice(0, 30) })} autoCapitalize="none" />
      <Field label={t('clip.hashtags')} value={view.hashtags.join(', ')} onChangeText={(v) => edit({ hashtags: splitList(v).map((h) => h.replace(/^#/, '')).slice(0, 15) })} autoCapitalize="none" />

      <Button title={t('clip.saveDraft')} icon="save" variant="secondary" disabled={!dirty || !!draft?.conflict} loading={busy === 'save'} onPress={() => void save()} />

      {editable ? (
        <Card>
          <Button title={t('clip.rerender')} icon="refresh" variant={needsRender ? 'primary' : 'secondary'} loading={busy === 'render'} disabled={!online} onPress={run('render', () => api(`/clips/${id}/render`, { method: 'POST' }))} />
          <T size={12} muted>{t('clip.rerenderInfo')}</T>
          <T weight="700">{t('clip.regen')}</T>
          <Row style={{ flexWrap: 'wrap' }}>
            {([['COMMENTARY', 'regenCommentary'], ['METADATA', 'regenMeta'], ['THUMBNAIL', 'regenThumb']] as const)
              .filter(([p]) => p !== 'COMMENTARY' || clip.commentaryFormat !== 'NONE')
              .map(([part, label]) => <Button key={part} small variant="secondary" title={t(`clip.${label}`)} disabled={!online || (part !== 'COMMENTARY' && clip.status !== 'READY')} onPress={run(part, () => api(`/clips/${id}/regenerate`, { method: 'POST', body: { part } }))} />)}
          </Row>
        </Card>
      ) : null}

      {pj ? <Card><T weight="700">{t(`cal.status_${pj.status}`)}</T><T muted>{dateTime(pj.scheduledAt, localeTag(lang))}</T>{pj.youtubeUrl ? <Button small title="YouTube" icon="logo-youtube" onPress={() => void Linking.openURL(pj.youtubeUrl!)} /> : null}{pj.error ? <T size={12} tone="danger">{pj.error.message}</T> : null}</Card> : null}

      {canSchedule ? (
        <Card>
          <T weight="700">{t('clip.schedule')}</T>
          <Segmented value={privacy} onChange={setPrivacy} label={t('clip.privacy')} options={(['PUBLIC', 'UNLISTED', 'PRIVATE'] as const).map((p) => ({ value: p, label: t(`clip.privacy_${p}`) }))} />
          <Button title={pj?.status === 'PENDING_APPROVAL' ? t('clip.approve') : t('clip.schedule')} icon="calendar" disabled={!online || needsRender || !!draft?.conflict} loading={busy === 'sched'} onPress={run('sched', () => api(`/clips/${id}/schedule`, { method: 'POST', body: { privacy, ...(when ? { scheduledAt: when.toISOString() } : {}) } }))} />
          <DateTimePicker value={when ?? new Date(Date.now() + 3_600_000)} mode="datetime" display={Platform.OS === 'ios' ? 'compact' : 'default'} minimumDate={new Date()} locale={localeTag(lang)} onChange={(_, d) => d && setWhen(d)} />
          <Button variant="secondary" title={t('clip.publishNow')} icon="flash" disabled={!online || needsRender || !!draft?.conflict} onPress={run('now', () => api(`/clips/${id}/schedule`, { method: 'POST', body: { now: true, privacy } }))} />
        </Card>
      ) : null}
      {pj && ['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED', 'RETRY_WAIT'].includes(pj.status) ? <Button variant="ghost" title={t('clip.cancelSchedule')} onPress={run('cancel', () => api(`/publish-jobs/${pj.id}`, { method: 'DELETE' }))} /> : null}
      {clip.videoUrl ? <Button variant="ghost" icon="download" title={t('clip.download')} onPress={() => void api<{ url: string }>(`/clips/${id}/download`).then((r) => Linking.openURL(r.url)).catch(fail)} /> : null}
      <View style={{ height: space.xl }} />
    </Screen>
  );
}
