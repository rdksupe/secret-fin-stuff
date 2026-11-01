import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Mono, Strong, Title } from '@/components/type';
import { setOnboarded } from '@/lib/onboarding';
import { registerPush } from '@/lib/push';
import { color, font, maxWidth, size, space } from '@/theme';

// First-run intro: what FINN does, shown with small specimens of the real screens.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.xl, borderWidth: 1, borderColor: color.hairline, borderRadius: 14, backgroundColor: color.well, padding: space.l, gap: 10 }}>
      {children}
    </View>
  );
}

function Hl({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: color.marigold, fontFamily: font.semibold }}>{children}</Text>;
}

function Line({ k, v, c = color.paper }: { k: string; v: string; c?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Body size={size.small} c={color.mist} style={{ flex: 1 }}>{k}</Body>
      <Mono size={13} c={c}>{v}</Mono>
    </View>
  );
}

const BriefSpecimen = () => (
  <Panel>
    <View style={{ flexDirection: 'row', gap: space.l }}>
      {[
        ['917', 'filings read'],
        ['5', 'yours'],
        ['2', 'worth your time'],
      ].map(([n, l], i) => (
        <View key={l} style={{ flex: 1 }}>
          <Mono size={26} c={i === 2 ? color.marigold : color.paper} style={{ fontFamily: font.monoMedium }}>{n}</Mono>
          <Body size={size.meta} c={color.dim}>{l}</Body>
        </View>
      ))}
    </View>
    <View style={{ height: 1, backgroundColor: color.hairline }} />
    <Body size={size.small}>
      <Hl>EMUDHRA</Hl> · Exits the TLS certificate business after browsers distrust its root CA. Pushed at 10:57, before the lower circuit.
    </Body>
  </Panel>
);

const ResultsSpecimen = () => (
  <Panel>
    <Strong size={size.small}>TCS · Q2 FY27 results</Strong>
    <Line k="Revenue" v="₹73,188 Cr   +11.2% YoY" />
    <Line k="PAT" v="₹13,884 Cr   +15.0% YoY" />
    <Line k="EBITDA margin" v="25.7%" />
    <View style={{ height: 1, backgroundColor: color.hairline }} />
    <Body size={size.small}><Text style={{ color: color.loss }}>▲ </Text>DIXON: other income was 61% of profit before tax</Body>
    <Body size={size.small}><Text style={{ color: color.marigold }}>● </Text>Your thresholds: volume 2× the 20-day average, price ±5%</Body>
  </Panel>
);

const BrainSpecimen = () => (
  <Panel>
    <View style={{ borderWidth: 1, borderColor: color.hairline, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: color.panel }}>
      <Body size={size.small} c={color.paper}>margin guidance</Body>
    </View>
    <Mono size={11} c={color.dim}>guidance-ledger · Q2 FY27 call</Mono>
    <Body size={size.small} c={color.mist}>
      … operating/EBIT <Hl>margin</Hl> | <Hl>Margins</Hl> to inch up from current levels while prioritizing …
    </Body>
    <View style={{ height: 1, backgroundColor: color.hairline }} />
    {['dossier/', 'results/', 'transcripts/', 'annual-reports/', 'filings/'].map((f) => (
      <Mono key={f} size={13} c={color.paper}>▸ {f}</Mono>
    ))}
  </Panel>
);

const AskSpecimen = () => (
  <Panel>
    <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: color.panel, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
      <Body size={size.small}>Which of my companies are exposed to data centres?</Body>
      <Text style={{ position: 'absolute', left: -8, bottom: -8, fontSize: 12 }}>👍</Text>
    </View>
    <Mono size={11} c={color.dim}>📈 finn_brain_search: "data centre"</Mono>
    <Body size={size.small}>
      <Hl>Eight</Hl> have real exposure. BHARTIARTL: Nxtra is one of two stated growth bets (Q1 concall, 2026-08) …
    </Body>
    <View style={{ height: 1, backgroundColor: color.hairline }} />
    <Body size={size.small} c={color.mist}>"Every weekday at 8:30, send me a two-line brief on my IT stocks." → a real scheduled job</Body>
  </Panel>
);

