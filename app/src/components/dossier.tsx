import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { api } from '@/lib/api';
import { quarterLabel } from '@/lib/format';
import { color, font, size, space, touch } from '@/theme';

import { Rule } from './story-row';
import { Body, Medium, Figure, Pct, Strong, Title } from './type';

type Row = { call: string; promise: string; delivered: string; status: string; cite?: string };
type Quarter = { period_end: string; labels: string[]; revenue: number | null; revenue_yoy: number | null; pat: number | null; pat_yoy: number | null; margin: number | null };
type Dossier = {
  symbol: string;
  built_on: string;
  snapshot: { what_it_does?: string; segments?: { name: string; share: string; note: string }[]; key_facts?: string[]; pages?: number[] };
  trajectory: Quarter[];
  guidance: { call?: string; month: string; items: unknown[] }[];
  promised_vs_delivered: { verdict?: string; score?: string; rows?: Row[] };
  bull_bear: { bull?: { point: string; cite?: string }[]; bear?: { point: string; cite?: string }[]; watch?: string[] };
  sources: { transcripts: string[]; annual_report: string | null };
};
type Progress = { state: string; pct: number; step: string; started: string };
type Resp = { status: 'missing' | 'building' | 'ready' | 'failed'; dossier: Dossier | null; error?: string; progress?: Progress | null };

/** Build progress: a thin bar, the current step, and that a push will say when it's done. */
function BuildProgress({ p }: { p?: Progress | null }) {
  const pct = Math.max(0.03, Math.min(1, p?.pct ?? 0.03));
  return (
    <View style={{ marginTop: space.l }}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: color.line, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: 4, borderRadius: 2, backgroundColor: color.brassText }} />
      </View>
      <View style={{ flexDirection: 'row', marginTop: space.s }}>
        <Body size={size.small} c={color.text} style={{ flex: 1 }}>{p?.step ?? 'Starting'}</Body>
        <Figure size={12} c={color.text3}>{Math.round(pct * 100)}%</Figure>
      </View>
      <Body size={size.meta} c={color.text3} style={{ marginTop: 4 }}>
        You can leave this screen. FINN sends a notification when it's ready.
      </Body>
    </View>
  );
}

const STATUS: Record<string, { label: string; c: string }> = {
  delivered: { label: 'Delivered', c: color.gain },
  partly: { label: 'Partly', c: color.brassText },
  missed: { label: 'Missed', c: color.loss },
  'too early': { label: 'Too early', c: color.text2 },
  'not measurable': { label: 'Not measurable', c: color.text3 },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.xxl }}>
      <Title size={size.lead} style={{ marginBottom: space.m }}>{title}</Title>
      {children}
    </View>
  );
}

