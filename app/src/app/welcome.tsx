import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChartArtifact, FormArtifact } from '@/components/artifacts';
import { Setback, SetbackPlate } from '@/components/deco';
import { SearchIcon } from '@/components/icons';
import { ScenarioArtifact } from '@/components/scenario';
import { SourceChip } from '@/components/source';
import { BarAction, TopBar } from '@/components/top-bar';
import { Body, Figure, Strong, Ticker, Title } from '@/components/type';
import { setOnboarded } from '@/lib/onboarding';
import { registerPush } from '@/lib/push';
import { color, deco, font, maxWidth, size, space, touch } from '@/theme';

// First-run intro: what FINN does, shown with small specimens of the real screens.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.xl, borderWidth: 1, borderColor: color.line, backgroundColor: color.raised, padding: space.l, gap: 10 }}>
      {children}
    </View>
  );
}

function Hl({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: color.sea, fontFamily: font.bold }}>{children}</Text>;
}

function Line({ k, v, c = color.text }: { k: string; v: string; c?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Body size={size.small} c={color.text2} style={{ flex: 1 }}>{k}</Body>
      <Figure size={13} c={c}>{v}</Figure>
    </View>
  );
}

/** A still of the "Needs you" deck: plates stacked like setbacks, filter chips above. */
const BriefSpecimen = () => (
  <View style={{ marginTop: space.xl }}>
    <Body size={size.small} c={color.text2} style={{ marginBottom: space.m }}>
      FINN read <Text style={{ color: color.text, fontFamily: font.bold }}>917</Text> filings that day.{' '}
      <Text style={{ color: color.text, fontFamily: font.bold }}>5</Text> were yours; <Text style={{ color: color.text, fontFamily: font.bold }}>2</Text> were worth your time.
    </Body>
    <View style={{ flexDirection: 'row', gap: 6, marginBottom: space.m }}>
      {[['All', 2, true], ['People', 1, false], ['Risk', 1, false]].map(([l, n, on]) => (
        <View key={String(l)} style={{ height: 32, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, borderWidth: 1, borderColor: on ? color.sea : color.line, backgroundColor: on ? color.seaTint : color.raised }}>
          <Body size={size.meta} c={on ? color.sea : color.text} style={{ fontFamily: font.semibold }}>{String(l)}</Body>
          <Figure size={11} c={color.text3}>{String(n)}</Figure>
        </View>
      ))}
    </View>
    <View style={{ paddingTop: 18 }}>
      <View style={{ position: 'absolute', left: 28, right: 28, top: 0, bottom: 0, backgroundColor: '#3F7D74' }} />
      <View style={{ position: 'absolute', left: 14, right: 14, top: 9, bottom: 0, backgroundColor: '#2E6B63' }} />
      <SetbackPlate>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ticker size={deco.lead} c={color.brassOnSea}>EMUDHRA</Ticker>
          <View style={{ flex: 1 }} />
          <Setback steps={3} onSea />
        </View>
        <Body size={size.small} c={color.onSea} style={{ marginTop: space.s, fontFamily: font.semibold }}>
          Exits the TLS certificate business after browsers distrust its root CA.
        </Body>
        <Body size={size.meta} c={color.onSea2} style={{ marginTop: 4 }}>Pushed at 10:57, before the lower circuit.</Body>
      </SetbackPlate>
    </View>
    <Figure size={12} c={color.text3} style={{ marginTop: space.s }}>1 of 2 · flick the card for the next</Figure>
  </View>
);

const ResultsSpecimen = () => (
  <Panel>
    <Strong size={size.small}>TCS · Q2 FY27 results</Strong>
    <Line k="Revenue" v="₹73,188 Cr   +11.2% YoY" />
    <Line k="PAT" v="₹13,884 Cr   +15.0% YoY" />
    <Line k="EBITDA margin" v="25.7%" />
    <View style={{ height: 1, backgroundColor: color.line }} />
    <Body size={size.small}><Text style={{ color: color.loss }}>▲ </Text>DIXON: other income was 61% of profit before tax</Body>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Setback steps={2} />
      <Body size={size.small} style={{ flex: 1 }}>Your thresholds: volume 2× the 20-day average, price ±5%</Body>
    </View>
  </Panel>
);

const BrainSpecimen = () => (
  <Panel>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: color.line, paddingHorizontal: 12, height: 44, backgroundColor: color.bg }}>
      <SearchIcon c={color.sea} size={18} />
      <Body size={size.small} c={color.text}>order book</Body>
    </View>
    <Figure size={11} c={color.text3}>LT · annual report 2026 · Page 44</Figure>
    <Body size={size.small} c={color.text2}>
      The year witnessed the booking of some noteworthy <Hl>orders</Hl> across businesses …
    </Body>
    <View style={{ height: 1, backgroundColor: color.line }} />
    <Body size={size.small}>
      Every figure FINN quotes carries its source. Tap one to read the passage:{' '}
      <SourceChip s={{ symbol: 'LT', path: 'annual-reports/annual-report-2026.md', section: 'Page 44', label: 'L&T AR p44' }} base={{ fontFamily: font.regular, fontSize: size.small }} />
    </Body>
  </Panel>
);

