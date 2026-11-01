---
name: FINN
description: An investor agent for an NSE portfolio, built like Mumbai's money district, where importance stands in setbacks.
colors:
  stone: "#E6ECE8"
  raised: "#F4F7F5"
  inset: "#D8E1DC"
  line: "#C5D0CB"
  faint: "#A9B8B2"
  ink: "#14201E"
  ink-2: "#3D4D49"
  ink-3: "#55655F"
  sea: "#1E4D47"
  sea-pressed: "#25605A"
  sea-tint: "#C3D8D1"
  on-sea: "#EEF4F1"
  on-sea-2: "#B5CFC6"
  brass: "#B8862B"
  brass-text: "#7A5712"
  brass-on-sea: "#E2BE76"
  gain: "#1F6B44"
  loss: "#A33A2A"
  loss-on-sea: "#F2A592"
  deck-behind-1: "#2E6B63"
  deck-behind-2: "#3F7D74"
typography:
  display:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.3px"
  title:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.3px"
  lead-headline:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: "27px"
  body:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: "tnum"
  deco-title:
    fontFamily: "Josefin Sans, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    letterSpacing: "0.2em"
  deco-plate-ticker:
    fontFamily: "Josefin Sans, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    letterSpacing: "0.14em"
  deco-ticker:
    fontFamily: "Josefin Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    letterSpacing: "0.14em"
rounded:
  none: "0px"
  pill-small: "16px"
  pill: "28px"
spacing:
  xs: "4px"
  s: "8px"
  m: "12px"
  l: "16px"
  xl: "24px"
  xxl: "40px"
components:
  top-bar:
    backgroundColor: "{colors.sea}"
    textColor: "{colors.on-sea}"
    height: "64px"
  setback-plate:
    backgroundColor: "{colors.sea}"
    textColor: "{colors.on-sea}"
    rounded: "{rounded.none}"
    padding: "10px 18px 18px"
  story-row:
    backgroundColor: "{colors.stone}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
  story-row-pressed:
    backgroundColor: "{colors.inset}"
  button-primary:
    backgroundColor: "{colors.sea}"
    textColor: "{colors.on-sea}"
    rounded: "{rounded.pill}"
    height: "56px"
  button-primary-pressed:
    backgroundColor: "{colors.sea-pressed}"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "52px"
  chip:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "36px"
  chip-selected:
    backgroundColor: "{colors.sea-tint}"
    textColor: "{colors.sea}"
  nav-bar:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink-2}"
  nav-indicator:
    backgroundColor: "{colors.sea-tint}"
    rounded: "{rounded.pill-small}"
    width: "64px"
    height: "32px"
---

# Design System: FINN

## Overview

**Creative North Star: "Bombay Deco"**

FINN is built like Marine Drive and the Fort: importance is drawn as architectural setbacks, not as bigger type or more cards. A sea-green stucco shell (app bars, nav indicator, the reversed plate) frames a pale stone ground with lacquer-black ink. Brass appears only when FINN itself is acting. The look refuses a dark terminal with a neon accent and the broker-app card stack. It is a daylight phone app for an investor between meetings.

The one signature move is the setback: a 1 to 3 tier stepped mark that ranks a row, and a stepped crown on the single reversed plate that carries the most material thing on a screen. There is no other ornament. Exchange references are shown like catalogue numbers ("NSE 1031874 · 21 Oct").

**Key Characteristics:**
- Light theme only (dark scheme deferred; not designed or verified).
- Flat: no shadows, no elevation; depth is tonal (ground, raised, inset) and the reversed plate.
- Square corners on content; radius only on Material pills.
- Two faces: Josefin Sans caps in three places, Public Sans (tabular figures for numbers) everywhere else.
- Source of truth for tokens: `app/src/theme.ts`.

## Colors

A cool green-grey stone ground, one deep sea-green, brass held in reserve, and red/green for money only.