export function DossierView({ symbol }: { symbol: string }) {
  const [r, setR] = useState<Resp | null>(null);

  const load = useCallback(() => api.get<Resp>(`/companies/${symbol}/dossier`).then(setR).catch(() => {}), [symbol]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (r?.status !== 'building') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [r?.status, load]);

  const build = async () => {
    setR((x) => ({ ...(x ?? { dossier: null }), status: 'building' }));
    await api.post(`/companies/${symbol}/dossier`, {}).catch(() => {});
    load();
  };

  if (!r) return null;
  const d = r.dossier;

  if (!d) {
    return (
      <Section title="Research">
        <Body c={color.text2}>
          {r.status === 'building'
            ? `Reading ${symbol}'s annual report and last four call transcripts. This takes a few minutes.`
            : r.status === 'failed'
              ? `The last attempt failed: ${r.error ?? 'unknown error'}.`
              : `FINN builds research only from ${symbol}'s own annual report, call transcripts and results filings.`}
        </Body>
        {r.status === 'building' ? (
          <BuildProgress p={r.progress} />
        ) : (
          <Pressable onPress={build} accessibilityRole="button" style={{ marginTop: space.l, alignSelf: 'flex-start', height: touch, paddingHorizontal: 24, justifyContent: 'center', borderRadius: touch / 2, backgroundColor: color.sea }}>
            <Strong size={size.small} c={color.onSea}>Build research</Strong>
          </Pressable>
        )}
      </Section>
    );
  }

  const pvd = d.promised_vs_delivered ?? {};
  const counts = (pvd.rows ?? []).reduce<Record<string, number>>((a, row) => ({ ...a, [row.status]: (a[row.status] ?? 0) + 1 }), {});
  const recent = d.trajectory.slice(-6);

  return (
    <>
      {pvd.rows && pvd.rows.length > 0 && (
        <Section title="Promised vs delivered">
          <Body>
            {pvd.score ? <Strong c={pvd.score === 'high' ? color.gain : pvd.score === 'low' ? color.loss : color.brassText}>{pvd.score.charAt(0).toUpperCase() + pvd.score.slice(1)} credibility. </Strong> : null}
            {pvd.verdict}
          </Body>
          <Body size={size.meta} c={color.text3} style={{ marginTop: space.xs }}>
            {Object.entries(counts).map(([k, v]) => `${v} ${STATUS[k]?.label.toLowerCase() ?? k}`).join(' · ')} · from {d.guidance.length} calls
          </Body>
          <View style={{ marginTop: space.m }}>
            {pvd.rows.map((row, i) => (
              <View key={i}>
                <Rule />
                <View style={{ paddingVertical: space.m }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STATUS[row.status]?.c ?? color.text3 }} />
                    <Body size={size.meta} c={STATUS[row.status]?.c ?? color.text3}>{STATUS[row.status]?.label ?? row.status}</Body>
                    <Body size={size.meta} c={color.text3}>· {row.call}</Body>
                  </View>
                  <Medium size={size.body} style={{ marginTop: 6 }}>{row.promise}</Medium>
                  <Body size={size.small} c={color.text2} style={{ marginTop: 2 }}>{row.delivered}</Body>
                </View>
              </View>
            ))}
          </View>
        </Section>
      )}

      {d.snapshot?.what_it_does && (
        <Section title="The business">
          <Body>{d.snapshot.what_it_does}</Body>
          {(d.snapshot.segments ?? []).length > 0 && (
            <View style={{ marginTop: space.m }}>
              {d.snapshot.segments!.map((s) => {
                // A share is usually "34%", but the annual report sometimes only gives a sentence;
                // short shares sit in a right column, long ones go under the name.
                // "not stated (FY26 revenue ₹79,785 crore)" → "FY26 revenue ₹79,785 crore"; bare "not stated" → nothing.
                const share = (s.share ?? '').replace(/^not stated\s*\(?/i, '').replace(/\)$/, '').trim();
                const short = share.length <= 14;
                return (
                  <View key={s.name} style={{ paddingVertical: 9, borderBottomWidth: 1, borderColor: color.line }}>
                    <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'baseline' }}>
                      <Body size={size.small} style={{ flex: 1, fontFamily: font.semibold }}>{s.name}</Body>
                      {short && share ? <Figure size={13} c={color.text2}>{share}</Figure> : null}
                    </View>
                    {!short && share ? <Body size={size.meta} c={color.text2} style={{ marginTop: 2 }}>{share}</Body> : null}
                  </View>
                );
              })}
            </View>
          )}
          {(d.snapshot.key_facts ?? []).slice(0, 4).map((k) => (
            <Body key={k} size={size.small} c={color.text2} style={{ marginTop: space.s }}>{k}</Body>
          ))}
          <Body size={size.meta} c={color.text3} style={{ marginTop: space.s }}>
            From the annual report{d.snapshot.pages?.length ? `, pages ${d.snapshot.pages.slice(0, 6).join(', ')}` : ''}
          </Body>
        </Section>
      )}

      {recent.length > 1 && (
        <Section title="Trajectory">
          <View style={{ flexDirection: 'row', paddingBottom: space.s, borderBottomWidth: 1, borderColor: color.line }}>
            <Body size={size.meta} c={color.text3} style={{ flex: 1 }}>Quarter</Body>
            <Body size={size.meta} c={color.text3} style={{ width: 72, textAlign: 'right' }}>{recent[0].labels[0]} YoY</Body>
            <Body size={size.meta} c={color.text3} style={{ width: 64, textAlign: 'right' }}>Margin</Body>
            <Body size={size.meta} c={color.text3} style={{ width: 72, textAlign: 'right' }}>PAT YoY</Body>
          </View>
          {recent.map((q) => (
            <View key={q.period_end} style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 9, borderBottomWidth: 1, borderColor: color.line }}>
              <Figure size={13} c={color.text2} style={{ flex: 1 }}>{quarterLabel(q.period_end)}</Figure>
              <View style={{ width: 72, alignItems: 'flex-end' }}><Pct v={q.revenue_yoy} /></View>
              <Figure size={13} style={{ width: 64, textAlign: 'right' }}>{q.margin === null ? '—' : `${q.margin}%`}</Figure>
              <View style={{ width: 72, alignItems: 'flex-end' }}><Pct v={q.pat_yoy} /></View>
            </View>
          ))}
          <Body size={size.meta} c={color.text3} style={{ marginTop: space.s }}>From NSE results filings</Body>
        </Section>
      )}

      {(d.bull_bear?.bull?.length || d.bull_bear?.bear?.length) ? (
        <Section title="Bull and bear">
          {(['bull', 'bear'] as const).map((side) => (
            <View key={side} style={{ marginBottom: space.l }}>
              <Strong size={size.small} c={side === 'bull' ? color.gain : color.loss}>{side === 'bull' ? 'Bull' : 'Bear'}</Strong>
              {(d.bull_bear[side] ?? []).map((p, i) => (
                <Body key={i} size={size.small} style={{ marginTop: 6 }}>
                  {p.point} <Body size={size.meta} c={color.text3}>({p.cite})</Body>
                </Body>
              ))}
            </View>
          ))}
          {(d.bull_bear.watch ?? []).length > 0 && (
            <>
              <Strong size={size.small} c={color.text2}>Watch next quarter</Strong>
              {d.bull_bear.watch!.map((w, i) => (
                <Body key={i} size={size.small} c={color.text2} style={{ marginTop: 6 }}>{w}</Body>
              ))}
            </>
          )}
        </Section>
      ) : null}

      <View style={{ marginTop: space.l, flexDirection: 'row', alignItems: 'center', gap: space.l }}>
        <Body size={size.meta} c={color.text3} style={{ flex: 1 }}>
          Built {d.built_on} from {d.sources.transcripts.length} call transcripts{d.sources.annual_report ? ' and the annual report' : ''}. No news or broker views.
        </Body>
        <Pressable onPress={build} hitSlop={8} accessibilityRole="button">
          <Body size={size.meta} c={color.text2}>Rebuild</Body>
        </Pressable>
      </View>
    </>
  );
}
