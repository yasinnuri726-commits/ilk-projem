import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { qk } from '../../src/api/hooks';
import { Loading, Screen } from '../../src/components/ui';
import { usePrefs } from '../../src/stores/prefs';

/** Tarayıcı oturumu dışında gelen klipai://oauth/youtube dönüşünü işler. */
export default function OAuthReturn() {
  const { status, channelId } = useLocalSearchParams<{ status?: string; channelId?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  useEffect(() => {
    void (async () => {
      if (status === 'ok') {
        await qc.invalidateQueries({ queryKey: qk.channels });
        if (channelId) usePrefs.getState().setChannel(channelId);
      }
      router.replace(status === 'ok' ? '/' : '/connect-channel');
    })();
  }, [status, channelId, qc, router]);
  return <Screen><Loading /></Screen>;
}
