import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Pressable, View } from 'react-native';
import { api } from '../../src/api/client';
import { useSubscription } from '../../src/api/hooks';
import { Badge, Button, Card, H1, H2, Row, Screen, Segmented, T } from '../../src/components/ui';
import { APP_VERSION, PRIVACY_URL, TERMS_URL } from '../../src/config';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';
import { useActiveChannel } from '../../src/lib/channel';
import { useAuth } from '../../src/stores/auth';
import { usePrefs } from '../../src/stores/prefs';
import { useTheme } from '../../src/theme/theme';

function Link({ icon, label, onPress, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; value?: string }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
      <Ionicons name={icon} size={22} color={c.primary} />
      <T style={{ flex: 1 }} weight="600">{label}</T>
      {value ? <T muted>{value}</T> : null}
      <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
    </Pressable>
  );
}

export default function Settings() {
  const t = useT();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const prefs = usePrefs();
  const { channels } = useActiveChannel();
  const sub = useSubscription();

  const fail = (e: unknown) => Alert.alert(t('common.error'), errorMessage(e, t));
  const patchMe = (body: object) => api('/me', { method: 'PATCH', body }).then((u) => useAuth.getState().setUser(u as never)).catch(fail);

  return (
    <Screen>
      <H1>{t('set.title')}</H1>
      <Card>
        <T weight="800" size={18}>{user?.displayName}</T>
        <T muted>{user?.email}</T>
        <Row><Badge text={sub.data ? (sub.data.role === 'DEVELOPER' ? 'DEV' : sub.data.plan) : '…'} tone="primary" /></Row>
        <Link icon="card-outline" label={t('set.subscription')} onPress={() => router.push('/subscription')} />
        <Link icon="notifications-outline" label={t('set.notifications')} onPress={() => router.push('/notifications')} />
      </Card>

      <H2>{t('set.channels')}</H2>
      <Card>
        {channels.map((ch) => (
          <View key={ch.id} style={{ gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T weight="700">{ch.title}</T>
              {ch.status !== 'ACTIVE' ? <Badge text={t(`channel.status_${ch.status}`)} tone="warning" /> : <Badge text={t(`channel.roles.${ch.role}`)} />}
            </Row>
            <Link icon="options-outline" label={t('set.profile')} onPress={() => router.push(`/channel/${ch.id}/settings`)} />
            <Link icon="people-outline" label={t('channel.team')} onPress={() => router.push(`/channel/${ch.id}/team`)} />
            {ch.role === 'OWNER' ? (
              <Button small variant="ghost" title={t('channel.disconnect')} onPress={() => Alert.alert(t('channel.disconnect'), t('channel.disconnectAsk'), [{ text: t('common.no') }, { text: t('common.yes'), style: 'destructive', onPress: () => void api(`/channels/${ch.id}`, { method: 'DELETE' }).then(() => router.replace('/connect-channel')).catch(fail) }])} />
            ) : null}
          </View>
        ))}
        <Button title={t('channel.connect')} variant="secondary" icon="logo-youtube" onPress={() => router.push('/connect-channel')} />
      </Card>

      <H2>{t('set.language')}</H2>
      <Segmented value={prefs.lang} onChange={(l) => { prefs.setLang(l); if (l !== 'system') void patchMe({ locale: l === 'tr' ? 'TR' : 'EN' }); }} options={(['system', 'tr', 'en'] as const).map((l) => ({ value: l, label: t(`set.lang_${l}`) }))} label={t('set.language')} />
      <H2>{t('set.theme')}</H2>
      <Segmented value={prefs.theme} onChange={prefs.setTheme} options={(['system', 'light', 'dark'] as const).map((m) => ({ value: m, label: t(`set.theme_${m}`) }))} label={t('set.theme')} />

      <H2>{t('set.privacy')}</H2>
      <Card>
        <Link icon="shield-checkmark-outline" label={t('set.policy')} onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} />
        <Link icon="document-text-outline" label={t('set.terms')} onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} />
        <Link icon="download-outline" label={t('set.export')} onPress={() => void api('/me/export', { method: 'POST' }).then(() => Alert.alert(t('set.exportDone'))).catch(fail)} />
        <Link icon="trash-outline" label={t('set.deleteAccount')} onPress={() => Alert.alert(t('set.deleteAccount'), t('set.deleteAsk'), [{ text: t('common.cancel') }, { text: t('common.delete'), style: 'destructive', onPress: () => void api('/me', { method: 'DELETE' }).then(() => signOut()).catch(fail) }])} />
      </Card>
      <Button title={t('auth.logout')} variant="secondary" onPress={() => void signOut()} />
      <T size={12} muted align="center">{`${t('set.version')} ${APP_VERSION}`}</T>
    </Screen>
  );
}
