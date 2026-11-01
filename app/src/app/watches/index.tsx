import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { FormArtifact } from '@/components/artifacts';
import { ChevronRight, PlusIcon } from '@/components/icons';
import { Screen } from '@/components/screen';
import { Rule } from '@/components/story-row';
import { BarAction, TopBar } from '@/components/top-bar';
import { Body, Figure, Strong } from '@/components/type';
import { api, type Holding, type Watch } from '@/lib/api';
import { istTime, openAskWith } from '@/lib/watches';
import { color, font, size, space } from '@/theme';

/** Your scheduled watches: what runs when, how the last run went, and a way to add one. */
export default function Watches() {
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [holdings, setHoldings] = useState<string[]>([]);

  const load = useCallback(() => {
    api.get<Watch[]>('/watches').then(setWatches).catch((e) => setErr(e?.message ?? 'unavailable'));
    api.get<Holding[]>('/holdings').then((h) => setHoldings(h.map((x) => x.symbol))).catch(() => {});
  }, []);
  useFocusEffect(load);

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <TopBar
        back
        title="Watches"
        right={
          <BarAction label="New watch" onPress={() => setAdding((a) => !a)}>
            <PlusIcon c={color.onSea} />
          </BarAction>
        }
      />
      <Screen bottomPad={space.xl} refreshing={false} onRefresh={load}>
        <Body c={color.text2} size={size.small}>
          Jobs FINN runs for you on a schedule. Each run's answer arrives as a notification and is kept here.
        </Body>

        {adding || (watches && watches.length === 0) ? (
          <View style={{ marginTop: space.l }}>
            <FormArtifact
              spec={{
                title: 'New watch',
                fields: [
                  { id: 'cos', label: 'Companies', type: 'multi', options: holdings.length ? holdings : ['TCS', 'INFY', 'LT'], value: holdings.slice(0, 2) },
                  {
                    id: 'when',
                    label: 'When',
                    type: 'select',
                    options: ['Weekdays at 08:30, before the open', 'Weekdays at 16:00, after the close', 'Every Monday at 09:00', 'Daily at 20:00'],
                    value: 'Weekdays at 08:30, before the open',
                  },
                  { id: 'topic', label: 'Watch for', type: 'text', value: 'anything material: results, guidance changes, management moves' },
                ],
                submit: {
                  label: 'Create watch',
                  prompt:
                    'Set up a scheduled watch for me. Schedule: {when} (IST). Companies: {cos}. Watch for: {topic}. ' +
                    'Each run: check new filings and data for these companies, report only what changed in two to four lines with sources, ' +
                    'and reply [SILENT] if nothing material happened. Give the job a short name.',
                },
              }}
              onAction={(p) => {
                setAdding(false);
                openAskWith(p);
              }}
            />
            <Body size={size.meta} c={color.text3} style={{ marginTop: space.xs }}>
              FINN sets it up in a new chat and confirms there. You can also just ask in any chat, e.g. "every Friday, sum up my banks".
            </Body>
          </View>
        ) : null}

        <View style={{ marginTop: space.l }}>
          {err ? (
            <Body c={color.text3}>Couldn't load your watches. {err}</Body>
          ) : !watches ? (
            <ActivityIndicator color={color.sea} style={{ alignSelf: 'flex-start' }} />
          ) : (
            watches.map((w, i) => (
              <View key={w.id}>
                {i > 0 ? <Rule /> : null}
                <Pressable
                  onPress={() => router.push({ pathname: '/watches/[id]', params: { id: w.id } })}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 64, paddingVertical: space.m, marginHorizontal: -space.l, paddingHorizontal: space.l, backgroundColor: pressed ? color.inset : 'transparent' })}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Strong numberOfLines={1}>{w.name}</Strong>
                    <Figure size={12} c={color.text2} style={{ marginTop: 2 }}>
                      {w.schedule}
                      {w.enabled ? (w.next_run_at ? ` · next ${istTime(w.next_run_at)}` : '') : ' · paused'}
                    </Figure>
                    <Body size={size.meta} c={w.last_status && w.last_status !== 'ok' ? color.text : color.text3} style={{ marginTop: 2, fontFamily: w.last_status && w.last_status !== 'ok' ? font.semibold : undefined }}>
                      {w.last_run_at ? `Last ran ${istTime(w.last_run_at)}${w.last_status && w.last_status !== 'ok' ? ` · ${w.last_status}` : ''}` : 'Not run yet'}
                      {w.runs ? ` · ${w.runs} run${w.runs === 1 ? '' : 's'} kept` : ''}
                    </Body>
                  </View>
                  <ChevronRight c={color.text3} />
                </Pressable>
              </View>
            ))
          )}
        </View>
      </Screen>
    </View>
  );
}
