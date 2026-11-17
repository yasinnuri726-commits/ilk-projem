import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '../../src/api/client';
import { Button, Field, H1, Screen, T } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';

/** klipai://reset-password?token=… derin bağlantısının hedefi. */
export default function Reset() {
  const t = useT();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [pw, setPw] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password: pw }, auth: false });
      setDone(true);
    } catch (e) {
      setErr(errorMessage(e, t));
    }
  };
  return (
    <Screen edges={['top', 'bottom']}>
      <H1>{t('auth.resetTitle')}</H1>
      <Field label={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry textContentType="newPassword" />
      {err ? <T tone="danger">{err}</T> : null}
      {done ? <T tone="success">{t('auth.resetDone')}</T> : null}
      {done ? <Button title={t('auth.login')} onPress={() => router.replace('/(auth)/login')} /> : <Button title={t('common.save')} onPress={submit} disabled={pw.length < 8 || !token} />}
    </Screen>
  );
}
