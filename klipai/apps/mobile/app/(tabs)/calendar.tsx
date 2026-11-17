import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { api } from '../../src/api/client';
import { usePublishJobs } from '../../src/api/hooks';
import type { PublishJob } from '../../src/api/types';
import { ChannelPicker } from '../../src/components/ChannelPicker';
import { Badge, Button, Card, EmptyState, H1, Loading, Row, Screen, T } from '../../src/components/ui';
import { localeTag, useLang, useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';
import { useActiveChannel } from '../../src/lib/channel';
import { dayKey, dateTime } from '../../src/lib/format';
import { radius, useTheme } from '../../src/theme/theme';

const tone = (s: string) => (s === 'PUBLISHED' ? 'success' : s === 'FAILED' ? 'danger' : s === 'PENDING_APPROVAL' || s === 'QUOTA_DEFERRED' || s === 'RETRY_WAIT' ? 'warning' : 'muted') as 'success' | 'danger' | 'warning' | 'muted';

export default function Calendar() {
  const t = useT();
  const c = useTheme();
  const lang = useLang();
  const router = useRouter();
  const qc = useQueryClient();
  const { channels, active, setChannel } = useActiveChannel();
  const [selected, setSelected] = useState(() => new Date());
  const [editing, setEditing] = useState<PublishJob | null>(null);

  const start = useMemo(() => { const d = new Date(selected); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay() + 1 - (d.getDay() === 0 ? 7 : 0)); return d; }, [selected]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000)), [start]);
  const end = useMemo(() => new Date(start.getTime() + 7 * 86_400_000), [start]);
  const jobs = usePublishJobs(active?.id, start, end);
  const quota = useQuery({ queryKey: ['quota', active?.id], enabled: !!active, queryFn: () => api<{ used: number; limit: number; remainingUploads: number }>(`/channels/${active!.id}/quota`) });
  const byDay = useMemo(() => {
    const m = new Map<string, PublishJob[]>();
    for (const j of jobs.data ?? []) m.set(dayKey(new Date(j.scheduledAt)), [...(m.get(dayKey(new Date(j.scheduledAt))) ?? []), j]);
    return m;
  }, [jobs.data]);
  const dayJobs = byDay.get(dayKey(selected)) ?? [];
  const fmt = new Intl.DateTimeFormat(localeTag(lang), { weekday: 'short' });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['publish'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const fail = (e: unknown) => Alert.alert(t('common.error'), errorMessage(e, t));

  const act = (fn: () => Promise<unknown>) => () => void fn().then(refresh).catch(fail);
  const cancel = (j: PublishJob) => Alert.alert(t('cal.cancel'), j.title, [{ text: t('common.no') }, { text: t('common.yes'), style: 'destructive', onPress: act(() => api(`/publish-jobs/${j.id}`, { method: 'DELETE' })) }]);

  return (
    <Screen onRefresh={refresh} refreshing={jobs.isRefetching}>
      <H1>{t('cal.title')}</H1>
      <ChannelPicker channels={channels} value={active?.id} onChange={setChannel} />
      {quota.data ? <T size={12} muted>{`${t('cal.quota')}: ${quota.data.used}/${quota.data.limit} · ${quota.data.remainingUploads} ${t('cal.uploadsLeft')}`}</T> : null}

      <Row style={{ justifyContent: 'space-between' }}>
        <Button title="‹" small variant="secondary" label="Previous week" onPress={() => setSelected(new Date(selected.getTime() - 7 * 86_400_000))} />
        <Pressable accessibilityRole="button" onPress={() => setSelected(new Date())}><T weight="700">{new Intl.DateTimeFormat(localeTag(lang), { month: 'long', year: 'numeric' }).format(selected)}</T></Pressable>
        <Button title="›" small variant="secondary" label="Next week" onPress={() => setSelected(new Date(selected.getTime() + 7 * 86_400_000))} />
      </Row>
      <Row gap={6}>
        {days.map((d) => {
          const on = dayKey(d) === dayKey(selected);
          const n = byDay.get(dayKey(d))?.length ?? 0;
          return (
            <Pressable key={d.toISOString()} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${fmt.format(d)} ${d.getDate()}, ${n}`} onPress={() => setSelected(d)}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border }}>
              <T size={11} color={on ? c.onPrimary : c.textMuted}>{fmt.format(d)}</T>
              <T size={17} weight="800" color={on ? c.onPrimary : c.text}>{d.getDate()}</T>
              <View style={{ height: 6, width: 6, borderRadius: 3, backgroundColor: n ? (on ? c.onPrimary : c.primary) : 'transparent' }} />
            </Pressable>
          );
        })}
      </Row>

      {jobs.isLoading ? <Loading /> : dayJobs.length === 0 ? <EmptyState icon="calendar-outline" text={t('cal.empty')} /> : dayJobs.map((j) => (
        <Card key={j.id} onPress={() => router.push(`/clip/${j.clipId}`)} label={j.title}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T weight="800" size={17}>{new Intl.DateTimeFormat(localeTag(lang), { hour: '2-digit', minute: '2-digit' }).format(new Date(j.scheduledAt))}</T>
            <Badge text={t(`cal.status_${j.status}`)} tone={tone(j.status)} />
          </Row>
          <T numberOfLines={2} weight="600">{j.title}</T>
          {j.status === 'UPLOADING' ? <T size={12} muted>{j.uploadProgress}%</T> : null}
          {j.error ? <T size={12} tone="danger">{j.error.message}</T> : null}
          <Row style={{ flexWrap: 'wrap' }}>
            {j.status === 'PENDING_APPROVAL' ? <Button small title={t('cal.approve')} onPress={act(() => api(`/clips/${j.clipId}/schedule`, { method: 'POST', body: {} }))} /> : null}
            {['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED'].includes(j.status) ? <Button small variant="secondary" title={t('cal.reschedule')} onPress={() => setEditing(j)} /> : null}
            {j.status === 'FAILED' ? <Button small title={t('cal.retry')} onPress={act(() => api(`/publish-jobs/${j.id}/retry`, { method: 'POST' }))} /> : null}
            {['PENDING_APPROVAL', 'SCHEDULED', 'QUOTA_DEFERRED', 'RETRY_WAIT'].includes(j.status) ? <Button small variant="ghost" title={t('cal.cancel')} onPress={() => cancel(j)} /> : null}
            {j.youtubeUrl ? <T size={12} muted>{dateTime(j.publishedAt ?? j.scheduledAt, localeTag(lang))}</T> : null}
          </Row>
        </Card>
      ))}

      {editing ? (
        <Card>
          <T weight="700">{t('cal.reschedule')}</T>
          <DateTimePicker
            value={new Date(editing.scheduledAt)} mode="datetime" display={Platform.OS === 'ios' ? 'inline' : 'default'} minimumDate={new Date()} locale={localeTag(lang)}
            onChange={(ev, date) => {
              if (Platform.OS === 'android') setEditing(null);
              if (ev.type === 'set' && date) { const job = editing; if (Platform.OS === 'ios') setEditing({ ...job, scheduledAt: date.toISOString() }); else void api(`/publish-jobs/${job.id}`, { method: 'PATCH', body: { scheduledAt: date.toISOString() } }).then(refresh).catch(fail); }
            }}
          />
          {Platform.OS === 'ios' ? (
            <Row>
              <Button small title={t('common.save')} onPress={() => { const j = editing; setEditing(null); void api(`/publish-jobs/${j.id}`, { method: 'PATCH', body: { scheduledAt: j.scheduledAt } }).then(refresh).catch(fail); }} />
              <Button small variant="ghost" title={t('common.cancel')} onPress={() => setEditing(null)} />
            </Row>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
