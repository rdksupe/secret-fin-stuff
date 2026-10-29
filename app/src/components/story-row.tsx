import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import type { Story } from '@/lib/api';
import { headline, quarterLabel, when } from '@/lib/format';
import { color, size, space } from '@/theme';

import { ResultsStrip } from './results';
import { Body, Medium, Mono, Pct, Ticker, Title } from './type';

export function kindLabel(s: Story): string {
  const h = s.head;
  if (s.situation) return 'Developing';
  if (h.kind === 'results' && h.payload.results) return `${quarterLabel(h.payload.results.period_end)} results`;
  if (h.kind === 'signal') return 'Unusual move';
  return h.payload.category_label ?? h.title;
}

/** FINN raised this above what its filing category alone would have. */
export function flaggedByFinn(s: Story): boolean {
  const m = s.head.payload.materiality;
  return !!(m && m.push && m.stage === 'llm') || !!s.head.payload.moved_with;
}

function Meta({ story }: { story: Story }) {
  const h = story.head;
  const move = story.situation ? story.cumulative_pct : h.kind === 'signal' ? h.payload.change_pct : undefined;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Ticker>{story.symbol}</Ticker>
      <Body size={size.small} c={color.mist} numberOfLines={1} style={{ flexShrink: 1 }}>
        {kindLabel(story)}
      </Body>
      {flaggedByFinn(story) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} accessibilityLabel="Flagged by FINN">
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.marigold }} />
          <Body size={size.meta} c={color.marigold}>FINN</Body>
        </View>
      )}
      <View style={{ flex: 1 }} />
      {move !== undefined && move !== null ? <Pct v={move} size={14} /> : <Mono size={12} c={color.dim}>{when(story.event_at)}</Mono>}
    </View>
  );
}

function Detail({ story, lead = false }: { story: Story; lead?: boolean }) {
  const h = story.head;
  const results = h.payload.results;
  const person = h.payload.person;
  return (
    <>
      {/* The headline already carries revenue/PAT; the full strip only earns its space on the lead. */}
      {results && lead && <ResultsStrip card={results} />}
      {results?.flags?.[0] && (
        <Body size={size.small} c={color.mist} style={{ marginTop: space.s }}>
          <Body size={size.small} c={color.loss}>Watch: </Body>
          {results.flags[0]}
        </Body>
      )}
      {person && (
        <Body size={size.small} c={color.mist} style={{ marginTop: space.s }} numberOfLines={2}>
          Incoming: <Body size={size.small} c={color.paper}>{person.name}</Body>
          {person.bio ? ` — ${person.bio.split('. ')[0]}` : person.role ? `, ${person.role}` : ''}
        </Body>
      )}
      {story.situation && (story.timeline?.length ?? 0) > 1 && (
        <Body size={size.small} c={color.mist} style={{ marginTop: space.s }}>
          {story.timeline!.length} updates since {when(story.timeline![0].at)}
          {story.from_close && story.to_close ? ` · ₹${Math.round(story.from_close)} → ₹${Math.round(story.to_close)}` : ''}
        </Body>
      )}
    </>
  );
}

function open(story: Story) {
  router.push({ pathname: '/story/[id]', params: { id: story.head.id } });
}

/** The single most important story: large headline, full context. */
export function LeadStory({ story }: { story: Story }) {
  return (
    <Pressable
      onPress={() => open(story)}
      accessibilityRole="button"
      style={({ pressed }) => ({ paddingVertical: space.l, opacity: pressed ? 0.7 : 1 })}>
      <Meta story={story} />
      <Title size={size.title} style={{ marginTop: space.m }}>
        {headline(story.head.title, story.head.summary)}
      </Title>
      <Detail story={story} lead />
    </Pressable>
  );
}

export function StoryRow({ story, compact = false }: { story: Story; compact?: boolean }) {
  return (
    <Pressable
      onPress={() => open(story)}
      accessibilityRole="button"
      style={({ pressed }) => ({ paddingVertical: compact ? space.m : space.l, opacity: pressed ? 0.7 : 1 })}>
      <Meta story={story} />
      <Medium size={compact ? size.small + 1 : size.body} style={{ marginTop: 6 }} numberOfLines={compact ? 2 : 3}>
        {headline(story.head.title, story.head.summary)}
      </Medium>
      {!compact && <Detail story={story} />}
    </Pressable>
  );
}

export function Rule() {
  return <View style={{ height: 1, backgroundColor: color.hairline }} />;
}