/** Real components with real, cited figures: the chart and the slider both work here. */
const TouchSpecimen = () => (
  <View style={{ marginTop: space.l }}>
    <ChartArtifact
      spec={{
        kind: 'bar',
        title: 'Maruti October sales (units)',
        unit: 'units',
        labels: ['Total', 'Domestic', 'Exports'],
        series: [
          { name: 'Oct 2019', values: [153435, 141550, 9158] },
          { name: 'Oct 2026', values: [276120, 216789, 49872] },
        ],
        source: 'Maruti sales releases, 1 Nov 2019 and 1 Nov 2026',
      }}
    />
    <ScenarioArtifact
      spec={{
        title: 'What if L&T spends more on data centres?',
        inputs: [{ id: 'capex', label: 'Data-centre capex a year', unit: '₹ Cr', min: 1000, max: 4000, step: 250, value: 2000 }],
        constants: { ocf: 16741 },
        outputs: [{ label: 'Share of FY26 operating cash flow', expr: 'capex / ocf * 100', unit: '%', digits: 1, bar: 100 }],
        source: '~₹10,000 Cr over FY27–31 (May-26 call); OCF ₹16,741 Cr (FY26 annual report)',
      }}
    />
  </View>
);

const AwaySpecimen = () => (
  <View style={{ marginTop: space.l }}>
    <FormArtifact
      spec={{
        title: 'Set up a watch',
        fields: [
          { id: 'cos', label: 'Companies', type: 'multi', options: ['LT', 'RELIANCE', 'BHARTIARTL'], value: ['LT', 'RELIANCE'] },
          { id: 'when', label: 'Tell me', type: 'select', options: ['On new filings', 'Weekdays 08:30'], value: 'On new filings' },
          { id: 'topic', label: 'Watch for', type: 'text', value: 'data-centre capex' },
        ],
        submit: { label: 'Create watch', prompt: '' },
      }}
    />
    <Panel>
      <Strong size={size.small}>Chats</Strong>
      {[
        ['Data-centre exposure', 'working', true],
        ['TCS promised vs delivered', '14:05', false],
        ['Maruti sales since 2019', 'working', true],
      ].map(([t, w, on]) => (
        <View key={String(t)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {on ? <View style={{ width: 7, height: 7, backgroundColor: color.brass }} /> : <View style={{ width: 7 }} />}
          <Body size={size.small} style={{ flex: 1 }} numberOfLines={1}>{String(t)}</Body>
          <Body size={size.meta} c={on ? color.brassText : color.text3}>{String(w)}</Body>
        </View>
      ))}
    </Panel>
  </View>
);

const AskSpecimen = () => (
  <Panel>
    <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: color.bg, borderWidth: 1, borderColor: color.line, paddingHorizontal: 12, paddingVertical: 8 }}>
      <Body size={size.small}>Compare Maruti October 2019 sales with October 2026.</Body>
    </View>
    <Figure size={11} c={color.text3}>📈 finn_filings: "sales" · 📈 finn_ingest · 📈 finn_brain_search</Figure>
    <Body size={size.small}>
      <Hl>+80% in seven years</Hl>, and October 2026 was the highest-ever month. FINN fetched the 2019 filing from NSE itself.
    </Body>
    <View style={{ height: 1, backgroundColor: color.line }} />
    <Body size={size.small} c={color.text2}>Speak instead of typing, long-press to quote or react, and /stop it any time.</Body>
  </Panel>
);

const PAGES = [
  {
    key: 'brief',
    title: 'It reads everything. You read what matters.',
    body: 'FINN reads every NSE filing as it lands and deals you the few from your companies that matter, as a deck of cards: flick through, filter by kind, tap for the why.',
    specimen: <BriefSpecimen />,
  },
  {
    key: 'results',
    title: 'Numbers straight from the exchange.',
    body: "Quarterly results come from NSE's machine-readable filing: exact, with QoQ and YoY, and flags when one-offs drive profit. Unusual price and volume moves are checked every evening.",
    specimen: <ResultsSpecimen />,
  },
  {
    key: 'brains',
    title: 'One brain per company, and you can search it.',
    body: "Annual reports, call transcripts, results and filings, kept as linked pages. Search across all of it, and check any number FINN gives you against the page it came from.",
    specimen: <BrainSpecimen />,
  },
  {
    key: 'ask',
    title: 'An agent, not a dashboard.',
    body: 'Ask anything, by text or voice. When the brain lacks a year, FINN fetches those filings from NSE itself and answers from them.',
    specimen: <AskSpecimen />,
  },
  {
    key: 'touch',
    title: 'Answers you can touch.',
    body: 'Charts you tap to read, tables you sort, company cards that open, and what-if tools you can drag. Try the slider.',
    specimen: <TouchSpecimen />,
  },
  {
    key: 'away',
    title: 'It works while you are away.',
    body: 'Ask FINN to watch something and it sets up a real scheduled job; the results come back as notifications. Run several chats at once; each keeps working on its own.',
    specimen: <AwaySpecimen />,
  },
];

