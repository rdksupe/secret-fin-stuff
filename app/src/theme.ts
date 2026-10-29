// FINN design tokens.
// One sans family (Archivo) carries hierarchy through size and weight; IBM Plex Mono is for
// figures only. Every text colour clears WCAG AA (4.5:1) on ink and panel.
// Marigold means one thing: FINN itself — its own judgement, or FINN actively working.

export const color = {
  ink: '#0F1218', // background
  panel: '#161A21', // raised surfaces
  well: '#12161D', // inset surfaces (composer, inputs)
  hairline: '#252B35',
  paper: '#ECE9E2', // primary text            15.5:1
  mist: '#A3ABB9', // secondary text            8.1:1
  dim: '#868FA0', // tertiary text (metadata)  5.8:1
  faint: '#3A414D', // non-text only: disabled strokes
  marigold: '#F0A63A', // FINN                    9.1:1
  gain: '#4FB98C', //                               7.7:1
  loss: '#EE7A6E', //                               6.8:1
} as const;

export const font = {
  regular: 'Archivo_400Regular',
  medium: 'Archivo_500Medium',
  semibold: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

// Type scale. Nothing below 12.
export const size = { meta: 12, small: 14, body: 16, lead: 20, title: 24, display: 30 } as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 40 } as const;

export const maxWidth = 640; // phones first; web caps the column instead of stretching
