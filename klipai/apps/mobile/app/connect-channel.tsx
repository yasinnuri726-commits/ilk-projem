import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '../src/api/client';
import { qk } from '../src/api/hooks';
import { Button, Screen, T } from '../src/components/ui';
import { useT } from '../src/i18n';
import { errorMessage } from '../src/i18n/errors';
import { useAuth } from '../src/stores/auth';
import { usePrefs } from '../src/stores/prefs';
import { space, useTheme } from '../src/theme/theme';

export default function ConnectChannel() {
  const t = useT();
  const c = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hasChannels = (qc.getQueryData(qk.channels) as unknown[] | undefined)?.length;

  const connect = async () => {
    setBusy(true); setErr('');
    try {
      const { authUrl } = await api<{ authUrl: string }>('/channels/youtube/oauth/start', { method: 'POST' });
      // Sunucu Google'dan dönüşü alır ve klipai://oauth/youtube?status=…&channelId=… adresine yönlendirir.
      const res = await WebBrowser.openAuthSessionAsync(authUrl, Linking.createURL('oauth/youtube'));
      if (res.type === 'success') {
        const params = new URL(res.url).searchParams;
        if (params.get('status') === 'ok') {
          await qc.invalidateQueries({ queryKey: qk.channels });
          if (params.get('channelId')) usePrefs.getState().setChannel(params.get('channelId'));
          router.replace('/');
        } else {
          setErr(errorMessage({ code: params.get('code') } as never, t) === t('err.INTERNAL') ? (params.get('message') ?? t('channel.failed')) : t(`err.${params.get('code')}`));
        }
      }
    } catch (e) {
      setErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <Ionicons name="logo-youtube" size={64} color={c.danger} />
        <T size={28} weight="800">{t('channel.connectTitle')}</T>
        <T muted size={16}>{t('channel.connectInfo')}</T>
        {err ? <T tone="danger" accessibilityRole="alert">{err}</T> : null}
      </View>
      <View style={{ gap: space.md }}>
        <Button title={t('channel.connect')} icon="logo-youtube" onPress={connect} loading={busy} />
        {hasChannels ? <Button title={t('common.back')} variant="ghost" onPress={() => router.back()} /> : <Button title={t('auth.logout')} variant="ghost" onPress={() => void useAuth.getState().signOut()} />}
      </View>
    </Screen>
  );
}
