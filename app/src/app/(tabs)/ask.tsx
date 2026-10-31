import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MicIcon, ReplyIcon, SendIcon, StopIcon } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { Dot } from '@/components/pulse';
import { Body, Mono, Strong, Title } from '@/components/type';
import { api, type Story } from '@/lib/api';
import { clean, useChats, useConversation, type ChatMessage, type ChatSummary } from '@/lib/chat';
import { useSpeech, useVoiceNote } from '@/lib/voice';
import { headline, when } from '@/lib/format';
import { color, font, maxWidth, size, space } from '@/theme';

const STARTERS = [
  'What changed in my portfolio this week?',
  'How did TCS do last quarter?',
  "What did Maruti's latest results show?",
  'Every weekday at 8:30, send me a two-line brief on my IT stocks.',
];

const LABELS: Record<string, string> = { once: 'Approve once', always: 'Always approve', cancel: 'Cancel' };

function Prompt({ m, onAnswer }: { m: ChatMessage; onAnswer: (choice: string) => void }) {
  const answered = m.payload.answered;
  const choices = m.kind === 'approval' ? ['approve', 'deny'] : m.payload.choices ?? [];
  const primary = m.kind === 'confirm' ? 'once' : 'approve';
  return (
    <View style={{ marginVertical: space.m, borderWidth: 1, borderColor: color.hairline, borderRadius: 12, padding: space.l }}>
      <Strong size={size.small} c={color.marigold}>{m.kind === 'clarify' ? 'FINN has a question' : 'FINN needs your OK'}</Strong>
      <Body style={{ marginTop: space.s }}>{clean(m.text).replace(/\*\*/g, '')}</Body>
      {m.payload.command ? (
        <Mono size={12} c={color.mist} style={{ marginTop: space.s }}>{m.payload.command}</Mono>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.m }}>
        {answered ? (
          <Body size={size.small} c={color.mist}>You chose: {LABELS[answered] ?? answered}</Body>
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
                backgroundColor: c === primary ? color.paper : 'transparent',
                borderWidth: 1,
                borderColor: c === primary ? color.paper : color.hairline,
                opacity: pressed ? 0.7 : 1,
              })}>
              <Body size={size.small} c={c === primary ? color.ink : color.paper}>
                {LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1)}
              </Body>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

type Listen = { playing: string | null; loading: string | null; toggle: (id: string) => void };

