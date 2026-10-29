import Svg, { Circle, Polyline } from 'react-native-svg';

import { color } from '@/theme';

/** Close-price trace. Colour follows the move over the window, the last close gets a dot. */
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
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? color.gain : color.loss;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <Svg width={width} height={height}>
      <Polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={stroke} strokeWidth={1.4} strokeOpacity={0.9} />
      <Circle cx={lx} cy={ly} r={2} fill={stroke} />
    </Svg>
  );
}
