import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { AskAction, AskButton } from '@/components/ask-bar';
import { CloseIcon } from '@/components/icons';
import { TopBar } from '@/components/top-bar';
import { BrainTree, openBrainPage } from '@/components/brain';
import { Markdown } from '@/components/markdown';
import { Screen } from '@/components/screen';
import { Rule } from '@/components/story-row';
import { Body, Figure, Ticker } from '@/components/type';
import { api, type Brain } from '@/lib/api';
import { color, font, size, space } from '@/theme';

type Hit = { path: string; title: string; heading: string; section?: string; snippet: string };

/** «matched» words from the FTS snippet, drawn in FINN's colour. */
function Snippet({ text }: { text: string }) {
  const parts = text.replace(/\s+/g, ' ').split(/(«[^»]*»)/);
  return (
    <Text style={{ fontFamily: font.regular, fontSize: size.small, lineHeight: 20, color: color.text2 }}>
      {parts.map((p, i) =>
        p.startsWith('«') ? (
          <Text key={i} style={{ color: color.sea, fontFamily: font.bold }}>{p.slice(1, -1)}</Text>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color.raised, borderWidth: 1, borderColor: color.line, paddingHorizontal: 14 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={`Search ${sym}: attrition, margin guidance, a name…`}
          placeholderTextColor={color.text3}
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1, paddingVertical: 12, color: color.text, fontFamily: font.regular, fontSize: 15, outlineStyle: 'none' } as never}
        />
        {busy ? (
          <ActivityIndicator size="small" color={color.sea} />
        ) : q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear search">
            <CloseIcon c={color.text2} size={18} />
          </Pressable>
        ) : null}
      </View>
      {hits && (
        <View style={{ marginTop: space.m }}>
          <Figure size={12} c={color.text3}>
            {hits.length === 0 ? 'Nothing in the brain matches that.' : `${hits.length} passage${hits.length === 1 ? '' : 's'}`}
          </Figure>
          {hits.map((h, i) => (
            <View key={`${h.path}-${i}`}>
              <Pressable onPress={() => openBrainPage(sym, h.path, h.section || undefined)} style={({ pressed }) => ({ paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                  <Figure size={11} c={color.text} numberOfLines={1} style={{ flexShrink: 1 }}>{h.path.replace(/\.md$/, '')}</Figure>
                  {h.heading ? <Figure size={11} c={color.text3} numberOfLines={1} style={{ flexShrink: 1 }}>· {h.heading}</Figure> : null}
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
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <TopBar back title={`${sym} brain`} right={<AskAction symbol={sym} />} />
      <Screen bottomPad={space.xl}>
        <Body c={color.text2} size={14} style={{ marginBottom: space.l }}>
          {brain ? `${total} pages FINN reads before it answers. ` : ''}Plain markdown from the company's own filings, results and calls, linked like a wiki.
        </Body>
        <Search sym={sym} onActive={setSearching} />
        <View style={{ marginTop: space.xl, display: searching ? 'none' : 'flex' }}>
          {brain ? (
            <BrainTree brain={brain} />
          ) : missing ? (
            <Body c={color.text3}>No brain for {sym} yet. Ask FINN to research it and it will build one.</Body>
          ) : (
            <ActivityIndicator color={color.sea} style={{ alignSelf: 'flex-start' }} />
          )}
        </View>
      </Screen>
    </View>
  );
}

/** One page of the brain. [[links]] and (folder/page.md) citations open the page they point to. */
type PageResp = { markdown: string; offset: number; total: number; section: string | null };

function BrainPage({ sym, path, section }: { sym: string; path: string; section?: string }) {
  const [md, setMd] = useState<string | null>(null);
  const [from, setFrom] = useState<string | undefined>(section);
  const [meta, setMeta] = useState<{ offset: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMd(null);
    setError(null);
    api
      .get<PageResp>(`/companies/${sym}/brain/${path}${from ? `?section=${encodeURIComponent(from)}` : ''}`)
      .then((r) => {
        setMd(r.markdown);
        setMeta({ offset: r.offset, total: r.total });
      })
      .catch(() => setError('This page is not in the brain yet.'));
  }, [sym, path, from]);

  const follow = (target: string) => openBrainPage(sym, target.replace(/^\/+/, '').replace(/^wiki\//, ''));
  const crumbs = path.split('/');

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <TopBar back title={`${sym} brain`} right={<AskAction symbol={sym} page={path} />} />
      <Screen bottomPad={space.xl}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <Pressable onPress={() => router.push({ pathname: '/brain/[symbol]', params: { symbol: sym } } as never)} hitSlop={6}>
            <Ticker size={13}>{sym}</Ticker>
          </Pressable>
          <Figure size={12} c={color.text3}>/</Figure>
          {crumbs.map((c, i) => (
            <Figure key={i} size={12} c={i === crumbs.length - 1 ? color.text : color.text3}>
              {c}
              {i < crumbs.length - 1 ? ' /' : ''}
            </Figure>
          ))}
        </View>
        <View style={{ marginTop: space.m }}>
          <Rule />
        </View>
        {meta && meta.offset > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.m, padding: space.m, backgroundColor: color.seaTint }}>
            <Body size={size.small} c={color.text2} style={{ flex: 1 }}>
              Opened at {from}, where your search matched ({Math.round((meta.offset / meta.total) * 100)}% into the document).
            </Body>
            <Pressable onPress={() => setFrom(undefined)} hitSlop={8}>
              <Body size={size.small} c={color.text}>From the start</Body>
            </Pressable>
          </View>
        ) : null}
        <View style={{ marginTop: space.m }}>
          {error ? (
            <Body c={color.text3}>{error}</Body>
          ) : md === null ? (
            <ActivityIndicator color={color.sea} style={{ marginTop: space.xl }} />
          ) : (
            <Markdown text={md} size={14} onLink={follow} />
          )}
        </View>
        {md && meta && meta.offset + md.length < meta.total ? (
          <Body size={12} c={color.text3} style={{ marginTop: space.m }}>
            Long document; showing about {Math.round(md.length / 2000)} pages from here. Search finds passages anywhere in it.
          </Body>
        ) : null}
        {md ? <AskButton symbol={sym} page={path} label="Ask FINN about this page" /> : null}
      </Screen>
    </View>
  );
}

export default function BrainScreen() {
  const { symbol, path, section } = useLocalSearchParams<{ symbol: string; path?: string; section?: string }>();
  const sym = String(symbol).toUpperCase();
  return path ? <BrainPage key={`${path}#${section ?? ''}`} sym={sym} path={String(path)} section={section} /> : <BrainHome sym={sym} />;
}
