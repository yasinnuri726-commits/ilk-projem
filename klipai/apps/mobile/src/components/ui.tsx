import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { radius, space, useTheme } from '../theme/theme';
import { useT } from '../i18n';

export function Screen({ children, scroll = true, onRefresh, refreshing = false, edges = ['top'], padded = true, footer }: {
  children: ReactNode; scroll?: boolean; onRefresh?: () => void; refreshing?: boolean; edges?: ('top' | 'bottom')[]; padded?: boolean; footer?: ReactNode;
}) {
  const c = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={{ padding: padded ? space.lg : 0, paddingBottom: space.xxl * 2, gap: space.lg }} keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: padded ? space.lg : 0, gap: space.lg }}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.bg }}>
      {body}
      {footer}
    </SafeAreaView>
  );
}

export function T({ children, size = 15, weight = '400', color, tone, style, muted, numberOfLines, align, accessibilityRole }: {
  children: ReactNode; size?: number; weight?: TextStyle['fontWeight']; color?: string; tone?: 'danger' | 'success' | 'primary' | 'warning'; style?: StyleProp<TextStyle>; muted?: boolean; numberOfLines?: number; align?: TextStyle['textAlign'];
  accessibilityRole?: 'alert' | 'header' | 'text' | 'link';
}) {
  const c = useTheme();
  return <Text accessibilityRole={accessibilityRole} numberOfLines={numberOfLines} style={[{ fontSize: size, fontWeight: weight, color: color ?? (tone ? c[tone] : muted ? c.textMuted : c.text), textAlign: align }, style]}>{children}</Text>;
}
export const H1 = ({ children }: { children: ReactNode }) => <T size={28} weight="800">{children}</T>;
export const H2 = ({ children }: { children: ReactNode }) => <T size={19} weight="700" style={{ marginTop: space.sm }}>{children}</T>;

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  const c = useTheme();
  const base: ViewStyle = { backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.lg, gap: space.sm };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }, style]}>
      {children}
    </Pressable>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, small, label }: {
  title: string; onPress: () => void; variant?: Variant; loading?: boolean; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap; small?: boolean; label?: string;
}) {
  const c = useTheme();
  const bg = { primary: c.primary, secondary: c.surface2, danger: c.danger, ghost: 'transparent' }[variant];
  const fg = { primary: c.onPrimary, secondary: c.text, danger: '#FFFFFF', ghost: c.primary }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off} onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: bg, borderRadius: radius.md, paddingVertical: small ? 8 : 14, paddingHorizontal: small ? 12 : 18, minHeight: small ? 36 : 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: off ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, error, multiline, ...rest }: { label?: string; value: string; onChangeText: (v: string) => void; error?: string; multiline?: boolean } & Omit<TextInputProps, 'value' | 'onChangeText'>) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <T size={13} weight="600" muted>{label}</T> : null}
      <TextInput
        accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline} placeholderTextColor={c.textMuted}
        style={{ backgroundColor: c.surface, color: c.text, borderColor: error ? c.danger : c.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: multiline ? 12 : 12, minHeight: multiline ? 96 : 48, fontSize: 16, textAlignVertical: multiline ? 'top' : 'center' }}
        {...rest}
      />
      {error ? <T size={12} color={c.danger}>{error}</T> : null}
    </View>
  );
}

export function Segmented<V extends string>({ options, value, onChange, label }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; label?: string }) {
  const c = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
            style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: on ? c.primary : c.surface2, borderWidth: 1, borderColor: on ? c.primary : c.border }}
          >
            <Text style={{ color: on ? c.onPrimary : c.text, fontWeight: '600', fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'success' | 'warning' | 'danger' | 'primary' }) {
  const c = useTheme();
  const fg = { muted: c.textMuted, success: c.success, warning: c.warning, danger: c.danger, primary: c.primary }[tone];
  return (
    <View style={{ alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: fg }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const c = useTheme();
  const style = useAnimatedStyle(() => ({ width: withTiming(`${Math.max(0, Math.min(100, value))}%`, { duration: 400 }) }));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }} style={{ height: 8, borderRadius: 4, backgroundColor: c.surface2, overflow: 'hidden' }}>
      <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: c.primary }, style]} />
    </View>
  );
}

export function ScoreRing({ score, size = 56 }: { score: number | null; size?: number }) {
  const c = useTheme();
  const color = score === null ? c.textMuted : score >= 75 ? c.success : score >= 55 ? c.warning : c.danger;
  return (
    <View accessibilityLabel={`Score ${score ?? '-'}`} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 4, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontWeight: '800', fontSize: size * 0.34 }}>{score ?? '–'}</Text>
    </View>
  );
}

export function Row({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Loading() {
  const c = useTheme();
  return <View style={{ padding: space.xl, alignItems: 'center' }}><ActivityIndicator color={c.primary} /></View>;
}

export function EmptyState({ icon = 'sparkles-outline', text, action }: { icon?: keyof typeof Ionicons.glyphMap; text: string; action?: ReactNode }) {
  const c = useTheme();
  return (
    <Animated.View entering={FadeIn} style={{ alignItems: 'center', padding: space.xl, gap: space.md }}>
      <Ionicons name={icon} size={36} color={c.textMuted} />
      <T muted align="center">{text}</T>
      {action}
    </Animated.View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  const c = useTheme();
  return (
    <View accessibilityRole="alert" style={{ alignItems: 'center', padding: space.xl, gap: space.md }}>
      <Ionicons name="cloud-offline-outline" size={36} color={c.danger} />
      <T align="center" muted>{message}</T>
      {onRetry ? <Button title={t('common.retry')} variant="secondary" small onPress={onRetry} /> : null}
    </View>
  );
}

export function OfflineBanner({ offline }: { offline: boolean }) {
  const t = useT();
  const c = useTheme();
  if (!offline) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: c.warning, padding: 8 }}>
      <T size={12} weight="600" color="#000" align="center">{t('common.offline')}</T>
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 }}>
      <View style={{ flex: 1 }}>
        <T weight="600">{label}</T>
        {hint ? <T size={12} muted>{hint}</T> : null}
      </View>
      <View style={{ width: 46, height: 28, borderRadius: 14, backgroundColor: value ? c.primary : c.surface2, borderWidth: 1, borderColor: c.border, justifyContent: 'center', paddingHorizontal: 3 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: value ? c.onPrimary : c.textMuted, alignSelf: value ? 'flex-end' : 'flex-start' }} />
      </View>
    </Pressable>
  );
}

export function Stepper({ label, value, onChange, step = 1, min = 0, max = 9999, format }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; format?: (v: number) => string }) {
  const c = useTheme();
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
  const btn = (icon: 'remove' | 'add', next: number, l: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={l} onPress={() => set(next)} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={20} color={c.text} />
    </Pressable>
  );
  return (
    <Row style={{ justifyContent: 'space-between', minHeight: 44 }}>
      <T weight="600" style={{ flex: 1 }}>{label}</T>
      {btn('remove', value - step, `${label} -`)}
      <T weight="700" style={{ minWidth: 56, textAlign: 'center' }}>{format ? format(value) : value}</T>
      {btn('add', value + step, `${label} +`)}
    </Row>
  );
}
