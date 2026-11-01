import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { ChevronRight } from '@/components/icons';
import { Body, Figure, Strong, Ticker } from '@/components/type';
import { color, font, size, space, touch } from '@/theme';

// Generative UI: FINN answers with small JSON blocks in fenced code (```finn-chart, ```finn-table,
// ```finn-cards, ```finn-actions) and the app draws them as native, tappable components.

export type ChartSpec = {
  kind?: 'bar' | 'line';
  title?: string;
  unit?: string;
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  source?: string;
};
export type TableSpec = { title?: string; columns: string[]; rows: (string | number | null)[][]; source?: string };
export type CardsSpec = { title?: string; items: { symbol?: string; title: string; value?: string; delta?: number | null; note?: string }[] };
export type ActionsSpec = { actions: { label: string; prompt: string }[] };

const SERIES = [color.sea, color.brass, '#5E8F86', '#7A5712', '#9BB8B0'];

function fmt(v: number | null | undefined, unit?: string): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const s = abs >= 1e5 ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : abs >= 100 ? v.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : String(Math.round(v * 100) / 100);
  return unit === '%' ? `${s}%` : s;
}

function Frame({ title, source, children }: { title?: string; source?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginVertical: space.s, borderWidth: 1, borderColor: color.line, backgroundColor: color.raised, padding: space.m }}>
      {title ? <Strong size={size.small} style={{ marginBottom: space.s }}>{title}</Strong> : null}
      {children}
      {source ? <Body size={size.meta} c={color.text3} style={{ marginTop: space.s }}>{source}</Body> : null}
    </View>
  );
}

function Legend({ spec, hidden, toggle }: { spec: ChartSpec; hidden: Set<number>; toggle: (i: number) => void }) {
  if (spec.series.length < 2) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.s }}>
      {spec.series.map((s, i) => (
        <Pressable
          key={s.name}
          onPress={() => toggle(i)}
          accessibilityRole="button"
          accessibilityState={{ selected: !hidden.has(i) }}
          hitSlop={6}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 10, borderWidth: 1, borderColor: color.line, backgroundColor: hidden.has(i) ? 'transparent' : color.bg }}>
          <View style={{ width: 10, height: 10, backgroundColor: hidden.has(i) ? color.faint : SERIES[i % SERIES.length] }} />
          <Body size={size.meta} c={hidden.has(i) ? color.text3 : color.text}>{s.name}</Body>
        </Pressable>
      ))}
    </View>
  );
}

