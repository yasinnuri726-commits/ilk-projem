import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../../../src/api/client';
import { qk, useMembers } from '../../../src/api/hooks';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Loading, Row, Screen, Segmented, T } from '../../../src/components/ui';
import { useT } from '../../../src/i18n';
import { errorMessage } from '../../../src/i18n/errors';

export default function Team() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const qc = useQueryClient();
  const q = useMembers(id);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');
  const [busy, setBusy] = useState(false);
  const done = () => void qc.invalidateQueries({ queryKey: qk.members(id) });
  const fail = (e: unknown) => Alert.alert(t('common.error'), errorMessage(e, t));

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: t('channel.team'), headerBackTitle: t('common.back') }} />
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState message={errorMessage(q.error, t)} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState text={t('common.empty')} /> : q.data.map((m) => (
        <Card key={m.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T weight="700" numberOfLines={1} style={{ flex: 1 }}>{m.displayName ?? m.email}</T>
            <Badge text={t(`channel.roles.${m.role}`)} tone={m.role === 'OWNER' ? 'primary' : 'muted'} />
          </Row>
          <T size={12} muted>{m.email}{!m.acceptedAt ? ` · ${t('channel.pending')}` : ''}</T>
          {m.role !== 'OWNER' ? (
            <Row>
              <Button small variant="secondary" title={m.role === 'EDITOR' ? t('channel.roles.VIEWER') : t('channel.roles.EDITOR')} onPress={() => void api(`/channels/${id}/members/${m.id}`, { method: 'PATCH', body: { role: m.role === 'EDITOR' ? 'VIEWER' : 'EDITOR' } }).then(done).catch(fail)} />
              <Button small variant="ghost" title={t('common.delete')} onPress={() => void api(`/channels/${id}/members/${m.id}`, { method: 'DELETE' }).then(done).catch(fail)} />
            </Row>
          ) : null}
        </Card>
      ))}
      <Card>
        <Field label={t('channel.inviteEmail')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Segmented value={role} onChange={setRole} options={[{ value: 'EDITOR', label: t('channel.roles.EDITOR') }, { value: 'VIEWER', label: t('channel.roles.VIEWER') }]} />
        <Button title={t('channel.invite')} loading={busy} disabled={!/\S+@\S+\.\S+/.test(email)} onPress={() => { setBusy(true); void api(`/channels/${id}/members`, { method: 'POST', body: { email, role } }).then(() => { setEmail(''); done(); }).catch(fail).finally(() => setBusy(false)); }} />
      </Card>
    </Screen>
  );
}
