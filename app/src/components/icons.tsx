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

// Navigation and chrome icons: 24dp grid, 1.8 stroke, square caps to match the setbacks.
const stroke = (c: string) => ({ fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const });

export const BackIcon = ({ size = 24, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M20 12H5M11 6l-6 6 6 6" {...stroke(c)} />
  </Svg>
);

export const ChevronRight = ({ size = 20, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M9 6l6 6-6 6" {...stroke(c)} />
  </Svg>
);

export const ChevronDown = ({ size = 20, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M6 9l6 6 6-6" {...stroke(c)} />
  </Svg>
);

export const CloseIcon = ({ size = 20, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M6 6l12 12M18 6L6 18" {...stroke(c)} />
  </Svg>
);

export const SearchIcon = ({ size = 20, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20" {...stroke(c)} />
  </Svg>
);

export const PlusIcon = ({ size = 22, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 5v14M5 12h14" {...stroke(c)} />
  </Svg>
);

export const ChatsIcon = ({ size = 22, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M4 5h11v8H8l-4 3zM9 16h7l4 3V10h-2" {...stroke(c)} />
  </Svg>
);

/** Brief: three setbacks, the ranked digest. */
export const BriefIcon = ({ size = 24, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M3 20h18M5 20v-5h14v5M8 15v-5h8v5M10.5 10V5h3v5" {...stroke(c)} />
  </Svg>
);

/** Watch: a lens over a rising line, the portfolio being watched. */
export const WatchIcon = ({ size = 24, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M3 17l5-5 4 3 7-8M15 7h4v4" {...stroke(c)} />
  </Svg>
);

/** Ask: a speech bubble. */
export const AskIcon = ({ size = 24, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M4 5h16v11h-9l-5 4v-4H4z" {...stroke(c)} />
  </Svg>
);

export const MinusIcon = ({ size = 22, c }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M5 12h14" {...stroke(c)} />
  </Svg>
);
