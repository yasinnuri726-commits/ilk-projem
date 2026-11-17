import { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../../src/api/client';
import { qk, useAction, useSettings, useTemplates } from '../../src/api/hooks';
import { Badge, Button, Card, EmptyState, Field, H1, Loading, Row, Screen, Segmented, T } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/i18n/errors';
import { useActiveChannel } from '../../src/lib/channel';

type Kind = 'SUBTITLE' | 'COMMENTARY' | 'METADATA' | 'BRAND';
const KINDS: Kind[] = ['SUBTITLE', 'COMMENTARY', 'METADATA', 'BRAND'];

/** Şablon yapılandırmasını kanal ayarlarına eşler. */
function settingsPatchFor(kind: Kind, config: Record<string, unknown>, current: Record<string, unknown>) {
  if (kind === 'SUBTITLE') return { subtitle: { ...(current.subtitle as object), ...config } };
  if (kind === 'BRAND') return { brand: { ...(current.brand as object), ...config } };
  return config; // COMMENTARY ve METADATA şablonları doğrudan üst düzey alanlardır
}
function configFromSettings(kind: Kind, s: Record<string, unknown>): Record<string, unknown> {
  if (kind === 'SUBTITLE') { const { fontFamily, fontSize, color, highlightColor, position } = s.subtitle as Record<string, unknown>; return { fontFamily, fontSize, color, highlightColor, position }; }
  if (kind === 'BRAND') return { ...(s.brand as object) };
  if (kind === 'COMMENTARY') return { commentaryFormat: s.commentaryFormat, commentaryTone: s.commentaryTone, commentaryMaxSec: s.commentaryMaxSec, commentaryPrompt: s.commentaryPrompt };
  return { descriptionTemplate: s.descriptionTemplate, youtubeCategoryId: s.youtubeCategoryId, fixedTags: s.fixedTags };
}

export default function Templates() {
  const t = useT();
  const [kind, setKind] = useState<Kind>('SUBTITLE');
  const [name, setName] = useState('');
  const { active } = useActiveChannel();
  const q = useTemplates(kind);
  const settings = useSettings(active?.id);
  const save = useAction((v: { name: string; config: Record<string, unknown> }) => api('/templates', { method: 'POST', body: { kind, name: v.name, channelId: active?.id ?? null, config: v.config } }), [qk.templates(kind)]);
  const apply = (config: Record<string, unknown>) => {
    if (!active || !settings.data) return;
    api(`/channels/${active.id}/settings`, { method: 'PATCH', body: settingsPatchFor(kind, config, settings.data as unknown as Record<string, unknown>) })
      .then(() => { void settings.refetch(); Alert.alert(t('tpl.applied')); }).catch((e) => Alert.alert(t('common.error'), errorMessage(e, t)));
  };
  const remove = (id: string) => Alert.alert(t('tpl.deleteAsk'), '', [{ text: t('common.no') }, { text: t('common.yes'), style: 'destructive', onPress: () => void api(`/templates/${id}`, { method: 'DELETE' }).then(() => q.refetch()) }]);

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <H1>{t('tpl.title')}</H1>
      <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`tpl.${k}`) }))} />
      {q.isLoading ? <Loading /> : q.data?.length ? q.data.map((tpl) => (
        <Card key={tpl.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T weight="700">{tpl.name}</T>
            <Badge text={tpl.isSystem ? t('tpl.system') : t('tpl.mine')} tone={tpl.isSystem ? 'muted' : 'primary'} />
          </Row>
          <T size={12} muted numberOfLines={2}>{Object.entries(tpl.config).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</T>
          <Row>
            <Button small title={t('tpl.apply')} disabled={!active || !settings.data} onPress={() => apply(tpl.config)} />
            {!tpl.isSystem ? <Button small variant="ghost" title={t('common.delete')} onPress={() => remove(tpl.id)} /> : null}
          </Row>
        </Card>
      )) : <EmptyState text={t('common.empty')} />}
      <Card>
        <Field label={t('tpl.name')} value={name} onChangeText={setName} />
        <Button title={t('tpl.saveCurrent')} variant="secondary" disabled={!name.trim() || !settings.data} loading={save.isPending}
          onPress={() => save.mutate({ name: name.trim(), config: configFromSettings(kind, settings.data as unknown as Record<string, unknown>) }, { onSuccess: () => setName(''), onError: (e) => Alert.alert(t('common.error'), errorMessage(e, t)) })} />
      </Card>
    </Screen>
  );
}
