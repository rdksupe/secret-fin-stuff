import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import { AskAction, AskButton } from '@/components/ask-bar';
import { TopBar } from '@/components/top-bar';
import { BrainEntry, openBrainPage } from '@/components/brain';
import { DossierView } from '@/components/dossier';
import { ResultsTable } from '@/components/results';
import { Screen } from '@/components/screen';
import { Spark } from '@/components/spark';
import { Rule } from '@/components/story-row';
import { Body, Figure, Pct, Strong, Title } from '@/components/type';
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
  const [brainMissing, setBrainMissing] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [parsing, setParsing] = useState<string | null>(null);

  useEffect(() => {
    api.get<PricePoint[]>(`/companies/${sym}/prices?days=60`).then(setPrices).catch(() => {});
    api.get<ResultsCard>(`/companies/${sym}/results`).then(setCard).catch(() => {});
    api.get<Brain>(`/companies/${sym}/brain`).then(setBrain).catch(() => setBrainMissing(true));
    api.get<Doc[]>(`/companies/${sym}/documents`).then(setDocs).catch(() => {});
  }, [sym]);

  const open = (path: string) => openBrainPage(sym, path);

  const parse = async (d: Doc) => {
    setParsing(d.id);
    try {
      const r = await api.post<{ wiki_path: string | null }>(`/documents/${d.id}/parse`, {});
      setDocs(await api.get<Doc[]>(`/companies/${sym}/documents`));
      api.get<Brain>(`/companies/${sym}/brain`).then(setBrain).catch(() => {});
      if (r.wiki_path) open(r.wiki_path);
    } finally {
      setParsing(null);
    }
  };

  const last = prices[prices.length - 1];
  const first = prices[0];
  const research = docs.filter((d) => d.status === 'parsed' && ['transcript', 'presentation', 'annual_report', 'results'].includes(d.doc_type ?? ''));
  const stored = docs.filter((d) => d.status === 'stored' && !['routine_compliance', 'call_notice'].includes(d.doc_type ?? ''));

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <TopBar
        back
        title={sym}
        right={<AskAction symbol={sym} />}
        below={
          last ? (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
              <Figure size={28} c={color.onSea} style={{ fontFamily: font.semibold }}>{rupee(last.close)}</Figure>
              <Pct v={last.change_pct} size={15} digits={2} onSea />
            </View>
          ) : undefined
        }
      />
      <Screen bottomPad={space.xl}>
        {prices.length > 1 && (
          <View>
            <Spark values={prices.map((p) => p.close)} width={340} height={64} />
            <Figure size={12} c={color.text3} style={{ marginTop: 4 }}>
              {prices.length} sessions · {first ? <Pct v={((last.close - first.close) / first.close) * 100} size={11} /> : null}
            </Figure>
          </View>
        )}

        {brain ? (
          <BrainEntry brain={brain} />
        ) : !brainMissing ? (
          <ActivityIndicator color={color.sea} style={{ marginTop: space.xl, alignSelf: 'flex-start' }} />
        ) : (
          <Body c={color.text3} size={14} style={{ marginTop: space.xl }}>
            No brain for {sym} yet. Ask FINN to research it and it will build one.
          </Body>
        )}

        <DossierView symbol={sym} />

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

        <>
            <View style={{ marginTop: space.xxl }}>
              <Title size={size.lead}>What FINN has read</Title>
              <Body c={color.text2} size={14} style={{ marginTop: space.s }}>
                Primary documents only. These are what research answers cite.
              </Body>
              <View style={{ marginTop: space.s }}>
                <Rule />
                {research.length === 0 && (
                  <Body size={14} c={color.text3} style={{ paddingVertical: space.m }}>
                    Nothing parsed yet. New transcripts and decks are read as they're filed.
                  </Body>
                )}
                {research.map((d) => (
                  <View key={d.id}>
                    <Pressable onPress={() => d.wiki_path && open(d.wiki_path)} style={{ paddingVertical: 12 }}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Strong size={14} style={{ flex: 1 }}>{DOC_LABEL[d.doc_type ?? 'other']}</Strong>
                        <Figure size={12} c={color.text3}>{when(d.filed_at)}</Figure>
                      </View>
                      <Figure size={12} c={color.text3} style={{ marginTop: 2 }}>
                        {d.pages ?? '?'} pages · {d.engine === 'chandra' ? 'OCR' : 'text'}{d.tree_path ? ' · indexed' : ''}
                      </Figure>
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
                        <Figure size={12} c={color.text3}>{when(d.filed_at)} · {d.pages ?? '?'} pages</Figure>
                      </View>
                      <Pressable onPress={() => Linking.openURL(d.url)} hitSlop={6}>
                        <Figure size={12} c={color.text2}>PDF</Figure>
                      </Pressable>
                      <Pressable onPress={() => parse(d)} disabled={!!parsing} hitSlop={6}>
                        {parsing === d.id ? <ActivityIndicator size="small" color={color.sea} /> : <Figure size={12} c={color.text}>Read it</Figure>}
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            )}

        </>
        <AskButton symbol={sym} label={`Research ${sym} with FINN`} />
      </Screen>

    </View>
  );
}