### Primary
- **Sea Stucco** (#1E4D47): the shell and brand. App bars, the reversed plate, primary buttons, nav indicator icon ink, chart series 1, sparklines. Pressed state #25605A. Deck cards behind the top plate step lighter (#2E6B63, #3F7D74).
- **Sea Tint** (#C3D8D1): nav indicator pill, selected chips and rows.
- **On Sea** (#EEF4F1) and **On Sea 2** (#B5CFC6): text on sea; secondary text on the plate.

### Secondary
- **Brass** (#B8862B): marks only (dots, working setback, FINN's rule on its chat messages). Text forms: **Brass Text** (#7A5712) on stone, **Brass on Sea** (#E2BE76) on sea, including the ticker on a plate.

### Neutral
- **Stone** (#E6ECE8) page ground; **Raised** (#F4F7F5) composer, sheets, inputs; **Inset** (#D8E1DC) wells, nav bar, pressed rows; **Line** (#C5D0CB) hairlines; **Faint** (#A9B8B2) non-text only.
- **Ink** (#14201E), **Ink 2** (#3D4D49), **Ink 3** (#55655F, metadata only). All text pairs are documented at 4.5:1 or better in `theme.ts`.

### Money
- **Gain** (#1F6B44), **Loss** (#A33A2A), **Loss on Sea** (#F2A592).

### Named Rules
**The Brass Means FINN Rule.** Brass is only "FINN is acting": working dots and setback, "raised by FINN", FINN's message rule, the ticker on a plate. It is never a generic accent, status, or highlight.
**The Loss Is a Price Rule.** Loss red is only for price losses (and the change figure beside a sparkline). Verdicts such as Missed or Partly are set in ink. Sparklines are neutral sea; red/green stays on the change figure. Chart series come from the sea family (second series #7FA9A0) and exclude brass.
**The Sea Is the Shell Rule.** Sea green is shell and brand, never a signal of good or bad.

## Typography

**Deco Face:** Josefin Sans (700, 600) for caps only.
**UI Face:** Public Sans (400, 500, 600, 700), tabular figures for every number, reference and timestamp.

**Character:** Deco caps read as carved building lettering; Public Sans carries all reading. No italics, no eyebrows or kickers.

### Hierarchy
- **Display** (600, 30/36): rare large headings.
- **Title** (600, 24/29, -0.3 tracking): in-content headings (`Title` in `type.tsx`).
- **Lead headline** (700, 21/27): headline on the reversed plate, in Public Sans.
- **Body** (400, 16/24): default reading text. **Small** (14/21): secondary. **Meta** (12, floor): references, timestamps, labels; nothing is below 12.
- **Deco title** (Josefin 700, 22, +0.2em, caps): wordmark and screen titles in the top bar (`DecoTitle`).
- **Deco plate ticker** (Josefin 700, 17, +0.14em, caps): ticker on a reversed plate.
- **Deco ticker** (Josefin 700, 14, +0.14em, caps): ticker in rows.

### Named Rules
**The Three Deco Steps Rule.** Josefin caps appear only as wordmark/screen title, plate ticker, and row ticker. Headlines, body, buttons and labels are Public Sans.
**The Tabular Rule.** Figures, percentages, refs and dates use `Figure` / `Pct` (tabular-nums).

## Layout

Single column, capped at 640dp (`maxWidth`) and centred on wide viewports; screen padding 16dp (`Screen` in `screen.tsx`). Spacing scale 4, 8, 12, 16, 24, 40. Rows are separated by 1dp Line hairlines and carry 12 to 16dp vertical padding with a 48dp minimum. The top bar draws under the status bar (min height 64dp). Three tabs: Brief, Watch, Ask.

Touch targets are 48dp (`touch`). Visual chips and window selectors are 36dp tall and add `hitSlop` of 6 to reach 48dp. System Back always works alongside the Material back arrow.

## Elevation & Depth

Flat. No shadows or elevation exist in the build. Depth is tonal: Stone ground, Raised sheets, Inset wells, and the reversed Sea plate. The deck of stacked stories is faked with lighter, narrower sea slabs peeking 9dp above each other, inset 14dp per side, like a setback.

## Shapes

Square corners on cards, inputs, chips, rows and plates. Radius belongs only to Material pills: buttons (24 to 28dp, full pill), the nav indicator (32dp tall, 16 radius), switches, and the bottom sheet. Small round bits (progress track ends at 2dp, 7dp status dots) are marks, not component radius.

The setback is the only geometry: a plate crown of two bars (7dp tall, inset 14dp and 28dp) over the body; rank mark of three tiers.

## Components

### Setback and SetbackPlate (`app/src/components/deco.tsx`)
`Setback` is the rank mark (steps 0 to 3: Routine, On file, Worth a look, Needs you), sea on stone or on-sea on plate; empty steps use Faint. `SetbackPlate` is the reversed sea plate with a stepped crown, 18dp side padding. One per screen: Brief (lead story deck), unlock, onboarding, company (brain entry), Ask empty state. Watch and Brain screens are deliberately bar-only.

### Top bar (`top-bar.tsx`)
Sea bar, 64dp minimum, deco title in On Sea, 48dp round-pressed `BarAction` and back arrow (pressed fill rgba(238,244,241,0.14)). Window chips (Brief) sit in the `below` slot.

### Story rows (`story-row.tsx`)
`LeadStory` (plate: plate ticker in brass-on-sea, kind and `refLine`, Public Sans 21 bold headline, one-line why, "raised by FINN"). `StoryRow`: setback mark, ticker, kind, brass "FINN" square plus label when raised by FINN, change figure right, semibold headline, ref line. `refLine` renders exchange refs as catalogue numbers. Pressed row fills Inset.

### Deck (`deck.tsx`)
Stack of `LeadStory fill` plates; drag sideways and flick (110dp or velocity above 0.6) to send the top card to the back. Equal heights; "Open story" foot on each.

### Pulse (`pulse.tsx`)
`Dot` is a 7dp brass block at rest; while FINN works it becomes a three-tier setback climbing tier by tier (220ms tiers, 240ms stagger, 520ms hold), the app's one authored motion. Holds still under Remove animations.

### Buttons, chips, inputs
Primary: sea fill, On Sea semibold label, 48 to 56dp tall, pill radius; pressed #25605A (`ask-bar.tsx`, `welcome.tsx`, `source.tsx`). Chips: 1dp border, 36dp, square, selected = Sea Tint with sea border. Input (unlock): Raised fill, 1dp Line border, 52dp, square; error border turns Loss.

### Navigation (`app/(tabs)/_layout.tsx`)
Material 3 bar on Inset with a Line top hairline. Icon in a 64 by 32 Sea Tint pill when selected, label below (12dp; bold and ink when selected).

### Icons (`icons.tsx`) and charts (`spark.tsx`, `artifacts.tsx`, `live-blocks.tsx`, `scenario.tsx`, `source.tsx`)
Icons are SVG. `Spark` is a neutral sea line with an end dot. Answer blocks (charts, tables, scenario, source sheet) draw on Raised/Inset with sea-family series (#1E4D47, #7FA9A0, #3D4D49, #B7C6C0, #5E8F86); negative bars and deltas use Loss.

## Do's and Don'ts

### Do:
- **Do** rank with the setback mark and the single plate, not with bigger type.
- **Do** keep every text colour on the AA-checked pairs in `theme.ts`.
- **Do** show exchange refs as catalogue numbers via `refLine`.
- **Do** keep 48dp targets; use `hitSlop` 6 for 36dp visuals.

### Don't:
- **Don't** add a second reversed plate to a screen, or one to Watch or Brain.
- **Don't** use brass for anything but FINN acting, or loss red for anything but price losses.
- **Don't** round cards, inputs or chips; radius is for Material pills only.
- **Don't** set body, headlines, or buttons in Josefin; don't add a fourth deco step.
- **Don't** add shadows, kickers/eyebrows, italics, or a dark scheme without a new decision.

## Known gaps

- Native-only behaviour is unverified on device: predictive back, font scale to 1.3x, haptics. Captures in `.impeccable/review/*.png` are react-native-web at 412x915 @2x, not device; blocks and source captures predate the second chart series change (#7FA9A0). Trust code.
- Drift in the build, not canonized (see report): red used beyond price losses; brass in the scenario bar; glyph "▲" markers. (The 8dp Brief chips and the stale 80dp nav comment were fixed after this audit.)
