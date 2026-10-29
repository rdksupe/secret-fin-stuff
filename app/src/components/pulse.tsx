import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

import { color } from '@/theme';

/**
 * FINN's status dot. Still by default — it only moves while FINN is actually working
 * (a chat run in flight), so motion always means something is happening.
 */
export function Dot({ size = 7, working = false, c = color.marigold }: { size?: number; working?: boolean; c?: string }) {
  const v = useRef(new Animated.Value(1)).current;
  const [still, setStill] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
  }, []);

  useEffect(() => {
    if (!working || still) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.35, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [working, still, v]);

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, opacity: v }} />
    </View>
  );
}
