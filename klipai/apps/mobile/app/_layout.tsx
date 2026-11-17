import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../src/api/client';
import { useChannels } from '../src/api/hooks';
import { SENTRY_DSN } from '../src/config';
import { useLang } from '../src/i18n';
import { useDraftSync } from '../src/offline/sync';
import { useRealtime } from '../src/realtime/socket';
import { handleNotificationTap, registerForPush } from '../src/lib/push';
import { initPurchases } from '../src/lib/purchases';
import { useAuth } from '../src/stores/auth';
import { usePrefs } from '../src/stores/prefs';
import { useIsDark, useTheme } from '../src/theme/theme';

if (SENTRY_DSN) Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1, enableNativeFramesTracking: false });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000, gcTime: 10 * 60_000,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
});

function Gate() {
  const c = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const hydrated = usePrefs((s) => s.hydrated);
  const lang = useLang();
  const channels = useChannels();
  useRealtime();
  useDraftSync();

  useEffect(() => { void useAuth.getState().bootstrap(); }, []);

  useEffect(() => {
    if (status !== 'authed' || !user) return;
    void registerForPush(lang === 'tr' ? 'TR' : 'EN').catch(() => undefined);
    void initPurchases(user);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => handleNotificationTap(r.notification.request.content.data));
    return () => sub.remove();
  }, [status, user, lang]);

  const group = segments[0] as string | undefined;
  useEffect(() => {
    if (status === 'loading' || !hydrated) return;
    const inAuth = group === '(auth)';
    if (status === 'guest' && !inAuth) router.replace('/(auth)/welcome');
    else if (status === 'authed' && inAuth) router.replace('/');
    else if (status === 'authed' && channels.data && channels.data.length === 0 && group !== 'connect-channel' && group !== 'oauth') router.replace('/connect-channel');
  }, [status, hydrated, group, channels.data, router]);

  if (status === 'loading' || !hydrated) {
    return <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.primary} /></View>;
  }
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerTitleStyle: { fontWeight: '700' }, contentStyle: { backgroundColor: c.bg }, headerShadowVisible: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="connect-channel" options={{ headerShown: false }} />
    </Stack>
  );
}

function Root() {
  const dark = useIsDark();
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Gate />
    </>
  );
}

export default function Layout() {
  const [client] = useState(() => queryClient);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={client}>
          <Root />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
