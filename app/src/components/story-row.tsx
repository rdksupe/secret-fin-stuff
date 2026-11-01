import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import type { Story } from '@/lib/api';
import { headline, quarterLabel, when } from '@/lib/format';
import { color, deco, font, size, space } from '@/theme';

import { Setback, SetbackPlate } from './deco';
import { ChevronRight } from './icons';

import { ResultsStrip } from './results';
import { Body, Medium, Figure, Pct, Ticker, Title } from './type';

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

/** The exchange's own reference for a story, shown like a catalogue number: "NSE 1031874 · 21 Oct". */
export function refLine(story: Story): string {
  const h = story.head;
  const r = h.ref ?? '';
  const ref = r.startsWith('nse:') ? `NSE ${r.slice(4)}` : h.kind === 'results' ? 'NSE XBRL' : h.kind === 'signal' ? 'NSE bhavcopy' : '';
  return [ref, when(story.event_at)].filter(Boolean).join(' · ');
}

function Move({ story, onSea }: { story: Story; onSea?: boolean }) {
  const h = story.head;
  const move = story.situation ? story.cumulative_pct : h.kind === 'signal' ? h.payload.change_pct : undefined;
  return move !== undefined && move !== null ? <Pct v={move} size={14} onSea={onSea} /> : null;
}

function Detail({ story, onSea = false }: { story: Story; onSea?: boolean }) {
  const h = story.head;
  const person = h.payload.person;
  const flag = h.payload.results?.flags?.[0];
  const c2 = onSea ? color.onSea2 : color.text2;
  return (
    <>
      {flag && (
        <Body size={size.small} c={c2} style={{ marginTop: space.s }}>
          <Body size={size.small} c={onSea ? color.lossOnSea : color.loss} style={{ fontFamily: font.semibold }}>Watch: </Body>
          {flag}
        </Body>
      )}
      {person && (
        <Body size={size.small} c={c2} style={{ marginTop: space.s }} numberOfLines={2}>
          Incoming: <Body size={size.small} c={onSea ? color.onSea : color.text} style={{ fontFamily: font.semibold }}>{person.name}</Body>
          {person.bio ? `, ${person.bio.split('. ')[0]}` : person.role ? `, ${person.role}` : ''}
        </Body>
      )}
      {story.situation && (story.timeline?.length ?? 0) > 1 && (
        <Body size={size.small} c={c2} style={{ marginTop: space.s }}>
          {story.timeline!.length} updates since {when(story.timeline![0].at)}
          {story.from_close && story.to_close ? ` · ₹${Math.round(story.from_close)} → ₹${Math.round(story.to_close)}` : ''}
        </Body>
      )}
    </>
  );
}

/** The one-line why under the lead headline: FINN's own reason from scoring the filing, never invented. */
function Why({ story }: { story: Story }) {
  const h = story.head;
  const line = h.payload.materiality?.llm?.one_liner?.trim();
  if (!line || headline(h.title, h.summary).toLowerCase().includes(line.toLowerCase().slice(0, 40))) return null;
  return (
    <Body size={size.small} c={color.onSea2} numberOfLines={2} style={{ marginTop: space.s }}>
      {line}
    </Body>
  );
}

function open(story: Story) {
  router.push({ pathname: '/story/[id]', params: { id: story.head.id } });
}

/**
 * The single most material story, reversed onto the sea-green plate with a stepped crown.
 * One per screen: rank is carried by this reversal, not by piling on sizes.
 */
export function LeadStory({ story, fill = false }: { story: Story; fill?: boolean }) {
  return (
    <Pressable onPress={() => open(story)} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1, flex: fill ? 1 : undefined })}>
      <SetbackPlate fill={fill}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ticker size={deco.lead} c={color.brassOnSea}>{story.symbol}</Ticker>
          <View style={{ flex: 1 }} />
          <Move story={story} onSea />
          <Setback steps={story.tier} onSea />
        </View>
        <Figure size={12} c={color.onSea2} style={{ marginTop: 2 }}>
          {[kindLabel(story), refLine(story)].join(' · ')}
          {flaggedByFinn(story) ? ' · raised by FINN' : ''}
        </Figure>
        <Title size={21} c={color.onSea} numberOfLines={fill ? 3 : undefined} style={{ marginTop: space.m, fontFamily: font.bold, lineHeight: 27 }}>
          {headline(story.head.title, story.head.summary)}
        </Title>
        <Why story={story} />
        {story.head.payload.results && !fill ? (
          <View style={{ marginTop: space.m }}>
            <ResultsStrip card={story.head.payload.results} onSea />
          </View>
        ) : null}
        <Detail story={story} onSea />
        {fill ? (
          // In the deck the plates share a height; the open action sits at the foot of each.
          <View style={{ flex: 1, minHeight: space.l, justifyContent: 'flex-end' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: space.m, borderTopWidth: 1, borderTopColor: 'rgba(238,244,241,0.18)' }}>
              <Body size={size.small} c={color.onSea2} style={{ flex: 1, fontFamily: font.semibold }}>Open story</Body>
              <ChevronRight c={color.onSea2} size={18} />
            </View>
          </View>
        ) : null}
      </SetbackPlate>
    </Pressable>
  );
}

/** A ranked row: the setback mark, ticker in deco caps, headline, and its exchange reference. */
export function StoryRow({ story, compact = false }: { story: Story; compact?: boolean }) {
  return (
    <Pressable
      onPress={() => open(story)}
      accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', gap: 14, paddingVertical: compact ? space.m : space.l, minHeight: 48, backgroundColor: pressed ? color.inset : 'transparent', marginHorizontal: -space.l, paddingHorizontal: space.l })}>
      <View style={{ paddingTop: 3, width: 18 }}>
        <Setback steps={story.tier} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ticker>{story.symbol}</Ticker>
          <Body size={size.small} c={color.text2} numberOfLines={1} style={{ flexShrink: 1 }}>{kindLabel(story)}</Body>
          {flaggedByFinn(story) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} accessibilityLabel="Raised by FINN">
              <View style={{ width: 6, height: 6, backgroundColor: color.brass }} />
              <Body size={size.meta} c={color.brassText} style={{ fontFamily: font.semibold }}>FINN</Body>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <Move story={story} />
        </View>
        <Medium size={compact ? size.small + 1 : size.body} style={{ marginTop: 4, fontFamily: font.semibold }} numberOfLines={compact ? 2 : 3}>
          {headline(story.head.title, story.head.summary)}
        </Medium>
        {!compact && <Detail story={story} />}
        <Figure size={12} c={color.text3} style={{ marginTop: 4 }}>{refLine(story)}</Figure>
      </View>
    </Pressable>
  );
}

export function Rule() {
  return <View style={{ height: 1, backgroundColor: color.line }} />;
}
