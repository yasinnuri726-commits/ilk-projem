import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { api } from '../api/client';
import { APP_VERSION, EAS_PROJECT_ID } from '../config';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** İzin ister, Expo push token'ını alır ve sunucuya kaydeder. Simülatörde ve izin reddinde sessizce çıkar. */
export async function registerForPush(locale: 'TR' | 'EN'): Promise<void> {
  if (!Device.isDevice) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'KlipAI', importance: Notifications.AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted' || !EAS_PROJECT_ID) return;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })).data;
  await api('/me/devices', { method: 'POST', body: { platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID', pushToken: token, locale, appVersion: APP_VERSION } });
}

/** Bildirime dokunulunca derin bağlantıya gider (ör. /clip/abc). */
export function handleNotificationTap(data: Record<string, unknown> | undefined) {
  const link = typeof data?.deepLink === 'string' ? data.deepLink : null;
  if (link?.startsWith('/')) router.push(link as never);
}
