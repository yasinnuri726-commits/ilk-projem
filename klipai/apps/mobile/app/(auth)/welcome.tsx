import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, Screen, T } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { space, useTheme } from '../../src/theme/theme';

export default function Welcome() {
  const t = useT();
  const c = useTheme();
  const router = useRouter();
  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden>
          <Ionicons name="cut" size={36} color={c.onPrimary} />
        </View>
        <T size={40} weight="900">{t('appName')}</T>
        <T size={18} muted>{t('auth.tagline')}</T>
      </View>
      <View style={{ gap: space.md }}>
        <Button title={t('auth.start')} onPress={() => router.push('/(auth)/register')} />
        <Button title={t('auth.haveAccount')} variant="secondary" onPress={() => router.push('/(auth)/login')} />
        <Link href="/(auth)/login"><T size={12} muted align="center">{t('auth.terms')}</T></Link>
      </View>
    </Screen>
  );
}
