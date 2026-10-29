import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Dot } from '@/components/pulse';
import { Screen } from '@/components/screen';
import { LeadStory, Rule, StoryRow } from '@/components/story-row';
import { Body, Mono, Strong, Ticker, Title } from '@/components/type';
import { api, type Digest, type Status, type Story } from '@/lib/api';
import { ago, headline, when } from '@/lib/format';
import { color, font, size, space } from '@/theme';

const WINDOWS = [
  { h: 24, label: '24h' },
  { h: 72, label: '3d' },
  { h: 168, label: '7d' },
  { h: 720, label: '30d' },
];

function WindowPicker({ hours, onChange }: { hours: number; onChange: (h: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: color.well, borderRadius: 8, padding: 3, borderWidth: 1, borderColor: color.hairline }}>
      {WINDOWS.map((w) => {
        const on = w.h === hours;
        return (
          <Pressable
            key={w.h}
            onPress={() => onChange(w.h)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Show the last ${w.label}`}
            style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 6, backgroundColor: on ? color.panel : 'transparent' }}>
            <Mono size={13} c={on ? color.paper : color.dim}>{w.label}</Mono>
          </Pressable>
        );
      })}
    </View>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.xxl }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: space.xs }}>
        <Title size={size.lead}>{title}</Title>
        {count !== undefined && <Mono size={14} c={color.dim}>{count}</Mono>}
      </View>
      {children}
    </View>
  );
}

function List({ items, compact }: { items: Story[]; compact?: boolean }) {
  return (
    <>
      {items.map((s, i) => (
        <View key={s.story_key}>
          {i > 0 && <Rule />}
          <StoryRow story={s} compact={compact} />
        </View>
      ))}
    </>
  );
}

function statusLine(hours: number, digest: Digest, status: Status | null): React.ReactNode {
  const kept = digest.counts.alert + digest.counts.brief;
  const keptText = kept === 0 ? 'none need you.' : kept === 1 ? '1 is worth your time.' : `${kept} are worth your time.`;
  const n = (v: number) => <Strong size={size.body} c={color.paper}>{v.toLocaleString('en-IN')}</Strong>;
  if (hours === 24 && status) {
    return (
      <>
        FINN read {n(status.read_24h)} exchange filings in the last day. {n(status.yours_24h)} were from your companies; {keptText}
      </>
    );
  }
  return (
    <>
      Your companies filed {n(digest.counts.filings)} times in this window; {keptText}
    </>
  );
}

export default function Brief() {
  const [hours, setHours] = useState(24);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [moreOnFile, setMoreOnFile] = useState(false);
  const [openRoutine, setOpenRoutine] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api.get<Digest>(`/digest?hours=${hours}`), api.get<Status>('/status').catch(() => null)]);
      setDigest(d);
      setStatus(s);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'no response');
    }
  }, [hours]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const [lead, ...restAlerts] = digest?.alert ?? [];
  const onFile = digest?.list ?? [];
  const routine = digest ? Object.entries(digest.routine) : [];

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      <Screen refreshing={refreshing} onRefresh={refresh} bottomPad={space.xl}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Title size={20} style={{ fontFamily: font.bold, letterSpacing: 0.5 }}>FINN</Title>
          <View style={{ flex: 1 }} />
          <WindowPicker hours={hours} onChange={setHours} />
        </View>

        <View style={{ marginTop: space.l }}>
          {error ? (
            <Body c={color.mist}>
              FINN's server didn't respond ({error}). Pull down to try again.
            </Body>
          ) : digest ? (
            <Body c={color.mist}>{statusLine(hours, digest, status)}</Body>
          ) : (
            <Body c={color.dim}>Loading your brief…</Body>
          )}
          {status && !error && (
            <Body size={size.meta} c={color.dim} style={{ marginTop: space.xs }}>
              Watching {status.watching} companies · updated {ago(status.checked_at)}
            </Body>
          )}
        </View>

        {lead && (
          <View style={{ marginTop: space.xl }}>
            <Rule />
            <LeadStory story={lead} />
            <Rule />
          </View>
        )}

        {restAlerts.length > 0 && (
          <Section title="Also needs you" count={restAlerts.length}>
            <List items={restAlerts} />
          </Section>
        )}

        {digest && digest.brief.length > 0 && (
          <Section title="Worth a look" count={digest.brief.length}>
            <List items={digest.brief} />
          </Section>
        )}

        {onFile.length > 0 && (
          <Section title="On file" count={onFile.length}>
            <List items={moreOnFile ? onFile : onFile.slice(0, 3)} compact />
            {onFile.length > 3 && (
              <Pressable onPress={() => setMoreOnFile((v) => !v)} style={{ paddingVertical: space.m }} accessibilityRole="button">
                <Body size={size.small} c={color.mist}>{moreOnFile ? 'Show fewer' : `Show ${onFile.length - 3} more`}</Body>
              </Pressable>
            )}
          </Section>
        )}

        {digest && digest.counts.routine > 0 && (
          <View style={{ marginTop: space.xl }}>
            <Rule />
            <Pressable onPress={() => setOpenRoutine((v) => !v)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.l }}>
              <Body size={size.small} c={color.mist} style={{ flex: 1 }}>
                {digest.counts.routine} routine filings: call notices, trading windows, newspaper copies, certificates
              </Body>
              <Body size={size.small} c={color.paper}>{openRoutine ? 'Hide' : 'Show'}</Body>
            </Pressable>
            {openRoutine &&
              routine.map(([sym, items]) => (
                <View key={sym} style={{ paddingBottom: space.m }}>
                  <Ticker size={12}>{sym}</Ticker>
                  {items.map((i) => (
                    <View key={i.id} style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                      <Mono size={12} c={color.dim} style={{ width: 70 }}>{when(i.event_at)}</Mono>
                      <Body size={size.small} c={color.mist} style={{ flex: 1 }} numberOfLines={1}>
                        {headline(i.title, i.summary)}
                      </Body>
                    </View>
                  ))}
                </View>
              ))}
          </View>
        )}

        {digest && !lead && digest.brief.length === 0 && onFile.length === 0 && (
          <Body c={color.mist} style={{ marginTop: space.xl }}>
            Nothing from your companies in this window. Pick a longer range, or ask FINN about one of them.
          </Body>
        )}
      </Screen>

      {/* Solid footer, part of the layout: the composer never covers the brief. */}
      <View style={{ borderTopWidth: 1, borderTopColor: color.hairline, backgroundColor: color.ink, alignItems: 'center', paddingHorizontal: space.l, paddingVertical: space.m }}>
        <Pressable
          onPress={() => router.push('/ask')}
          accessibilityRole="button"
          style={({ pressed }) => ({
            width: '100%',
            maxWidth: 608,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: color.panel,
            borderWidth: 1,
            borderColor: color.hairline,
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 14,
            opacity: pressed ? 0.85 : 1,
          })}>
          <Dot />
          <Body c={color.mist}>Ask FINN about any of this</Body>
        </Pressable>
      </View>
    </View>
  );
}
