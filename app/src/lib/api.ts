// FINN API client. The app authenticates with a JWT the server mints when the investor unlocks
// FINN with the password (see lib/session.ts), sent as `Authorization: Bearer …`.
// No token is baked into the build.

import { getToken, setToken } from './session';

export const API_BASE = (process.env.EXPO_PUBLIC_FINN_API ?? '').replace(/\/$/, '');

/** A media URL the app's image views can load (native views can't always attach headers). */
export function mediaUrl(path: string): string {
  const u = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const t = getToken();
  return t ? `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}` : u;
}

export function headers(extra: Record<string, string> = {}): Record<string, string> {
  const t = getToken();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Say what went wrong in the investor's terms; the raw transport error stays in the log. */
export function networkMessage(e: unknown): string {
  const raw = String((e as Error)?.message ?? e);
  console.warn('FINN request failed', raw);
  if (/certif|trust anchor|ssl|handshake/i.test(raw))
    return "Can't reach FINN's server securely. This network may be blocking it; try another network or turn off the VPN.";
  return "Can't reach FINN's server. Check your connection.";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await globalThis.fetch(`${API_BASE}/api${path}`, {
      ...init,
      headers: headers({ 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) }),
    });
  } catch (e) {
    throw new ApiError(0, networkMessage(e));
  }
  if (res.status === 401 && getToken()) {
    // The session expired or the password changed: drop it so the app asks to unlock again.
    setToken(null);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, String(detail));
  }
  return res.json() as Promise<T>;
}

/** Exchange the password for a session token. */
export async function unlock(password: string): Promise<void> {
  const res = await globalThis.fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, device: 'android' }),
  }).catch(() => null);
  if (!res) throw new ApiError(0, "Can't reach FINN's server. Check your connection.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, String(body.detail ?? 'Unlock failed'));
  await setToken(body.token);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── shapes ────────────────────────────────────────────────────────────────

export type ResultsRow = {
  label: string;
  value: number | null;
  prev_q: number | null;
  year_ago: number | null;
  qoq_pct: number | null;
  yoy_pct: number | null;
};
export type ResultsCard = {
  symbol: string;
  period_end: string;
  consolidated: boolean;
  is_bank: boolean;
  ebitda_margin_pct: number | null;
  flags: string[];
  rows: ResultsRow[];
  source?: { xbrl: string; filed: string };
};
export type Person = { name: string; role?: string; change?: string; bio?: string; sources?: string[] };
export type Materiality = {
  stage: 'rules' | 'jev' | 'llm';
  verdict: string;
  score: number | null;
  nouls: Record<string, number>;
  llm: { one_liner?: string; importance?: number; direction?: string; push_now?: boolean; _model?: string } | null;
  push: boolean;
};
export type FeedItem = {
  id: string;
  symbol: string;
  kind: 'filing' | 'signal' | 'results' | string;
  category: string;
  tier: number;
  title: string;
  summary: string | null;
  payload: {
    desc?: string;
    company?: string;
    category_label?: string;
    results?: ResultsCard;
    results_pending?: boolean;
    person?: Person;
    materiality?: Materiality;
    moved_with?: string;
    importance?: number;
    raw_text?: string;
    change_pct?: number;
    volume_x?: number;
    close?: number;
    prev_close?: number;
  };
  source_url: string | null;
  ref?: string;
  event_at: string;
  seen: boolean;
  related?: FeedItem[];
};
export type TimelineEntry = { at: string; kind: string; title: string; summary: string | null };
export type Story = {
  story_key: string;
  symbol: string;
  tier: number;
  score: number;
  head: FeedItem;
  related: FeedItem[];
  event_at: string;
  situation?: boolean;
  timeline?: TimelineEntry[];
  cumulative_pct?: number;
  from_close?: number;
  to_close?: number;
};
export type Digest = {
  window: { since: string; until: string };
  counts: { alert: number; brief: number; list: number; routine: number; filings: number };
  alert: Story[];
  brief: Story[];
  list: Story[];
  routine: Record<string, FeedItem[]>;
};
export type Status = {
  watching: number;
  read_24h: number;
  yours_24h: number;
  routine_24h: number;
  kept_24h: number;
  alerts_24h: number;
  last_filing_at: string | null;
  checked_at: string;
};
/** A scheduled watch: a Hermes cron job the investor set up from chat. */
export type Watch = {
  id: string;
  name: string;
  schedule: string; // "Weekdays 08:30"
  cron: string | null;
  enabled: boolean;
  state: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  chat_id: string | null;
  script_only: boolean;
  prompt: string;
  runs: number;
};
export type WatchRun = { id: string; at: string; silent: boolean; preview?: string; response?: string };
export type WatchDetail = Watch & { runs_list: WatchRun[] };

export type Holding = {
  symbol: string;
  name: string | null;
  industry: string | null;
  weight: number;
  close: number | null;
  change_pct: number | null;
  volume: number | null;
  day: string | null;
};
export type Me = {
  id: string;
  thresholds: { volume_x: number; price_pct: number; overrides: Record<string, unknown> };
  alert_categories: string[];
};
export type PricePoint = { day: string; close: number; change_pct: number; volume: number };
export type BrainPage = { path: string; title: string; tree?: string | null };
export type BrainFolder = { name: string; label: string; about: string; pages: BrainPage[] };
export type Brain = { symbol: string; pages: string[]; index: string; tree?: BrainFolder[] };
export type Doc = {
  id: string;
  desc: string;
  url: string;
  pages: number | null;
  doc_type: string | null;
  decision: string;
  status: string;
  engine: string | null;
  wiki_path: string | null;
  tree_path: string | null;
  filed_at: string | null;
};
