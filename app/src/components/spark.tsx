import Svg, { Circle, Polyline } from 'react-native-svg';

import { color } from '@/theme';

/** Close-price trace in a neutral sea line: red and green stay with the day's change figure beside it. */
export function Spark({ values, width = 72, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pad = 2;
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (width - pad * 2),
    pad + (1 - (v - lo) / span) * (height - pad * 2),
  ]);
  const stroke = color.sea;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <Svg width={width} height={height}>
      <Polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={stroke} strokeWidth={1.4} strokeOpacity={0.9} />
      <Circle cx={lx} cy={ly} r={2} fill={stroke} />
    </Svg>
  );
}
