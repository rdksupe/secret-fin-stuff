import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { CloseIcon, SearchIcon } from '@/components/icons';
import { Body, Ticker } from '@/components/type';
import { api } from '@/lib/api';
import { color, font, size, space, touch } from '@/theme';

type Hit = { symbol: string; name: string };

/**
 * Pick NSE companies by symbol or name. Results come from NSE's own equity list, so only listed
 * symbols can be added; picks show as chips and `onAdd` gets them when the investor taps Add.
 */
export function TickerSearch({ onAdd, busy, exclude = [] }: { onAdd: (symbols: string[]) => void; busy?: boolean; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Hit[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<Hit[]>(`/symbols?q=${encodeURIComponent(term)}&limit=6`)
        .then((r) => n === seq.current && setHits(r))
        .catch(() => n === seq.current && setHits([]))
        .finally(() => n === seq.current && setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (h: Hit) => {
    setPicked((p) => (p.some((x) => x.symbol === h.symbol) ? p : [...p, h]));
    setQ('');
    setHits([]);
  };
  const shown = hits.filter((h) => !picked.some((p) => p.symbol === h.symbol));
  const held = new Set(exclude);

  return (
    <View style={{ marginTop: space.l }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: touch, backgroundColor: color.raised, borderWidth: 1, borderColor: color.line, paddingHorizontal: 14 }}>
        <SearchIcon c={color.text3} size={18} />
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => shown[0] && pick(shown[0])}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="Add a company: symbol or name"
          placeholderTextColor={color.text3}
          accessibilityLabel="Search NSE companies"
          style={{ flex: 1, height: touch, color: color.text, fontFamily: font.medium, fontSize: 15, outlineStyle: 'none' } as never}
        />
        {loading ? <ActivityIndicator color={color.sea} size="small" /> : null}
      </View>

      {shown.length > 0 ? (
        <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: color.line, backgroundColor: color.raised }}>
          {shown.map((h, i) => (
            <Pressable
              key={h.symbol}
              onPress={() => pick(h)}
              accessibilityRole="button"
              accessibilityLabel={`${h.symbol}, ${h.name}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderColor: color.line, backgroundColor: pressed ? color.inset : 'transparent' })}>
              <Ticker>{h.symbol}</Ticker>
              <Body size={size.small} c={color.text2} numberOfLines={1} style={{ flex: 1 }}>{h.name}</Body>
              {held.has(h.symbol) ? <Body size={size.meta} c={color.text3}>held</Body> : null}
            </Pressable>
          ))}
        </View>
      ) : q.trim() && !loading ? (
        <Body size={size.meta} c={color.text3} style={{ marginTop: space.xs }}>No NSE company matches "{q.trim()}".</Body>
      ) : null}

      {picked.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s, marginTop: space.m }}>
          {picked.map((h) => (
            <View key={h.symbol} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingLeft: 12, borderWidth: 1, borderColor: color.sea, backgroundColor: color.seaTint }}>
              <Ticker>{h.symbol}</Ticker>
              <Pressable onPress={() => setPicked((p) => p.filter((x) => x.symbol !== h.symbol))} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${h.symbol}`} style={{ width: 32, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                <CloseIcon c={color.sea} size={16} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => {
              onAdd(picked.map((h) => h.symbol));
              setPicked([]);
            }}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => ({ height: touch, paddingHorizontal: 20, justifyContent: 'center', borderRadius: touch / 2, backgroundColor: pressed ? '#25605A' : color.sea, opacity: busy ? 0.6 : 1 })}>
            <Body size={size.small} c={color.onSea} style={{ fontFamily: font.semibold }}>
              Add {picked.length === 1 ? picked[0].symbol : `${picked.length} companies`}
            </Body>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
