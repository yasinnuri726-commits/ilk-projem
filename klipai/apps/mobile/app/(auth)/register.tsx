import { useRouter } from 'expo-router';
import { useState } from 'react';
import { getLocales, getCalendars } from 'expo-localization';
import { api } from '../../src/api/client';
import type { Session } from '../../src/api/types';
import { Button, Field, H1, Screen, T } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';
import { useAuth } from '../../src/stores/auth';

export default function Register() {
  const t = useT();
  const router = useRouter();
  const signIn = useAuth((s) => s.signIn);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const valid = name.trim().length > 0 && /\S+@\S+\.\S+/.test(email) && pw.length >= 8;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const locale = getLocales()[0]?.languageCode === 'tr' ? 'TR' : 'EN';
      const timezone = getCalendars()[0]?.timeZone ?? 'Europe/Istanbul';
      await signIn(await api<Session>('/auth/register', { method: 'POST', body: { email, password: pw, displayName: name, locale, timezone }, auth: false }));
    } catch (e) {
      setErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen edges={['top', 'bottom']}>
      <H1>{t('auth.register')}</H1>
      <Field label={t('auth.name')} value={name} onChangeText={setName} textContentType="name" autoComplete="name" />
      <Field label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
      <Field label={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry textContentType="newPassword" autoComplete="new-password" />
      <T size={12} muted>{t('auth.passwordHint')}</T>
      {err ? <T tone="danger" accessibilityRole="alert">{err}</T> : null}
      <Button title={t('auth.register')} onPress={submit} loading={busy} disabled={!valid} />
      <Button title={t('auth.haveAccount')} variant="ghost" onPress={() => router.replace('/(auth)/login')} />
      <T size={12} muted align="center">{t('auth.terms')}</T>
    </Screen>
  );
}
