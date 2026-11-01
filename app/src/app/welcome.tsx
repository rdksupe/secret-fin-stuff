import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Setback, SetbackPlate } from '@/components/deco';
import { ChevronRight, SearchIcon } from '@/components/icons';
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

const BriefSpecimen = () => (
  <View style={{ marginTop: space.xl }}>
    <Body size={size.small} c={color.text2} style={{ marginBottom: space.m }}>
      FINN read <Text style={{ color: color.text, fontFamily: font.bold }}>917</Text> filings that day.{' '}
      <Text style={{ color: color.text, fontFamily: font.bold }}>5</Text> were yours; <Text style={{ color: color.text, fontFamily: font.bold }}>2</Text> were worth your time.
    </Body>
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
      <Body size={size.small} c={color.text}>margin guidance</Body>
    </View>
    <Figure size={11} c={color.text3}>guidance-ledger · Q2 FY27 call</Figure>
    <Body size={size.small} c={color.text2}>
      … operating/EBIT <Hl>margin</Hl> | <Hl>Margins</Hl> to inch up from current levels while prioritizing …
    </Body>
    <View style={{ height: 1, backgroundColor: color.line }} />
    {['dossier/', 'results/', 'transcripts/', 'annual-reports/', 'filings/'].map((f) => (
      <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <ChevronRight c={color.sea} size={16} />
        <Figure size={13} c={color.text} style={{ fontFamily: font.semibold }}>{f}</Figure>
      </View>
    ))}
  </Panel>
);

const AskSpecimen = () => (
  <Panel>
    <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: color.bg, borderWidth: 1, borderColor: color.line, paddingHorizontal: 12, paddingVertical: 8 }}>
      <Body size={size.small}>Which of my companies are exposed to data centres?</Body>
      <Text style={{ position: 'absolute', left: -8, bottom: -8, fontSize: 12 }}>👍</Text>
    </View>
    <Figure size={11} c={color.text3}>📈 finn_brain_search: "data centre"</Figure>
    <Body size={size.small}>
      <Hl>Eight</Hl> have real exposure. BHARTIARTL: Nxtra is one of two stated growth bets (Q1 concall, 2026-08) …
    </Body>
    <View style={{ height: 1, backgroundColor: color.line }} />
    <Body size={size.small} c={color.text2}>"Every weekday at 8:30, send me a two-line brief on my IT stocks." → a real scheduled job</Body>
  </Panel>
);

const PAGES = [
  {
    key: 'brief',
    title: 'It reads everything. You read what matters.',
    body: 'FINN reads every NSE filing as it lands, keeps the few from your companies that matter, and says in one line why.',
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
    title: 'One brain per company.',
    body: "Annual reports, call transcripts, results and filings, read and kept as linked pages you can search. FINN's research cites them: promised vs delivered, trajectory, bull and bear.",
    specimen: <BrainSpecimen />,
  },
  {
    key: 'ask',
    title: 'An agent, not a dashboard.',
    body: 'Ask anything, by text or voice. Answers cite the page they came from. Long-press to reply or react, run several chats at once, and ask it to watch things on a schedule.',
    specimen: <AskSpecimen />,
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
