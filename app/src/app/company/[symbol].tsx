import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import { Markdown } from '@/components/markdown';
import { ResultsTable } from '@/components/results';
import { Screen } from '@/components/screen';
import { Spark } from '@/components/spark';
import { Rule } from '@/components/story-row';
import { Body, Mono, Pct, Strong, Ticker, Title } from '@/components/type';
import { api, type Brain, type Doc, type PricePoint, type ResultsCard } from '@/lib/api';
import { quarterLabel, rupee, when } from '@/lib/format';
import { color, font, size, space } from '@/theme';

const DOC_LABEL: Record<string, string> = {
  transcript: 'Call transcript',
  presentation: 'Investor presentation',
  results: 'Results filing',
  annual_report: 'Annual report',
  press_release: 'Press release',
  order_contract: 'Order or contract',
  mna: 'M&A',
  rating: 'Credit rating',
  legal_regulatory: 'Legal or regulatory',
  management_change: 'Management change',
  corporate_action: 'Corporate action',
  routine_compliance: 'Routine',
  call_notice: 'Call notice',
  other: 'Other',
};

export default function Company() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const sym = String(symbol).toUpperCase();
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [card, setCard] = useState<ResultsCard | null>(null);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [page, setPage] = useState<{ path: string; md: string } | null>(null);
  const [parsing, setParsing] = useState<string | null>(null);

  useEffect(() => {
    api.get<PricePoint[]>(`/companies/${sym}/prices?days=60`).then(setPrices).catch(() => {});
    api.get<ResultsCard>(`/companies/${sym}/results`).then(setCard).catch(() => {});
    api.get<Brain>(`/companies/${sym}/brain`).then(setBrain).catch(() => {});
    api.get<Doc[]>(`/companies/${sym}/documents`).then(setDocs).catch(() => {});
  }, [sym]);

  const open = async (path: string) => {
    try {
      const r = await api.get<{ path: string; markdown: string }>(`/companies/${sym}/brain/${path}`);
      setPage({ path, md: r.markdown });
    } catch {}
  };

  const parse = async (d: Doc) => {
    setParsing(d.id);
    try {
      const r = await api.post<{ wiki_path: string | null }>(`/documents/${d.id}/parse`, {});
      setDocs(await api.get<Doc[]>(`/companies/${sym}/documents`));
      if (r.wiki_path) open(r.wiki_path);
    } finally {
      setParsing(null);
    }
  };

  const last = prices[prices.length - 1];
  const first = prices[0];
  const research = docs.filter((d) => d.status === 'parsed' && ['transcript', 'presentation', 'annual_report', 'results'].includes(d.doc_type ?? ''));
  const stored = docs.filter((d) => d.status === 'stored' && !['routine_compliance', 'call_notice'].includes(d.doc_type ?? ''));
  const brainPages = (brain?.pages ?? []).filter((p) => !p.startsWith('filings/') && p !== 'index.md' && !p.includes('/trees/'));

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      <Screen bottomPad={space.xl}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12}>
          <Body c={color.mist} size={size.small}>‹ Back</Body>
        </Pressable>

        <View style={{ marginTop: space.xl }}><Ticker size={15}>{sym}</Ticker></View>
        {last && (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: space.s }}>
            <Mono size={30} style={{ fontFamily: font.monoMedium }}>{rupee(last.close)}</Mono>
            <Pct v={last.change_pct} size={15} digits={2} />
          </View>
        )}
        {prices.length > 1 && (
          <View style={{ marginTop: space.m }}>
            <Spark values={prices.map((p) => p.close)} width={340} height={64} />
            <Mono size={12} c={color.dim} style={{ marginTop: 4 }}>
              {prices.length} sessions · {first ? <Pct v={((last.close - first.close) / first.close) * 100} size={11} /> : null}
            </Mono>
          </View>
        )}

        {card && (
          <View style={{ marginTop: space.xxl }}>
            <Title size={size.lead} style={{ marginBottom: space.m }}>{quarterLabel(card.period_end)} results</Title>
            <ResultsTable card={card} />
            {card.flags.map((f) => (
              <Body key={f} size={14} style={{ marginTop: space.s }}>
                <Body size={14} c={color.loss}>▲ </Body>
                {f}
              </Body>
            ))}
          </View>
        )}

        {page ? (
          <View style={{ marginTop: space.xxl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.m }}>
              <Mono size={12} c={color.mist} style={{ flex: 1 }} numberOfLines={1}>{page.path}</Mono>
              <Pressable onPress={() => setPage(null)} hitSlop={10}>
                <Mono size={12} c={color.paper}>Close</Mono>
              </Pressable>
            </View>
            <Rule />
            <View style={{ marginTop: space.m }}>
              <Markdown text={page.md.slice(0, 20000)} size={14} />
            </View>
          </View>
        ) : (
          <>
            <View style={{ marginTop: space.xxl }}>
              <Title size={size.lead}>What FINN has read</Title>
              <Body c={color.mist} size={14} style={{ marginTop: space.s }}>
                Primary documents only. These are what research answers cite.
              </Body>
              <View style={{ marginTop: space.s }}>
                <Rule />
                {research.length === 0 && (
                  <Body size={14} c={color.dim} style={{ paddingVertical: space.m }}>
                    Nothing parsed yet. New transcripts and decks are read as they're filed.
                  </Body>
                )}
                {research.map((d) => (
                  <View key={d.id}>
                    <Pressable onPress={() => d.wiki_path && open(d.wiki_path)} style={{ paddingVertical: 12 }}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Strong size={14} style={{ flex: 1 }}>{DOC_LABEL[d.doc_type ?? 'other']}</Strong>
                        <Mono size={12} c={color.dim}>{when(d.filed_at)}</Mono>
                      </View>
                      <Mono size={12} c={color.dim} style={{ marginTop: 2 }}>
                        {d.pages ?? '?'} pages · {d.engine === 'chandra' ? 'OCR' : 'text'}{d.tree_path ? ' · indexed' : ''}
                      </Mono>
                    </Pressable>
                    <Rule />
                  </View>
                ))}
              </View>
            </View>

            {stored.length > 0 && (
              <View style={{ marginTop: space.xl }}>
                <Title size={size.lead}>Filed, not read yet</Title>
                <View style={{ marginTop: space.s }}>
                  {stored.slice(0, 8).map((d) => (
                    <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Body size={14} numberOfLines={1}>{DOC_LABEL[d.doc_type ?? 'other']} · {d.desc}</Body>
                        <Mono size={12} c={color.dim}>{when(d.filed_at)} · {d.pages ?? '?'} pages</Mono>
                      </View>
                      <Pressable onPress={() => Linking.openURL(d.url)} hitSlop={6}>
                        <Mono size={12} c={color.mist}>PDF</Mono>
                      </Pressable>
                      <Pressable onPress={() => parse(d)} disabled={!!parsing} hitSlop={6}>
                        {parsing === d.id ? <ActivityIndicator size="small" color={color.marigold} /> : <Mono size={12} c={color.paper}>Read it</Mono>}
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {brainPages.length > 0 && (
              <View style={{ marginTop: space.xl }}>
                <Title size={size.lead}>Notes FINN keeps</Title>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space.s }}>
                  {brainPages.slice(0, 24).map((p) => (
                    <Pressable key={p} onPress={() => open(p)} style={{ borderWidth: 1, borderColor: color.hairline, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                      <Mono size={12} c={color.mist}>{p.replace(/\.md$/, '')}</Mono>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </Screen>

      <View style={{ borderTopWidth: 1, borderTopColor: color.hairline, backgroundColor: color.ink, alignItems: 'center', paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l }}>
        <Pressable
          onPress={() => router.push({ pathname: '/ask', params: { symbol: sym } })}
          style={({ pressed }) => ({ width: '100%', maxWidth: 608, backgroundColor: color.paper, borderRadius: 14, paddingVertical: 14, alignItems: 'center', opacity: pressed ? 0.85 : 1 })}>
          <Strong c={color.ink}>Research {sym} with FINN</Strong>
        </Pressable>
      </View>
    </View>
  );
}