const PAGES = [
  {
    eyebrow: 'Brief',
    title: 'It reads everything. You read what matters.',
    body: 'FINN reads every NSE filing as it lands, keeps the few from your companies that matter, and says in one line why.',
    specimen: <BriefSpecimen />,
  },
  {
    eyebrow: 'Results and moves',
    title: 'Numbers straight from the exchange.',
    body: "Quarterly results come from NSE's machine-readable filing: exact, with QoQ and YoY, and flags when one-offs drive profit. Unusual price and volume moves are checked every evening.",
    specimen: <ResultsSpecimen />,
  },
  {
    eyebrow: 'Company brains',
    title: 'One brain per company.',
    body: "Annual reports, call transcripts, results and filings, read and kept as linked pages you can search. FINN's research cites them: promised vs delivered, trajectory, bull and bear.",
    specimen: <BrainSpecimen />,
  },
  {
    eyebrow: 'Ask',
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
    <View style={{ flex: 1, backgroundColor: color.ink, paddingTop: insets.top + space.l }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l }}>
        <Title size={20} style={{ fontFamily: font.bold, letterSpacing: 0.5, flex: 1 }}>FINN</Title>
        {page < total - 1 ? (
          <Pressable onPress={finish} hitSlop={12} accessibilityRole="button">
            <Body size={size.small} c={color.mist}>Skip</Body>
          </Pressable>
        ) : null}
      </View>

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
          <ScrollView key={p.eyebrow} style={{ width }} contentContainerStyle={[column, { paddingTop: space.xl, paddingBottom: space.xl }]}>
            <View style={inner}>
              <Mono size={12} c={color.marigold}>{`${String(i + 1).padStart(2, '0')} · ${p.eyebrow.toUpperCase()}`}</Mono>
              <Title size={size.display} style={{ marginTop: space.m, lineHeight: 38 }}>{p.title}</Title>
              <Body c={color.mist} style={{ marginTop: space.m, lineHeight: 24 }}>{p.body}</Body>
              {p.specimen}
            </View>
          </ScrollView>
        ))}
        <ScrollView style={{ width }} contentContainerStyle={[column, { paddingTop: space.xl, paddingBottom: space.xl }]}>
          <View style={inner}>
            <Mono size={12} c={color.marigold}>{`${String(total).padStart(2, '0')} · NOTIFICATIONS`}</Mono>
            <Title size={size.display} style={{ marginTop: space.m, lineHeight: 38 }}>Let FINN tap you on the shoulder.</Title>
            <Body c={color.mist} style={{ marginTop: space.m, lineHeight: 24 }}>Only when it's worth it. FINN notifies you about:</Body>
            <Panel>
              {[
                ['A material filing', 'from one of your companies, with the one-line why'],
                ['An unusual move', 'price or volume past your thresholds'],
                ['Research that finished', "a company's brain and dossier are ready"],
                ['Something you asked for', 'scheduled briefs and watches, and answers that finish while you are away'],
              ].map(([k, v]) => (
                <View key={k} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ color: color.marigold, fontFamily: font.mono, fontSize: 13, lineHeight: 20 }}>●</Text>
                  <Body size={size.small} style={{ flex: 1, lineHeight: 20 }}>
                    <Text style={{ fontFamily: font.semibold }}>{k}</Text>
                    <Text style={{ color: color.mist }}>{`, ${v}.`}</Text>
                  </Body>
                </View>
              ))}
            </Panel>
            <Body size={size.meta} c={color.dim} style={{ marginTop: space.m }}>Routine filings are folded into the Brief and never notify.</Body>
          </View>
        </ScrollView>
      </ScrollView>

      <View style={{ paddingHorizontal: space.l, paddingBottom: Math.max(insets.bottom, space.l), paddingTop: space.m, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: space.l }}>
          {Array.from({ length: total }).map((_, i) => (
            <Pressable key={i} onPress={() => go(i)} hitSlop={6} accessibilityLabel={`Page ${i + 1}`}>
              <View style={{ width: i === page ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? color.paper : color.faint }} />
            </Pressable>
          ))}
        </View>
        <View style={{ width: '100%', maxWidth }}>
          {page < total - 1 ? (
            <Pressable onPress={() => go(page + 1)} accessibilityRole="button" style={({ pressed }) => ({ backgroundColor: color.paper, borderRadius: 14, paddingVertical: 15, alignItems: 'center', opacity: pressed ? 0.85 : 1 })}>
              <Strong c={color.ink}>Next</Strong>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={allow} disabled={asking} accessibilityRole="button" style={({ pressed }) => ({ backgroundColor: color.paper, borderRadius: 14, paddingVertical: 15, alignItems: 'center', opacity: pressed || asking ? 0.85 : 1 })}>
                <Strong c={color.ink}>{asking ? 'Asking…' : 'Allow notifications and start'}</Strong>
              </Pressable>
              <Pressable onPress={finish} hitSlop={8} style={{ alignItems: 'center', paddingVertical: space.m }}>
                <Body size={size.small} c={color.mist}>Not now</Body>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}
