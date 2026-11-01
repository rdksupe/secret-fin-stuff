import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { color } from '@/theme';

// FINN's one signature move: importance drawn as architectural setbacks, the stepped
// silhouettes of the Art Deco blocks on Marine Drive. Three steps = needs you now
// (alert), two = worth a look (brief), one = on file (list), none = routine.

/** The setback mark: up to three stepped tiers, filled to the item's rank. */
export function Setback({ steps, size = 18, ink = color.sea, onSea = false }: { steps: number; size?: number; ink?: string; onSea?: boolean }) {
  const n = Math.max(0, Math.min(3, Math.round(steps)));
  const empty = onSea ? 'rgba(238,244,241,0.28)' : color.faint;
  const w = size;
  const h = Math.round(size * 0.78);
  const u = w / 6; // tier inset
  const t = h / 3; // tier height
  // tiers from the base up: full width, inset one unit, inset two units
  const tiers = [
    { x: 0, y: h - t, w },
    { x: u, y: h - 2 * t, w: w - 2 * u },
    { x: 2 * u, y: 0, w: w - 4 * u },
  ];
  const label = ['Routine', 'On file', 'Worth a look', 'Needs you'][n];
  return (
    <View accessible accessibilityLabel={label}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {tiers.map((r, i) => (
          <Rect key={i} x={r.x} y={r.y} width={r.w} height={t + 0.5} fill={i < n ? (onSea ? color.onSea : ink) : empty} />
        ))}
      </Svg>
    </View>
  );
}

/** The reversed sea-green plate with a stepped crown. One per screen: the single most material thing. */
export function SetbackPlate({ children, style, fill = false }: { children: ReactNode; style?: ViewStyle; fill?: boolean }) {
  // Two fixed setbacks (14dp in, 7dp up) so the crown keeps its proportions at any width.
  // `fill` stretches the plate to its container (equal-height cards in the deck).
  return (
    <View style={[fill ? { flex: 1 } : null, style]}>
      <View style={{ height: 7, marginHorizontal: 28, backgroundColor: color.sea }} />
      <View style={{ height: 7, marginHorizontal: 14, backgroundColor: color.sea }} />
      <View style={{ backgroundColor: color.sea, paddingHorizontal: 18, paddingBottom: 18, paddingTop: 10, flex: fill ? 1 : undefined }}>{children}</View>
    </View>
  );
}
