import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatsIcon, ChevronRight, CloseIcon, MicIcon, PlusIcon, ReplyIcon, SendIcon, StopIcon } from '@/components/icons';
import { BarAction, TopBar } from '@/components/top-bar';
import { Markdown } from '@/components/markdown';
import { Dot } from '@/components/pulse';
import { Body, Figure, Strong, Ticker, Title } from '@/components/type';
import { api, mediaUrl, type Story } from '@/lib/api';
import { clean, useChats, useConversation, type ChatMessage, type ChatSummary } from '@/lib/chat';
import { useSpeech, useVoiceNote } from '@/lib/voice';
import { headline, when } from '@/lib/format';
import { color, font, maxWidth, size, space, touch } from '@/theme';
import { Setback, SetbackPlate } from '@/components/deco';

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
    <View style={{ marginVertical: space.m, borderWidth: 1, borderColor: color.line, backgroundColor: color.raised, padding: space.l }}>
      <Strong size={size.small} c={color.brassText}>{m.kind === 'clarify' ? 'FINN has a question' : 'FINN needs your OK'}</Strong>
      <Body style={{ marginTop: space.s }}>{clean(m.text).replace(/\*\*/g, '')}</Body>
      {m.payload.command ? (
        <Figure size={12} c={color.text2} style={{ marginTop: space.s }}>{m.payload.command}</Figure>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.m }}>
        {answered ? (
          <Body size={size.small} c={color.text2}>You chose: {LABELS[answered] ?? answered}</Body>
        ) : (
          choices.map((c) => (
            <Pressable
              key={c}
              onPress={() => onAnswer(c)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 9,
                minHeight: touch,
                justifyContent: 'center',
                backgroundColor: c === primary ? color.text : 'transparent',
                borderWidth: 1,
                borderColor: c === primary ? color.text : color.line,
                opacity: pressed ? 0.7 : 1,
              })}>
              <Body size={size.small} c={c === primary ? color.bg : color.text}>
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
    <View style={{ flexDirection: 'row', alignItems: 'center', borderLeftWidth: 1, borderLeftColor: m.role === 'finn' ? color.brass : color.text3, paddingLeft: 8, marginBottom: 6 }}>
      <View style={{ flex: 1 }}>
        <Body size={size.meta} c={m.role === 'finn' ? color.brassText : color.text2}>{m.role === 'finn' ? 'FINN' : 'You'}</Body>
        <Body size={size.meta} c={color.text2} numberOfLines={2}>{clean(m.text).replace(/[#*_`|>]/g, '')}</Body>
      </View>
      {onClear ? (
        <Pressable onPress={onClear} hitSlop={12} accessibilityLabel="Cancel reply" style={{ paddingHorizontal: 6 }}>
          <CloseIcon c={color.text2} size={18} />
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
        <Figure size={12} c={color.text3}>{`${lines.length} steps · show all`}</Figure>
      ) : null}
      {shown.map((l, i) => (
        <Figure key={i} size={12} c={live && i === shown.length - 1 ? color.brassText : color.text3} numberOfLines={2}>{l}</Figure>
      ))}
    </Pressable>
  );
}

/** A file FINN sent: images inline (tap for full size), anything else as a file row. */
function Attachment({ a }: { a: NonNullable<ChatMessage['payload']['attachments']>[number] }) {
  const [full, setFull] = useState(false);
  const uri = mediaUrl(a.url);
  if (a.type === 'image') {
    return (
      <>
        <Pressable onPress={() => setFull(true)} accessibilityRole="imagebutton" accessibilityLabel={`Image: ${a.name}`} style={{ marginTop: space.s, borderWidth: 1, borderColor: color.line, backgroundColor: color.raised }}>
          <Image source={{ uri }} style={{ width: '100%', aspectRatio: 4 / 3 }} contentFit="contain" />
        </Pressable>
        <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
          <Pressable onPress={() => setFull(false)} style={{ flex: 1, backgroundColor: 'rgba(10,20,18,0.92)', justifyContent: 'center' }} accessibilityLabel="Close image">
            <Image source={{ uri }} style={{ width: '100%', height: '80%' }} contentFit="contain" />
          </Pressable>
        </Modal>
      </>
    );
  }
  return (
    <Pressable
      onPress={() => Linking.openURL(uri)}
      accessibilityRole="link"
      style={({ pressed }) => ({ marginTop: space.s, flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, borderWidth: 1, borderColor: color.line, backgroundColor: pressed ? color.inset : color.raised, paddingHorizontal: space.m })}>
      <View style={{ flex: 1 }}>
        <Body size={size.small} style={{ fontFamily: font.semibold }} numberOfLines={1}>{a.name}</Body>
        <Body size={size.meta} c={color.text3}>{a.type}{a.bytes ? ` · ${Math.max(1, Math.round(a.bytes / 1024))} KB` : ''}</Body>
      </View>
      <ChevronRight c={color.sea} size={18} />
    </Pressable>
  );
}

function Reaction({ emoji }: { emoji: string }) {
  return (
    <View style={{ alignSelf: 'flex-start', marginTop: 6, borderWidth: 1, borderColor: color.line, backgroundColor: color.raised, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Body size={size.small}>{emoji}</Body>
    </View>
  );
}

function Bubble({
  m,
  live,
  interim,
  showQuote,
  selected,
  onSelect,
  onAnswer,
  onAction,
  listen,
}: {
  m: ChatMessage;
  live: boolean;
  interim: boolean;
  showQuote: boolean;
  selected: boolean;
  onSelect: (m: ChatMessage) => void;
  onAnswer: (id: string, choice: string) => void;
  onAction: (prompt: string) => void;
  listen: Listen;
}) {
  if (m.kind === 'approval' || m.kind === 'clarify' || m.kind === 'confirm') return <Prompt m={m} onAnswer={(c) => onAnswer(m.id, c)} />;
  if (m.kind === 'tool') return <ToolTrace m={m} live={live} />;
  if (interim) {
    // Commentary between tool calls ("checking the Q2 call…"): part of the working, not the answer.
    return (
      <Body size={size.meta} c={color.text3} numberOfLines={3} style={{ marginVertical: space.xs }}>
        {clean(m.text).replace(/[#*_`|>]/g, '').replace(/\s+/g, ' ').trim()}
      </Body>
    );
  }
  const quote = showQuote && m.payload.reply_text ? { role: m.payload.reply_role ?? 'finn', text: m.payload.reply_text } : null;
  const highlight = selected ? { backgroundColor: color.inset } : null;
  if (m.role === 'user') {
    // Slash commands are controls, not conversation.
    if (m.text.startsWith('/')) {
      return (
        <Body size={size.meta} c={color.text3} style={{ alignSelf: 'center', marginVertical: space.s }}>
          {m.text === '/stop' ? 'Stopped' : m.text === '/new' ? 'New conversation' : m.text}
        </Body>
      );
    }
    return (
      <Pressable onLongPress={() => onSelect(m)} delayLongPress={300} style={[{ alignSelf: 'flex-end', maxWidth: '86%', marginVertical: space.s }, highlight]}>
        <View style={{ backgroundColor: selected ? color.seaTint : color.raised, borderWidth: 1, borderColor: color.line, paddingHorizontal: 14, paddingVertical: 10 }}>
          {quote ? <Quote m={quote} /> : null}
          {m.payload.voice ? <Body size={size.meta} c={color.text3}>Voice note</Body> : null}
          <Body>{m.text}</Body>
        </View>
        {m.payload.finn_reaction ? (
          <View style={{ position: 'absolute', left: -10, bottom: -8, backgroundColor: color.raised, borderWidth: 1, borderColor: color.line, paddingHorizontal: 4, paddingVertical: 1 }}>
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
        <Body size={size.meta} c={m.final ? color.text3 : color.brassText}>
          {m.proactive ? `FINN · scheduled · ${when(m.at)}` : m.final ? 'FINN' : 'FINN is writing'}
        </Body>
      </View>
      {quote ? <Quote m={quote} /> : null}
      {text ? <Markdown text={text} onAction={onAction} /> : m.payload.attachments?.length ? null : <Body c={color.text3}>…</Body>}
      {m.payload.attachments?.map((a) => <Attachment key={a.url} a={a} />)}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        {m.payload.reaction ? <Reaction emoji={m.payload.reaction} /> : null}
        {m.final && text.length > 0 && (
          <Pressable onPress={() => listen.toggle(m.id)} hitSlop={8} accessibilityRole="button" style={{ marginTop: space.s }}>
            <Body size={size.meta} c={color.text2}>
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

/** A FINN message followed by more FINN activity (tool steps or another message) in the same turn. */
function isInterim(ms: ChatMessage[], i: number): boolean {
  const m = ms[i];
  if (m.role !== 'finn' || m.kind !== 'message' || m.proactive) return false;
  if (m.text.startsWith('💾')) return true; // Hermes self-review notices
  for (let j = i + 1; j < ms.length; j++) {
    if (ms[j].role === 'user' || ms[j].proactive) return false;
    if (ms[j].kind === 'tool' || ms[j].kind === 'message') return true;
  }
  return false;
}

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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.bg }} behavior="padding">
      <TopBar
        title="Ask"
        right={
          <>
            <BarAction label={othersWorking > 0 ? `Chats, ${othersWorking} running` : 'Chats'} onPress={() => setSheet(true)}>
              <ChatsIcon c={color.onSea} />
              {othersWorking > 0 ? <Figure size={12} c={color.brassOnSea} style={{ fontFamily: font.semibold }}>{othersWorking}</Figure> : null}
            </BarAction>
            {messages.length > 0 ? (
              <BarAction label="New chat" onPress={newChat}>
                <PlusIcon c={color.onSea} />
              </BarAction>
            ) : null}
          </>
        }
        below={
          working || !online || context ? (
            <View style={{ gap: space.s }}>
              {working ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Dot size={6} working onSea />
                  <Body size={size.small} c={color.brassOnSea} style={{ fontFamily: font.semibold }}>FINN is working</Body>
                </View>
              ) : !online ? (
                <Body size={size.small} c={color.onSea2}>Reconnecting…</Body>
              ) : null}
              {context ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 1, borderColor: 'rgba(238,244,241,0.38)', paddingLeft: 12, height: 36 }}>
                  <Ticker c={color.brassOnSea}>{context.symbol}</Ticker>
                  {context.label ? (
                    <Body size={size.meta} c={color.onSea2} numberOfLines={1} style={{ flexShrink: 1 }}>{context.label}</Body>
                  ) : null}
                  <Pressable onPress={clearContext} accessibilityRole="button" accessibilityLabel="Clear context" hitSlop={6} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                    <CloseIcon c={color.onSea} size={18} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : undefined
        }
      />

      <ScrollView
        ref={scroll as never}
        style={{ flex: 1 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, width: '100%', maxWidth, alignSelf: 'center' }}>
        {messages.length === 0 ? (
          <View style={{ marginTop: space.xl }}>
            <SetbackPlate>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Title size={22} c={color.onSea} style={{ flex: 1, fontFamily: font.bold }}>{context ? `Ask about ${context.symbol}` : 'Ask about any NSE company'}</Title>
                <Setback steps={3} onSea />
              </View>
              <Body size={size.small} c={color.onSea2} style={{ marginTop: space.s }}>
                Answers come from each company's own filings, results and call transcripts. FINN cites the page it used. Ask it to watch something on a schedule and it will message you here.
              </Body>
            </SetbackPlate>
            <View style={{ marginTop: space.xl, gap: space.s }}>
              {(context
                ? [`Promised vs delivered at ${context.symbol} over the last four quarters`, `Summarise ${context.symbol}'s latest results`, `What should I watch at ${context.symbol} next quarter?`]
                : STARTERS
              ).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => submit(s)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderWidth: 1, borderColor: color.line, backgroundColor: pressed ? color.inset : color.raised, paddingHorizontal: 14, paddingVertical: 12 })}>
                  <Body size={size.small} c={color.text} style={{ flex: 1 }}>{s}</Body>
                  <ChevronRight c={color.sea} size={18} />
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
              interim={isInterim(messages, i)}
              // Hermes threads every answer to the question it answers; only show a quote when it isn't the one just above.
              showQuote={m.role === 'user' || m.payload.reply_to !== lastUserBefore(messages, i)}
              selected={selected?.id === m.id}
              onSelect={setSelected}
              onAnswer={answer}
              onAction={(p) => submit(p)}
              listen={listen}
            />
          ))
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: space.l, paddingBottom: space.s, paddingTop: space.s, width: '100%', maxWidth, alignSelf: 'center' }}>
        {selected ? (
          // Long-press menu: reply to any message, react to FINN's.
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: space.s, backgroundColor: color.raised, borderWidth: 1, borderColor: color.line, padding: 4 }}>
            <Pressable
              onPress={() => {
                setReplyTo(selected);
                setSelected(null);
                input.current?.focus();
              }}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: touch }}>
              <ReplyIcon c={color.sea} />
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
                    style={{ width: touch, height: touch, alignItems: 'center', justifyContent: 'center', backgroundColor: selected.payload.reaction === e ? color.seaTint : 'transparent' }}>
                    <Body size={size.lead}>{e}</Body>
                  </Pressable>
                ))
              : null}
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setSelected(null)} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
              <Body size={size.small} c={color.text3}>Cancel</Body>
            </Pressable>
          </View>
        ) : null}
        <View style={{ backgroundColor: color.raised, borderWidth: 1, borderColor: color.line, paddingLeft: 14, paddingRight: 4, paddingVertical: 4 }}>
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
              placeholderTextColor={voice.recording ? color.loss : color.text3}
              multiline
              style={{ flex: 1, minHeight: 38, maxHeight: 120, color: color.text, fontFamily: font.regular, fontSize: 15, paddingTop: 9, paddingBottom: 9, outlineStyle: 'none' } as any}
              onKeyPress={(e: any) => {
                if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                  e.preventDefault?.();
                  submit();
                }
              }}
            />
            {voice.recording ? (
              <Figure size={12} c={color.loss} style={{ alignSelf: 'center' }}>
                {`${Math.max(0, Math.round((Date.now() - voice.startedAt) / 1000))}s`}
              </Figure>
            ) : null}
            {draft.trim() ? (
              <RoundButton label="Send" onPress={() => submit()} bg={color.sea}>
                <SendIcon c={color.onSea} />
              </RoundButton>
            ) : working && !voice.recording ? (
              <RoundButton label="Stop FINN" onPress={stop} bg={color.inset} border>
                <StopIcon c={color.sea} size={14} />
              </RoundButton>
            ) : voice.supported ? (
              <RoundButton
                label={voice.recording ? 'Stop and send voice note' : 'Record a voice note'}
                onPress={() => (voice.recording ? voice.stopAndSend(contextText()) : voice.start())}
                disabled={voice.sending}
                bg={voice.recording ? color.loss : color.inset}
                border={!voice.recording}>
                {voice.recording ? <SendIcon c={color.raised} /> : <MicIcon c={voice.sending ? color.text3 : color.sea} />}
              </RoundButton>
            ) : null}
          </View>
        </View>
        {voice.sending ? <Body size={size.meta} c={color.text3} style={{ marginTop: space.xs }}>Transcribing…</Body> : null}
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
      <View style={{ maxHeight: '75%', backgroundColor: color.raised, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: insets.bottom + space.m }}>
        <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: color.faint, marginTop: 12 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.m }}>
          <Title size={18} style={{ fontFamily: font.bold }}>Chats</Title>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onNew} accessibilityRole="button" style={{ height: touch, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 20, backgroundColor: color.sea }}>
            <Strong size={14} c={color.onSea}>New chat</Strong>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.l }}>
          {sessions.length === 0 ? <Body c={color.text3}>No chats yet.</Body> : null}
          {sessions.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => onPick(c.id)}
              onLongPress={() => c.id !== 'home' && onRemove(c.id)}
              style={({ pressed }) => ({
                minHeight: 64,
                paddingVertical: space.m,
                paddingHorizontal: space.l,
                marginHorizontal: -space.l,
                backgroundColor: c.id === current ? color.seaTint : pressed ? color.inset : 'transparent',
              })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {c.working ? <Dot size={6} working /> : null}
                <Body numberOfLines={1} style={{ flex: 1, fontFamily: font.medium }}>{c.title}</Body>
                <Body size={size.meta} c={c.working ? color.brassText : color.text3}>
                  {c.working ? 'working' : c.at ? when(c.at) : 'empty'}
                </Body>
              </View>
              {c.last ? (
                <Body size={size.small} c={color.text2} numberOfLines={1} style={{ marginTop: 2 }}>
                  {c.last_role === 'user' ? 'You: ' : ''}
                  {clean(c.last).replace(/[#*_`|>]/g, '')}
                </Body>
              ) : null}
            </Pressable>
          ))}
          <Body size={size.meta} c={color.text3} style={{ marginTop: space.m, marginBottom: space.s }}>
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
      style={({ pressed }) => ({
        width: touch,
        height: touch,
        borderRadius: touch / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        borderWidth: border ? 1 : 0,
        borderColor: color.line,
        opacity: pressed ? 0.7 : 1,
      })}>
      {children}
    </Pressable>
  );
}
