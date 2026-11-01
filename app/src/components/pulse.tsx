import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

import { color } from '@/theme';

/**
 * FINN's mark. At rest, one brass block. While FINN is working (a chat run in flight), the
 * block becomes a setback that climbs tier by tier, the app's one authored motion. With
 * Remove animations on, it holds as a full setback instead.
 */
export function Dot({ size = 7, working = false, onSea = false }: { size?: number; working?: boolean; onSea?: boolean }) {
  const ink = onSea ? color.brassOnSea : color.brass;
  const tiers = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const [still, setStill] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
  }, []);

  useEffect(() => {
    if (!working || still) {
      tiers.forEach((t) => t.setValue(1));
      return;
    }
    const rise = (t: Animated.Value) => Animated.timing(t, { toValue: 1, duration: 220, easing: Easing.out(Easing.exp), useNativeDriver: true });
    const loop = Animated.loop(
      Animated.sequence([
        ...tiers.map((t) => Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true })),
        Animated.stagger(240, tiers.map(rise)),
        Animated.delay(520),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [working, still, tiers]);

  if (!working) {
    return <View style={{ width: size, height: size, backgroundColor: ink }} />;
  }
  // A three-tier setback at roughly twice the dot's footprint.
  const w = Math.max(12, size * 2);
  const t = Math.max(3, Math.round(w / 4.5));
  const widths = [w, w * 0.66, w * 0.33];
  return (
    <View accessibilityLabel="FINN is working" style={{ width: w, height: t * 3, justifyContent: 'flex-end', alignItems: 'center' }}>
      {[2, 1, 0].map((i) => (
        <Animated.View key={i} style={{ width: widths[i], height: t, backgroundColor: ink, opacity: tiers[i] }} />
      ))}
    </View>
  );
}
