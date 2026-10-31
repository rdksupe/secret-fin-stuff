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
  kind: 'message' | 'approval' | 'clarify';
  text: string;
  payload: { choices?: string[]; command?: string; answered?: string; resolved?: boolean };
  final: boolean;
  proactive: boolean;
  at: string;
};

const KEY = 'finn.chat-id';

async function chatId(): Promise<string> {
  try {
    if (Platform.OS === 'web') {
      const v = globalThis.localStorage?.getItem(KEY);
      if (v) return v;
    } else {
      const v = await SecureStore.getItemAsync(KEY);
      if (v) return v;
    }
  } catch {}
  const id = `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, id);
    else await SecureStore.setItemAsync(KEY, id);
  } catch {}
  return id;
}

/** Strip the gateway's streaming cursor; the app draws its own state. */
export const clean = (t: string) => t.replace(/\s*▉\s*$/, '').replace(/^\n+/, '');

export function useConversation() {
  const [id, setId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingAt, setTypingAt] = useState(0);
  const [online, setOnline] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    chatId().then(setId);
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
    api.get<ChatMessage[]>(`/conversations/${id}/messages`).then(setMessages).catch(() => {});

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
              else if (ev?.message) upsert(ev.message);
            }
          }
        } catch {}
        setOnline(false);
        if (stop) break;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 15000);
        // Catch up on anything sent while we were disconnected.
        api.get<ChatMessage[]>(`/conversations/${id}/messages`).then(setMessages).catch(() => {});
      }
    })();
    return () => {
      stop = true;
      ctrl?.abort();
    };
  }, [id, upsert]);

  const send = useCallback(
    async (text: string, context?: string) => {
      if (!id || !text.trim()) return;
      try {
        const m = await api.post<ChatMessage>(`/conversations/${id}/messages`, { text: text.trim(), context });
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

  const last = messages[messages.length - 1];
  const working =
    now - typingAt < 6000 ||
    (!!last && last.role === 'finn' && last.kind === 'message' && !last.final) ||
    (!!last && last.role === 'user' && now - Date.parse(last.at) < 90_000);

  return {
    chatId: id,
    add: upsert,
    messages,
    online,
    working,
    send,
    stop: () => send('/stop'),
    newChat: () => send('/new'),
    answer,
  };
}
