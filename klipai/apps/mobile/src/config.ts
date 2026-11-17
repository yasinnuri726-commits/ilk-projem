import Constants from 'expo-constants';

const fromEnv = process.env.EXPO_PUBLIC_API_URL;
export const API_URL = (fromEnv ?? 'http://localhost:3000/v1').replace(/\/$/, '');
export const WS_URL = API_URL.replace(/\/v1$/, '');
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
export const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '';
export const RC_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
export const RC_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
export const EAS_PROJECT_ID: string | undefined = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId || undefined;
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
export const PRIVACY_URL = 'https://klipai.app/privacy';
export const TERMS_URL = 'https://klipai.app/terms';
