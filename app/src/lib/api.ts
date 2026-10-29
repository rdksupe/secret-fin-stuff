// FINN API client. The app authenticates with a JWT minted on the server (`finn token`) and
// baked in at build time via EXPO_PUBLIC_FINN_TOKEN, sent as `Authorization: Bearer …`.

export const API_BASE = (process.env.EXPO_PUBLIC_FINN_API ?? '').replace(/\/$/, '');
const TOKEN = process.env.EXPO_PUBLIC_FINN_TOKEN ?? '';

export function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...extra };
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await globalThis.fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: headers({ 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) }),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, String(detail));
  }
  return res.json() as Promise<T>;
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
export type Brain = { symbol: string; pages: string[]; index: string };
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
