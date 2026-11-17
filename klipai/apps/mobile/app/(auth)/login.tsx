import { Link, useRouter } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { api } from '../../src/api/client';
import type { Session } from '../../src/api/types';
import { Button, Field, H1, Screen, T } from '../../src/components/ui';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../../src/config';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';
import { useAuth } from '../../src/stores/auth';

WebBrowser.maybeCompleteAuthSession();

export default function Login() {
  const t = useT();
  const router = useRouter();
  const signIn = useAuth((s) => s.signIn);
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const googleEnabled = !!GOOGLE_WEB_CLIENT_ID;
  const [req, res, prompt] = Google.useIdTokenAuthRequest({ clientId: GOOGLE_WEB_CLIENT_ID || 'unset', iosClientId: GOOGLE_IOS_CLIENT_ID || undefined, androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined });

  useEffect(() => {
    if (res?.type !== 'success') return;
    const idToken = res.params.id_token;
    setBusy(true);
    api<Session>('/auth/google', { method: 'POST', body: { idToken }, auth: false }).then(signIn).catch((e) => setErr(errorMessage(e, t))).finally(() => setBusy(false));
  }, [res, signIn, t]);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await signIn(await api<Session>('/auth/login', { method: 'POST', body: { email: id, password: pw }, auth: false }));
    } catch (e) {
      setErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <H1>{t('auth.login')}</H1>
      <Field label={t('auth.emailOrUser')} value={id} onChangeText={setId} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="username" />
      <Field label={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry textContentType="password" autoComplete="password" onSubmitEditing={submit} />
      {err ? <T tone="danger" accessibilityRole="alert">{err}</T> : null}
      <Button title={t('auth.login')} onPress={submit} loading={busy} disabled={!id || !pw} />
      {googleEnabled ? <Button title={t('auth.google')} variant="secondary" icon="logo-google" onPress={() => void prompt()} disabled={!req || busy} /> : null}
      <Link href="/(auth)/forgot"><T tone="primary" weight="600" align="center">{t('auth.forgot')}</T></Link>
      <Button title={t('auth.register')} variant="ghost" onPress={() => router.replace('/(auth)/register')} />
    </Screen>
  );
}
