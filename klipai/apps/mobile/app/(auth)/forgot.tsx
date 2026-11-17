import { useState } from 'react';
import { api } from '../../src/api/client';
import { Button, Field, H1, Screen, T } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';

export default function Forgot() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email }, auth: false });
      setSent(true);
    } catch (e) {
      setErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen edges={['top', 'bottom']}>
      <H1>{t('auth.forgotTitle')}</H1>
      <T muted>{t('auth.forgotInfo')}</T>
      <Field label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      {err ? <T tone="danger">{err}</T> : null}
      {sent ? <T tone="success" accessibilityRole="alert">{t('auth.forgotSent')}</T> : null}
      <Button title={t('auth.send')} onPress={submit} loading={busy} disabled={!/\S+@\S+\.\S+/.test(email)} />
    </Screen>
  );
}
