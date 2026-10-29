import { View } from 'react-native';

import type { ResultsCard } from '@/lib/api';
import { n0, quarterLabel } from '@/lib/format';
import { color, size, space } from '@/theme';

import { Body, Mono, Pct } from './type';

/** The four headline numbers, YoY — one line in the brief. */
export function ResultsStrip({ card }: { card: ResultsCard }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 4, marginTop: space.s }}>
      {card.rows.map((r) => (
        <View key={r.label} style={{ flexDirection: 'row', gap: 6, alignItems: 'baseline' }}>
          <Body size={size.small} c={color.mist}>{r.label}</Body>
          <Pct v={r.yoy_pct} size={13} />
        </View>
      ))}
      <Body size={size.small} c={color.dim}>YoY</Body>
    </View>
  );
}

/** This quarter vs previous quarter vs same quarter last year. */
export function ResultsTable({ card }: { card: ResultsCard }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingBottom: space.s, borderBottomWidth: 1, borderColor: color.hairline }}>
        <Body size={size.meta} c={color.dim} style={{ flex: 1 }}>₹ crore</Body>
        <Body size={size.meta} c={color.dim} style={{ width: 84, textAlign: 'right' }}>{quarterLabel(card.period_end)}</Body>
        <Body size={size.meta} c={color.dim} style={{ width: 64, textAlign: 'right' }}>QoQ</Body>
        <Body size={size.meta} c={color.dim} style={{ width: 64, textAlign: 'right' }}>YoY</Body>
      </View>
      {card.rows.map((r) => (
        <View key={r.label} style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 10, borderBottomWidth: 1, borderColor: color.hairline }}>
          <Body size={size.small} c={color.mist} style={{ flex: 1 }}>{r.label}</Body>
          <Mono size={14} style={{ width: 84, textAlign: 'right' }}>{n0(r.value)}</Mono>
          <View style={{ width: 64, alignItems: 'flex-end' }}><Pct v={r.qoq_pct} /></View>
          <View style={{ width: 64, alignItems: 'flex-end' }}><Pct v={r.yoy_pct} /></View>
        </View>
      ))}
      <Body size={size.meta} c={color.dim} style={{ marginTop: space.s }}>
        {card.consolidated ? 'Consolidated' : 'Standalone'}, from the NSE results filing
        {card.ebitda_margin_pct !== null && !card.is_bank ? ` · EBITDA margin ${card.ebitda_margin_pct}%` : ''}
      </Body>
    </View>
  );
}
