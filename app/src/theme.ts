// FINN design tokens: Bombay Deco.
// The world of Marine Drive and the Fort, Mumbai's money district: a sea-green stucco shell,
// a pale stone ground, lacquer-black ink, brass for FINN acting. Importance is drawn in setbacks.
// Every text colour clears WCAG AA (4.5:1) on the surfaces it is used on (ratios noted).

export const color = {
  // Ground and surfaces
  bg: '#E6ECE8', // pale stone, the page ground
  raised: '#F4F7F5', // sheets that sit on the ground (composer, sheets, cards of record)
  inset: '#D8E1DC', // wells: inputs, nav bar, pressed rows
  line: '#C5D0CB', // hairlines between rows
  faint: '#A9B8B2', // non-text only: disabled strokes, empty setback steps

  // Ink on stone              bg / raised / inset
  text: '#14201E', //          14.0 / 15.5 / 12.5
  text2: '#3D4D49', //          7.4 /  8.3 /  6.7
  text3: '#55655F', //          5.1 /  5.7 /  4.6  (metadata only)

  // The shell: sea-green stucco
  sea: '#1E4D47', // app bars, the reversed plate, nav indicator ink; as text 7.9 on bg
  seaTint: '#C3D8D1', // nav indicator pill, selected rows
  onSea: '#EEF4F1', // 8.5 on sea
  onSea2: '#B5CFC6', // 5.8 on sea (secondary on the plate)

  // FINN acting: brass
  brass: '#B8862B', // marks only (dots, setback fill when FINN is working)
  brassText: '#7A5712', // 5.5 on bg
  brassOnSea: '#E2BE76', // 5.4 on sea

  // Money, only where it carries meaning
  gain: '#1F6B44', // 5.4 on bg
  loss: '#A33A2A', // 5.5 on bg
  lossOnSea: '#F2A592', // 4.8 on sea
} as const;

export const font = {
  regular: 'PublicSans_400Regular',
  medium: 'PublicSans_500Medium',
  semibold: 'PublicSans_600SemiBold',
  bold: 'PublicSans_700Bold',
  // Deco caps: exactly three steps (wordmark/screen title, ticker, lead headline). Never body.
  deco: 'JosefinSans_700Bold',
  decoSemi: 'JosefinSans_600SemiBold',
} as const;

// Type scale. Nothing below 12.
export const size = { meta: 12, small: 14, body: 16, lead: 20, title: 24, display: 30 } as const;

// The three deco steps.
export const deco = { title: 22, lead: 17, ticker: 14 } as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 40 } as const;

// Material minimum touch target.
export const touch = 48;

export const maxWidth = 640; // phones first; web caps the column instead of stretching
