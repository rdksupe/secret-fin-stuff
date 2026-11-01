import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { ChartArtifact } from '@/components/artifacts';
import { openBrainPage } from '@/components/brain';
import { ChevronRight } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { ResultsTable } from '@/components/results';
import { StoryRow } from '@/components/story-row';
import { Body, Figure, Pct, Strong, Ticker } from '@/components/type';
import { api, type Holding, type PricePoint, type ResultsCard, type Story } from '@/lib/api';
import { quarterLabel, rupee } from '@/lib/format';
import { color, font, size, space } from '@/theme';

// Live blocks: FINN names WHAT to show and the app fetches the numbers from FINN's own API, so a
// figure in one of these can never be mistyped by the model. ```finn-price, ```finn-results,
// ```finn-story, ```finn-holdings, ```finn-source.

function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api.get<T>(path).then((d) => live && setData(d)).catch((e) => live && setErr(e?.message ?? 'unavailable'));
    return () => {
      live = false;
    };
  }, [path]);
  return { data, err };
}

function Shell({ title, children, onOpen, openLabel }: { title?: string; children: React.ReactNode; onOpen?: () => void; openLabel?: string }) {
  return (
    <View style={{ marginVertical: space.s, borderWidth: 1, borderColor: color.line, backgroundColor: color.raised, padding: space.m }}>
      {title ? <Strong size={size.small} style={{ marginBottom: space.s }}>{title}</Strong> : null}
      {children}
      {onOpen ? (
        <Pressable onPress={onOpen} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.s, minHeight: 40 }}>
          <Body size={size.small} c={color.sea} style={{ fontFamily: font.semibold, flex: 1 }}>{openLabel ?? 'Open'}</Body>
          <ChevronRight c={color.sea} size={18} />
        </Pressable>
      ) : null}
      <Body size={size.meta} c={color.text3} style={{ marginTop: 2 }}>Live from FINN's data</Body>
    </View>
  );
}

const Loading = () => <ActivityIndicator color={color.sea} style={{ alignSelf: 'flex-start', marginVertical: space.s }} />;
const Failed = ({ what }: { what: string }) => <Body size={size.small} c={color.text3}>Couldn't load {what}.</Body>;

/** {"symbols":["TCS","INFY"],"days":180} — one stock as prices, several rebased to 100 to compare. */
export function PriceBlock({ spec }: { spec: { symbol?: string; symbols?: string[]; days?: number; title?: string } }) {
  const syms = (spec.symbols ?? (spec.symbol ? [spec.symbol] : [])).slice(0, 5).map((s) => s.toUpperCase());
  const days = Math.min(Math.max(spec.days ?? 90, 5), 365);
  const [series, setSeries] = useState<Record<string, PricePoint[]> | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(syms.map((s) => api.get<PricePoint[]>(`/companies/${s}/prices?days=${days}`).catch(() => [] as PricePoint[]))).then(
      (rs) => live && setSeries(Object.fromEntries(syms.map((s, i) => [s, rs[i]]))),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syms.join(','), days]);
  if (!syms.length) return null;
  if (!series) return <Shell title={spec.title}><Loading /></Shell>;
  const base = series[syms[0]] ?? [];
  if (base.length < 2) return <Shell title={spec.title}><Failed what="prices" /></Shell>;
  const many = syms.length > 1;
  const labels = base.map((p) => p.day.slice(5));
  const byDay = (s: string) => Object.fromEntries((series[s] ?? []).map((p) => [p.day, p.close]));
  const chart = {
    kind: 'line' as const,
    title: spec.title ?? (many ? `${syms.join(' vs ')}, rebased to 100` : `${syms[0]} close, ${days} days`),
    unit: many ? '' : '₹',
    labels,
    series: syms.map((s) => {
      const m = byDay(s);
      const first = (series[s] ?? [])[0]?.close;
      return { name: s, values: base.map((p) => (m[p.day] == null ? null : many && first ? Math.round((m[p.day] / first) * 1000) / 10 : m[p.day])) };
    }),
    source: 'NSE bhavcopy closes',
  };
  const last = base[base.length - 1];
  return (
    <View>
      {!many ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: space.s }}>
          <Ticker>{syms[0]}</Ticker>
          <Figure size={18} style={{ fontFamily: font.semibold }}>{rupee(last.close)}</Figure>
          <Pct v={((last.close - base[0].close) / base[0].close) * 100} size={13} />
          <Body size={size.meta} c={color.text3}>over {base.length} sessions</Body>
        </View>
      ) : null}
      <ChartArtifact spec={chart} />
    </View>
  );
}