/** The quoted message a reply points at, Telegram-style. */
function Quote({ m, onClear }: { m: Pick<ChatMessage, 'role' | 'text'>; onClear?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderLeftWidth: 2, borderLeftColor: m.role === 'finn' ? color.marigold : color.mist, paddingLeft: 8, marginBottom: 6 }}>
      <View style={{ flex: 1 }}>
        <Body size={size.meta} c={m.role === 'finn' ? color.marigold : color.mist}>{m.role === 'finn' ? 'FINN' : 'You'}</Body>
        <Body size={size.meta} c={color.mist} numberOfLines={2}>{clean(m.text).replace(/[#*_`|>]/g, '')}</Body>
      </View>
      {onClear ? (
        <Pressable onPress={onClear} hitSlop={12} accessibilityLabel="Cancel reply" style={{ paddingHorizontal: 6 }}>
          <Body c={color.dim}>×</Body>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The gateway's tool-progress bubble: what FINN is doing, one line per tool call. */
function ToolTrace({ m, live }: { m: ChatMessage; live: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = m.text.split('\n').filter((l) => l.trim() && !l.startsWith('```'));
  const shown = open || live ? lines : lines.slice(-2);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} disabled={live || lines.length <= 2} style={{ marginVertical: space.xs, gap: 2 }}>
      {!open && !live && lines.length > 2 ? (
        <Mono size={12} c={color.dim}>{`${lines.length} steps · show all`}</Mono>
      ) : null}
      {shown.map((l, i) => (
        <Mono key={i} size={12} c={live && i === shown.length - 1 ? color.marigold : color.dim} numberOfLines={2}>{l}</Mono>
      ))}
    </Pressable>
  );
}

function Reaction({ emoji }: { emoji: string }) {
  return (
    <View style={{ alignSelf: 'flex-start', marginTop: 6, borderRadius: 10, borderWidth: 1, borderColor: color.hairline, backgroundColor: color.panel, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Body size={size.small}>{emoji}</Body>
    </View>
  );
}

function Bubble({
  m,
  live,
  showQuote,
  selected,
  onSelect,
  onAnswer,
  listen,
}: {
  m: ChatMessage;
  live: boolean;
  showQuote: boolean;
  selected: boolean;
  onSelect: (m: ChatMessage) => void;
  onAnswer: (id: string, choice: string) => void;
  listen: Listen;
}) {
  if (m.kind === 'approval' || m.kind === 'clarify' || m.kind === 'confirm') return <Prompt m={m} onAnswer={(c) => onAnswer(m.id, c)} />;
  if (m.kind === 'tool') return <ToolTrace m={m} live={live} />;
  const quote = showQuote && m.payload.reply_text ? { role: m.payload.reply_role ?? 'finn', text: m.payload.reply_text } : null;
  const highlight = selected ? { backgroundColor: color.well, borderRadius: 14 } : null;
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
      <Pressable onLongPress={() => onSelect(m)} delayLongPress={300} style={[{ alignSelf: 'flex-end', maxWidth: '86%', marginVertical: space.s }, highlight]}>
        <View style={{ backgroundColor: selected ? color.hairline : color.panel, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 }}>
          {quote ? <Quote m={quote} /> : null}
          {m.payload.voice ? <Body size={size.meta} c={color.dim}>Voice note</Body> : null}
          <Body>{m.text}</Body>
        </View>
        {m.payload.finn_reaction ? (
          <View style={{ position: 'absolute', left: -10, bottom: -8, borderRadius: 10, backgroundColor: color.panel, borderWidth: 1, borderColor: color.hairline, paddingHorizontal: 4, paddingVertical: 1 }}>
            <Body size={12}>{m.payload.finn_reaction}</Body>
          </View>
        ) : null}
      </Pressable>
    );
  }
  const text = clean(m.text);
  return (
    <Pressable onLongPress={() => onSelect(m)} delayLongPress={300} style={[{ marginVertical: space.m, paddingVertical: selected ? 6 : 0, paddingHorizontal: selected ? 8 : 0, marginHorizontal: selected ? -8 : 0 }, highlight]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Dot size={6} working={!m.final} />
        <Body size={size.meta} c={m.final ? color.dim : color.marigold}>
          {m.proactive ? `FINN · scheduled · ${when(m.at)}` : m.final ? 'FINN' : 'FINN is writing'}
        </Body>
      </View>
      {quote ? <Quote m={quote} /> : null}
      {text ? <Markdown text={text} /> : <Body c={color.dim}>…</Body>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        {m.payload.reaction ? <Reaction emoji={m.payload.reaction} /> : null}
        {m.final && text.length > 0 && (
          <Pressable onPress={() => listen.toggle(m.id)} hitSlop={8} accessibilityRole="button" style={{ marginTop: space.s }}>
            <Body size={size.meta} c={color.mist}>
              {listen.loading === m.id ? 'Preparing audio…' : listen.playing === m.id ? 'Stop listening' : 'Listen'}
            </Body>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

function contextLine(c: { symbol: string; label: string }) {
  if (c.label.startsWith('brain page '))
    return `Investor is asking about ${c.symbol}; they are reading kb/companies/${c.symbol}/wiki/${c.label.slice(11)}`;
  return `Investor is asking about ${c.symbol}${c.label ? `; the story they opened: ${c.label}` : ''}`;
}

const REACTIONS = ['👍', '👎', '🎯', '🤔'];

function lastUserBefore(ms: ChatMessage[], i: number): string | undefined {
  for (let j = i - 1; j >= 0; j--) if (ms[j].role === 'user') return ms[j].id;
  return undefined;
}

export default function Ask() {
  const params = useLocalSearchParams<{ feed?: string; symbol?: string; chat?: string; page?: string }>();
  const chats = useChats();
  const [sheet, setSheet] = useState(false);
  const [context, setContext] = useState<{ symbol: string; label: string } | null>(null);
  const { chatId, add, messages, working, online, send, stop, answer, react } = useConversation(chats.current);
  const [selected, setSelected] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const input = useRef<{ focus: () => void } | null>(null);
  const voice = useVoiceNote(chatId, add);
  const listen = useSpeech(chatId);
  const [draft, setDraft] = useState('');
  const scroll = useRef<{ scrollToEnd: (o?: { animated?: boolean }) => void } | null>(null);
  const insets = useSafeAreaInsets();

  // Opened from a push about a particular session.
  const { select } = chats;
  useEffect(() => {
    if (params.chat) select(params.chat);
  }, [params.chat, select]);

  const othersWorking = chats.sessions.filter((c) => c.working && c.id !== chats.current).length;
  const newChat = () => {
    chats.create();
    setSelected(null);
    setReplyTo(null);
    setDraft('');
  };

  // Opened from a story or company page: carry that along with the next message.
  useEffect(() => {
    if (!params.symbol) return;
    if (params.feed) {
      api
        .get<Story>(`/stories/${params.feed}`)
        .then((s) => setContext({ symbol: params.symbol!, label: headline(s.head.title, s.head.summary) }))
        .catch(() => setContext({ symbol: params.symbol!, label: '' }));
    } else if (params.page) {
      setContext({ symbol: params.symbol, label: `brain page ${params.page}` });
    } else {
      setContext({ symbol: params.symbol, label: '' });
    }
  }, [params.symbol, params.feed, params.page]);

  const contextText = () =>
    context ? contextLine(context) : undefined;

  const submit = (text = draft) => {
    if (!text.trim()) return;
    const ctx = context ? contextLine(context) : undefined;
    send(text, ctx, replyTo?.id);
    setDraft('');
    setReplyTo(null);
  };

  const clearContext = () => {
    setContext(null);
    router.setParams({ symbol: undefined, feed: undefined, page: undefined });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.ink }} behavior="padding">
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
          <Pressable onPress={() => setSheet(true)} hitSlop={10} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: space.l }}>
            {othersWorking > 0 ? <Dot size={6} working /> : null}
            <Body size={size.small} c={color.mist}>
              {othersWorking > 0 ? `Chats · ${othersWorking} running` : 'Chats'}
            </Body>
          </Pressable>
          {messages.length > 0 && (
            <Pressable onPress={newChat} hitSlop={10} accessibilityRole="button">
              <Body size={size.small} c={color.paper}>New</Body>
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
          messages.map((m, i) => (
            <Bubble
              key={m.id}
              m={m}
              live={working && i === messages.length - 1}
              // Hermes threads every answer to the question it answers; only show a quote when it isn't the one just above.
              showQuote={m.role === 'user' || m.payload.reply_to !== lastUserBefore(messages, i)}
              selected={selected?.id === m.id}
              onSelect={setSelected}
              onAnswer={answer}
              listen={listen}
            />
          ))
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: space.l, paddingBottom: space.s, paddingTop: space.s, width: '100%', maxWidth, alignSelf: 'center' }}>
        {selected ? (
          // Long-press menu: reply to any message, react to FINN's.
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: space.s, backgroundColor: color.panel, borderWidth: 1, borderColor: color.hairline, borderRadius: 14, padding: 4 }}>
            <Pressable
              onPress={() => {
                setReplyTo(selected);
                setSelected(null);
                input.current?.focus();
              }}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}>
              <ReplyIcon c={color.paper} />
              <Body size={size.small}>Reply</Body>
            </Pressable>
            {selected.role === 'finn'
              ? REACTIONS.map((e) => (
                  <Pressable
                    key={e}
                    onPress={() => {
                      react(selected.id, selected.payload.reaction === e ? null : e);
                      setSelected(null);
                    }}
                    accessibilityLabel={`React ${e}`}
                    style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: selected.payload.reaction === e ? color.hairline : 'transparent' }}>
                    <Body size={size.lead}>{e}</Body>
                  </Pressable>
                ))
              : null}
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setSelected(null)} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
              <Body size={size.small} c={color.dim}>Cancel</Body>
            </Pressable>
          </View>
        ) : null}
        <View style={{ backgroundColor: color.panel, borderWidth: 1, borderColor: color.hairline, borderRadius: 18, paddingLeft: 14, paddingRight: 5, paddingVertical: 5 }}>
          {replyTo ? (
            <View style={{ paddingTop: 6, paddingRight: 6 }}>
              <Quote m={replyTo} onClear={() => setReplyTo(null)} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <TextInput
              ref={input as never}
              value={draft}
              onChangeText={setDraft}
              placeholder={voice.recording ? 'Listening… tap the mic to send' : working ? 'Add to that; FINN folds it in' : 'Ask about a company, a filing, a number'}
              placeholderTextColor={voice.recording ? color.loss : color.dim}
              multiline
              style={{ flex: 1, minHeight: 38, maxHeight: 120, color: color.paper, fontFamily: font.regular, fontSize: 15, paddingTop: 9, paddingBottom: 9, outlineStyle: 'none' } as any}
              onKeyPress={(e: any) => {
                if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                  e.preventDefault?.();
                  submit();
                }
              }}
            />
            {voice.recording ? (
              <Mono size={12} c={color.loss} style={{ alignSelf: 'center' }}>
                {`${Math.max(0, Math.round((Date.now() - voice.startedAt) / 1000))}s`}
              </Mono>
            ) : null}
            {draft.trim() ? (
              <RoundButton label="Send" onPress={() => submit()} bg={color.paper}>
                <SendIcon c={color.ink} />
              </RoundButton>
            ) : working && !voice.recording ? (
              <RoundButton label="Stop FINN" onPress={stop} bg={color.well} border>
                <StopIcon c={color.paper} size={14} />
              </RoundButton>
            ) : voice.supported ? (
              <RoundButton
                label={voice.recording ? 'Stop and send voice note' : 'Record a voice note'}
                onPress={() => (voice.recording ? voice.stopAndSend(contextText()) : voice.start())}
                disabled={voice.sending}
                bg={voice.recording ? color.loss : color.well}
                border={!voice.recording}>
                {voice.recording ? <SendIcon c={color.ink} /> : <MicIcon c={voice.sending ? color.dim : color.paper} />}
              </RoundButton>
            ) : null}
          </View>
        </View>
        {voice.sending ? <Body size={size.meta} c={color.dim} style={{ marginTop: space.xs }}>Transcribing…</Body> : null}
        {voice.error ? <Body size={size.meta} c={color.loss} style={{ marginTop: space.xs }}>{voice.error}</Body> : null}
      </View>
      <Sessions
        open={sheet}
        sessions={chats.sessions}
        current={chats.current}
        onClose={() => setSheet(false)}
        onPick={(id) => {
          chats.select(id);
          setSheet(false);
          setSelected(null);
          setReplyTo(null);
        }}
        onNew={() => {
          newChat();
          setSheet(false);
        }}
        onRemove={chats.remove}
      />
    </KeyboardAvoidingView>
  );
}

/** All of this install's sessions. Each is a separate Hermes session; several can be working at once. */
function Sessions({
  open,
  sessions,
  current,
  onClose,
  onPick,
  onNew,
  onRemove,
}: {
  open: boolean;
  sessions: ChatSummary[];
  current: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
  onNew: () => void;
  onRemove: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} />
      <View style={{ maxHeight: '75%', backgroundColor: color.ink, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: 1, borderColor: color.hairline, paddingBottom: insets.bottom + space.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.m }}>
          <Title size={18} style={{ fontFamily: font.bold }}>Chats</Title>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onNew} hitSlop={10} accessibilityRole="button" style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: color.paper }}>
            <Strong size={14} c={color.ink}>New chat</Strong>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.l }}>
          {sessions.length === 0 ? <Body c={color.dim}>No chats yet.</Body> : null}
          {sessions.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => onPick(c.id)}
              onLongPress={() => c.id !== 'home' && onRemove(c.id)}
              style={({ pressed }) => ({
                paddingVertical: space.m,
                paddingHorizontal: space.m,
                marginHorizontal: -space.m,
                borderRadius: 12,
                backgroundColor: c.id === current ? color.panel : pressed ? color.well : 'transparent',
              })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {c.working ? <Dot size={6} working /> : null}
                <Body numberOfLines={1} style={{ flex: 1, fontFamily: font.medium }}>{c.title}</Body>
                <Body size={size.meta} c={c.working ? color.marigold : color.dim}>
                  {c.working ? 'working' : c.at ? when(c.at) : 'empty'}
                </Body>
              </View>
              {c.last ? (
                <Body size={size.small} c={color.mist} numberOfLines={1} style={{ marginTop: 2 }}>
                  {c.last_role === 'user' ? 'You: ' : ''}
                  {clean(c.last).replace(/[#*_`|>]/g, '')}
                </Body>
              ) : null}
            </Pressable>
          ))}
          <Body size={size.meta} c={color.dim} style={{ marginTop: space.m, marginBottom: space.s }}>
            Each chat runs on its own; FINN can work on several at once and notifies you when one finishes. Long-press a chat to remove it from this list.
          </Body>
        </ScrollView>
      </View>
    </Modal>
  );
}

function RoundButton({
  children,
  label,
  onPress,
  disabled,
  bg,
  border,
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  bg: string;
  border?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        borderWidth: border ? 1 : 0,
        borderColor: color.hairline,
        opacity: pressed ? 0.7 : 1,
      })}>
      {children}
    </Pressable>
  );
}
