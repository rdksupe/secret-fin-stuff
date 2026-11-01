import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AskIcon } from '@/components/icons';
import { Strong } from '@/components/type';
import { color, maxWidth, space } from '@/theme';

/** The bottom "talk to FINN" bar; whatever the investor is looking at rides along as context. */
export function AskBar({ symbol, page, label }: { symbol: string; page?: string; label?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: color.line, backgroundColor: color.bg, alignItems: 'center', paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: Math.max(insets.bottom, space.l) }}>
      <Pressable
        onPress={() => router.push({ pathname: '/ask', params: page ? { symbol, page } : { symbol } })}
        accessibilityRole="button"
        style={({ pressed }) => ({ width: '100%', maxWidth, height: 56, flexDirection: 'row', gap: 10, backgroundColor: pressed ? '#25605A' : color.sea, borderRadius: 28, justifyContent: 'center', alignItems: 'center' })}>
        <AskIcon c={color.onSea} />
        <Strong c={color.onSea}>{label ?? `Ask FINN about ${symbol}`}</Strong>
      </Pressable>
    </View>
  );
}
