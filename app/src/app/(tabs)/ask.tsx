import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Markdown } from '@/components/markdown';
import { Dot } from '@/components/pulse';
import { Body, Mono, Strong, Title } from '@/components/type';
import { describeTool, useChat, type Message } from '@/lib/chat';
import { color, font, maxWidth, size, space } from '@/theme';

const STARTERS = [
  'What changed in my portfolio this week?',
  'How did TCS do last quarter?',
  'Walk me through what happened at eMudhra.',
  'Which of my companies changed management this year?',
];

function Steps({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);
  if (!m.tools.length) return null;
  const live = m.state === 'streaming';
  const shown = live || open ? m.tools : [];
  return (
    <View style={{ marginBottom: space.s }}>
      {shown.map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <Mono size={12} c={t.done ? color.dim : color.marigold}>{t.done ? '✓' : '›'}</Mono>
          <Mono size={12} c={t.done ? color.dim : color.mist} numberOfLines={1} style={{ flex: 1 }}>
            {describeTool(t.name, t.detail)}
          </Mono>
        </View>
      ))}
      {!live && (
        <Pressable onPress={() => setOpen((v) => !v)} hitSlop={8}>
          <Body size={size.meta} c={color.dim}>
            {open ? 'Hide steps' : `${m.tools.length} step${m.tools.length > 1 ? 's' : ''} · show`}
          </Body>
        </Pressable>
      )}
    </View>
  );
}

function Bubble({ m }: { m: Message }) {
  if (m.role === 'user') {
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: color.panel, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginVertical: space.s }}>
        <Body>{m.text}</Body>
      </View>
    );
  }
  return (
    <View style={{ marginVertical: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Dot size={6} working={m.state === 'streaming'} />
        <Body size={size.meta} c={m.state === 'streaming' ? color.marigold : color.dim}>
          {m.state === 'streaming' ? 'FINN is working' : m.state === 'stopped' ? 'FINN · stopped' : m.state === 'failed' ? 'FINN · failed' : 'FINN'}
        </Body>
      </View>
      <Steps m={m} />
      {m.text ? <Markdown text={m.text} /> : m.state === 'streaming' && !m.tools.length ? <Body c={color.dim}>Thinking…</Body> : null}
    </View>
  );
}

export default function Ask() {
  const params = useLocalSearchParams<{ feed?: string; symbol?: string }>();
  const [symbol, setSymbol] = useState<string | undefined>(params.symbol);
  const [feedId, setFeedId] = useState<string | undefined>(params.feed);
  const { messages, running, send, stop, reset } = useChat({ symbol, feedId });
  const [draft, setDraft] = useState('');
  const scroll = useRef<{ scrollToEnd: (o?: { animated?: boolean }) => void } | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (params.symbol) setSymbol(params.symbol);
    if (params.feed) setFeedId(params.feed);
  }, [params.symbol, params.feed]);

  const submit = (text = draft) => {
    if (!text.trim()) return;
    send(text);
    setDraft('');
  };

  const clearContext = () => {
    setSymbol(undefined);
    setFeedId(undefined);
    router.setParams({ symbol: undefined, feed: undefined });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.ink }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top + space.l, paddingHorizontal: space.l, width: '100%', maxWidth, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Title size={20} style={{ fontFamily: font.bold, letterSpacing: 0.5 }}>Ask</Title>
          {running && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 12 }}>
              <Dot size={6} working />
              <Body size={size.meta} c={color.marigold}>working</Body>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {messages.length > 0 && (
            <Pressable onPress={reset} hitSlop={10}>
              <Body size={size.small} c={color.mist}>New chat</Body>
            </Pressable>
          )}
        </View>
        {symbol && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.m, alignSelf: 'flex-start', backgroundColor: color.well, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Body size={size.small} c={color.mist}>{feedId ? 'About this story ·' : 'About'}</Body>
            <Mono size={12} style={{ fontFamily: font.monoMedium }}>{symbol}</Mono>
            <Pressable onPress={clearContext} hitSlop={10} accessibilityLabel="Clear context">
              <Mono size={12} c={color.dim}>×</Mono>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView
        ref={scroll as never}
        style={{ flex: 1 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, width: '100%', maxWidth, alignSelf: 'center' }}>
        {messages.length === 0 ? (
          <View style={{ marginTop: space.xxl }}>
            <Title size={size.title}>{symbol ? `Ask about ${symbol}` : 'Ask about any NSE company'}</Title>
            <Body c={color.mist} style={{ marginTop: space.s }}>
              Answers come from each company's own filings, results and call transcripts. FINN cites the page it used.
            </Body>
            <View style={{ marginTop: space.xl, gap: space.s }}>
              {(symbol
                ? [`Promised vs delivered at ${symbol} over the last four quarters`, `Summarise ${symbol}'s latest results`, `What should I watch at ${symbol} next quarter?`]
                : STARTERS
              ).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => submit(s)}
                  style={({ pressed }) => ({ borderWidth: 1, borderColor: color.hairline, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
                  <Body size={14} c={color.paper}>{s}</Body>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: space.l, paddingBottom: space.s, paddingTop: space.s, width: '100%', maxWidth, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: color.panel, borderWidth: 1, borderColor: color.hairline, borderRadius: 14, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={running ? 'Add to that; FINN reads it next' : 'Ask about a company, a filing, a number'}
            placeholderTextColor={color.dim}
            multiline
            style={{ flex: 1, minHeight: 36, maxHeight: 120, color: color.paper, fontFamily: font.regular, fontSize: 15, paddingTop: 8, paddingBottom: 8, outlineStyle: 'none' } as any}
            onKeyPress={(e: any) => {
              if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                e.preventDefault?.();
                submit();
              }
            }}
          />
          {running && !draft.trim() ? (
            <Pressable onPress={stop} accessibilityRole="button" style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: color.hairline }}>
              <Body size={size.small} c={color.paper}>Stop</Body>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => submit()}
              disabled={!draft.trim()}
              accessibilityRole="button"
              style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: draft.trim() ? color.paper : color.well }}>
              <Strong size={14} c={draft.trim() ? color.ink : color.dim}>Send</Strong>
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
