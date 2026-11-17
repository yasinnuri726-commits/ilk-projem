import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useSubscription, useUsage } from '../src/api/hooks';
import { Badge, Button, Card, ErrorState, H2, Loading, ProgressBar, Row, Screen, T } from '../src/components/ui';
import { localeTag, useLang, useT } from '../src/i18n';
import { errorMessage } from '../src/i18n/errors';
import { buy, isCancelled, loadOffers, Offer, restore } from '../src/lib/purchases';
import { dateTime } from '../src/lib/format';
import { useAuth } from '../src/stores/auth';
import { PLAN_LIMITS } from '@klipai/shared';

export default function Subscription() {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const sub = useSubscription();
  const usage = useUsage();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { void loadOffers().then(setOffers).catch(() => setOffers([])); }, [user?.id]);

  const done = () => { void qc.invalidateQueries({ queryKey: ['subscription'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); void qc.invalidateQueries({ queryKey: ['me'] }); };
  const purchase = async (o: Offer) => {
    setBusy(o.plan);
    try { await buy(o.pkg); done(); Alert.alert(t('sub.purchased')); } catch (e) { if (!isCancelled(e)) Alert.alert(t('common.error'), errorMessage(e, t)); } finally { setBusy(''); }
  };
  const s = sub.data;
  const limitText = (plan: 'FREE' | 'PRO' | 'AGENCY') => {
    const l = PLAN_LIMITS[plan];
    return [
      l.clipsPerMonth === null ? t('sub.unlimitedClips') : `${l.clipsPerMonth} ${t('sub.clipsPerMonth')}`,
      `${{ HD_720: '720p', FHD_1080: '1080p', UHD_4K: '4K' }[l.maxResolution]} ${t('sub.res')}`,
      `${l.maxChannels} ${t('sub.channels')}`,
      l.teamAccess ? t('sub.team') : null,
      l.watermark ? t('sub.watermark') : t('sub.noWatermark'),
    ].filter(Boolean) as string[];
  };

  return (
    <Screen onRefresh={() => { void sub.refetch(); void usage.refetch(); }} refreshing={sub.isRefetching}>
      <Stack.Screen options={{ title: t('sub.title'), headerBackTitle: t('common.back') }} />
      {sub.isLoading ? <Loading /> : sub.isError || !s ? <ErrorState message={errorMessage(sub.error, t)} onRetry={() => void sub.refetch()} /> : (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}><T weight="800" size={20}>{t(`sub.${s.plan.toLowerCase()}`)}</T><Badge text={s.status} tone="primary" /></Row>
            {s.role === 'DEVELOPER' ? <T tone="success" weight="600">{t('sub.developer')}</T> : null}
            <T size={13} muted>{`${s.willRenew ? t('sub.renews') : t('sub.ends')}: ${dateTime(s.currentPeriodEnd, localeTag(lang))}`}</T>
            <H2>{t('sub.usage')}</H2>
            <Row style={{ justifyContent: 'space-between' }}><T muted>{t('sub.creditsUsed')}</T><T>{s.usage.creditsGranted === null ? `${s.usage.creditsUsed} · ${t('home.unlimited')}` : `${s.usage.creditsUsed} / ${s.usage.creditsGranted}`}</T></Row>
            {s.usage.creditsGranted !== null ? <ProgressBar value={(s.usage.creditsUsed / Math.max(1, s.usage.creditsGranted)) * 100} label={t('sub.creditsUsed')} /> : null}
            <Row style={{ justifyContent: 'space-between' }}><T muted>{t('sub.clipsUsed')}</T><T>{s.limits.clipsPerMonth === null ? `${s.usage.clipsUsed} · ${t('home.unlimited')}` : `${s.usage.clipsUsed} / ${s.limits.clipsPerMonth}`}</T></Row>
            {s.limits.clipsPerMonth !== null ? <ProgressBar value={(s.usage.clipsUsed / s.limits.clipsPerMonth) * 100} label={t('sub.clipsUsed')} /> : null}
            <T size={12} muted>{t('sub.creditNote')}</T>
          </Card>

          {(['FREE', 'PRO', 'AGENCY'] as const).map((plan) => {
            const offer = offers?.find((o) => o.plan === plan);
            return (
              <Card key={plan} style={s.plan === plan ? { borderColor: '#6A47F5', borderWidth: 2 } : undefined}>
                <Row style={{ justifyContent: 'space-between' }}><T weight="800" size={18}>{t(`sub.${plan.toLowerCase()}`)}</T>{offer ? <T weight="700">{`${offer.price} / ${t('sub.month')}`}</T> : null}</Row>
                {limitText(plan).map((l) => <T key={l} size={13} muted>• {l}</T>)}
                {offer && s.plan !== plan && s.role !== 'DEVELOPER' ? <Button title={t('sub.choose')} loading={busy === plan} onPress={() => void purchase(offer)} /> : null}
              </Card>
            );
          })}
          {offers && offers.length === 0 && Platform.OS !== 'web' ? <T size={12} muted align="center">{t('sub.storeError')}</T> : null}
          <Button variant="secondary" title={t('sub.restore')} loading={busy === 'restore'} onPress={() => { setBusy('restore'); void restore().then(done).catch((e) => Alert.alert(t('common.error'), errorMessage(e, t))).finally(() => setBusy('')); }} />

          <H2>{t('sub.history')}</H2>
          {(usage.data?.pages.flatMap((p) => p.items) ?? []).map((u) => (
            <Row key={u.id} style={{ justifyContent: 'space-between' }}>
              <T size={13} style={{ flex: 1 }} numberOfLines={1}>{`${t(`sub.kind_${u.kind}`)}${u.projectTitle ? ` · ${u.projectTitle}` : ''}`}</T>
              <T size={13} tone={u.credits < 0 ? 'danger' : u.credits > 0 ? 'success' : undefined}>{u.credits || ''}</T>
            </Row>
          ))}
          {usage.hasNextPage ? <Button small variant="ghost" title={t('common.seeAll')} onPress={() => void usage.fetchNextPage()} /> : null}
        </>
      )}
    </Screen>
  );
}
