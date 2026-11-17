import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useT } from '../../src/i18n';
import { useTheme } from '../../src/theme/theme';

type Icon = keyof typeof Ionicons.glyphMap;
const tab = (name: string, key: string, icon: Icon, t: (k: string) => string) => (
  <Tabs.Screen key={name} name={name} options={{ title: t(`tabs.${key}`), tabBarAccessibilityLabel: t(`tabs.${key}`), tabBarIcon: ({ color, size }) => <Ionicons name={icon} size={size} color={color} /> }} />
);

export default function TabsLayout() {
  const t = useT();
  const c = useTheme();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: c.primary, tabBarInactiveTintColor: c.textMuted, tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border } }}>
      {tab('index', 'home', 'home', t)}
      {tab('calendar', 'calendar', 'calendar', t)}
      {tab('stats', 'stats', 'stats-chart', t)}
      {tab('templates', 'templates', 'color-palette', t)}
      {tab('settings', 'settings', 'settings', t)}
    </Tabs>
  );
}
