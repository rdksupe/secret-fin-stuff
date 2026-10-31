import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Strong } from '@/components/type';
import { color, maxWidth, space } from '@/theme';

/** The bottom "talk to FINN" bar; whatever the investor is looking at rides along as context. */
export function AskBar({ symbol, page, label }: { symbol: string; page?: string; label?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: color.hairline, backgroundColor: color.ink, alignItems: 'center', paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: Math.max(insets.bottom, space.l) }}>
      <Pressable
        onPress={() => router.push({ pathname: '/ask', params: page ? { symbol, page } : { symbol } })}
        accessibilityRole="button"
        style={({ pressed }) => ({ width: '100%', maxWidth, backgroundColor: color.paper, borderRadius: 14, paddingVertical: 14, alignItems: 'center', opacity: pressed ? 0.85 : 1 })}>
        <Strong c={color.ink}>{label ?? `Ask FINN about ${symbol}`}</Strong>
      </Pressable>
    </View>
  );
}