export default function Welcome() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroller = useRef<{ scrollTo: (o: { x: number; animated: boolean }) => void } | null>(null);
  const [page, setPage] = useState(0);
  const [asking, setAsking] = useState(false);
  const total = PAGES.length + 1;

  const go = (i: number) => scroller.current?.scrollTo({ x: i * width, animated: true });
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  const finish = async () => {
    await setOnboarded(true);
    router.replace('/');
  };

  const allow = async () => {
    setAsking(true);
    await registerPush(true);
    setAsking(false);
    finish();
  };

  const column = { width, paddingHorizontal: space.l, alignItems: 'center' as const };
  const inner = { width: '100%' as const, maxWidth };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <TopBar title="FINN" right={page < total - 1 ? <BarAction label="Skip" onPress={finish} /> : undefined} />

      <ScrollView
        ref={scroller as never}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        onScroll={onScroll}
        scrollEventThrottle={64}
        style={{ flex: 1 }}>
        {PAGES.map((p, i) => (
          <ScrollView key={p.key} style={{ width }} contentContainerStyle={[column, { paddingTop: space.xl, paddingBottom: space.xl }]}>
            <View style={inner}>
              <Title size={28} style={{ lineHeight: 34, fontFamily: font.bold }}>{p.title}</Title>
              <Body c={color.text2} style={{ marginTop: space.m, lineHeight: 24 }}>{p.body}</Body>
              {p.specimen}
            </View>
          </ScrollView>
        ))}
        <ScrollView style={{ width }} contentContainerStyle={[column, { paddingTop: space.xl, paddingBottom: space.xl }]}>
          <View style={inner}>
            <Title size={28} style={{ lineHeight: 34, fontFamily: font.bold }}>Let FINN tap you on the shoulder.</Title>
            <Body c={color.text2} style={{ marginTop: space.m, lineHeight: 24 }}>Only when it's worth it. FINN notifies you about:</Body>
            <Panel>
              {[
                ['A material filing', 'from one of your companies, with the one-line why'],
                ['An unusual move', 'price or volume past your thresholds'],
                ['Research that finished', "a company's brain and dossier are ready"],
                ['Something you asked for', 'scheduled briefs and watches, and answers that finish while you are away'],
              ].map(([k, v], i) => (
                <View key={k} style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ paddingTop: 3 }}>
                    <Setback steps={3 - Math.min(i, 2)} />
                  </View>
                  <Body size={size.small} style={{ flex: 1, lineHeight: 20 }}>
                    <Text style={{ fontFamily: font.semibold }}>{k}</Text>
                    <Text style={{ color: color.text2 }}>{`, ${v}.`}</Text>
                  </Body>
                </View>
              ))}
            </Panel>
            <Body size={size.meta} c={color.text3} style={{ marginTop: space.m }}>Routine filings are folded into the Brief and never notify.</Body>
          </View>
        </ScrollView>
      </ScrollView>

      <View style={{ paddingHorizontal: space.l, paddingBottom: Math.max(insets.bottom, space.l), paddingTop: space.m, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: space.l }}>
          {Array.from({ length: total }).map((_, i) => (
            <Pressable key={i} onPress={() => go(i)} hitSlop={6} accessibilityLabel={`Page ${i + 1}`}>
              <View style={{ width: i === page ? 20 : 8, height: 6, backgroundColor: i === page ? color.sea : color.faint }} />
            </Pressable>
          ))}
        </View>
        <View style={{ width: '100%', maxWidth }}>
          {page < total - 1 ? (
            <Pressable onPress={() => go(page + 1)} accessibilityRole="button" style={({ pressed }) => ({ backgroundColor: pressed ? '#25605A' : color.sea, borderRadius: 28, height: 56, justifyContent: 'center', alignItems: 'center' })}>
              <Strong c={color.onSea}>Next</Strong>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={allow} disabled={asking} accessibilityRole="button" style={({ pressed }) => ({ backgroundColor: pressed || asking ? '#25605A' : color.sea, borderRadius: 28, height: 56, justifyContent: 'center', alignItems: 'center' })}>
                <Strong c={color.onSea}>{asking ? 'Asking…' : 'Allow notifications and start'}</Strong>
              </Pressable>
              <Pressable onPress={finish} accessibilityRole="button" style={{ alignItems: 'center', justifyContent: 'center', height: touch, marginTop: space.xs }}>
                <Body size={size.small} c={color.text2}>Not now</Body>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}
