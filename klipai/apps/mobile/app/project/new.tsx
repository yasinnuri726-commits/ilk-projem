import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { api } from '../../src/api/client';
import { qk } from '../../src/api/hooks';
import type { Project } from '../../src/api/types';
import { ChannelPicker } from '../../src/components/ChannelPicker';
import { Button, Card, Field, ProgressBar, Row, Screen, Segmented, Stepper, T, Toggle } from '../../src/components/ui';
import { RIGHTS_ATTESTATION, RIGHTS_ATTESTATION_VERSION, RIGHTS_BASES } from '@klipai/shared';
import { useT, useLang } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';
import { useActiveChannel } from '../../src/lib/channel';
import { uploadFile } from '../../src/upload/uploader';
import { ProjectDraft, useDrafts } from '../../src/stores/drafts';
import { space } from '../../src/theme/theme';

const EMPTY: ProjectDraft = { step: 0, channelId: null, title: '', sourceType: 'UPLOAD', file: null, url: '', basis: null, details: '', accepted: false, minScore: 70, maxClips: 8, updatedAt: 0 };
const key = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export default function NewProject() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const qc = useQueryClient();
  const { channels, active } = useActiveChannel();
  const saved = useDrafts((s) => s.project);
  const [d, setD] = useState<ProjectDraft>(saved ?? EMPTY);
  const [busy, setBusy] = useState<'idle' | 'upload' | 'create'>('idle');
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState('');
  const uploadId = useRef<string | undefined>(undefined);
  const idemKey = useRef(key());

  // Çevrimdışı taslak: her değişiklik cihazda saklanır.
  useEffect(() => { useDrafts.getState().saveProject({ ...d, updatedAt: Date.now() }); }, [d]);
  const set = (p: Partial<ProjectDraft>) => setD((x) => ({ ...x, ...p }));
  const channelId = d.channelId ?? active?.id ?? null;

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['video/*', 'audio/*'], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    set({ file: { uri: a.uri, name: a.name, size: a.size ?? 0, mime: a.mimeType ?? 'video/mp4' }, title: d.title || a.name.replace(/\.[^.]+$/, '') });
  };

  const validStep = [
    d.title.trim().length > 0 && !!channelId && (d.sourceType === 'UPLOAD' ? !!d.file && d.file.size > 0 : /^https:\/\/\S+\.\w{2,5}(\?\S*)?$/.test(d.url)),
    !!d.basis && d.accepted,
    true,
    true,
  ][d.step];

  const submit = async () => {
    if (!channelId || !d.basis) return;
    setErr('');
    const net = await NetInfo.fetch();
    if (net.isConnected === false) { setErr(t('common.offline')); return; }
    try {
      let source: unknown;
      if (d.sourceType === 'UPLOAD' && d.file) {
        setBusy('upload');
        const id = await uploadFile(d.file, { existingUploadId: uploadId.current, onSession: (s) => { uploadId.current = s; }, onProgress: setPct });
        source = { type: 'UPLOAD', uploadId: id };
      } else source = { type: 'LINK', url: d.url.trim() };
      setBusy('create');
      const p = await api<Project>('/projects', {
        method: 'POST', idempotencyKey: idemKey.current,
        body: {
          channelId, title: d.title.trim(), source,
          rights: { basis: d.basis, details: d.details || undefined, attestationVersion: RIGHTS_ATTESTATION_VERSION, accepted: true },
          settingsOverride: { minScore: d.minScore, maxClipsPerVideo: d.maxClips }, autoStart: true,
        },
      });
      useDrafts.getState().dropProject();
      await qc.invalidateQueries({ queryKey: qk.projects(undefined) });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      router.replace(`/project/${p.id}`);
    } catch (e) {
      setErr(d.sourceType === 'UPLOAD' && busy === 'upload' ? `${t('wizard.uploadFailed')} (${errorMessage(e, t)})` : errorMessage(e, t));
      setBusy('idle');
    }
  };

  const attestation = RIGHTS_ATTESTATION[lang === 'tr' ? 'TR' : 'EN'];
  return (
    <Screen>
      <Stack.Screen options={{ title: t('wizard.title'), headerBackTitle: t('common.back') }} />
      <T muted>{`${t('wizard.step')} ${d.step + 1}/4 · ${[t('wizard.s1'), t('wizard.s2'), t('wizard.s3'), t('wizard.s4')][d.step]}`}</T>
      <ProgressBar value={((d.step + 1) / 4) * 100} />

      {d.step === 0 ? (
        <>
          <ChannelPicker channels={channels} value={channelId ?? undefined} onChange={(id) => set({ channelId: id })} />
          <Field label={t('wizard.projectName')} value={d.title} onChangeText={(v) => set({ title: v })} maxLength={120} />
          <Segmented value={d.sourceType} onChange={(v) => set({ sourceType: v })} options={[{ value: 'UPLOAD', label: t('wizard.pickFile') }, { value: 'LINK', label: t('wizard.orLink') }]} />
          {d.sourceType === 'UPLOAD' ? (
            <Card>
              <Button title={d.file ? d.file.name : t('wizard.pickFile')} variant="secondary" icon="cloud-upload-outline" onPress={() => void pick()} />
              {d.file ? <T size={12} muted>{`${t('wizard.fileChosen')}: ${(d.file.size / 1024 / 1024).toFixed(0)} MB`}</T> : null}
            </Card>
          ) : <Field value={d.url} onChangeText={(v) => set({ url: v })} placeholder={t('wizard.linkHint')} autoCapitalize="none" keyboardType="url" autoCorrect={false} />}
        </>
      ) : null}

      {d.step === 1 ? (
        <>
          <T weight="700" size={17}>{t('wizard.rightsTitle')}</T>
          <Segmented value={d.basis ?? ('' as never)} onChange={(v) => set({ basis: v })} options={RIGHTS_BASES.map((b) => ({ value: b, label: t(`wizard.basis_${b}`) }))} label={t('wizard.rightsTitle')} />
          <Field label={t('wizard.detailsHint')} value={d.details} onChangeText={(v) => set({ details: v })} multiline maxLength={1000} />
          <Card><T size={13} muted>{attestation}</T></Card>
          <Toggle label={t('wizard.accept')} value={d.accepted} onChange={(v) => set({ accepted: v })} hint={t('wizard.rightsNote')} />
        </>
      ) : null}

      {d.step === 2 ? (
        <>
          <T weight="700" size={17}>{t('wizard.quick')}</T>
          <Stepper label={t('wizard.minScore')} value={d.minScore} min={0} max={100} step={5} onChange={(v) => set({ minScore: v })} />
          <Stepper label={t('wizard.maxClips')} value={d.maxClips} min={1} max={30} onChange={(v) => set({ maxClips: v })} />
          <T size={12} muted>{t('wizard.channelSettingsHint')}</T>
        </>
      ) : null}

      {d.step === 3 ? (
        <Card>
          <T weight="700" size={17}>{d.title}</T>
          <T muted>{channels.find((c) => c.id === channelId)?.title}</T>
          <T muted>{d.sourceType === 'UPLOAD' ? d.file?.name : d.url}</T>
          <T muted>{`${t('wizard.rightsTitle')} ${t(`wizard.basis_${d.basis}`)}`}</T>
          <T muted>{`${t('wizard.minScore')}: ${d.minScore} · ${t('wizard.maxClips')}: ${d.maxClips}`}</T>
          <T size={12} muted>{t('project.inBackground')}</T>
        </Card>
      ) : null}

      {busy === 'upload' ? <View style={{ gap: space.sm }}><T>{`${t('wizard.uploading')} ${Math.round(pct)}%`}</T><ProgressBar value={pct} /></View> : null}
      {busy === 'create' ? <T muted>{t('wizard.creating')}</T> : null}
      {err ? <T tone="danger" accessibilityRole="alert">{err}</T> : null}
      <T size={12} muted>{t('wizard.draftSaved')}</T>

      <Row>
        {d.step > 0 ? <Button title={t('common.back')} variant="secondary" onPress={() => set({ step: d.step - 1 })} disabled={busy !== 'idle'} /> : null}
        <View style={{ flex: 1 }}>
          {d.step < 3 ? <Button title={t('common.next')} onPress={() => set({ step: d.step + 1 })} disabled={!validStep} /> : <Button title={t('wizard.start')} icon="rocket" onPress={() => void submit()} loading={busy !== 'idle'} disabled={!validStep} />}
        </View>
      </Row>
      {d.step === 0 && saved ? <Button title={t('common.cancel')} variant="ghost" onPress={() => { useDrafts.getState().dropProject(); Alert.alert(t('common.done')); router.back(); }} /> : null}
    </Screen>
  );
}
