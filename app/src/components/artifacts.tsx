import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Svg, { Circle, Line, Path, Polygon, Polyline, Text as SvgText } from 'react-native-svg';

import { ChevronRight } from '@/components/icons';
import { HoldingsBlock, PriceBlock, ResultsBlock, SourceBlock, StoryBlock } from '@/components/live-blocks';
import { ScenarioArtifact } from '@/components/scenario';
import { Body, Figure, Strong, Ticker } from '@/components/type';
import { color, font, size, space, touch } from '@/theme';

// Generative UI: FINN answers with small JSON blocks in fenced code (```finn-chart, ```finn-table,
// ```finn-cards, ```finn-actions) and the app draws them as native, tappable components.

export type ChartSpec = {
  kind?: 'bar' | 'line' | 'area' | 'donut' | 'scatter';
  points?: { label: string; x: number; y: number }[]; // scatter
  xLabel?: string;
  yLabel?: string;
  title?: string;
  unit?: string;
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  source?: string;
};
export type TableSpec = { title?: string; columns: string[]; rows: (string | number | null)[][]; source?: string };
export type CardsSpec = { title?: string; layout?: 'list' | 'carousel'; items: { symbol?: string; title: string; value?: string; delta?: number | null; note?: string }[] };
export type ActionsSpec = { actions: { label: string; prompt: string }[] };
export type TimelineSpec = { title?: string; items: { date: string; title: string; note?: string; status?: string }[]; source?: string };
export type FormSpec = {
  title?: string;
  fields: { id: string; label: string; type: 'text' | 'number' | 'select' | 'multi'; options?: string[]; value?: string | string[] }[];
  submit: { label: string; prompt: string };
};

