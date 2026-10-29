const IST_OFFSET_MIN = 330;

/** "10:57" today, "Tue 16:46" this week, "21 Oct" otherwise — always IST, because NSE is. */
export function when(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  const istNow = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const hm = `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
  const days = Math.floor((istNow.getTime() - ist.getTime()) / 86_400_000);
  if (ist.toISOString().slice(0, 10) === istNow.toISOString().slice(0, 10)) return hm;
  if (days < 6) return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][ist.getUTCDay()]} ${hm}`;
  return `${ist.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][ist.getUTCMonth()]}`;
}

export function ago(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const n0 = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const rupee = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function quarterLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split('-').map(Number);
  const fy = m > 3 ? y + 1 : y;
  const q = ({ 6: 1, 9: 2, 12: 3, 3: 4 } as Record<number, number>)[m] ?? 0;
  return `Q${q} FY${String(fy % 100).padStart(2, '0')}`;
}

/** The line a person reads first: FINN's one-liner when there is one, else the exchange text
 *  with the legal scaffolding removed. */
export function headline(title: string, summary: string | null): string {
  let t = (summary ?? '').trim();
  if (!t) return title;
  const titled = t.match(/titled\s+["“'‘](.+?)["”'’]\.?\s*$/i);
  if (titled) t = titled[1];
  t = t
    .replace(/^.*?has (informed|submitted to) the Exchange (about|regarding|that|on|of)\s*(the\s+)?/i, '')
    .replace(/(intimation|disclosure)s? (under|pursuant to) (regulation|reg\.?)\s*\d+[^,.]*?(regulations,?\s*\d{4}|\(listing[^)]*\)[^,.]*?\d{4})\s*[-–:,]?\s*/gi, '')
    .replace(/^(sub(ject)?|re)\s*:\s*/i, '')
    .replace(/^['"‘’“”\s-]+|['"‘’“”.\s]+$/g, '')
    .trim();
  if (!t) return title;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "2026-10-29" → "29 Oct" */
export function day(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}
