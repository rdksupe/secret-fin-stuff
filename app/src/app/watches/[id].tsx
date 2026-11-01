import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { ChevronDown, ChevronRight } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { Screen } from '@/components/screen';
import { Rule } from '@/components/story-row';
import { TopBar } from '@/components/top-bar';
import { Body, Figure, Strong, Title } from '@/components/type';
import { api, type WatchDetail, type WatchRun } from '@/lib/api';
import { istTime, openAskWith } from '@/lib/watches';
import { color, font, size, space, touch } from '@/theme';


function Pill({ label, onPress, busy, primary }: { label: string; onPress: () => void; busy?: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: touch, paddingHorizontal: 18, justifyContent: 'center', borderRadius: touch / 2, borderWidth: 1, borderColor: color.sea, backgroundColor: primary ? (pressed ? '#25605A' : color.sea) : pressed ? color.seaTint : 'transparent', opacity: busy ? 0.6 : 1 })}>
      <Body size={size.small} c={primary ? color.onSea : color.sea} style={{ fontFamily: font.semibold }}>{label}</Body>
    </Pressable>
  );
}

/** One run: when it ran, and the answer FINN delivered (tap to read it in full). */
function Run({ watchId, run, open, onToggle }: { watchId: string; run: WatchRun; open: boolean; onToggle: () => void }) {
  const [full, setFull] = useState<string | null>(null);
  useEffect(() => {
    if (!open || full !== null || run.silent) return;
    api.get<WatchRun>(`/watches/${watchId}/runs/${run.id}`).then((r) => setFull(r.response ?? '')).catch(() => setFull(run.preview ?? ''));
  }, [open, full, run, watchId]);
  return (
    <View>
      <Pressable
        onPress={onToggle}
        disabled={run.silent}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ flexDirection: 'row', gap: space.m, minHeight: 56, paddingVertical: space.m, marginHorizontal: -space.l, paddingHorizontal: space.l, backgroundColor: pressed ? color.inset : 'transparent' })}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Figure size={12} c={color.text2} style={{ fontFamily: font.semibold }}>{istTime(run.at)}</Figure>
          {run.silent ? (
            <Body size={size.small} c={color.text3} style={{ marginTop: 2 }}>Nothing new. FINN stayed quiet.</Body>
          ) : !open ? (
            <Body size={size.small} numberOfLines={3} style={{ marginTop: 2 }}>{run.preview}</Body>
          ) : null}
        </View>
        {run.silent ? null : open ? <ChevronDown c={color.text3} /> : <ChevronRight c={color.text3} />}
      </Pressable>
      {open && !run.silent ? (
        <View style={{ paddingBottom: space.m }}>
          {full === null ? <ActivityIndicator color={color.sea} style={{ alignSelf: 'flex-start' }} /> : <Markdown text={full} size={14} onAction={openAskWith} />}
        </View>
      ) : null}
    </View>
  );
}

/** A watch: its schedule and instruction, controls, and every answer it has delivered. */
export default function WatchPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [w, setW] = useState<WatchDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    api
      .get<WatchDetail>(`/watches/${id}`)
      .then((d) => {
        setW(d);
        // Opened from a notification (or fresh): the newest answer is already open.
        setOpenRun((o) => o ?? d.runs_list.find((r) => !r.silent)?.id ?? null);
      })
      .catch((e) => setErr(e?.message ?? 'unavailable'));
  }, [id]);
  useEffect(load, [load]);

  const act = async (path: string, method: 'post' | 'delete' = 'post') => {
    setBusy(true);
    try {
      if (method === 'delete') {
        await api.del(`/watches/${id}`);
        router.back();
        return;
      }
      await api.post(`/watches/${id}/${path}`, {});
      load();
    } catch (e) {
      setErr((e as Error)?.message ?? 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <TopBar back title="Watch" />
      <Screen bottomPad={space.xl} refreshing={false} onRefresh={load}>
        {!w ? (
          err ? <Body c={color.text3}>Couldn't load this watch. {err}</Body> : <ActivityIndicator color={color.sea} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <>
            <Title size={22} style={{ fontFamily: font.bold }}>{w.name}</Title>
            <Figure size={13} c={color.text2} style={{ marginTop: 4 }}>
              {w.schedule}
              {w.enabled ? (w.next_run_at ? ` · next ${istTime(w.next_run_at)}` : '') : ' · paused'}
            </Figure>
            {w.last_error && /^delivery error/i.test(w.last_error) ? (
              // The run worked; only the first delivery route failed, and Hermes delivered by its fallback.
              <Body size={size.meta} c={color.text3} style={{ marginTop: space.s }}>The last answer took the slow delivery route; it's below.</Body>
            ) : w.last_error ? (
              <Body size={size.small} c={color.text} style={{ marginTop: space.s }}>
                <Body size={size.small} style={{ fontFamily: font.semibold }}>Last run failed: </Body>
                {w.last_error.slice(0, 200)}
              </Body>
            ) : null}
            {w.prompt ? (
              <View style={{ marginTop: space.m, borderLeftWidth: 2, borderLeftColor: color.line, paddingLeft: space.m }}>
                <Body size={size.meta} c={color.text3}>What FINN does each run</Body>
                <Body size={size.small} c={color.text2} numberOfLines={5} style={{ marginTop: 2 }}>{w.prompt}</Body>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.l }}>
              <Pill label={w.enabled ? 'Pause' : 'Resume'} busy={busy} onPress={() => act(w.enabled ? 'pause' : 'resume')} />
              <Pill label="Run now" busy={busy} onPress={() => act('run')} />
              {w.chat_id ? <Pill label="Open chat" onPress={() => router.push({ pathname: '/ask', params: { chat: w.chat_id! } })} /> : null}
              <Pill
                label={confirmDelete ? 'Tap again to delete' : 'Delete'}
                busy={busy}
                onPress={() => (confirmDelete ? act('', 'delete') : setConfirmDelete(true))}
              />
            </View>

            <Strong style={{ marginTop: space.xl }}>Runs</Strong>
            <Body size={size.meta} c={color.text3} style={{ marginTop: 2 }}>Newest first. Tap one to read the full answer.</Body>
            <View style={{ marginTop: space.s }}>
              <Rule />
              {w.runs_list.length === 0 ? (
                <Body size={size.small} c={color.text3} style={{ paddingVertical: space.m }}>
                  No runs yet{w.next_run_at ? `. The first is due ${istTime(w.next_run_at)}.` : '.'}
                </Body>
              ) : (
                w.runs_list.map((r, i) => (
                  <View key={r.id}>
                    {i > 0 ? <Rule /> : null}
                    <Run watchId={w.id} run={r} open={openRun === r.id} onToggle={() => setOpenRun(openRun === r.id ? null : r.id)} />
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </Screen>
    </View>
  );
}
