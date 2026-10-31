import Svg, { Path, Rect } from 'react-native-svg';

type P = { size?: number; c: string };

export const MicIcon = ({ size = 20, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <Rect x={9} y={3} width={6} height={11} rx={3} />
    <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
);

export const SendIcon = ({ size = 20, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);

export const StopIcon = ({ size = 16, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={5} y={5} width={14} height={14} rx={2.5} fill={c} />
  </Svg>
);

export const ReplyIcon = ({ size = 16, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6v1" />
  </Svg>
);
