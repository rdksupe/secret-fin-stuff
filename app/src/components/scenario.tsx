import { useMemo, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';

import { Body, Figure, Strong } from '@/components/type';
import { color, font, size, space } from '@/theme';

// ```finn-scenario: a small working tool. Inputs (sliders, choices) feed outputs computed in the
// app from expressions over the inputs and fixed constants, so every number on screen is exact and
// recomputes as the reader moves a slider. Describes consequences; never a recommendation.

type SliderIn = { id: string; label: string; min: number; max: number; step?: number; value?: number; unit?: string };
type ChoiceIn = { id: string; label: string; options: { label: string; value: number }[]; value?: number };
type Output = { label: string; expr: string; unit?: string; digits?: number; bar?: number };
export type ScenarioSpec = { title?: string; inputs: (SliderIn | ChoiceIn)[]; constants?: Record<string, number>; outputs: Output[]; note?: string; source?: string };

// ── a tiny safe expression evaluator: numbers, names, + - * / ^, parentheses, min/max/abs/round ──
function evaluate(expr: string, vars: Record<string, number>): number | null {
  const toks = expr.match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const fns: Record<string, (...a: number[]) => number> = { min: Math.min, max: Math.max, abs: Math.abs, round: Math.round };
  function primary(): number {
    const t = take();
    if (t === undefined) throw new Error('end');
    if (t === '(') {
      const v = sum();
      take();
      return v;
    }
    if (t === '-') return -primary();
    if (/^\d/.test(t)) return parseFloat(t);
    if (fns[t] && peek() === '(') {
      take();
      const args = [sum()];
      while (peek() === ',') {
        take();
        args.push(sum());
      }
      take();
      return fns[t](...args);
    }
    if (t in vars) return vars[t];
    throw new Error(`unknown ${t}`);
  }
  function power(): number {
    const b = primary();
    if (peek() === '^') {
      take();
      return b ** power();
    }
    return b;
  }
  function product(): number {
    let v = power();
    while (peek() === '*' || peek() === '/') v = take() === '*' ? v * power() : v / power();
    return v;
  }
  function sum(): number {
    let v = product();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + product() : v - product();
    return v;
  }
  try {
    const v = sum();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** "₹ Cr" reads as a prefix ("₹2,000 Cr"), "%" hugs the number, anything else follows it. */
const withUnit = (v: number, unit?: string, digits = 1) => {
  const n = fmtNum(v, digits);
  if (!unit) return n;
  if (unit === '%') return `${n}%`;
  const m = unit.match(/^\s*₹\s*(.*)$/);
  return m ? `₹${n}${m[1] ? ` ${m[1]}` : ''}` : `${n} ${unit}`;
};

const fmtNum = (v: number, digits = 1) => v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

function Slider({ input, value, onChange }: { input: SliderIn; value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const step = input.step ?? (input.max - input.min) / 100;
  const set = (x: number) => {
    const raw = input.min + Math.max(0, Math.min(1, x / Math.max(1, w))) * (input.max - input.min);
    onChange(Math.round(raw / step) * step);
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
        onPanResponderMove: (e) => set(e.nativeEvent.locationX),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, input.min, input.max, step],
  );
  const pct = (value - input.min) / (input.max - input.min || 1);
  return (
    <View style={{ marginTop: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Body size={size.small} c={color.text2} style={{ flex: 1 }}>{input.label}</Body>
        <Figure size={14} style={{ fontFamily: font.semibold }}>{withUnit(value, input.unit, 2)}</Figure>
      </View>
      <View
        {...responder.panHandlers}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={input.label}
        accessibilityValue={{ min: input.min, max: input.max, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(Math.max(input.min, Math.min(input.max, value + (e.nativeEvent.actionName === 'increment' ? step : -step))))}
        style={{ height: 40, justifyContent: 'center' }}>
        <View style={{ height: 4, backgroundColor: color.line }}>
          <View style={{ width: `${pct * 100}%`, height: 4, backgroundColor: color.sea }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: Math.max(0, pct * w - 10), width: 20, height: 20, borderRadius: 10, backgroundColor: color.sea, borderWidth: 3, borderColor: color.raised }} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Figure size={11} c={color.text3} style={{ flex: 1 }}>{fmtNum(input.min, 2)}</Figure>
        <Figure size={11} c={color.text3}>{fmtNum(input.max, 2)}</Figure>
      </View>
    </View>
  );
}

function Choice({ input, value, onChange }: { input: ChoiceIn; value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ marginTop: space.m }}>
      <Body size={size.small} c={color.text2}>{input.label}</Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {input.options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.label} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }} hitSlop={6} style={{ height: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 0, borderWidth: 1, borderColor: on ? color.sea : color.line, backgroundColor: on ? color.seaTint : color.bg }}>
              <Body size={size.small} c={on ? color.sea : color.text} style={{ fontFamily: font.semibold }}>{o.label}</Body>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ScenarioArtifact({ spec }: { spec: ScenarioSpec }) {
  const [vals, setVals] = useState<Record<string, number>>(() =>
    Object.fromEntries(spec.inputs.map((inp) => [inp.id, 'options' in inp ? (inp.value ?? inp.options[0]?.value ?? 0) : (inp.value ?? inp.min)])),
  );
  const vars = { ...(spec.constants ?? {}), ...vals };
  return (
    <View style={{ marginVertical: space.s, borderWidth: 1, borderColor: color.line, backgroundColor: color.raised, padding: space.m }}>
      {spec.title ? <Strong size={size.small}>{spec.title}</Strong> : null}
      {spec.inputs.map((inp) =>
        'options' in inp ? (
          <Choice key={inp.id} input={inp} value={vals[inp.id]} onChange={(v) => setVals((s) => ({ ...s, [inp.id]: v }))} />
        ) : (
          <Slider key={inp.id} input={inp} value={vals[inp.id]} onChange={(v) => setVals((s) => ({ ...s, [inp.id]: v }))} />
        ),
      )}
      <View style={{ marginTop: space.l, borderTopWidth: 1, borderColor: color.line }}>
        {spec.outputs.map((o) => {
          const v = evaluate(o.expr, vars);
          return (
            <View key={o.label} style={{ paddingTop: space.m }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m }}>
                <Body size={size.small} style={{ flex: 1 }}>{o.label}</Body>
                <Figure size={18} c={color.sea} style={{ fontFamily: font.bold }}>{v === null ? '—' : withUnit(v, o.unit, o.digits ?? 1)}</Figure>
              </View>
              {o.bar && v !== null ? (
                <View style={{ height: 6, backgroundColor: color.line, marginTop: 6 }}>
                  <View style={{ width: `${Math.max(0, Math.min(1, v / o.bar)) * 100}%`, height: 6, backgroundColor: v > o.bar ? color.loss : color.brass }} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {spec.note ? <Body size={size.meta} c={color.text2} style={{ marginTop: space.m }}>{spec.note}</Body> : null}
      {spec.source ? <Body size={size.meta} c={color.text3} style={{ marginTop: space.xs }}>{spec.source}</Body> : null}
    </View>
  );
}

export const _evaluate = evaluate; // for tests
