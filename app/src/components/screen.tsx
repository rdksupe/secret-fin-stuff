import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, maxWidth, space } from '@/theme';

/** Scrolling page with a centred, phone-width column (web caps the width instead of stretching). */
export function Screen({
  children,
  refreshing,
  onRefresh,
  bottomPad = 120,
  style,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomPad?: number;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ink }}
      contentContainerStyle={{ paddingTop: insets.top + space.l, paddingBottom: bottomPad + insets.bottom }}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.marigold} /> : undefined
      }>
      <View style={[{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: space.l }, style]}>{children}</View>
    </ScrollView>
  );
}
