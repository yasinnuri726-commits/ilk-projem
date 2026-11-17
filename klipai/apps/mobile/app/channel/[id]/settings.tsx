import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../../../src/api/client';
import { qk, useSettings } from '../../../src/api/hooks';
import type { ChannelSettings } from '../../../src/api/types';
import { Button, Card, ErrorState, Field, H2, Loading, Row, Screen, Segmented, Stepper, T, Toggle } from '../../../src/components/ui';
import { AUTOMATION_MODES, ASPECT_RATIOS, COMMENTARY_FORMATS, COMMENTARY_TONES, LOCALES, RESOLUTIONS, SUBTITLE_POSITIONS, YOUTUBE_PRIVACIES } from '@klipai/shared';
import { useT } from '../../../src/i18n';
import { errorMessage } from '../../../src/i18n/errors';
import { splitList } from '../../../src/lib/format';

const opts = <V extends string>(list: readonly V[], t: (k: string) => string, prefix: string) => list.map((v) => ({ value: v, label: t(`${prefix}${v}`) }));
const HEX = /^#[0-9A-Fa-f]{6}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function ChannelProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const qc = useQueryClient();
  const q = useSettings(id);
  const [s, setS] = useState<ChannelSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data && !s) setS(q.data); }, [q.data, s]);

  if (q.isLoading || !s) return <Screen>{q.isError ? <ErrorState message={errorMessage(q.error, t)} onRetry={() => void q.refetch()} /> : <Loading />}</Screen>;
  const set = (p: Partial<ChannelSettings>) => setS({ ...s, ...p });
  const sub = (p: Partial<ChannelSettings['subtitle']>) => set({ subtitle: { ...s.subtitle, ...p } });
  const audio = (p: Partial<ChannelSettings['audio']>) => set({ audio: { ...s.audio, ...p } });
  const slotsOk = s.timeSlots.every((x) => HHMM.test(x.start) && HHMM.test(x.end));
  const colorsOk = HEX.test(s.subtitle.color) && HEX.test(s.subtitle.highlightColor) && s.brand.palette.every((c) => HEX.test(c));

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api<ChannelSettings>(`/channels/${id}/settings`, { method: 'PATCH', body: s });
      qc.setQueryData(qk.settings(id), saved); setS(saved);
      Alert.alert(t('prof.saved'));
    } catch (e) {
      Alert.alert(t('common.error'), errorMessage(e, t));
    } finally { setBusy(false); }
  };

  return (
    <Screen footer={<Card style={{ borderRadius: 0 }}><Button title={t('common.save')} onPress={() => void save()} loading={busy} disabled={!slotsOk || !colorsOk || s.minDurationSec > s.maxDurationSec} /></Card>} edges={[]}>
      <Stack.Screen options={{ title: t('prof.title'), headerBackTitle: t('common.back') }} />

      <H2>{t('prof.automation')}</H2>
      <Segmented value={s.automationMode} onChange={(v) => set({ automationMode: v })} options={opts(AUTOMATION_MODES, t, 'prof.mode_')} />
      <T size={12} muted>{t(`prof.modeHint_${s.automationMode}`)}</T>

      <H2>{t('prof.plan')}</H2>
      <Stepper label={t('prof.daily')} value={s.dailyClipCount} min={0} max={50} onChange={(v) => set({ dailyClipCount: v })} />
      {s.timeSlots.map((slot, i) => (
        <Row key={i}>
          <Field value={slot.start} onChangeText={(v) => set({ timeSlots: s.timeSlots.map((x, j) => (j === i ? { ...x, start: v } : x)) })} error={HHMM.test(slot.start) ? undefined : 'HH:MM'} placeholder="12:00" />
          <T>–</T>
          <Field value={slot.end} onChangeText={(v) => set({ timeSlots: s.timeSlots.map((x, j) => (j === i ? { ...x, end: v } : x)) })} error={HHMM.test(slot.end) ? undefined : 'HH:MM'} placeholder="14:00" />
          <Button small variant="ghost" title="✕" label={t('common.delete')} onPress={() => set({ timeSlots: s.timeSlots.filter((_, j) => j !== i) })} />
        </Row>
      ))}
      {s.timeSlots.length < 12 ? <Button small variant="secondary" title={t('prof.addSlot')} onPress={() => set({ timeSlots: [...s.timeSlots, { start: '18:00', end: '20:00' }] })} /> : null}
      <Field label={t('prof.timezone')} value={s.timezone} onChangeText={(v) => set({ timezone: v })} autoCapitalize="none" />
      <Toggle label={t('prof.bestTimes')} value={s.useBestTimes} onChange={(v) => set({ useBestTimes: v })} />

      <H2>{t('prof.cut')}</H2>
      <Stepper label={t('prof.minDur')} value={s.minDurationSec} min={15} max={90} step={5} onChange={(v) => set({ minDurationSec: v })} />
      <Stepper label={t('prof.maxDur')} value={s.maxDurationSec} min={15} max={90} step={5} onChange={(v) => set({ maxDurationSec: v })} />
      <Stepper label={t('prof.minScore')} value={s.minScore} min={0} max={100} step={5} onChange={(v) => set({ minScore: v })} />
      <Stepper label={t('prof.maxClips')} value={s.maxClipsPerVideo} min={1} max={30} onChange={(v) => set({ maxClipsPerVideo: v })} />

      <H2>{t('prof.format')}</H2>
      <Segmented value={s.aspectRatio} onChange={(v) => set({ aspectRatio: v })} options={opts(ASPECT_RATIOS, t, 'prof.ratio_')} />
      <Segmented value={s.resolution} onChange={(v) => set({ resolution: v })} options={opts(RESOLUTIONS, t, 'prof.res_')} />

      <H2>{t('prof.subtitle')}</H2>
      <Toggle label={t('prof.subOn')} value={s.subtitle.enabled} onChange={(v) => sub({ enabled: v })} />
      <Field label={t('prof.font')} value={s.subtitle.fontFamily} onChangeText={(v) => sub({ fontFamily: v })} />
      <Stepper label={t('prof.size')} value={s.subtitle.fontSize} min={24} max={160} step={4} onChange={(v) => sub({ fontSize: v })} />
      <Field label={t('prof.color')} value={s.subtitle.color} onChangeText={(v) => sub({ color: v })} autoCapitalize="characters" error={HEX.test(s.subtitle.color) ? undefined : '#RRGGBB'} />
      <Field label={t('prof.highlight')} value={s.subtitle.highlightColor} onChangeText={(v) => sub({ highlightColor: v })} autoCapitalize="characters" error={HEX.test(s.subtitle.highlightColor) ? undefined : '#RRGGBB'} />
      <Segmented value={s.subtitle.position} onChange={(v) => sub({ position: v })} options={opts(SUBTITLE_POSITIONS, t, 'prof.pos_')} label={t('prof.position')} />
      <Field label={t('prof.subLang')} value={s.subtitle.language} onChangeText={(v) => sub({ language: v })} autoCapitalize="none" />
      <Field label={t('prof.translate')} value={s.subtitle.translateTo ?? ''} onChangeText={(v) => sub({ translateTo: v.trim() || null })} autoCapitalize="none" />

      <H2>{t('prof.commentary')}</H2>
      <Segmented value={s.commentaryFormat} onChange={(v) => set({ commentaryFormat: v })} options={opts(COMMENTARY_FORMATS, t, 'prof.format_')} />
      {s.commentaryFormat !== 'NONE' ? (
        <>
          <Segmented value={s.commentaryTone} onChange={(v) => set({ commentaryTone: v })} options={opts(COMMENTARY_TONES, t, 'prof.tone_')} label={t('prof.tone')} />
          <Field label={t('prof.customPrompt')} value={s.commentaryPrompt ?? ''} onChangeText={(v) => set({ commentaryPrompt: v || null })} multiline maxLength={1000} />
          <Stepper label={t('prof.maxSec')} value={s.commentaryMaxSec} min={3} max={45} onChange={(v) => set({ commentaryMaxSec: v })} />
        </>
      ) : null}

      <H2>{t('prof.audio')}</H2>
      <Field label={t('prof.voice')} value={s.audio.ttsVoice} onChangeText={(v) => audio({ ttsVoice: v })} autoCapitalize="none" />
      <Stepper label={t('prof.speed')} value={s.audio.ttsSpeed} min={0.7} max={1.4} step={0.05} onChange={(v) => audio({ ttsSpeed: v })} format={(v) => `${v.toFixed(2)}×`} />
      <Field label={t('prof.music')} value={s.audio.musicGenre} onChangeText={(v) => audio({ musicGenre: v.trim() || 'none' })} autoCapitalize="none" />
      <Stepper label={t('prof.musicLevel')} value={s.audio.musicLevelDb} min={-40} max={0} step={2} onChange={(v) => audio({ musicLevelDb: v })} />

      <H2>{t('prof.brand')}</H2>
      <T size={12} muted>{t('prof.brandInfo')}</T>
      <Field label={t('prof.palette')} value={s.brand.palette.join(', ')} onChangeText={(v) => set({ brand: { ...s.brand, palette: splitList(v).slice(0, 5) } })} autoCapitalize="characters" error={s.brand.palette.every((c) => HEX.test(c)) ? undefined : '#RRGGBB'} />

      <H2>{t('prof.meta')}</H2>
      <Segmented value={s.titleLanguage} onChange={(v) => set({ titleLanguage: v })} options={LOCALES.map((l) => ({ value: l, label: l }))} label={t('prof.titleLang')} />
      <Field label={t('prof.fixedTags')} value={s.fixedTags.join(', ')} onChangeText={(v) => set({ fixedTags: splitList(v).slice(0, 20) })} autoCapitalize="none" />
      <Field label={`${t('prof.descTemplate')} (${t('prof.descHint')})`} value={s.descriptionTemplate ?? ''} onChangeText={(v) => set({ descriptionTemplate: v || null })} multiline maxLength={4000} />
      <Field label={t('prof.category')} value={s.youtubeCategoryId} onChangeText={(v) => set({ youtubeCategoryId: v.replace(/\D/g, '').slice(0, 4) })} keyboardType="number-pad" />
      <Segmented value={s.defaultPrivacy} onChange={(v) => set({ defaultPrivacy: v })} options={YOUTUBE_PRIVACIES.map((p) => ({ value: p, label: t(`clip.privacy_${p}`) }))} label={t('prof.privacy')} />
      <Toggle label={t('prof.kids')} value={s.madeForKids} onChange={(v) => set({ madeForKids: v })} />
    </Screen>
  );
}
