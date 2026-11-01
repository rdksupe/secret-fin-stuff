import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Setback } from '@/components/deco';
import { AskAction, AskButton } from '@/components/ask-bar';
import { ChevronRight } from '@/components/icons';
import { ResultsTable } from '@/components/results';
import { Screen } from '@/components/screen';
import { TopBar } from '@/components/top-bar';
import { Rule } from '@/components/story-row';
import { Body, Figure, Pct, Strong, Title } from '@/components/type';
import { api, type FeedItem, type Materiality, type Story } from '@/lib/api';
import { headline, quarterLabel, rupee, when } from '@/lib/format';
import { color, font, size, space, touch } from '@/theme';

type StoryDetail = Story & { company?: string };

const NOUL_LABELS: Record<string, string> = {
  incident: 'Something went wrong',
  third_party_action: 'Someone acted against them',
  core_business: 'Hits the core business',
  stops_activity: 'Stops or loses an activity',
  claims_immaterial: 'Company says it is minor',
  routine: 'Routine paperwork',
};

function Back({ title = 'Story', ask }: { title?: string; ask?: { symbol: string; feed: string } }) {
  return <TopBar back title={title} right={ask ? <AskAction {...ask} /> : undefined} />;
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <Title size={size.lead} style={{ marginBottom: space.m }}>{label}</Title>
      {children}
    </View>
  );
}

function Why({ m, movedWith }: { m?: Materiality; movedWith?: string }) {
  if (!m && !movedWith) return null;
  return (
    <Block label="Why FINN surfaced this">
      {movedWith && <Body c={color.text}>Filed around an unusual move: {movedWith}.</Body>}
      {m?.llm && (
        <Body c={color.text} style={{ marginTop: movedWith ? 6 : 0 }}>
          FINN read the filing and judged it{' '}
          <Strong c={m.llm.direction === 'negative' ? color.loss : m.llm.direction === 'positive' ? color.gain : color.text}>
            {m.llm.direction ?? 'material'}
          </Strong>
          , importance {Math.round((m.llm.importance ?? 0) * 100)}/100.
        </Body>
      )}
      {m && Object.keys(m.nouls ?? {}).length > 0 && (
        <View style={{ marginTop: space.m, gap: 7 }}>
          <Figure c={color.text3} size={11}>
            First screen (Jev) · {m.stage === 'jev' ? `settled it: ${m.verdict}` : 'unsure, so FINN read it in full'}
          </Figure>
          {Object.entries(m.nouls).map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Body size={14} c={color.text2} style={{ width: 190 }}>{NOUL_LABELS[k] ?? k}</Body>
              <View style={{ flex: 1, height: 4, backgroundColor: color.inset, borderRadius: 2 }}>
                <View style={{ width: `${Math.round(v * 100)}%`, height: 4, borderRadius: 2, backgroundColor: v >= 0.7 ? color.text : color.text3 }} />
              </View>
              <Figure size={12} c={color.text3} style={{ width: 30, textAlign: 'right' }}>{v.toFixed(2)}</Figure>
            </View>
          ))}
        </View>
      )}
    </Block>
  );
}

function Timeline({ story }: { story: StoryDetail }) {
  return (
    <Block label="How it unfolded">
      {(story.timeline ?? []).map((t, i, arr) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ alignItems: 'center', width: 10 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                marginTop: 6,
                backgroundColor: t.kind === 'signal' ? color.bg : color.text,
                borderWidth: 1,
                borderColor: t.kind === 'signal' ? color.text2 : color.text,
              }}
            />
            {i < arr.length - 1 && <View style={{ flex: 1, width: 1, backgroundColor: color.line }} />}
          </View>
          <View style={{ flex: 1, paddingBottom: space.l }}>
            <Figure size={12} c={color.text3}>{when(t.at)}</Figure>
            <Body size={14} style={{ marginTop: 2 }}>{t.kind === 'signal' ? t.title : headline(t.title, t.summary)}</Body>
          </View>
        </View>
      ))}
    </Block>
  );
}

function Related({ items }: { items: FeedItem[] }) {
  const filings = items.filter((i) => i.kind !== 'signal');
  if (!filings.length) return null;
  return (
    <Block label="Related filings">
      {filings.map((i) => (
        <Pressable key={i.id} onPress={() => i.source_url && Linking.openURL(i.source_url)} style={{ paddingVertical: 8 }}>
          <Figure size={12} c={color.text3}>{when(i.event_at)} · {i.payload.desc ?? i.title}</Figure>
          <Body size={14} numberOfLines={2}>{headline(i.title, i.summary)}</Body>
        </Pressable>
      ))}
    </Block>
  );
}

