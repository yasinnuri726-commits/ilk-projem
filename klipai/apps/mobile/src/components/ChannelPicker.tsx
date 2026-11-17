import { ScrollView } from 'react-native';
import type { Channel } from '../api/types';
import { Segmented } from './ui';

export function ChannelPicker({ channels, value, onChange }: { channels: Channel[]; value: string | undefined; onChange: (id: string) => void }) {
  if (channels.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Segmented options={channels.map((c) => ({ value: c.id, label: c.title }))} value={value ?? ''} onChange={onChange} />
    </ScrollView>
  );
}
