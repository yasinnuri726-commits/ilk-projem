import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { api } from '../src/api/client';
import { useNotifications } from '../src/api/hooks';
import { Button, Card, EmptyState, ErrorState, Loading, Row, Screen, T } from '../src/components/ui';
import { localeTag, useLang, useT } from '../src/i18n';
import { errorMessage } from '../src/i18n/errors';
import { dateTime } from '../src/lib/format';
import { useTheme } from '../src/theme/theme';

export default function Notifications() {
  const t = useT();
  const c = useTheme();
  const lang = useLang();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useNotifications();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); void qc.invalidateQueries({ queryKey: ['unread'] }); };

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: t('notif.title'), headerBackTitle: t('common.back') }} />
      {items.some((n) => !n.readAt) ? <Button small variant="secondary" title={t('notif.markAll')} onPress={() => void api('/notifications/read', { method: 'POST', body: { all: true } }).then(refresh)} /> : null}
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState message={errorMessage(q.error, t)} onRetry={() => void q.refetch()} /> : !items.length ? <EmptyState icon="notifications-off-outline" text={t('notif.none')} /> : items.map((n) => (
        <Pressable key={n.id} accessibilityRole="button" onPress={() => { if (!n.readAt) void api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).then(refresh); if (n.deepLink?.startsWith('/')) router.push(n.deepLink as never); }}>
          <Card style={{ borderColor: n.readAt ? c.border : c.primary }}>
            <T weight={n.readAt ? '400' : '700'}>{t(`notif.${n.type}`, n.params)}</T>
            <Row><T size={12} muted>{dateTime(n.createdAt, localeTag(lang))}</T></Row>
          </Card>
        </Pressable>
      ))}
      {q.hasNextPage ? <Button variant="secondary" title={t('common.seeAll')} loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
    </Screen>
  );
}