/** Grouped horizontal bars (categories down the page fit a phone) or a line over labels. Tap for values. */
export function ChartArtifact({ spec }: { spec: ChartSpec }) {
  const { width } = useWindowDimensions();
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [pick, setPick] = useState<{ li: number; si: number } | null>(null);
  const toggle = (i: number) => setHidden((h) => { const n = new Set(h); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const shown = spec.series.map((s, i) => ({ ...s, i })).filter((s) => !hidden.has(s.i));
  const all = shown.flatMap((s) => s.values).filter((v): v is number => typeof v === 'number');
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const w = Math.min(width - 64, 560);

  if ((spec.kind ?? 'bar') === 'line') {
    const h = 180;
    const padL = 8, padR = 8, padT = 14, padB = 22;
    // A line reads the change, not the distance from zero: fit the range to the data.
    const lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
    const lmin = lo - pad, lmax = hi + pad;
    const span = lmax - lmin || 1;
    const x = (li: number) => padL + (li / Math.max(1, spec.labels.length - 1)) * (w - padL - padR);
    const y = (v: number) => padT + (1 - (v - lmin) / span) * (h - padT - padB);
    return (
      <Frame title={spec.title} source={spec.source}>
        <Legend spec={spec} hidden={hidden} toggle={toggle} />
        <Svg width={w} height={h}>
          <Line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke={color.line} strokeWidth={1} />
          <SvgText x={padL} y={padT - 3} fontSize={11} fontFamily={font.medium} fill={color.text3}>{fmt(hi, spec.unit)}</SvgText>
          <SvgText x={padL} y={h - padB - 4} fontSize={11} fontFamily={font.medium} fill={color.text3}>{fmt(lo, spec.unit)}</SvgText>
          {shown.map((s) => (
            <Polyline key={s.name} points={s.values.map((v, li) => (v === null ? null : `${x(li)},${y(v)}`)).filter(Boolean).join(' ')} fill="none" stroke={SERIES[s.i % SERIES.length]} strokeWidth={2} />
          ))}
          {shown.map((s) => s.values.map((v, li) => (v === null ? null : (
            <Circle key={`${s.name}${li}`} cx={x(li)} cy={y(v)} r={pick?.li === li ? 5 : 3} fill={SERIES[s.i % SERIES.length]} />
          ))))}
          {[0, spec.labels.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((li) => (
            <SvgText key={li} x={x(li)} y={h - 6} fontSize={11} fontFamily={font.medium} fill={color.text3} textAnchor={li === 0 ? 'start' : 'end'}>{spec.labels[li]}</SvgText>
          ))}
        </Svg>
        {/* Tap targets per label column: tap anywhere in the chart's width to read that point. */}
        <View style={{ flexDirection: 'row', marginTop: -h, height: h }}>
          {spec.labels.map((_, li) => (
            <Pressable key={li} style={{ flex: 1 }} onPress={() => setPick({ li, si: shown[0]?.i ?? 0 })} accessibilityLabel={spec.labels[li]} />
          ))}
        </View>
        {pick ? (
          <Body size={size.small} style={{ marginTop: space.s }}>
            <Text style={{ fontFamily: font.semibold }}>{spec.labels[pick.li]}</Text>
            {shown.map((s) => ` · ${s.name} ${fmt(s.values[pick.li], spec.unit)}`).join('')}
          </Body>
        ) : (
          <Body size={size.meta} c={color.text3} style={{ marginTop: space.s }}>Tap the chart to read a point.</Body>
        )}
      </Frame>
    );
  }

  // Bars: one row per label, a bar per visible series, value at the bar's end.
  const labelW = Math.min(110, w * 0.32);
  const barArea = w - labelW - 64;
  const scale = (v: number) => (Math.abs(v) / (Math.max(Math.abs(max), Math.abs(min)) || 1)) * barArea;
  return (
    <Frame title={spec.title} source={spec.source}>
      <Legend spec={spec} hidden={hidden} toggle={toggle} />
      {spec.labels.map((label, li) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: li < spec.labels.length - 1 ? 1 : 0, borderColor: color.line }}>
          <Body size={size.meta} c={color.text2} numberOfLines={2} style={{ width: labelW, paddingRight: 8 }}>{label}</Body>
          <View style={{ flex: 1, gap: 3 }}>
            {shown.map((s) => {
              const v = s.values[li];
              const on = pick?.li === li && pick.si === s.i;
              return (
                <Pressable key={s.name} onPress={() => setPick(on ? null : { li, si: s.i })} accessibilityLabel={`${label}, ${s.name}, ${fmt(v, spec.unit)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 18 }}>
                  <View style={{ width: v === null ? 0 : Math.max(2, scale(v)), height: 12, backgroundColor: v !== null && v < 0 ? color.loss : SERIES[s.i % SERIES.length], opacity: pick && !on ? 0.55 : 1 }} />
                  <Figure size={11} c={on ? color.text : color.text2} style={on ? { fontFamily: font.bold } : undefined}>{fmt(v, spec.unit)}</Figure>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {pick ? (
        <Body size={size.small} style={{ marginTop: space.s }}>
          <Text style={{ fontFamily: font.semibold }}>{spec.labels[pick.li]}</Text>
          {` · ${spec.series[pick.si].name}: ${fmt(spec.series[pick.si].values[pick.li], spec.unit)}${spec.unit && spec.unit !== '%' ? ` ${spec.unit}` : ''}`}
        </Body>
      ) : null}
    </Frame>
  );
}

/** A table you can sort by tapping a column header. */
export function TableArtifact({ spec }: { spec: TableSpec }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[₹,%x+\s]/g, '').replace('−', '-')));
  const rows = sort
    ? [...spec.rows].sort((a, b) => {
        const x = num(a[sort.col]), y = num(b[sort.col]);
        if (!Number.isNaN(x) && !Number.isNaN(y)) return (x - y) * sort.dir;
        return String(a[sort.col] ?? '').localeCompare(String(b[sort.col] ?? '')) * sort.dir;
      })
    : spec.rows;
  return (
    <Frame title={spec.title} source={spec.source}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: color.line }}>
            {spec.columns.map((c, ci) => (
              <Pressable key={c} onPress={() => setSort((s) => (s?.col === ci ? { col: ci, dir: s.dir === 1 ? -1 : 1 } : { col: ci, dir: -1 }))} accessibilityRole="button" style={{ minWidth: ci === 0 ? 108 : 84, height: 36, justifyContent: 'center', paddingRight: 12 }}>
                <Body size={size.meta} c={sort?.col === ci ? color.sea : color.text3} style={{ fontFamily: font.semibold, textAlign: ci === 0 ? 'left' : 'right' }}>
                  {c}{sort?.col === ci ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                </Body>
              </Pressable>
            ))}
          </View>
          {rows.map((r, ri) => (
            <View key={ri} style={{ flexDirection: 'row', borderBottomWidth: ri < rows.length - 1 ? 1 : 0, borderColor: color.line }}>
              {r.map((v, ci) => {
                const s = v === null || v === undefined ? '—' : typeof v === 'number' ? fmt(v) : String(v);
                const neg = /^[−-]/.test(s);
                return (
                  <View key={ci} style={{ minWidth: ci === 0 ? 108 : 84, paddingVertical: 8, paddingRight: 12 }}>
                    <Figure size={13} c={ci === 0 ? color.text : neg ? color.loss : color.text} style={{ textAlign: ci === 0 ? 'left' : 'right', fontFamily: ci === 0 ? font.semibold : font.medium }}>{s}</Figure>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <Body size={size.meta} c={color.text3} style={{ marginTop: space.xs }}>Tap a column to sort.</Body>
    </Frame>
  );
}

/** Company or metric cards; a card with a symbol opens that company. */
export function CardsArtifact({ spec }: { spec: CardsSpec }) {
  return (
    <View style={{ marginVertical: space.s, gap: space.s }}>
      {spec.title ? <Strong size={size.small}>{spec.title}</Strong> : null}
      {spec.items.map((it, i) => (
        <Pressable
          key={i}
          disabled={!it.symbol}
          onPress={() => it.symbol && router.push({ pathname: '/company/[symbol]', params: { symbol: it.symbol } })}
          accessibilityRole={it.symbol ? 'button' : undefined}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, borderWidth: 1, borderColor: color.line, backgroundColor: pressed ? color.inset : color.raised, paddingHorizontal: space.m, paddingVertical: space.s })}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {it.symbol ? <Ticker>{it.symbol}</Ticker> : null}
              <Body size={size.small} style={{ fontFamily: font.semibold, flexShrink: 1 }} numberOfLines={2}>{it.title}</Body>
            </View>
            {it.note ? <Body size={size.meta} c={color.text2} numberOfLines={2} style={{ marginTop: 2 }}>{it.note}</Body> : null}
          </View>
          {it.value ? <Figure size={14} style={{ fontFamily: font.semibold }}>{it.value}</Figure> : null}
          {typeof it.delta === 'number' ? <Figure size={13} c={it.delta < 0 ? color.loss : color.gain} style={{ fontFamily: font.semibold }}>{`${it.delta > 0 ? '+' : it.delta < 0 ? '−' : ''}${Math.abs(it.delta)}%`}</Figure> : null}
          {it.symbol ? <ChevronRight c={color.sea} size={18} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** Follow-up buttons: tapping sends that prompt to FINN. */
export function ActionsArtifact({ spec, onAction }: { spec: ActionsSpec; onAction?: (prompt: string) => void }) {
  if (!onAction) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginVertical: space.s }}>
      {spec.actions.slice(0, 4).map((a) => (
        <Pressable
          key={a.label}
          onPress={() => onAction(a.prompt)}
          accessibilityRole="button"
          style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: color.sea, backgroundColor: pressed ? color.seaTint : 'transparent' })}>
          <Body size={size.small} c={color.sea} style={{ fontFamily: font.semibold }}>{a.label}</Body>
        </Pressable>
      ))}
    </View>
  );
}

/** Render one fenced block: a finn-* artifact when it parses, otherwise a plain code panel. */
export function Artifact({ lang, body, onAction }: { lang: string; body: string; onAction?: (prompt: string) => void }) {
  let spec: any = null;
  if (lang.startsWith('finn-')) {
    try {
      spec = JSON.parse(body);
    } catch {
      spec = null;
    }
  }
  try {
    if (spec && lang === 'finn-chart' && Array.isArray(spec.labels) && Array.isArray(spec.series)) return <ChartArtifact spec={spec} />;
    if (spec && lang === 'finn-table' && Array.isArray(spec.columns) && Array.isArray(spec.rows)) return <TableArtifact spec={spec} />;
    if (spec && lang === 'finn-cards' && Array.isArray(spec.items)) return <CardsArtifact spec={spec} />;
    if (spec && lang === 'finn-actions' && Array.isArray(spec.actions)) return <ActionsArtifact spec={spec} onAction={onAction} />;
  } catch {}
  // A finn block still streaming in (or malformed): a quiet placeholder rather than raw JSON.
  if (lang.startsWith('finn-')) {
    return (
      <View style={{ marginVertical: space.s, borderWidth: 1, borderColor: color.line, padding: space.m, minHeight: touch }}>
        <Body size={size.meta} c={color.text3}>Drawing {lang.slice(5)}…</Body>
      </View>
    );
  }
  return (
    <ScrollView horizontal style={{ marginVertical: space.s, backgroundColor: color.inset }} contentContainerStyle={{ padding: space.m }}>
      <Text style={{ fontFamily: 'monospace', fontSize: 12, color: color.text }}>{body}</Text>
    </ScrollView>
  );
}

