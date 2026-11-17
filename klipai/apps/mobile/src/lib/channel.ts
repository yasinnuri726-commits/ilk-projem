import { useChannels } from '../api/hooks';
import { usePrefs } from '../stores/prefs';

/** Seçili kanal: tercih edilen kanal hâlâ erişilebilirse o, değilse ilki. `undefined` = tüm kanallar. */
export function useActiveChannel() {
  const q = useChannels();
  const pref = usePrefs((s) => s.channelId);
  const setChannel = usePrefs((s) => s.setChannel);
  const channels = q.data ?? [];
  const active = channels.find((c) => c.id === pref) ?? channels[0];
  return { channels, active, setChannel, isLoading: q.isLoading };
}
