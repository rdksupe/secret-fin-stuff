import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type ViewStyle } from 'react-native';

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
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={{ paddingTop: space.l, paddingBottom: bottomPad }}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.sea} colors={[color.sea]} progressBackgroundColor={color.raised} /> : undefined
      }>
      <View style={[{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: space.l }, style]}>{children}</View>
    </ScrollView>
  );
}
