import { Text, type TextProps, type TextStyle } from 'react-native';

import { color, deco, font, size as scale } from '@/theme';

type P = TextProps & { c?: string; size?: number; style?: TextStyle | TextStyle[] };

const balance = { textWrap: 'balance' } as unknown as TextStyle; // web: no stub last lines on headings
const pretty = { textWrap: 'pretty' } as unknown as TextStyle; // web: no orphans in paragraphs

/** Headings in the UI face. Weight and size do the work: no italics, no eyebrows. */
export function Title({ c = color.text, size = scale.title, style, ...rest }: P) {
  return (
    <Text
      accessibilityRole="header"
      {...rest}
      style={[{ fontFamily: font.semibold, fontSize: size, lineHeight: Math.round(size * 1.2), color: c, letterSpacing: size >= 24 ? -0.3 : 0 }, balance, style as TextStyle]}
    />
  );
}

export function Body({ c = color.text, size = scale.body, style, ...rest }: P) {
  return <Text {...rest} style={[{ fontFamily: font.regular, fontSize: size, lineHeight: Math.round(size * 1.5), color: c }, pretty, style as TextStyle]} />;
}

export function Medium({ c = color.text, size = scale.body, style, ...rest }: P) {
  return <Text {...rest} style={[{ fontFamily: font.medium, fontSize: size, lineHeight: Math.round(size * 1.4), color: c }, pretty, style as TextStyle]} />;
}

export function Strong({ c = color.text, size = scale.body, style, ...rest }: P) {
  return <Text {...rest} style={[{ fontFamily: font.semibold, fontSize: size, lineHeight: Math.round(size * 1.4), color: c }, style as TextStyle]} />;
}

/** Figures, references, timestamps: the UI face with tabular numerals so columns line up. */
export function Figure({ c = color.text, size = 13, style, ...rest }: P) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: font.medium, fontSize: Math.max(size, 12), lineHeight: Math.round(Math.max(size, 12) * 1.4), color: c, fontVariant: ['tabular-nums'] }, style as TextStyle]}
    />
  );
}

/** Tickers in deco caps: one of the three deco steps. */
export function Ticker({ children, size = deco.ticker, c = color.sea }: { children: React.ReactNode; size?: number; c?: string }) {
  return (
    <Text style={{ fontFamily: font.deco, fontSize: size, lineHeight: Math.round(size * 1.25), letterSpacing: size * 0.14, color: c, textTransform: 'uppercase' }}>
      {children}
    </Text>
  );
}

export function Pct({ v, size = 13, digits = 1, onSea = false }: { v: number | null | undefined; size?: number; digits?: number; onSea?: boolean }) {
  if (v === null || v === undefined || Number.isNaN(v)) return <Figure c={onSea ? color.onSea2 : color.text3} size={size}>—</Figure>;
  const c = onSea ? (v < 0 ? color.lossOnSea : color.onSea) : v > 0 ? color.gain : v < 0 ? color.loss : color.text2;
  return (
    <Figure c={c} size={size} style={{ fontFamily: font.semibold }}>
      {v > 0 ? '+' : v < 0 ? '−' : ''}
      {Math.abs(v).toFixed(digits)}%
    </Figure>
  );
}
