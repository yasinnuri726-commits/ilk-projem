import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useDashboard, useUnreadCount } from '../../src/api/hooks';
import type { Clip, Project, PublishJob } from '../../src/api/types';
import { ChannelPicker } from '../../src/components/ChannelPicker';
import { Badge, Button, Card, EmptyState, ErrorState, H2, Loading, OfflineBanner, ProgressBar, Row, Screen, T } from '../../src/components/ui';
import { localeTag, useLang, useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';
import { useActiveChannel } from '../../src/lib/channel';
import { dateTime, compact } from '../../src/lib/format';
import { useOnline } from '../../src/offline/sync';
import { useAuth } from '../../src/stores/auth';
import { space, useTheme } from '../../src/theme/theme';

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <Card style={{ flex: 1, minWidth: '45%', padding: space.md }}>
      <T size={12} muted>{label}</T>
      <T size={24} weight="800" tone={tone}>{value}</T>
    </Card>
  );
}

export default function Home() {
  const t = useT();
  const c = useTheme();
  const router = useRouter();
  const lang = useLang();
  const user = useAuth((s) => s.user);
  const { channels, active, setChannel } = useActiveChannel();
  const q = useDashboard(active?.id);
  const unread = useUnreadCount();
  const online = useOnline();
  const d = q.data;

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching} padded={false} edges={['top']}>
      <OfflineBanner offline={!online} />
      <View style={{ padding: space.lg, gap: space.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T size={13} muted>{t('home.today')}</T>
            <T size={24} weight="800" numberOfLines={1}>{user?.displayName ?? ''}</T>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('notif.title')} onPress={() => router.push('/notifications')} hitSlop={10}>
            <Ionicons name="notifications-outline" size={26} color={c.text} />
            {unread.data ? (
              <View style={{ position: 'absolute', top: -4, right: -6, backgroundColor: c.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <T size={11} weight="800" color="#fff">{unread.data > 99 ? '99+' : unread.data}</T>
              </View>
            ) : null}
          </Pressable>
        </Row>

        <ChannelPicker channels={channels} value={active?.id} onChange={setChannel} />
        <Button title={t('home.newProject')} icon="add-circle" onPress={() => router.push('/project/new')} />

        {q.isLoading ? <Loading /> : q.isError && !d ? <ErrorState message={errorMessage(q.error, t)} onRetry={() => void q.refetch()} /> : d ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              <Stat label={t('home.published')} value={d.today.published} tone="success" />
              <Stat label={t('home.scheduled')} value={d.today.scheduled} />
              <Stat label={t('home.approval')} value={d.today.awaitingApproval} tone={d.today.awaitingApproval ? 'warning' : undefined} />
              <Stat label={t('home.failed')} value={d.today.failed} tone={d.today.failed ? 'danger' : undefined} />
            </View>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <T weight="700">{t('home.credits')}</T>
                <T muted>{d.credits.granted === null ? t('home.unlimited') : `${d.credits.used} / ${d.credits.granted} ${t('common.min')}`}</T>
              </Row>
              {d.credits.granted !== null ? <ProgressBar value={(d.credits.used / Math.max(1, d.credits.granted)) * 100} label={t('home.credits')} /> : null}
              <Row style={{ justifyContent: 'space-between' }}>
                <T muted>{t('home.clips')}</T>
                <T muted>{d.credits.clipLimit === null ? `${d.credits.clipsUsed} · ${t('home.unlimited')}` : `${d.credits.clipsUsed} / ${d.credits.clipLimit}`}</T>
              </Row>
              <T size={12} muted>{`${t('home.views24h')}: ${compact(d.today.views24h, localeTag(lang))}`}</T>
            </Card>

            <H2>{t('home.queue')}</H2>
            {d.queue.projects.length + d.queue.rendering.length === 0 ? <EmptyState icon="film-outline" text={t('home.noQueue')} /> : null}
            {d.queue.projects.map((p: Project) => (
              <Card key={p.id} onPress={() => router.push(`/project/${p.id}`)} label={p.title}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T weight="700" numberOfLines={1} style={{ flex: 1 }}>{p.title}</T>
                  <Badge text={t(`project.status_${p.status}`)} tone="primary" />
                </Row>
                <ProgressBar value={p.progress} label={p.title} />
                {p.currentStage ? <T size={12} muted>{t(`stage.${p.currentStage}`)} · {p.progress}%</T> : null}
              </Card>
            ))}
            {d.queue.rendering.map((cl: Clip) => (
              <Card key={cl.id} onPress={() => router.push(`/clip/${cl.id}`)} label={cl.title ?? t('clip.title')}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T weight="700" numberOfLines={1} style={{ flex: 1 }}>{cl.title ?? t('clip.title')}</T>
                  <Badge text={t('home.rendering')} tone="primary" />
                </Row>
                {cl.renderStage ? <T size={12} muted>{t(`stage.${cl.renderStage}`)}</T> : null}
              </Card>
            ))}

            {d.queue.upcoming.length ? <H2>{t('home.upcoming')}</H2> : null}
            {d.queue.upcoming.map((j: PublishJob) => (
              <Card key={j.id} onPress={() => router.push(`/clip/${j.clipId}`)} label={j.title}>
                <T weight="700" numberOfLines={1}>{j.title}</T>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T size={12} muted>{dateTime(j.scheduledAt, localeTag(lang))}</T>
                  <Badge text={t(`cal.status_${j.status}`)} tone={j.status === 'PENDING_APPROVAL' ? 'warning' : 'muted'} />
                </Row>
              </Card>
            ))}
          </>
        ) : null}
      </View>
    </Screen>
  );
}