/** {"symbol":"MARUTI"}: the latest quarter straight from the NSE XBRL filing. */
export function ResultsBlock({ spec }: { spec: { symbol: string } }) {
  const sym = spec.symbol?.toUpperCase();
  const { data, err } = useData<ResultsCard>(sym ? `/companies/${sym}/results` : null);
  return (
    <Shell title={data ? `${sym} · ${quarterLabel(data.period_end)} results` : `${sym} results`} onOpen={() => router.push({ pathname: '/company/[symbol]', params: { symbol: sym } })} openLabel={`Open ${sym}`}>
      {err ? <Failed what="results" /> : data ? <ResultsTable card={data} /> : <Loading />}
    </Shell>
  );
}

/** {"id":"<feed id>"}: a Brief story as its row, tappable. */
export function StoryBlock({ spec }: { spec: { id: string } }) {
  const { data, err } = useData<Story>(spec.id ? `/stories/${spec.id}` : null);
  return (
    <View style={{ marginVertical: space.s, borderWidth: 1, borderColor: color.line, backgroundColor: color.raised, paddingHorizontal: space.l }}>
      {err ? <View style={{ paddingVertical: space.m }}><Failed what="that story" /></View> : data ? <StoryRow story={data} /> : <Loading />}
    </View>
  );
}

/** {} or {"symbols":[...]}: the portfolio's rows with weight, last close and the day's move. */
export function HoldingsBlock({ spec }: { spec: { symbols?: string[]; title?: string } }) {
  const { data, err } = useData<Holding[]>('/holdings');
  const want = spec.symbols?.map((s) => s.toUpperCase());
  const rows = (data ?? []).filter((h) => !want || want.includes(h.symbol));
  return (
    <Shell title={spec.title ?? 'Your holdings'}>
      {err ? <Failed what="holdings" /> : !data ? <Loading /> : rows.map((h, i) => (
        <Pressable key={h.symbol} onPress={() => router.push({ pathname: '/company/[symbol]', params: { symbol: h.symbol } })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderTopWidth: i ? 1 : 0, borderColor: color.line, backgroundColor: pressed ? color.inset : 'transparent' })}>
          <View style={{ flex: 1 }}><Ticker>{h.symbol}</Ticker></View>
          <Figure size={13} c={color.text2} style={{ width: 44, textAlign: 'right' }}>{h.weight ? `${h.weight}%` : '—'}</Figure>
          <Figure size={13} style={{ width: 88, textAlign: 'right', fontFamily: font.semibold }}>{rupee(h.close)}</Figure>
          <View style={{ width: 64, alignItems: 'flex-end' }}><Pct v={h.change_pct} size={12} digits={2} /></View>
        </Pressable>
      ))}
    </Shell>
  );
}

/** {"symbol":"LT","path":"transcripts/2026-05-concall.md","section":"Page 12"}: the cited passage itself. */
export function SourceBlock({ spec }: { spec: { symbol: string; path: string; section?: string; title?: string } }) {
  const sym = spec.symbol?.toUpperCase();
  const path = spec.path?.replace(/^kb\/companies\/[^/]+\/wiki\//, '');
  const q = spec.section ? `?section=${encodeURIComponent(spec.section)}&chars=1200` : '?chars=1200';
  const { data, err } = useData<{ markdown: string }>(sym && path ? `/companies/${sym}/brain/${path}${q}` : null);
  return (
    <Shell title={spec.title ?? `${sym} · ${path?.replace(/\.md$/, '')}${spec.section ? ` · ${spec.section}` : ''}`} onOpen={() => openBrainPage(sym, path, spec.section)} openLabel="Open the full page">
      {err ? <Failed what="that page" /> : data ? <Markdown text={data.markdown.slice(0, 1200)} size={13} /> : <Loading />}
    </Shell>
  );
}
