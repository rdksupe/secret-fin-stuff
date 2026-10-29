import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Spark } from '@/components/spark';
import { Rule } from '@/components/story-row';
import { Body, Mono, Pct, Ticker, Title } from '@/components/type';
import { api, type Holding, type Me } from '@/lib/api';
import { day as fmtDay, rupee } from '@/lib/format';
import { color, font, size, space } from '@/theme';

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'results', label: 'Results' },
  { key: 'management', label: 'Management changes' },
  { key: 'mna', label: 'M&A and restructuring' },
  { key: 'distress', label: 'Defaults and insolvency' },
  { key: 'rating', label: 'Credit ratings' },
  { key: 'orders', label: 'Orders and contracts' },
  { key: 'legal', label: 'Legal and regulatory' },
  { key: 'capital', label: 'Dividends, buybacks, fund raises' },
];

function Stepper({ value, unit, step, min, max, onChange }: { value: number; unit: string; step: number; min: number; max: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 10) / 10);
  const btn = (label: string, v: number, a11y: string) => (
    <Pressable onPress={() => set(v)} accessibilityLabel={a11y} hitSlop={6} style={{ width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: color.hairline, alignItems: 'center', justifyContent: 'center' }}>
      <Mono size={16} c={color.paper}>{label}</Mono>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {btn('−', value - step, 'Decrease')}
      <Mono size={16} style={{ minWidth: 64, textAlign: 'center' }}>
        {value}
        {unit}
      </Mono>
      {btn('+', value + step, 'Increase')}
    </View>
  );
}

function Toggle({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11 }}>
      <Body size={15} c={on ? color.paper : color.mist} style={{ flex: 1 }}>{label}</Body>
      <View style={{ width: 36, height: 20, borderRadius: 10, backgroundColor: on ? color.paper : color.well, padding: 2, alignItems: on ? 'flex-end' : 'flex-start' }}>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: on ? color.ink : color.dim }} />
      </View>
    </Pressable>
  );
}

export default function Watch() {
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [prices, setPrices] = useState<Record<string, number[]>>({});
  const [me, setMe] = useState<Me | null>(null);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, m] = await Promise.all([api.get<Holding[]>('/holdings'), api.get<Me>('/me')]);
      setHoldings(h);
      setMe(m);
      api.get<Record<string, number[]>>('/holdings/prices?days=30').then(setPrices).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    try {
      setMe(await api.put<Me>('/me', patch));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const add = async () => {
    const syms = adding.toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (!syms.length) return;
    setBusy(`Building brains for ${syms.join(', ')}…`);
    try {
      await api.post('/holdings', { symbols: syms });
      setAdding('');
      await load();
    } catch (e: any) {
      setError(`Couldn't add ${syms.join(', ')}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const up = holdings?.filter((h) => (h.change_pct ?? 0) > 0).length ?? 0;
  const down = holdings?.filter((h) => (h.change_pct ?? 0) < 0).length ?? 0;
  const day = holdings?.find((h) => h.day)?.day;

  return (
    <Screen>
      <Title size={20} style={{ fontFamily: font.bold, letterSpacing: 0.5 }}>Watch</Title>
      <Body c={color.mist} style={{ marginTop: space.l }}>
        {holdings ? `${holdings.length} companies. ${up} closed up, ${down} down${day ? ` on ${fmtDay(day)}` : ''}.` : 'Loading your companies…'}
      </Body>
      {error && <Body c={color.loss} size={13} style={{ marginTop: space.m }}>{error}</Body>}

      <View style={{ marginTop: space.l }}>
        <Rule />
        {holdings === null ? (
          <ActivityIndicator color={color.marigold} style={{ marginTop: space.xl }} />
        ) : (
          holdings.map((h) => (
            <View key={h.symbol}>
              <Pressable
                onPress={() => router.push({ pathname: '/company/[symbol]', params: { symbol: h.symbol } })}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Ticker>{h.symbol}</Ticker>
                  <Body size={size.meta} c={color.dim} numberOfLines={1}>{h.name ?? h.industry ?? ''}</Body>
                </View>
                <Spark values={prices[h.symbol] ?? []} />
                <View style={{ width: 92, alignItems: 'flex-end' }}>
                  <Mono size={13}>{rupee(h.close)}</Mono>
                  <Pct v={h.change_pct} size={12} digits={2} />
                </View>
              </Pressable>
              <Rule />
            </View>
          ))
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: space.m }}>
          <TextInput
            value={adding}
            onChangeText={setAdding}
            onSubmitEditing={add}
            autoCapitalize="characters"
            placeholder="Add NSE symbols, e.g. TRENT, KAYNES"
            placeholderTextColor={color.dim}
            style={{ flex: 1, backgroundColor: color.well, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: color.paper, fontFamily: font.mono, fontSize: 13, outlineStyle: 'none' } as any}
          />
          <Pressable onPress={add} disabled={!!busy} style={{ paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, backgroundColor: adding.trim() ? color.paper : color.well }}>
            <Body size={size.small} c={adding.trim() ? color.ink : color.dim}>Add</Body>
          </Pressable>
        </View>
        {busy && <Body size={size.small} c={color.marigold} style={{ marginTop: space.s }}>{busy}</Body>}
      </View>

      {me && (
        <>
          <View style={{ marginTop: space.xxl }}>
            <Title size={size.lead}>Tell me when</Title>
            <Body c={color.mist} size={14} style={{ marginTop: space.s }}>
              FINN checks every close against these and pings you only when one is crossed.
            </Body>
          </View>
          <View style={{ marginTop: space.l, gap: space.l }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Body style={{ flex: 1 }}>Volume is at least</Body>
              <Stepper value={me.thresholds.volume_x} unit="×" step={0.5} min={1} max={10} onChange={(v) => save({ volume_x: v })} />
            </View>
            <Body c={color.dim} size={12} style={{ marginTop: -10 }}>its 20-day average</Body>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Body style={{ flex: 1 }}>Price moves more than</Body>
              <Stepper value={me.thresholds.price_pct} unit="%" step={0.5} min={0.5} max={20} onChange={(v) => save({ price_pct: v })} />
            </View>
            <Body c={color.dim} size={12} style={{ marginTop: -10 }}>in a single day, either way</Body>
          </View>

          <View style={{ marginTop: space.xxl }}>
            <Title size={size.lead}>Filings that ping me</Title>
            <Body c={color.mist} size={14} style={{ marginTop: space.s }}>
              Everything else still shows in the brief. FINN also pings on anything it judges serious, whatever the category.
            </Body>
          </View>
          <View style={{ marginTop: space.s }}>
            {CATEGORIES.map((c) => {
              const on = me.alert_categories.includes(c.key);
              return (
                <Toggle
                  key={c.key}
                  on={on}
                  label={c.label}
                  onPress={() => save({ alert_categories: on ? me.alert_categories.filter((k) => k !== c.key) : [...me.alert_categories, c.key] })}
                />
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}
