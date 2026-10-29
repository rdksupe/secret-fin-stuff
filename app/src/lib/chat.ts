import { fetch as streamingFetch } from 'expo/fetch';
import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE, headers } from './api';

export type ToolStep = { name: string; detail: string; done: boolean };
export type Message = {
  id: string;
  role: 'user' | 'finn';
  text: string;
  tools: ToolStep[];
  state: 'streaming' | 'done' | 'stopped' | 'failed';
};
export type ChatContext = { symbol?: string; feedId?: string };

const BURST_MS = 400; // rapid messages within this window become one turn

let seq = 0;
const nid = () => `${Date.now().toString(36)}-${seq++}`;

/** Human-readable line for what FINN is doing right now. */
export function describeTool(name: string, detail: string): string {
  const path = (detail.match(/companies\/([A-Z0-9&-]+)\/wiki\/([^"' ]+)/) ?? []).slice(1);
  switch (name) {
    case 'read_file':
      return path.length ? `reading ${path[0]} · ${path[1]}` : 'reading a file';
    case 'search_files':
    case 'list_directory':
      return path.length ? `looking through ${path[0]}'s brain` : 'looking through the brains';
    case 'finn_results':
      return 'pulling the results filing';
    case 'finn_digest':
      return 'checking your digest';
    case 'finn_filing_text':
      return 'reading the filing';
    case 'finn_onboard':
      return 'building a brain for this company';
    case 'web_search':
      return 'searching the web';
    case 'skill_view':
      return 'loading its playbook';
    default:
      return name.replace(/_/g, ' ');
  }
}

export function useChat(ctx: ChatContext = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
  const session = useRef<string | undefined>(undefined);
  const runId = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<string[]>([]);
  const burst = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const patchFinn = useCallback((id: string, fn: (m: Message) => Message) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const run = useCallback(
    async (text: string) => {
      const finnId = nid();
      setMessages((ms) => [...ms, { id: finnId, role: 'finn', text: '', tools: [], state: 'streaming' }]);
      setRunning(true);
      const ac = new AbortController();
      abort.current = ac;
      try {
        const start = await globalThis.fetch(`${API_BASE}/api/chat`, {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            message: text,
            session_id: session.current,
            symbol: ctxRef.current.symbol,
            feed_id: ctxRef.current.feedId,
          }),
        });
        if (!start.ok) throw new Error(`FINN couldn't start (${start.status})`);
        const { run_id, session_id } = await start.json();
        session.current = session_id;
        runId.current = run_id;

        const res = await streamingFetch(`${API_BASE}/api/chat/${run_id}/events`, {
          headers: headers({ Accept: 'text/event-stream' }),
          signal: ac.signal,
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let finished = false;
        while (!finished) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
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
            const kind = ev.event as string | undefined;
            if (kind === 'message.delta' && ev.delta) {
              patchFinn(finnId, (m) => ({ ...m, text: m.text + ev.delta }));
            } else if (kind === 'tool.started') {
              const name = ev.tool ?? ev.name ?? 'tool';
              const detail = JSON.stringify(ev.args ?? ev.preview ?? '');
              patchFinn(finnId, (m) => ({ ...m, tools: [...m.tools, { name, detail, done: false }] }));
            } else if (kind === 'tool.completed' || kind === 'tool.failed') {
              patchFinn(finnId, (m) => {
                const tools = [...m.tools];
                const i = tools.findIndex((t) => !t.done);
                if (i >= 0) tools[i] = { ...tools[i], done: true };
                return { ...m, tools };
              });
            } else if (kind === 'run.completed') {
              finished = true;
              patchFinn(finnId, (m) => ({ ...m, state: 'done' }));
            } else if (kind === 'run.cancelled') {
              finished = true;
              patchFinn(finnId, (m) => ({ ...m, state: 'stopped' }));
            } else if (kind === 'run.failed') {
              finished = true;
              patchFinn(finnId, (m) => ({ ...m, state: 'failed', text: m.text || String(ev.error ?? 'FINN hit an error.') }));
            }
          }
        }
        patchFinn(finnId, (m) => (m.state === 'streaming' ? { ...m, state: 'done' } : m));
      } catch (e: any) {
        const stopped = ac.signal.aborted;
        patchFinn(finnId, (m) => ({
          ...m,
          state: stopped ? 'stopped' : 'failed',
          text: m.text || (stopped ? '' : `Couldn't reach FINN. ${e?.message ?? ''}`.trim()),
        }));
      } finally {
        runId.current = null;
        abort.current = null;
        setRunning(false);
      }
    },
    [patchFinn],
  );

  // When a run ends, anything typed meanwhile goes as the next turn.
  useEffect(() => {
    if (!running && pending.current.length) {
      const text = pending.current.join('\n');
      pending.current = [];
      run(text);
    }
  }, [running, run]);

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setMessages((ms) => [...ms, { id: nid(), role: 'user', text: t, tools: [], state: 'done' }]);
      pending.current.push(t);
      if (running) return; // queued; flushed when the current run ends
      if (burst.current) clearTimeout(burst.current);
      burst.current = setTimeout(() => {
        burst.current = null;
        if (!pending.current.length) return;
        const merged = pending.current.join('\n');
        pending.current = [];
        run(merged);
      }, BURST_MS);
    },
    [running, run],
  );

  const stop = useCallback(async () => {
    const id = runId.current;
    abort.current?.abort();
    if (id) {
      try {
        await globalThis.fetch(`${API_BASE}/api/chat/${id}/stop`, { method: 'POST', headers: headers() });
      } catch {}
    }
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    session.current = undefined;
  }, []);

  return { messages, running, send, stop, reset, queued: pending.current.length };
}
