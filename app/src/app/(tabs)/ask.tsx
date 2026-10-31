import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Markdown } from '@/components/markdown';
import { Dot } from '@/components/pulse';
import { Body, Mono, Strong, Title } from '@/components/type';
import { api, type Story } from '@/lib/api';
import { clean, useConversation, type ChatMessage } from '@/lib/chat';
import { headline, when } from '@/lib/format';
import { color, font, maxWidth, size, space } from '@/theme';

const STARTERS = [
  'What changed in my portfolio this week?',
  'How did TCS do last quarter?',
  "What did Maruti's latest results show?",
  'Every weekday at 8:30, send me a two-line brief on my IT stocks.',
];

function Prompt({ m, onAnswer }: { m: ChatMessage; onAnswer: (choice: string) => void }) {
  const answered = m.payload.answered;
  const choices = m.kind === 'approval' ? ['approve', 'deny'] : m.payload.choices ?? [];
  return (
    <View style={{ marginVertical: space.m, borderWidth: 1, borderColor: color.hairline, borderRadius: 12, padding: space.l }}>
      <Strong size={size.small} c={color.marigold}>{m.kind === 'approval' ? 'FINN needs your OK' : 'FINN has a question'}</Strong>
      <Body style={{ marginTop: space.s }}>{clean(m.text)}</Body>
      {m.payload.command ? (
        <Mono size={12} c={color.mist} style={{ marginTop: space.s }}>{m.payload.command}</Mono>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.m }}>
        {answered ? (
          <Body size={size.small} c={color.mist}>You chose: {answered}</Body>
        ) : (
          choices.map((c) => (
            <Pressable
              key={c}
              onPress={() => onAnswer(c)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: 10,
                backgroundColor: c === 'approve' ? color.paper : 'transparent',
                borderWidth: 1,
                borderColor: c === 'approve' ? color.paper : color.hairline,
                opacity: pressed ? 0.7 : 1,
              })}>
              <Body size={size.small} c={c === 'approve' ? color.ink : color.paper}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </Body>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

function Bubble({ m, onAnswer }: { m: ChatMessage; onAnswer: (id: string, choice: string) => void }) {
  if (m.kind !== 'message') return <Prompt m={m} onAnswer={(c) => onAnswer(m.id, c)} />;
  if (m.role === 'user') {
    // Slash commands are controls, not conversation.
    if (m.text.startsWith('/')) {
      return (
        <Body size={size.meta} c={color.dim} style={{ alignSelf: 'center', marginVertical: space.s }}>
          {m.text === '/stop' ? 'Stopped' : m.text === '/new' ? 'New conversation' : m.text}
        </Body>
      );
    }
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: color.panel, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginVertical: space.s }}>
        <Body>{m.text}</Body>
      </View>
    );
  }
  const text = clean(m.text);
  return (
    <View style={{ marginVertical: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Dot size={6} working={!m.final} />
        <Body size={size.meta} c={m.final ? color.dim : color.marigold}>
          {m.proactive ? `FINN · scheduled · ${when(m.at)}` : m.final ? 'FINN' : 'FINN is writing'}
        </Body>
      </View>
      {text ? <Markdown text={text} /> : <Body c={color.dim}>…</Body>}
    </View>
  );
}

export default function Ask() {
  const params = useLocalSearchParams<{ feed?: string; symbol?: string }>();
  const [context, setContext] = useState<{ symbol: string; label: string } | null>(null);
  const { messages, working, online, send, stop, newChat, answer } = useConversation();
  const [draft, setDraft] = useState('');
  const scroll = useRef<{ scrollToEnd: (o?: { animated?: boolean }) => void } | null>(null);
  const insets = useSafeAreaInsets();

  // Opened from a story or company page: carry that along with the next message.
  useEffect(() => {
    if (!params.symbol) return;
    if (params.feed) {
      api
        .get<Story>(`/stories/${params.feed}`)
        .then((s) => setContext({ symbol: params.symbol!, label: headline(s.head.title, s.head.summary) }))
        .catch(() => setContext({ symbol: params.symbol!, label: '' }));
    } else {
      setContext({ symbol: params.symbol, label: '' });
    }
  }, [params.symbol, params.feed]);

  const submit = (text = draft) => {
    if (!text.trim()) return;
    const ctx = context
      ? `Investor is asking about ${context.symbol}${context.label ? `; the story they opened: ${context.label}` : ''}`
      : undefined;
    send(text, ctx);
    setDraft('');
  };

  const clearContext = () => {
    setContext(null);
    router.setParams({ symbol: undefined, feed: undefined });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.ink }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top + space.l, paddingHorizontal: space.l, width: '100%', maxWidth, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Title size={20} style={{ fontFamily: font.bold, letterSpacing: 0.5 }}>Ask</Title>
          {working ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 12 }}>
              <Dot size={6} working />
              <Body size={size.meta} c={color.marigold}>working</Body>
            </View>
          ) : !online ? (
            <Body size={size.meta} c={color.dim} style={{ marginLeft: 12 }}>reconnecting</Body>
          ) : null}
          <View style={{ flex: 1 }} />
          {messages.length > 0 && (
            <Pressable onPress={newChat} hitSlop={10} accessibilityRole="button">
              <Body size={size.small} c={color.mist}>New chat</Body>
            </Pressable>
          )}
        </View>
        {context && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.m, alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: color.well, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Mono size={12} style={{ fontFamily: font.monoMedium }}>{context.symbol}</Mono>
            {context.label ? (
              <Body size={size.meta} c={color.mist} numberOfLines={1} style={{ flexShrink: 1 }}>{context.label}</Body>
            ) : null}
            <Pressable onPress={clearContext} hitSlop={10} accessibilityLabel="Clear context">
              <Body size={size.small} c={color.dim}>×</Body>
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
            <Title size={size.title}>{context ? `Ask about ${context.symbol}` : 'Ask about any NSE company'}</Title>
            <Body c={color.mist} style={{ marginTop: space.s }}>
              Answers come from each company's own filings, results and call transcripts. FINN cites the page it used. Ask it to watch something on a schedule and it will message you here.
            </Body>
            <View style={{ marginTop: space.xl, gap: space.s }}>
              {(context
                ? [`Promised vs delivered at ${context.symbol} over the last four quarters`, `Summarise ${context.symbol}'s latest results`, `What should I watch at ${context.symbol} next quarter?`]
                : STARTERS
              ).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => submit(s)}
                  style={({ pressed }) => ({ borderWidth: 1, borderColor: color.hairline, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
                  <Body size={size.small} c={color.paper}>{s}</Body>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} onAnswer={answer} />)
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: space.l, paddingBottom: space.s, paddingTop: space.s, width: '100%', maxWidth, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: color.panel, borderWidth: 1, borderColor: color.hairline, borderRadius: 14, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={working ? 'Add to that; FINN folds it into what it is doing' : 'Ask about a company, a filing, a number'}
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
          {working && !draft.trim() ? (
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
