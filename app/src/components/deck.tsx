import { useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, View } from 'react-native';

import type { Story } from '@/lib/api';
import { color, space } from '@/theme';

import { LeadStory } from './story-row';
import { Figure } from './type';

const GAP = 12;

/**
 * The stories that need you, as a swipeable deck of reversed plates (a Material carousel):
 * one plate in view, the next peeking at the edge so it reads as swipeable.
 */
export function Deck({ stories }: { stories: Story[] }) {
  const [w, setW] = useState(0);
  const [at, setAt] = useState(0);
  if (!stories.length) return null;
  const many = stories.length > 1;
  const card = many ? Math.round(w * 0.88) : w;
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / (card + GAP));
    if (i !== at) setAt(Math.max(0, Math.min(stories.length - 1, i)));
  };
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={card + GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          onScroll={onScroll}
          scrollEventThrottle={32}
          contentContainerStyle={{ gap: GAP, alignItems: 'stretch' }}
          accessibilityLabel={`${stories.length} stories need you`}>
          {stories.map((s) => (
            <View key={s.story_key} style={{ width: card }}>
              <LeadStory story={s} fill />
            </View>
          ))}
        </ScrollView>
      )}
      {many && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.m }}>
          {stories.map((s, i) => (
            <View key={s.story_key} style={{ width: i === at ? 20 : 8, height: 6, backgroundColor: i === at ? color.sea : color.faint }} />
          ))}
          <View style={{ flex: 1 }} />
          <Figure size={12} c={color.text3}>
            {at + 1} of {stories.length}
          </Figure>
        </View>
      )}
    </View>
  );
}
