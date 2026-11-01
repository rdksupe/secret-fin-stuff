import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon } from '@/components/icons';
import { color, deco, font, maxWidth, touch } from '@/theme';

/** Deco caps for the wordmark and screen titles: the first of the three deco steps. */
export function DecoTitle({ children, size = deco.title, c = color.onSea }: { children: ReactNode; size?: number; c?: string }) {
  return (
    <Text accessibilityRole="header" numberOfLines={1} style={{ fontFamily: font.deco, fontSize: size, lineHeight: Math.round(size * 1.15), letterSpacing: size * 0.2, color: c, textTransform: 'uppercase', paddingTop: 3 }}>
      {children}
    </Text>
  );
}

/**
 * The sea-green stucco app bar (Material top app bar). Draws under the status bar.
 * `back` shows the Material back arrow; the system Back gesture always works too.
 */
export function TopBar({ title, back, right, below }: { title: ReactNode; back?: boolean; right?: ReactNode; below?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: color.sea, paddingTop: insets.top }}>
      <View style={{ width: '100%', maxWidth, alignSelf: 'center', minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingLeft: back ? 4 : 20, paddingRight: 8 }}>
        {back ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => ({ width: touch, height: touch, alignItems: 'center', justifyContent: 'center', borderRadius: touch / 2, backgroundColor: pressed ? 'rgba(238,244,241,0.14)' : 'transparent' })}>
            <BackIcon c={color.onSea} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, paddingLeft: back ? 4 : 0 }}>{typeof title === 'string' ? <DecoTitle>{title}</DecoTitle> : title}</View>
        {right}
      </View>
      {below ? <View style={{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 14 }}>{below}</View> : null}
    </View>
  );
}

/** A 48dp text action for the app bar (e.g. "New", "Chats"). */
export function BarAction({ label, onPress, children }: { label: string; onPress: () => void; children?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ minWidth: touch, height: touch, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, borderRadius: touch / 2, backgroundColor: pressed ? 'rgba(238,244,241,0.14)' : 'transparent' })}>
      {children ?? <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.onSea }}>{label}</Text>}
    </Pressable>
  );
}
