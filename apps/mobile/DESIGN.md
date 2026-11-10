---
name: WonderMoney Mobile
description: The native iOS/Android app, built as web's phone layout. Web's DESIGN.md is the system; this file only says how the phone carries it.
colors:
  background: "#faf9fe"
  foreground: "#0a0a0a"
  card: "#faf9fe"
  primary: "#6044b5"
  primary-foreground: "#f7fbfd"
  secondary-muted-accent: "#f5f4fa"
  muted-foreground: "#6b6b72"
  destructive: "#d90000"
  destructive-text: "#c51e1f"
  warning: "#d48e00"
  warning-text: "#8f5d00"
  info: "#0062c0"
  info-text: "#006da3"
  success: "#4ac06c"
  success-text: "#007932"
  overlay-scrim: "#0a090f"
  border: "#e5e4ea"
  input-stroke: "#8c8b93"
  ring: "#724ed8"
typography:
  display:
    fontFamily: "GeistMono"
    fontSize: "48px"
    fontWeight: 500
    lineHeight: "60px"
  figure:
    fontFamily: "GeistMono"
    fontSize: "36px"
    fontWeight: 500
    lineHeight: "44px"
  stat:
    fontFamily: "GeistMono"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: "32px"
  title:
    fontFamily: "Geist"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
  section:
    fontFamily: "Geist"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: "Geist"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  meta:
    fontFamily: "Geist"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Geist"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  action:
    fontFamily: "Geist"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  amountLarge:
    fontFamily: "GeistMono"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: "28px"
  amountBase:
    fontFamily: "GeistMono"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  amount:
    fontFamily: "GeistMono"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  amountSmall:
    fontFamily: "GeistMono"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "40px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  list-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    height: "44px"
---

# Design System: WonderMoney Mobile

## The system is web's

`../web/DESIGN.md` is the design system: the Calm Ledger identity, violet 290 used in its seven
places only, Geist for language and Geist Mono for every figure, border-first depth, sentence case,
no gradients, emoji or celebration. This file does not restate it. Each mobile screen is the web
screen at 390px wide: same information, same order, same labels (`apps/web/messages/en`), same
look. When the two disagree, web wins and the mobile screen has a bug.

The shell and primitives that make that true are listed, with their props and the web class each
maps to, in `src/components/ui/PARITY.md`. Build screens from them; don't restyle one-off copies.

## What the phone adds

- **Shell, as web's phone layout.** A top bar with the Wonder wordmark (goes Home) and the person
  avatar menu (Settings, Appearance & Language, Help, Dark/Light mode, Sign out); section tabs
  under it inside Accounts, Portfolio and Financial Markets; a plain bottom bar (Home, Accounts,
  Budgets, Portfolio, More; outline icons, 12px labels, current item at weight 500). Detail pages
  open with a "← Parent" back link above the title. The top bar owns the top safe area; screens use
  `SafeAreaView` from `components/ui/screen-safe-area` and add no top padding, so every title sits
  16pt under the shell. Flow routes (create, edit, import, scan, connect) hide the bar.
- **Type.** Web's scale at phone width (frontmatter): 16px body, 14px data text, 12px helper,
  24/600 page title, Mono 48/36/24/18/16/14/12 figures. All sizes come from `textStyles` /
  `<Text variant>`; a size that isn't listed is a missing role, not a reason to hand-roll one.
- **Targets.** Controls draw at web's sizes (40pt, 36pt small) and reach the **44pt minimum**
  through `hitSlop`. Rows are at least 44pt. Nothing a finger can press is smaller.
- **Appearance.** System (default), Light or Dark, chosen in Appearance & Language or the person
  menu. A non-System choice is stored on the device and applied with `Appearance.setColorScheme`,
  so screens read only `useColorScheme()` / `usePalette()`.
- **Colour storage.** React Native can't parse `oklch()`, so `src/theme/tokens.ts` commits sRGB hex
  converted from web's OKLCH, which is kept beside it in `colorSources`. `design-system-sync.test.ts`
  reconverts every hex and checks the contrast floors on both halves. Change the OKLCH, never the
  hex.
- **Native pieces.** Selects and menus open as bottom sheets (`OptionSheet`), web dialogs as
  `Sheet`; icons are web's lucide names mapped to SF Symbols / Material (`Icon`); relative times
  ("Balances updated 1 day ago") come from `lib/formatters/relative-time`, worded as web words
  them, because Hermes lacks `Intl.RelativeTimeFormat` on some runtimes.

## Rules that are easy to break here

- Every colour, size and space through tokens: spacing `4/8/12/16/24/32/48`, screen padding 16.
- No card around stats, no card inside a card, no wall of bordered boxes.
- One `primary` button per section; amounts stay foreground ink, semantic colour only on a delta
  or a status.
- A missing value is `—`, never `0`; an aggregate that can't be computed honestly says so.
- No `FlatList` inside a `ScrollView`.
- Dark mode is checked for every change, against web's dark screenshots.
