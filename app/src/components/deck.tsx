import { useMemo, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, View, useWindowDimensions } from 'react-native';

import type { Story } from '@/lib/api';
import { color, font, space, touch } from '@/theme';

import { LeadStory } from './story-row';
import { Body, Figure } from './type';

const STEP = 9; // how far each card behind peeks above the one in front (dp)
const INSET = 14; // and how much narrower it is on each side: the stack steps back like a setback
const FLICK = 110; // drag distance that sends a card to the back
const BEHIND = ['#2E6B63', '#3F7D74']; // the cards beneath, lighter as they recede

/**
 * The stories that need you, as a physical deck of sea plates. Drag the top card sideways and
 * flick it: it flies off and goes to the back while the next card rises. Tap opens the story.
 */
export function Deck({ stories }: { stories: Story[] }) {
  const { width } = useWindowDimensions();
  const [top, setTop] = useState(0);
  const [pan] = useState(() => new Animated.Value(0));
  const n = stories.length;
  const behind = Math.min(2, n - 1);

  const next = (dir: 1 | -1) => {
    Animated.timing(pan, { toValue: dir * width * 1.2, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }).start(() => {
      setTop((t) => (t + 1) % n);
      pan.setValue(0);
    });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim only clearly horizontal drags, so taps open the story and vertical drags scroll the Brief.
        onMoveShouldSetPanResponder: (_e, g) => n > 1 && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: Animated.event([null, { dx: pan }], { useNativeDriver: false }),
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) > FLICK || Math.abs(g.vx) > 0.6) next(g.dx >= 0 ? 1 : -1);
          else Animated.spring(pan, { toValue: 0, friction: 6, tension: 80, useNativeDriver: false }).start();
        },
        onPanResponderTerminate: () => Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, width],
  );

  if (!n) return null;
  const story = stories[top % n];

  // As the top card travels, the cards beneath move up one step.
  const lift = pan.interpolate({ inputRange: [-FLICK, 0, FLICK], outputRange: [1, 0, 1], extrapolate: 'clamp' });
  const rotate = pan.interpolate({ inputRange: [-width, 0, width], outputRange: ['-12deg', '0deg', '12deg'] });

  return (
    <View>
      <View style={{ paddingTop: behind * STEP }}>
        {Array.from({ length: behind }).map((_, k) => {
          const depth = behind - k; // 2 = furthest back
          const offset = Animated.subtract(depth, lift);
          return (
            <Animated.View
              key={depth}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                top: 0,
                transform: [{ translateY: Animated.multiply(offset, -STEP) }],
                paddingHorizontal: Animated.multiply(offset, INSET),
              }}>
              <View style={{ flex: 1, marginTop: behind * STEP, backgroundColor: BEHIND[depth - 1] }} />
            </Animated.View>
          );
        })}
        {/* A shared minimum height keeps the deck from jumping as cards of different length come up. */}
        <Animated.View {...responder.panHandlers} style={{ minHeight: 196, transform: [{ translateX: pan }, { rotate }] }}>
          <LeadStory key={story.story_key} story={story} fill />
        </Animated.View>
      </View>

      {n > 1 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.s }}>
          <Figure size={12} c={color.text3} style={{ flex: 1 }}>
            {top + 1} of {n} · flick the card for the next
          </Figure>
          <Pressable
            onPress={() => next(1)}
            accessibilityRole="button"
            accessibilityLabel="Next story"
            style={({ pressed }) => ({ height: touch, paddingHorizontal: 16, justifyContent: 'center', borderRadius: touch / 2, backgroundColor: pressed ? color.inset : 'transparent' })}>
            <Body size={14} c={color.sea} style={{ fontFamily: font.semibold }}>Next</Body>
          </Pressable>
        </View>
      )}
    </View>
  );
}
