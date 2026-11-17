import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, View } from 'react-native';
import { api } from '../../../src/api/client';
import { useProject } from '../../../src/api/hooks';
import { Badge, Button, Card, ErrorState, Loading, ProgressBar, Row, Screen, T } from '../../../src/components/ui';
import { useT } from '../../../src/i18n';
import { errorMessage } from '../../../src/i18n/errors';
import { space, useTheme } from '../../../src/theme/theme';

const STAGES = ['INGEST', 'ANALYZE', 'CANDIDATES', 'SCORE'] as const;

export default function ProjectProgress() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const c = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useProject(id);
  const p = q.data;
  const fail = (e: unknown) => Alert.alert(t('common.error'), errorMessage(e, t));
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['project', id] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const running = p && ['INGESTING', 'ANALYZING', 'GENERATING', 'SCORING'].includes(p.status);

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: p?.title ?? '', headerBackTitle: t('common.back') }} />
      {q.isLoading ? <Loading /> : q.isError || !p ? <ErrorState message={errorMessage(q.error, t)} onRetry={() => void q.refetch()} /> : (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <T size={20} weight="800" numberOfLines={2} style={{ flex: 1 }}>{p.title}</T>
              <Badge text={t(`project.status_${p.status}`)} tone={p.status === 'READY' ? 'success' : p.status === 'FAILED' ? 'danger' : 'primary'} />
            </Row>
            <ProgressBar value={p.progress} label={p.title} />
            <T muted>{`${p.progress}%`}</T>
            {running ? <T size={13} muted>{t('project.inBackground')}</T> : null}
            {p.error ? <T tone="danger" accessibilityRole="alert">{t(`err.${p.error.code}`) !== `err.${p.error.code}` ? t(`err.${p.error.code}`) : p.error.message}</T> : null}
          </Card>

          <Card>
            {STAGES.map((s) => {
              const st = p.stages.find((x) => x.stage === s);
              const status = st?.status;
              const icon = status === 'SUCCEEDED' ? 'checkmark-circle' : status === 'FAILED' ? 'close-circle' : status === 'RUNNING' || status === 'RETRYING' ? 'sync-circle' : 'ellipse-outline';
              const color = status === 'SUCCEEDED' ? c.success : status === 'FAILED' ? c.danger : status ? c.primary : c.textMuted;
              return (
                <Row key={s} style={{ minHeight: 40 }}>
                  <Ionicons name={icon} size={24} color={color} />
                  <View style={{ flex: 1 }}>
                    <T weight="600">{t(`stage.${s}`)}</T>
                    {status ? <T size={12} muted>{`${t(`project.stageStatus_${status}`)}${st!.attempt > 1 ? ` · ${t('project.attempt')} ${st!.attempt}` : ''}`}</T> : null}
                  </View>
                  {status === 'RUNNING' ? <T muted>{`${st!.progress}%`}</T> : null}
                </Row>
              );
            })}
          </Card>

          <View style={{ gap: space.md }}>
            {p.status === 'READY' ? <Button title={`${t('project.viewCandidates')} (${p.candidateCount})`} icon="sparkles" onPress={() => router.push(`/project/${id}/candidates`)} /> : null}
            {p.status === 'FAILED' ? <Button title={t('project.retry')} icon="refresh" onPress={() => void api(`/projects/${id}/retry`, { method: 'POST', body: {} }).then(refresh).catch(fail)} /> : null}
            {running ? <Button title={t('project.cancel')} variant="secondary" onPress={() => Alert.alert(t('project.cancel'), t('project.cancelAsk'), [{ text: t('common.no') }, { text: t('common.yes'), style: 'destructive', onPress: () => void api(`/projects/${id}/cancel`, { method: 'POST' }).then(refresh).catch(fail) }])} /> : null}
            {!running ? <Button title={t('project.delete')} variant="ghost" onPress={() => Alert.alert(t('project.delete'), t('project.deleteAsk'), [{ text: t('common.cancel') }, { text: t('common.delete'), style: 'destructive', onPress: () => void api(`/projects/${id}`, { method: 'DELETE' }).then(() => { void qc.invalidateQueries({ queryKey: ['projects'] }); router.replace('/'); }).catch(fail) }])} /> : null}
          </View>
        </>
      )}
    </Screen>
  );
}
