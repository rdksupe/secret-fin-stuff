import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { AskBar } from '@/components/ask-bar';
import { BrainTree, openBrainPage } from '@/components/brain';
import { Markdown } from '@/components/markdown';
import { Screen } from '@/components/screen';
import { Rule } from '@/components/story-row';
import { Body, Mono, Ticker, Title } from '@/components/type';
import { api, type Brain } from '@/lib/api';
import { color, font, size, space } from '@/theme';

type Hit = { path: string; title: string; heading: string; snippet: string };

const back = (sym: string) => (router.canGoBack() ? router.back() : router.replace(`/company/${sym}`));

/** «matched» words from the FTS snippet, drawn in FINN's colour. */
function Snippet({ text }: { text: string }) {
  const parts = text.replace(/\s+/g, ' ').split(/(«[^»]*»)/);
  return (
    <Text style={{ fontFamily: font.regular, fontSize: size.small, lineHeight: 20, color: color.mist }}>
      {parts.map((p, i) =>
        p.startsWith('«') ? (
          <Text key={i} style={{ color: color.marigold, fontFamily: font.semibold }}>{p.slice(1, -1)}</Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

function Search({ sym, onActive }: { sym: string; onActive: (active: boolean) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    onActive(term.length >= 2);
    if (term.length < 2) {
      setHits(null);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api.get<Hit[]>(`/companies/${sym}/brain/search?q=${encodeURIComponent(term)}`);
        if (live) setHits(r);
      } catch {
        if (live) setHits([]);
      } finally {
        if (live) setBusy(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, sym, onActive]);

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color.panel, borderWidth: 1, borderColor: color.hairline, borderRadius: 12, paddingHorizontal: 14 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={`Search ${sym}: attrition, margin guidance, a name…`}
          placeholderTextColor={color.dim}
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1, paddingVertical: 12, color: color.paper, fontFamily: font.regular, fontSize: 15, outlineStyle: 'none' } as never}
        />
        {busy ? (
          <ActivityIndicator size="small" color={color.marigold} />
        ) : q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear search">
            <Body c={color.dim}>×</Body>
          </Pressable>
        ) : null}
      </View>
      {hits && (
        <View style={{ marginTop: space.m }}>
          <Mono size={12} c={color.dim}>
            {hits.length === 0 ? 'Nothing in the brain matches that.' : `${hits.length} passage${hits.length === 1 ? '' : 's'}`}
          </Mono>
          {hits.map((h, i) => (
            <View key={`${h.path}-${i}`}>
              <Pressable onPress={() => openBrainPage(sym, h.path)} style={({ pressed }) => ({ paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                  <Mono size={11} c={color.paper} numberOfLines={1} style={{ flexShrink: 1 }}>{h.path.replace(/\.md$/, '')}</Mono>
                  {h.heading ? <Mono size={11} c={color.dim} numberOfLines={1} style={{ flexShrink: 1 }}>· {h.heading}</Mono> : null}
                </View>
                <Snippet text={h.snippet} />
              </Pressable>
              <Rule />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function BrainHome({ sym }: { sym: string }) {
  const [brain, setBrain] = useState<Brain | null>(null);
  const [missing, setMissing] = useState(false);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    api.get<Brain>(`/companies/${sym}/brain`).then(setBrain).catch(() => setMissing(true));
  }, [sym]);
  const total = (brain?.tree ?? []).reduce((n, f) => n + f.pages.length, 0);

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      <Screen bottomPad={space.xl}>
        <Pressable onPress={() => back(sym)} hitSlop={12}>
          <Body c={color.mist} size={14}>‹ Back</Body>
        </Pressable>
        <View style={{ marginTop: space.xl }}><Ticker size={15}>{sym}</Ticker></View>
        <Title size={size.title} style={{ marginTop: space.s }}>Brain</Title>
        <Body c={color.mist} size={14} style={{ marginTop: space.s, marginBottom: space.l }}>
          {brain ? `${total} pages FINN reads before it answers. ` : ''}Plain markdown from the company's own filings, results and calls, linked like a wiki.
        </Body>
        <Search sym={sym} onActive={setSearching} />
        <View style={{ marginTop: space.xl, display: searching ? 'none' : 'flex' }}>
          {brain ? (
            <BrainTree brain={brain} />
          ) : missing ? (
            <Body c={color.dim}>No brain for {sym} yet. Ask FINN to research it and it will build one.</Body>
          ) : (
            <ActivityIndicator color={color.marigold} style={{ alignSelf: 'flex-start' }} />
          )}
        </View>
      </Screen>
      <AskBar symbol={sym} />
    </View>
  );
}

/** One page of the brain. [[links]] and (folder/page.md) citations open the page they point to. */
function BrainPage({ sym, path }: { sym: string; path: string }) {
  const [md, setMd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMd(null);
    setError(null);
    api
      .get<{ markdown: string }>(`/companies/${sym}/brain/${path}`)
      .then((r) => setMd(r.markdown))
      .catch(() => setError('This page is not in the brain yet.'));
  }, [sym, path]);

  const follow = (target: string) => openBrainPage(sym, target.replace(/^\/+/, '').replace(/^wiki\//, ''));
  const crumbs = path.split('/');

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      <Screen bottomPad={space.xl}>
        <Pressable onPress={() => back(sym)} hitSlop={12}>
          <Body c={color.mist} size={14}>‹ Back</Body>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: space.l }}>
          <Pressable onPress={() => router.push({ pathname: '/brain/[symbol]', params: { symbol: sym } } as never)} hitSlop={6}>
            <Ticker size={13}>{sym}</Ticker>
          </Pressable>
          <Mono size={12} c={color.dim}>/</Mono>
          {crumbs.map((c, i) => (
            <Mono key={i} size={12} c={i === crumbs.length - 1 ? color.paper : color.dim}>
              {c}
              {i < crumbs.length - 1 ? ' /' : ''}
            </Mono>
          ))}
        </View>
        <View style={{ marginTop: space.m }}>
          <Rule />
        </View>
        <View style={{ marginTop: space.m }}>
          {error ? (
            <Body c={color.dim}>{error}</Body>
          ) : md === null ? (
            <ActivityIndicator color={color.marigold} style={{ marginTop: space.xl }} />
          ) : (
            <Markdown text={md.slice(0, 40000)} size={14} onLink={follow} />
          )}
        </View>
        {md && md.length > 40000 ? (
          <Body size={12} c={color.dim} style={{ marginTop: space.m }}>Long page; showing the first part. Search finds passages anywhere in it.</Body>
        ) : null}
      </Screen>
      <AskBar symbol={sym} page={path} label="Ask FINN about this page" />
    </View>
  );
}

export default function BrainScreen() {
  const { symbol, path } = useLocalSearchParams<{ symbol: string; path?: string }>();
  const sym = String(symbol).toUpperCase();
  return path ? <BrainPage sym={sym} path={String(path)} /> : <BrainHome sym={sym} />;
}
