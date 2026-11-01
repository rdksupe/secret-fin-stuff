import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openBrainPage } from '@/components/brain';
import { CloseIcon } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { Body, Figure, Strong, Ticker } from '@/components/type';
import { ApiError, api } from '@/lib/api';
import { color, font, size, space, touch } from '@/theme';

// Tap-for-source. FINN cites as [[SYMBOL:path#Section|label]]; the app turns each citation into a
// chip that opens this sheet with the cited passage, so any figure can be checked in one tap.

export type Source = { symbol: string; path: string; section?: string; label?: string };

let current: Source | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openSource(s: Source) {
  current = s;
  emit();
}
function closeSource() {
  current = null;
  emit();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Parse "[[LT:transcripts/2026-05-concall#Page 12|May call p12]]" (the inner part). */
export function parseSource(inner: string): Source | null {
  const m = inner.match(/^([A-Z0-9&-]{1,20}):([^#|]+?)(?:#([^|]+))?(?:\|(.+))?$/);
  if (!m) return null;
  const path = m[2].trim().replace(/^kb\/companies\/[^/]+\/wiki\//, '');
  return { symbol: m[1], path: path.endsWith('.md') ? path : `${path}.md`, section: m[3]?.trim(), label: m[4]?.trim() };
}

/** The inline chip a citation renders as (inside running text). */
export function SourceChip({ s, base }: { s: Source; base: object }) {
  const label = s.label ?? `${s.path.replace(/\.md$/, '').split('/').pop()}${s.section ? ` · ${s.section}` : ''}`;
  return (
    <Text
      onPress={() => openSource(s)}
      accessibilityRole="link"
      accessibilityLabel={`Source: ${s.symbol} ${label}`}
      style={[base, { fontFamily: font.semibold, fontSize: 13, color: color.sea, backgroundColor: color.seaTint }]}>
      {` ${label} `}
    </Text>
  );
}

/** One sheet for the whole app, mounted at the root. */
export function SourceSheet() {
  const s = useSyncExternalStore(subscribe, () => current, () => null);
  const insets = useSafeAreaInsets();
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<false | 'missing' | 'locked'>(false);

  useEffect(() => {
    if (!s) return;
    let live = true;
    setMd(null);
    setErr(false);
    api
      .get<{ markdown: string }>(`/companies/${s.symbol}/brain/${s.path}${s.section ? `?section=${encodeURIComponent(s.section)}&chars=2400` : '?chars=2400'}`)
      .then((r) => live && setMd(r.markdown))
      .catch((e) => live && setErr(e instanceof ApiError && e.status === 401 ? 'locked' : 'missing'));
    return () => {
      live = false;
    };
  }, [s]);

  return (
    <Modal visible={!!s} transparent animationType="slide" onRequestClose={closeSource}>
      <Pressable onPress={closeSource} style={{ flex: 1, backgroundColor: 'rgba(10,20,18,0.5)' }} accessibilityLabel="Close source" />
      <View style={{ maxHeight: '70%', backgroundColor: color.raised, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: insets.bottom + space.m }}>
        <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: color.faint, marginTop: 12 }} />
        {s ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l, paddingTop: space.m }}>
              <View style={{ flex: 1 }}>
                <Ticker>{s.symbol}</Ticker>
                <Figure size={12} c={color.text3} numberOfLines={1}>{s.path}{s.section ? ` · ${s.section}` : ''}</Figure>
              </View>
              <Pressable onPress={closeSource} accessibilityRole="button" accessibilityLabel="Close" style={{ width: touch, height: touch, alignItems: 'center', justifyContent: 'center' }}>
                <CloseIcon c={color.text2} />
              </Pressable>
            </View>
            <ScrollView style={{ marginTop: space.s }} contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
              {err === 'locked' ? <Body c={color.text2}>Unlock FINN to read the cited passage. In answers, every chip like this opens the exact page FINN quoted.</Body> : err ? <Body c={color.text2}>FINN hasn't read this page yet. Ask FINN to fetch the filing and it will add it to the brain.</Body> : md === null ? <ActivityIndicator color={color.sea} /> : <Markdown text={md} size={14} />}
            </ScrollView>
            {err ? null : <Pressable
              onPress={() => {
                const t = s;
                closeSource();
                openBrainPage(t.symbol, t.path, t.section);
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({ marginHorizontal: space.l, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? '#25605A' : color.sea })}>
              <Strong size={size.small} c={color.onSea}>Open the full page</Strong>
            </Pressable>}
          </>
        ) : null}
      </View>
    </Modal>
  );
}
