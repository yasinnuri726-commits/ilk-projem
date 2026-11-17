import { useQueryClient } from '@tanstack/react-query';
import { useEvent } from 'expo';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { api } from '../../../src/api/client';
import { useCandidates } from '../../../src/api/hooks';
import type { Candidate } from '../../../src/api/types';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, ProgressBar, Row, Screen, ScoreRing, Stepper, T } from '../../../src/components/ui';
import { useT } from '../../../src/i18n';
import { errorMessage } from '../../../src/i18n/errors';
import { mmss } from '../../../src/lib/format';
import { space } from '../../../src/theme/theme';

/** Proxy videoda yalnızca aday aralığını oynatır; bitişte başa sarar. */
function Preview({ url, start, end }: { url: string; start: number; end: number }) {
  const player = useVideoPlayer(url, (p) => { p.timeUpdateEventInterval = 0.25; p.currentTime = start; p.loop = false; });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => { if (currentTime >= end) { player.pause(); player.currentTime = start; } });
    return () => sub.remove();
  }, [player, start, end]);
  return (
    <View style={{ gap: space.sm }}>
      <VideoView player={player} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#000' }} nativeControls={false} contentFit="contain" accessibilityLabel="Preview" />
      <Button small variant="secondary" icon={isPlaying ? 'pause' : 'play'} title={isPlaying ? 'Pause' : 'Play'} onPress={() => { if (isPlaying) player.pause(); else { if (player.currentTime < start || player.currentTime >= end) player.currentTime = start; player.play(); } }} />
    </View>
  );
}

const CRITERIA = ['hook', 'emotion', 'standalone', 'curiosity', 'shareability'] as const;

function CandidateCard({ cand, projectId, minScore }: { cand: Candidate; projectId: string; minScore: number }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const clip = await api<{ id: string }>(`/candidates/${cand.id}/accept`, { method: 'POST', body: {} });
      await qc.invalidateQueries({ queryKey: ['candidates', projectId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      router.push(`/clip/${clip.id}`);
    } catch (e) {
      Alert.alert(t('common.error'), errorMessage(e, t));
    } finally { setBusy(false); }
  };
  const reject = () => void api(`/candidates/${cand.id}/reject`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['candidates', projectId] })).catch((e) => Alert.alert(t('common.error'), errorMessage(e, t)));
  const r = cand.rationale;
  void minScore;
  return (
    <Card>
      <Row>
        <ScoreRing score={cand.score} />
        <View style={{ flex: 1 }}>
          <T weight="700">{`${mmss(cand.startSec)} – ${mmss(cand.endSec)} · ${Math.round(cand.durationSec)}${t('common.sec')}`}</T>
          {r?.summary ? <T size={13} muted numberOfLines={open ? undefined : 2}>{r.summary}</T> : null}
        </View>
        {cand.status === 'ACCEPTED' ? <Badge text={t('cand.accepted')} tone="success" /> : null}
      </Row>
      <T size={13} numberOfLines={open ? undefined : 3} muted>{cand.text}</T>
      <Button small variant="ghost" title={open ? t('common.close') : t('cand.why')} onPress={() => setOpen(!open)} />
      {open ? (
        <View style={{ gap: space.sm }}>
          {cand.breakdown ? CRITERIA.map((k) => (
            <View key={k} style={{ gap: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}><T size={13} weight="600">{t(`cand.${k}`)}</T><T size={13} muted>{cand.breakdown![k]}</T></Row>
              <ProgressBar value={cand.breakdown![k]} label={t(`cand.${k}`)} />
              {r?.[k] ? <T size={12} muted>{r[k]}</T> : null}
            </View>
          )) : null}
          {r?.suggestedHook ? <T size={13}>{`${t('cand.suggestedHook')}: “${r.suggestedHook}”`}</T> : null}
          {r?.risks?.length ? <Card><T size={13} weight="700" tone="warning">{t('cand.risks')}</T>{r.risks.map((x) => <T key={x} size={13} muted>• {x}</T>)}</Card> : null}
          {cand.previewUrl ? <Preview url={cand.previewUrl} start={cand.startSec} end={cand.endSec} /> : null}
        </View>
      ) : null}
      <Row>
        {cand.clipId ? <Button small title={t('cand.open')} onPress={() => router.push(`/clip/${cand.clipId}`)} /> : (
          <>
            <Button small title={t('cand.accept')} icon="cut" loading={busy} onPress={() => void accept()} />
            <Button small variant="ghost" title={t('cand.reject')} onPress={reject} />
          </>
        )}
      </Row>
    </Card>
  );
}

export default function Candidates() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const q = useCandidates(id);
  const [min, setMin] = useState(0);
  const items = (q.data ?? []).filter((c) => (c.score ?? 0) >= min && c.status !== 'REJECTED');
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: t('cand.title'), headerBackTitle: t('common.back') }} />
      <Stepper label={t('cand.minScore')} value={min} min={0} max={100} step={5} onChange={setMin} />
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState message={errorMessage(q.error, t)} onRetry={() => void q.refetch()} /> : items.length === 0 ? <EmptyState text={t('cand.none')} /> : items.map((c) => <CandidateCard key={c.id} cand={c} projectId={id} minScore={min} />)}
    </Screen>
  );
}
