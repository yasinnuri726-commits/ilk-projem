import type { ExpoConfig } from 'expo/config';

const projectId = process.env.EAS_PROJECT_ID ?? '';

const config: ExpoConfig = {
  name: 'KlipAI',
  slug: 'klipai',
  scheme: 'klipai',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: 'app.klipai.mobile',
    buildNumber: '1',
    supportsTablet: false,
    infoPlist: {
      NSPhotoLibraryUsageDescription: 'Analiz edilecek videoyu seçmek için galeriye erişim gerekir.',
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ['remote-notification'],
    },
  },
  android: {
    package: 'app.klipai.mobile',
    versionCode: 1,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0B0B12' },
    permissions: ['POST_NOTIFICATIONS'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    'expo-video',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 180, backgroundColor: '#0B0B12', dark: { backgroundColor: '#0B0B12' } }],
    'expo-web-browser',
    ['expo-notifications', { color: '#7C5CFF' }],
    ['expo-build-properties', { ios: { deploymentTarget: '16.4' }, android: { minSdkVersion: 29 } }],
    ...(process.env.SENTRY_ORG ? [['@sentry/react-native/expo', { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT }] as [string, object]] : []),
  ],
  extra: { eas: { projectId } },
  updates: { fallbackToCacheTimeout: 0 },
  runtimeVersion: { policy: 'appVersion' },
};

export default config;
