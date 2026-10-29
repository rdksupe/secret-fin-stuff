import { Text, type TextProps, type TextStyle } from 'react-native';

import { color, font, size as scale } from '@/theme';

type P = TextProps & { c?: string; size?: number; style?: TextStyle | TextStyle[] };

const balance = { textWrap: 'balance' } as unknown as TextStyle; // web: no stub last lines on headings
const pretty = { textWrap: 'pretty' } as unknown as TextStyle; // web: no orphans in paragraphs

/** Headings. Weight and size do the work — no italics, no eyebrows. */
export function Title({ c = color.paper, size = scale.title, style, ...rest }: P) {
  return (
    <Text
      accessibilityRole="header"
      {...rest}
      style={[{ fontFamily: font.semibold, fontSize: size, lineHeight: Math.round(size * 1.2), color: c, letterSpacing: size >= 24 ? -0.3 : 0 }, balance, style as TextStyle]}
    />
  );
}

export function Body({ c = color.paper, size = scale.body, style, ...rest }: P) {
  return <Text {...rest} style={[{ fontFamily: font.regular, fontSize: size, lineHeight: Math.round(size * 1.5), color: c }, pretty, style as TextStyle]} />;
}

export function Medium({ c = color.paper, size = scale.body, style, ...rest }: P) {
  return <Text {...rest} style={[{ fontFamily: font.medium, fontSize: size, lineHeight: Math.round(size * 1.4), color: c }, pretty, style as TextStyle]} />;
}

export function Strong({ c = color.paper, size = scale.body, style, ...rest }: P) {
  return <Text {...rest} style={[{ fontFamily: font.semibold, fontSize: size, lineHeight: Math.round(size * 1.4), color: c }, style as TextStyle]} />;
}

/** Figures, tickers, timestamps. Tabular so columns line up. */
export function Mono({ c = color.paper, size = 13, style, ...rest }: P) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: font.mono, fontSize: Math.max(size, 12), lineHeight: Math.round(Math.max(size, 12) * 1.4), color: c, fontVariant: ['tabular-nums'] }, style as TextStyle]}
    />
  );
}

export function Ticker({ children, size = 13, c = color.paper }: { children: React.ReactNode; size?: number; c?: string }) {
  return (
    <Mono size={size} c={c} style={{ fontFamily: font.monoMedium, letterSpacing: 0.3 }}>
      {children}
    </Mono>
  );
}

export function Pct({ v, size = 13, digits = 1 }: { v: number | null | undefined; size?: number; digits?: number }) {
  if (v === null || v === undefined || Number.isNaN(v)) return <Mono c={color.dim} size={size}>—</Mono>;
  const c = v > 0 ? color.gain : v < 0 ? color.loss : color.mist;
  return (
    <Mono c={c} size={size}>
      {v > 0 ? '+' : v < 0 ? '−' : ''}
      {Math.abs(v).toFixed(digits)}%
    </Mono>
  );
}