export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [story, setStory] = useState<StoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<StoryDetail>(`/stories/${id}`)
      .then(setStory)
      .catch((e) => setError(e.message));
    api.patch(`/feed/${id}`, { seen: true }).catch(() => {});
  }, [id]);

  if (error)
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <Back />
        <Screen>
          <Title>This item is no longer in your feed.</Title>
          <Body c={color.text2} style={{ marginTop: space.s }}>{error}</Body>
        </Screen>
      </View>
    );
  if (!story)
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <Back />
      </View>
    );

  const h = story.head;
  const results = h.payload.results;
  const person = h.payload.person;
  const raw = h.payload.raw_text ?? (h.payload.materiality?.llm ? null : h.summary);

  const dismiss = async () => {
    await api.patch(`/feed/${h.id}`, { dismissed: true }).catch(() => {});
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Back title={story.symbol} ask={{ symbol: story.symbol, feed: h.id }} />
      <Screen bottomPad={space.xl}>
        <Pressable
          onPress={() => router.push({ pathname: '/company/[symbol]', params: { symbol: story.symbol } })}
          accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, backgroundColor: pressed ? color.inset : 'transparent', marginHorizontal: -space.l, paddingHorizontal: space.l })}>
          <Setback steps={story.tier} />
          <Body size={size.small} c={color.text2} numberOfLines={1} style={{ flex: 1 }}>
            {story.company ?? h.payload.company ?? ''}
          </Body>
          <Body size={size.small} c={color.sea} style={{ fontFamily: font.semibold }}>Company</Body>
          <ChevronRight c={color.sea} size={18} />
        </Pressable>

        <Title size={headline(h.title, h.summary).length > 90 ? size.title : size.display} style={{ marginTop: space.m }}>
          {results ? `${quarterLabel(results.period_end)}: ${headline(h.title, h.summary)}` : headline(h.title, h.summary)}
        </Title>
        <Body size={size.small} c={color.text3} style={{ marginTop: space.s }}>
          {story.situation ? 'Developing situation' : h.payload.category_label ?? h.title} · {when(h.event_at)}
        </Body>

        {story.situation && story.cumulative_pct !== undefined && (
          <View style={{ marginTop: space.xl, flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
            <Pct v={story.cumulative_pct} size={28} />
            <Figure c={color.text2}>
              {rupee(story.from_close)} → {rupee(story.to_close)}
            </Figure>
          </View>
        )}

        {story.situation && <Timeline story={story} />}

        {results && (
          <Block label="Headline numbers">
            <ResultsTable card={results} />
            {results.flags.map((f) => (
              <Body key={f} size={14} style={{ marginTop: space.s }}>
                <Body size={14} c={color.loss}>Watch: </Body>
                {f}
              </Body>
            ))}
          </Block>
        )}

        {person && (
          <Block label={person.change === 'appointed' || person.role?.includes('incoming') ? 'Who is coming in' : 'Who'}>
            <Strong size={17}>{person.name}</Strong>
            {person.role && <Figure c={color.text2} size={12} style={{ marginTop: 2 }}>{person.role}</Figure>}
            {person.bio && <Body style={{ marginTop: space.s }}>{person.bio}</Body>}
            {(person.sources ?? []).slice(0, 3).map((s) => (
              <Pressable key={s} onPress={() => Linking.openURL(s)}>
                <Figure size={12} c={color.text3} numberOfLines={1} style={{ marginTop: 4, textDecorationLine: 'underline' }}>{s}</Figure>
              </Pressable>
            ))}
          </Block>
        )}

        <Why m={h.payload.materiality} movedWith={h.payload.moved_with} />

        {raw && h.kind !== 'signal' && (
          <Block label="What the exchange says">
            <Body c={color.text2} size={14}>{raw}</Body>
          </Block>
        )}

        <Related items={story.related} />

        <View style={{ marginTop: space.xxl }}>
          <Rule />
          <View style={{ flexDirection: 'row', gap: space.s, paddingTop: space.m }}>
            {h.source_url && (
              <Pressable
                onPress={() => Linking.openURL(h.source_url!)}
                accessibilityRole="link"
                style={({ pressed }) => ({ height: touch, paddingHorizontal: 18, justifyContent: 'center', borderRadius: touch / 2, borderWidth: 1, borderColor: color.sea, backgroundColor: pressed ? color.seaTint : 'transparent', marginVertical: 4 })}>
                <Body size={size.small} c={color.sea} style={{ fontFamily: font.semibold }}>Open filing</Body>
              </Pressable>
            )}
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              style={({ pressed }) => ({ height: touch, paddingHorizontal: 14, justifyContent: 'center', borderRadius: touch / 2, backgroundColor: pressed ? color.inset : 'transparent', marginVertical: 4 })}>
              <Body size={size.small} c={color.text2} style={{ fontFamily: font.semibold }}>Dismiss</Body>
            </Pressable>
          </View>
        </View>
        <AskButton symbol={story.symbol} feed={h.id} label="Ask FINN about this" />
      </Screen>
    </View>
  );
}
