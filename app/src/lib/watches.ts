import { router } from 'expo-router';

/** "2026-11-02T08:30:00+05:30" → "Mon 2 Nov, 08:30" (Hermes keeps watch times in IST). */
export function istTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1];
  return `${day} ${+m[3]} ${mon}, ${m[4]}:${m[5]}`;
}

export function openAskWith(prompt: string) {
  router.push({ pathname: '/ask', params: { prompt } });
}
