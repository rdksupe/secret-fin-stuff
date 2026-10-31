import { fetch as streamingFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { API_BASE, api, headers } from './api';

// The app is a Hermes messaging platform (`finn_app`), like a Telegram chat: sessions,
// burst merging, steer-while-working, /stop and scheduled jobs are all handled by the
// Hermes gateway. This hook just keeps one conversation in sync with the server.

export type ChatMessage = {
  id: string;
  role: 'user' | 'finn';
  kind: 'message' | 'tool' | 'approval' | 'clarify' | 'confirm';
  text: string;
  payload: {
    choices?: string[];
    command?: string;
    answered?: string;
    resolved?: boolean;
    voice?: boolean;
    reply_to?: string;
    reply_text?: string;
    reply_role?: 'user' | 'finn';
    reaction?: string | null; // the investor's, on a FINN message
    finn_reaction?: string | null; // FINN's 👀 / 👍 / 👎 on the investor's message
  };
  final: boolean;
  proactive: boolean;
  at: string;
};

// Each chat is its own Hermes session (session key = chat id), so several can run at once.
// The install keeps its list of chat ids; the server keeps the messages.
const LIST = 'finn.chats';
const CURRENT = 'finn.chat-id';

async function load(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function save(key: string, value: string) {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {}
}

const newId = () => `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type ChatSummary = {
  id: string;
  title: string;
  last: string;
  last_role: 'user' | 'finn' | null;
  at: string | null;
  working: boolean;
  count: number;
};

/** The install's sessions: which one is open, the list, and their live summaries. */
export function useChats() {
  const [ids, setIds] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<ChatSummary[]>([]);

  useEffect(() => {
    (async () => {
      const cur = await load(CURRENT);
      let list: string[] = [];
      try {
        list = JSON.parse((await load(LIST)) ?? '[]');
      } catch {}
      const open = cur ?? list[0] ?? newId();
      if (!list.includes(open)) list = [open, ...list];
      setIds(list);
      setCurrent(open);
      save(LIST, JSON.stringify(list));
      save(CURRENT, open);
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!ids.length) return;
    try {
      setSummaries(await api.get<ChatSummary[]>(`/conversations?ids=${ids.join(',')}`));
    } catch {}
  }, [ids]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const select = useCallback(
    (id: string) => {
      setCurrent(id);
      save(CURRENT, id);
      if (id !== 'home' && !ids.includes(id)) {
        const list = [id, ...ids];
        setIds(list);
        save(LIST, JSON.stringify(list));
      }
    },
    [ids],
  );

  const create = useCallback(() => {
    // Reuse the open chat if nothing has been said in it yet.
    const open = summaries.find((c) => c.id === current);
    if (current && current !== 'home' && open && open.count === 0) return current;
    const id = newId();
    const list = [id, ...ids];
    setIds(list);
    setCurrent(id);
    save(LIST, JSON.stringify(list));
    save(CURRENT, id);
    return id;
  }, [ids, current, summaries]);

  const remove = useCallback(
    (id: string) => {
      const list = ids.filter((x) => x !== id);
      setIds(list);
      save(LIST, JSON.stringify(list));
      if (id === current) {
        const next = list[0] ?? newId();
        if (!list.length) {
          setIds([next]);
          save(LIST, JSON.stringify([next]));
        }
        setCurrent(next);
        save(CURRENT, next);
      }
    },
    [ids, current],
  );

  // Sessions in most-recent order; empty ones (other than the open one) are hidden.
  const sessions = summaries
    .filter((c) => c.count > 0 || c.id === current)
    .sort((a, b) => (b.at ?? '9').localeCompare(a.at ?? '9'));

  return { current, sessions, select, create, remove, refresh };
}

// The API sends UTC without a zone suffix; Date.parse would read it as local time.
const utc = (iso: string) => Date.parse(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);

/** Strip the gateway's streaming cursor; the app draws its own state. */
export const clean = (t: string) => t.replace(/\s*▉\s*$/, '').replace(/^\n+/, '');

export function useConversation(id: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingAt, setTypingAt] = useState(0);
  const [online, setOnline] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1500);
    return () => clearInterval(t);
  }, []);

  const upsert = useCallback((m: ChatMessage) => {
    setMessages((ms) => {
      const i = ms.findIndex((x) => x.id === m.id);
      if (i === -1) return [...ms, m];
      const next = ms.slice();
      next[i] = m;
      return next;
    });
  }, []);

  // History, then a live stream that reconnects with back-off.
  useEffect(() => {
    if (!id) return;
    let stop = false;
    let ctrl: AbortController | null = null;
    setMessages([]);
    setTypingAt(0);
    api.get<ChatMessage[]>(`/conversations/${id}/messages`).then((ms) => !stop && setMessages(ms)).catch(() => {});

    (async () => {
      let delay = 1000;
      while (!stop) {
        ctrl = new AbortController();
        try {
          const res = await streamingFetch(`${API_BASE}/api/conversations/${id}/stream`, {
            headers: headers({ Accept: 'text/event-stream' }),
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) throw new Error(String(res.status));
          setOnline(true);
          delay = 1000;
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              let ev: any;
              try {
                ev = JSON.parse(line.slice(5).trim());
              } catch {
                continue;
              }
              if (ev?.type === 'typing') setTypingAt(Date.now());
              else if (ev?.message && !stop) upsert(ev.message);
            }
          }
        } catch {}
        setOnline(false);
        if (stop) break;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 15000);
        // Catch up on anything sent while we were disconnected.
        api.get<ChatMessage[]>(`/conversations/${id}/messages`).then((ms) => !stop && setMessages(ms)).catch(() => {});
      }
    })();
    return () => {
      stop = true;
      ctrl?.abort();
    };
  }, [id, upsert]);

  const send = useCallback(
    async (text: string, context?: string, replyTo?: string) => {
      if (!id || !text.trim()) return;
      try {
        const m = await api.post<ChatMessage>(`/conversations/${id}/messages`, { text: text.trim(), context, reply_to: replyTo });
        upsert(m);
      } catch (e: any) {
        upsert({
          id: `err-${Date.now()}`,
          role: 'finn',
          kind: 'message',
          text: `Couldn't reach FINN: ${e?.message ?? 'network error'}`,
          payload: {},
          final: true,
          proactive: false,
          at: new Date().toISOString(),
        });
      }
    },
    [id, upsert],
  );

  const answer = useCallback(
    async (messageId: string, choice: string) => {
      if (!id) return;
      try {
        upsert(await api.post<ChatMessage>(`/conversations/${id}/actions`, { message_id: messageId, choice }));
      } catch {}
    },
    [id, upsert],
  );

  const react = useCallback(
    async (messageId: string, emoji: string | null) => {
      if (!id) return;
      try {
        upsert(await api.post<ChatMessage>(`/conversations/${id}/messages/${messageId}/reaction`, { emoji }));
      } catch {}
    },
    [id, upsert],
  );

  const last = messages[messages.length - 1];
  const working =
    now - typingAt < 6000 ||
    (!!last && last.kind === 'tool' && now - utc(last.at) < 90_000) ||
    (!!last && last.role === 'finn' && last.kind === 'message' && !last.final && now - utc(last.at) < 300_000) ||
    (!!last && last.role === 'user' && now - utc(last.at) < 90_000);

  return {
    chatId: id,
    add: upsert,
    messages,
    online,
    working,
    send,
    stop: () => send('/stop'),
    answer,
    react,
  };
}
