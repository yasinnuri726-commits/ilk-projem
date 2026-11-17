import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useStats } from '../../src/api/hooks';
import { ChannelPicker } from '../../src/components/ChannelPicker';
import { Card, EmptyState, ErrorState, H1, H2, Loading, Row, Screen, Segmented, T } from '../../src/components/ui';
import { localeTag, useLang, useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';
import { useActiveChannel } from '../../src/lib/channel';
import { compact } from '../../src/lib/format';
import { space, useTheme } from '../../src/theme/theme';

export default function Stats() {
  const t = useT();
  const c = useTheme();
  const lang = useLang();
  const router = useRouter();
  const { channels, active, setChannel } = useActiveChannel();
  const [range, setRange] = useState<'7d' | '28d' | '90d'>('28d');
  const q = useStats(active?.id, range);
  const loc = localeTag(lang);
  const d = q.data;
  const max = Math.max(1, ...(d?.series.map((s) => s.views) ?? [1]));

  const tile = (label: string, value: string) => (
    <Card style={{ flex: 1, minWidth: '45%', padding: space.md }}><T size={12} muted>{label}</T><T size={22} weight="800">{value}</T></Card>
  );
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <H1>{t('stats.title')}</H1>
      <ChannelPicker channels={channels} value={active?.id} onChange={setChannel} />
      <Segmented value={range} onChange={setRange} options={[{ value: '7d', label: t('stats.range7') }, { value: '28d', label: t('stats.range28') }, { value: '90d', label: t('stats.range90') }]} />
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState message={errorMessage(q.error, t)} onRetry={() => void q.refetch()} /> : d ? (
        d.totals.clipsPublished === 0 ? <EmptyState icon="stats-chart-outline" text={t('stats.none')} /> : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              {tile(t('stats.views'), compact(d.totals.views, loc))}
              {tile(t('stats.likes'), compact(d.totals.likes, loc))}
              {tile(t('stats.comments'), compact(d.totals.comments, loc))}
              {tile(t('stats.subs'), compact(d.totals.subscribersGained, loc))}
              {tile(t('stats.clips'), String(d.totals.clipsPublished))}
              {tile(t('stats.retention'), d.totals.avgViewPct === null ? '–' : `${d.totals.avgViewPct}%`)}
            </View>
            <Card label={t("stats.views")}>
              <T weight="700">{t('stats.views')}</T>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 2 }} accessibilityElementsHidden>
                {d.series.map((s) => <View key={s.date} style={{ flex: 1, height: Math.max(2, (s.views / max) * 110), backgroundColor: c.primary, borderRadius: 2, opacity: s.views ? 1 : 0.25 }} />)}
              </View>
              <Row style={{ justifyContent: 'space-between' }}><T size={11} muted>{d.series[0]?.date}</T><T size={11} muted>{d.series.at(-1)?.date}</T></Row>
            </Card>
            {d.insight ? (
              <Card>
                <T weight="700">{t('stats.insight')}</T>
                <T muted>{d.insight}</T>
                <T size={12} muted>{t('stats.insightHint')}</T>
              </Card>
            ) : null}
            <H2>{t('stats.top')}</H2>
            {d.topClips.map((cl, i) => (
              <Card key={cl.clipId} onPress={() => router.push(`/clip/${cl.clipId}`)} label={cl.title}>
                <Row>
                  <T weight="800" size={18} muted>{i + 1}</T>
                  {cl.thumbnailUrl ? <Image source={cl.thumbnailUrl} style={{ width: 44, height: 78, borderRadius: 6 }} contentFit="cover" accessibilityLabel={cl.title} /> : null}
                  <View style={{ flex: 1 }}>
                    <T weight="600" numberOfLines={2}>{cl.title}</T>
                    <T size={12} muted>{compact(cl.views, loc)} {t('stats.views').toLowerCase()}{cl.score !== null ? ` · ${t('cand.score')} ${cl.score}` : ''}</T>
                  </View>
                </Row>
              </Card>
            ))}
          </>
        )
      ) : null}
    </Screen>
  );
}