const SERIES = [color.sea, '#7FA9A0', '#3D4D49', '#B7C6C0', '#5E8F86'];

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
  const kind = spec.kind ?? 'bar';

  if (kind === 'donut') return <Donut spec={spec} />;
  if (kind === 'scatter') return <Scatter spec={spec} w={w} />;

  if (kind === 'line' || kind === 'area') {
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
          {kind === 'area'
            ? shown.map((s) => {
                const pts = s.values.map((v, li) => (v === null ? null : `${x(li)},${y(v)}`)).filter(Boolean) as string[];
                if (pts.length < 2) return null;
                const first = pts[0].split(',')[0], last = pts[pts.length - 1].split(',')[0];
                return <Polygon key={`f${s.name}`} points={`${first},${h - padB} ${pts.join(' ')} ${last},${h - padB}`} fill={SERIES[s.i % SERIES.length]} opacity={0.14} />;
              })
            : null}
          {shown.map((s) => (
            <Polyline key={s.name} points={s.values.map((v, li) => (v === null ? null : `${x(li)},${y(v)}`)).filter(Boolean).join(' ')} fill="none" stroke={SERIES[s.i % SERIES.length]} strokeWidth={2} />
          ))}
          {/* Dots only where they help: short series, or the point being read on a long one. */}
          {shown.map((s) => s.values.map((v, li) => (v === null || (spec.labels.length > 24 && pick?.li !== li) ? null : (
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

/** A donut over one series: share of each label, tap a row to light its segment. */
function Donut({ spec }: { spec: ChartSpec }) {
  const [pick, setPick] = useState<number | null>(null);
  const vals = (spec.series[0]?.values ?? []).map((v) => (typeof v === 'number' && v > 0 ? v : 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  // Values already in % (e.g. portfolio weights) are shown as given, not re-shared to 100.
  const asGiven = spec.unit === '%';
  const share = (v: number) => (asGiven ? v : Math.round((v / total) * 1000) / 10);
  const R = 70, r = 44, c = 80;
  let a0 = -Math.PI / 2;
  const arcs = vals.map((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${c + rad * Math.cos(ang)},${c + rad * Math.sin(ang)}`;
    const d = v <= 0 ? '' : v >= total ? `M ${p(R, 0)} A ${R} ${R} 0 1 1 ${p(R, Math.PI)} A ${R} ${R} 0 1 1 ${p(R, 0)} M ${p(r, 0)} A ${r} ${r} 0 1 0 ${p(r, Math.PI)} A ${r} ${r} 0 1 0 ${p(r, 0)} Z`
      : `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
    a0 = a1;
    return { d, i };
  });
  const COLORS = [color.sea, '#7FA9A0', '#3D4D49', '#B7C6C0', '#5E8F86', '#2C6A62', '#9BB8B0', '#6F837D'];
  return (
    <Frame title={spec.title} source={spec.source}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <Svg width={160} height={160}>
          {arcs.map((a) => (a.d ? <Path key={a.i} d={a.d} fill={COLORS[a.i % COLORS.length]} opacity={pick === null || pick === a.i ? 1 : 0.3} fillRule="evenodd" /> : null))}
          <SvgText x={c} y={c + 5} fontSize={13} fontFamily={font.semibold} fill={color.text} textAnchor="middle">
            {pick === null ? fmt(total, spec.unit) : `${share(vals[pick])}%`}
          </SvgText>
        </Svg>
        <View style={{ flex: 1, gap: 2 }}>
          {spec.labels.map((l, i) => (
            <Pressable key={l} onPress={() => setPick(pick === i ? null : i)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 }}>
              <View style={{ width: 10, height: 10, backgroundColor: COLORS[i % COLORS.length] }} />
              <Body size={size.meta} style={{ flex: 1 }} numberOfLines={1}>{l}</Body>
              <Figure size={12} c={color.text2}>{share(vals[i])}%</Figure>
            </Pressable>
          ))}
        </View>
      </View>
    </Frame>
  );
}

/** Points on two axes (e.g. growth vs margin across holdings); tap a point to read it. */
function Scatter({ spec, w }: { spec: ChartSpec; w: number }) {
  const [pick, setPick] = useState<number | null>(null);
  const pts = spec.points ?? [];
  if (pts.length === 0) return null;
  const h = 220, pad = 28;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const px = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (w - pad * 2);
  const py = (v: number) => h - pad - ((v - y0) / (y1 - y0 || 1)) * (h - pad * 2);
  return (
    <Frame title={spec.title} source={spec.source}>
      <View style={{ width: w, height: h }}>
        <Svg width={w} height={h}>
          <Line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke={color.line} />
          <Line x1={pad} x2={pad} y1={pad} y2={h - pad} stroke={color.line} />
          {spec.xLabel ? <SvgText x={w - pad} y={h - 8} fontSize={11} fontFamily={font.medium} fill={color.text3} textAnchor="end">{spec.xLabel}</SvgText> : null}
          {spec.yLabel ? <SvgText x={pad} y={pad - 10} fontSize={11} fontFamily={font.medium} fill={color.text3}>{spec.yLabel}</SvgText> : null}
          {pts.map((p, i) => (
            <Circle key={p.label} cx={px(p.x)} cy={py(p.y)} r={pick === i ? 7 : 5} fill={pick === i ? color.text : color.sea} opacity={0.9} />
          ))}
          {pts.map((p) => (
            <SvgText key={`t${p.label}`} x={px(p.x) + 8} y={py(p.y) + 4} fontSize={10} fontFamily={font.semibold} fill={color.text2}>{p.label}</SvgText>
          ))}
        </Svg>
        {pts.map((p, i) => (
          <Pressable key={`h${p.label}`} onPress={() => setPick(pick === i ? null : i)} accessibilityLabel={`${p.label}: ${p.x}, ${p.y}`} style={{ position: 'absolute', left: px(p.x) - 16, top: py(p.y) - 16, width: 32, height: 32 }} />
        ))}
      </View>
      {pick !== null ? (
        <Body size={size.small} style={{ marginTop: space.s }}>
          <Text style={{ fontFamily: font.semibold }}>{pts[pick].label}</Text>
          {` · ${spec.xLabel ?? 'x'} ${fmt(pts[pick].x)} · ${spec.yLabel ?? 'y'} ${fmt(pts[pick].y)}`}
        </Body>
      ) : (
        <Body size={size.meta} c={color.text3} style={{ marginTop: space.s }}>Tap a point to read it.</Body>
      )}
    </Frame>
  );
}

// Loss red is for price losses and brass for FINN acting, so verdicts stay in ink.
const STATUS_C: Record<string, string> = { delivered: color.gain, done: color.gain, missed: color.text, partly: color.text2, pending: color.text3, too_early: color.text3 };

/** Dated events down a line: a developing situation, guidance call by call. */
export function TimelineArtifact({ spec }: { spec: TimelineSpec }) {
  return (
    <Frame title={spec.title} source={spec.source}>
      {spec.items.map((it, i) => {
        const c = STATUS_C[(it.status ?? '').toLowerCase().replace(' ', '_')] ?? color.sea;
        return (
          <View key={i} style={{ flexDirection: 'row', gap: space.m }}>
            <View style={{ width: 12, alignItems: 'center' }}>
              <View style={{ width: 10, height: 10, backgroundColor: c, marginTop: 5 }} />
              {i < spec.items.length - 1 ? <View style={{ flex: 1, width: 1, backgroundColor: color.line, marginTop: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: space.m }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
                <Figure size={12} c={color.text3}>{it.date}</Figure>
                {it.status ? <Body size={size.meta} c={c} style={{ fontFamily: font.semibold }}>{it.status}</Body> : null}
              </View>
              <Body size={size.small} style={{ fontFamily: font.semibold, marginTop: 2 }}>{it.title}</Body>
              {it.note ? <Body size={size.meta} c={color.text2} style={{ marginTop: 2 }}>{it.note}</Body> : null}
            </View>
          </View>
        );
      })}
    </Frame>
  );
}

/** A form whose submit sends a filled-in prompt (e.g. set up a watch). */
export function FormArtifact({ spec, onAction }: { spec: FormSpec; onAction?: (prompt: string) => void }) {
  const [vals, setVals] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(spec.fields.map((f) => [f.id, f.value ?? (f.type === 'multi' ? [] : f.type === 'select' ? f.options?.[0] ?? '' : '')])),
  );
  const [sent, setSent] = useState(false);
  const set = (id: string, v: string | string[]) => setVals((s) => ({ ...s, [id]: v }));
  const submit = () => {
    const prompt = spec.submit.prompt.replace(/\{(\w+)\}/g, (_, k) => {
      const v = vals[k];
      return Array.isArray(v) ? v.join(', ') : String(v ?? '');
    });
    onAction?.(prompt);
    setSent(true);
  };
  return (
    <Frame title={spec.title}>
      {spec.fields.map((f) => (
        <View key={f.id} style={{ marginTop: space.s }}>
          <Body size={size.small} c={color.text2}>{f.label}</Body>
          {f.type === 'select' || f.type === 'multi' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {(f.options ?? []).map((o) => {
                const v = vals[f.id];
                const on = Array.isArray(v) ? v.includes(o) : v === o;
                return (
                  <Pressable
                    key={o}
                    onPress={() => (f.type === 'multi' ? set(f.id, on ? (v as string[]).filter((x) => x !== o) : [...(v as string[]), o]) : set(f.id, o))}
                    accessibilityRole={f.type === 'multi' ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked: on }}
                    hitSlop={6}
                    style={{ height: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 0, borderWidth: 1, borderColor: on ? color.sea : color.line, backgroundColor: on ? color.seaTint : color.bg }}>
                    <Body size={size.small} c={on ? color.sea : color.text} style={{ fontFamily: font.semibold }}>{o}</Body>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <TextInput
              value={String(vals[f.id] ?? '')}
              onChangeText={(t) => set(f.id, t)}
              keyboardType={f.type === 'number' ? 'numeric' : 'default'}
              placeholderTextColor={color.text3}
              style={{ marginTop: 6, height: 44, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, paddingHorizontal: 12, color: color.text, fontFamily: font.medium, fontSize: 15 }}
            />
          )}
        </View>
      ))}
      <Pressable
        onPress={submit}
        disabled={!onAction || sent}
        accessibilityRole="button"
        style={({ pressed }) => ({ marginTop: space.l, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: sent ? color.inset : pressed ? '#25605A' : color.sea })}>
        <Strong size={size.small} c={sent ? color.text3 : color.onSea}>{sent ? 'Sent to FINN' : spec.submit.label}</Strong>
      </Pressable>
    </Frame>
  );
}

/** A table you can sort by tapping a column header. */
export function TableArtifact({ spec }: { spec: TableSpec }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [copied, setCopied] = useState(false);
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
              <Pressable key={c} onPress={() => setSort((s) => (s?.col === ci ? { col: ci, dir: s.dir === 1 ? -1 : 1 } : { col: ci, dir: -1 }))} accessibilityRole="button" style={{ minWidth: ci === 0 ? 108 : 84, height: touch, justifyContent: 'center', paddingRight: 12 }}>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
        <Body size={size.meta} c={color.text3} style={{ flex: 1 }}>Tap a column to sort.</Body>
        <Pressable
          onPress={() => {
            Clipboard.setStringAsync([spec.columns, ...spec.rows].map((r) => r.map((c) => (c === null ? '' : String(c))).join('\t')).join('\n'));
            setCopied(true);
          }}
          accessibilityRole="button"
          hitSlop={8}
          style={{ height: 32, justifyContent: 'center', paddingHorizontal: 10 }}>
          <Body size={size.meta} c={color.sea} style={{ fontFamily: font.semibold }}>{copied ? 'Copied' : 'Copy table'}</Body>
        </Pressable>
      </View>
    </Frame>
  );
}

/** Company or metric cards; a card with a symbol opens that company. */
export function CardsArtifact({ spec }: { spec: CardsSpec }) {
  const { width } = useWindowDimensions();
  if (spec.layout === 'carousel') {
    const cw = Math.min(280, Math.round((width - 64) * 0.78));
    return (
      <View style={{ marginVertical: space.s }}>
        {spec.title ? <Strong size={size.small} style={{ marginBottom: space.s }}>{spec.title}</Strong> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cw + 10} decelerationRate="fast" contentContainerStyle={{ gap: 10 }}>
          {spec.items.map((it, i) => (
            <Pressable
              key={i}
              disabled={!it.symbol}
              onPress={() => it.symbol && router.push({ pathname: '/company/[symbol]', params: { symbol: it.symbol } })}
              style={({ pressed }) => ({ width: cw, minHeight: 120, borderWidth: 1, borderColor: color.line, backgroundColor: pressed ? color.inset : color.raised, padding: space.m, justifyContent: 'space-between' })}>
              <View>
                {it.symbol ? <Ticker>{it.symbol}</Ticker> : null}
                <Body size={size.small} style={{ fontFamily: font.semibold, marginTop: 4 }} numberOfLines={3}>{it.title}</Body>
                {it.note ? <Body size={size.meta} c={color.text2} numberOfLines={3} style={{ marginTop: 4 }}>{it.note}</Body> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: space.s }}>
                {it.value ? <Figure size={16} style={{ fontFamily: font.bold }}>{it.value}</Figure> : null}
                {typeof it.delta === 'number' ? <Figure size={13} c={it.delta < 0 ? color.loss : color.gain} style={{ fontFamily: font.semibold }}>{`${it.delta > 0 ? '+' : it.delta < 0 ? '−' : ''}${Math.abs(it.delta)}%`}</Figure> : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }
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
          style={({ pressed }) => ({ minHeight: touch, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: color.sea, backgroundColor: pressed ? color.seaTint : 'transparent' })}>
          <Body size={size.small} c={color.sea} style={{ fontFamily: font.semibold }}>{a.label}</Body>
        </Pressable>
      ))}
    </View>
  );
}

/** Render one fenced block: a finn-* artifact when it parses, otherwise a plain code panel. */
export function Artifact({ lang, body, onAction, closed = false }: { lang: string; body: string; onAction?: (prompt: string) => void; closed?: boolean }) {
  let spec: any = null;
  if (lang.startsWith('finn-')) {
    try {
      spec = JSON.parse(body);
      if (lang === 'finn-actions' && Array.isArray(spec)) spec = { actions: spec }; // FINN sometimes sends the bare list
    } catch {
      spec = null;
    }
  }
  try {
    if (spec && lang === 'finn-chart' && ((Array.isArray(spec.labels) && Array.isArray(spec.series)) || Array.isArray(spec.points)))
      return <ChartArtifact spec={{ labels: [], series: [], ...spec }} />;
    if (spec && lang === 'finn-timeline' && Array.isArray(spec.items)) return <TimelineArtifact spec={spec} />;
    if (spec && lang === 'finn-form' && Array.isArray(spec.fields) && spec.submit) return <FormArtifact spec={spec} onAction={onAction} />;
    if (spec && lang === 'finn-scenario' && Array.isArray(spec.inputs) && Array.isArray(spec.outputs)) return <ScenarioArtifact spec={spec} />;
    if (spec && lang === 'finn-price' && (spec.symbol || spec.symbols)) return <PriceBlock spec={spec} />;
    if (spec && lang === 'finn-results' && spec.symbol) return <ResultsBlock spec={spec} />;
    if (spec && lang === 'finn-story' && spec.id) return <StoryBlock spec={spec} />;
    if (spec && lang === 'finn-holdings') return <HoldingsBlock spec={spec} />;
    if (spec && lang === 'finn-source' && spec.symbol && spec.path) return <SourceBlock spec={spec} />;
    if (spec && lang === 'finn-table' && Array.isArray(spec.columns) && Array.isArray(spec.rows)) return <TableArtifact spec={spec} />;
    if (spec && lang === 'finn-cards' && Array.isArray(spec.items)) return <CardsArtifact spec={spec} />;
    if (spec && lang === 'finn-actions' && Array.isArray(spec.actions)) return <ActionsArtifact spec={spec} onAction={onAction} />;
  } catch {}
  // A finished block that still can't be drawn: leave it out rather than promise a drawing forever.
  if (lang.startsWith('finn-') && closed) return null;
  // A finn block still streaming in: a quiet placeholder rather than raw JSON.
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

