---
name: WonderMoney Mobile
description: The native iOS/Android half of WonderMoney's calm financial workbench — the same violet-290 system as web, committed to sRGB.
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
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "34px"
  title:
    fontFamily: "Geist"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
  section:
    fontFamily: "Geist"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Geist"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "21px"
  bodyStrong:
    fontFamily: "Geist"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: "21px"
  meta:
    fontFamily: "Geist"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  label:
    fontFamily: "Geist"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  action:
    fontFamily: "Geist"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "20px"
  amount:
    fontFamily: "GeistMono"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "21px"
  amountSmall:
    fontFamily: "GeistMono"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
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
    height: "48px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "12px"
  list-row:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    height: "52px"
---

# Design System: WonderMoney Mobile

## Overview

**Creative North Star: "The Calm Ledger"** — the same identity as `../web/DESIGN.md` (upstream) and `../lp/DESIGN.md`, ported to the phone rather than reinvented. This is the third half of one system, not a separate app: same violet 290, same modern-minimal Stripe/Linear register, same "never promotional or gamified" stance, same two-font split (Geist for language, Geist Mono for financial data). Dark mode is first-class here exactly as on web — `useColorScheme()` is the switch; there is no in-app theme toggle and no second stylesheet.

`../web/DESIGN.md` is upstream. Where this file is silent, that file rules. Every place this file diverges from it is named below with its reason — an unnamed divergence is drift, not a decision.

**The one mechanical difference: color storage.** React Native's color parser (`@react-native/normalize-colors`) has no `oklch()` support — hex, `rgb()`, `hsl()`, `hwb()`, and named colors only. So `src/theme/tokens.ts` commits sRGB hex, converted once from web's OKLCH source, with that OKLCH source recorded beside it in `colorSources`. A guard test reconverts and fails if a hex stops matching its source — never hand-edit a hex; change the OKLCH and let the guard hand you the new value. Eight tokens fall outside the sRGB gamut and are clipped by the conversion (six in light, two in dark); this is recorded rather than hidden, and every contrast floor below is measured against the *clipped* value actually rendered on-device.

**Named divergences from web (upstream), each bought deliberately:**
- **Uppercase micro-labels are banned outright here, not accepted.** Web reversed its "sentence case only" rule once it found the pattern already pervasive in practice. Mobile made the opposite call: ten uppercase-tracked labels were found and removed during the port, and a CI guard (`design-drift.test.ts`) now fails on any `textTransform: 'uppercase'` reintroduction. This is a live, enforced contradiction between the two platforms' conventions — not an oversight — because mobile's port started clean and had no installed base of uppercase call sites to reckon with the way web did.
- **Touch targets are 48px, not the 44px floor** web and the platforms themselves use. A pointer lands where it's aimed; a thumb does not. 44px is still recorded as the absolute floor a control may never go under.
- **Body text is 15px, not web's 14px.** Web's 14px assumes a wide table scanned at arm's length; on a phone the row restructures into a stacked block and its primary line has to stay scannable in the hand. Measured against this app, not inherited from web's screenshot-derived contract.
- **The tab bar's active-tint alpha is 10%, not web's rail 5%.** Different underlying surface: web's rail sits on `--muted`, where a 10% wash measured under the contrast floor; this tab bar sits on `card`, which *is* the canvas, so the same 10% wash clears 5.79:1 light / 6.09:1 dark. Re-measure before reusing this value if the bar's background ever changes.
- **Page subtitles are removed outright**, where web left the decision open (audience-dependent, desktop has room to spare). On a 375px column a subtitle costs a third of the first screenful and the tab bar has already named the destination; a screen that genuinely needs to explain itself uses an on-demand `helpText` affordance instead of an always-on sentence.
- **A percentage change from a zero baseline renders as "nothing to compare," not `(0%)`.** Web's net-worth view model returns `0` to make this case go away; mobile's returns `null` because 0% literally means "unchanged," which is false when there's no baseline to change from. The underlying delta calculation still keeps its zero baseline correctly — only the percentage differs.

**Key Characteristics:**
- Same violet-290 identity as web/lp, committed to sRGB with a machine-verified conversion guard
- Dark mode first-class, `useColorScheme()`-driven, no manual toggle
- Two-font split: Geist for language, Geist Mono for financial data
- Denser touch/type contract than web in places, tuned for a phone in the hand rather than inherited wholesale
- Border-first depth; a single shadow role (`shadow.overlay`) for sheets/dialogs/popovers only

## Colors

### Primary
- **Restrained Violet** (`#6044b5` light / `#9c85fc` dark, OKLCH source shared with web): the one primary action, the current tab. Capped at roughly 5% of any screen, in the same seven placements as web (current tab, one primary action per section, active segment, focused control border/ring, inline link, `chart1` leading series, selected radio/choice state).

### Neutral
- **Canvas** (`#faf9fe` light / `#0a090f` dark): screen background, card, and popover all share this exact value — surface hierarchy comes from the 1px border, not a lighter fill. A screen reaching for a lighter card to separate content is fighting the system; give it a border, or give it space.
- **Ink** (`#0a0a0a` light / `#fafafa` dark): primary text and every rendered amount.
- **Quiet Surface** (`#f5f4fa` light / `#26252c` dark): secondary, muted, and accent tokens are byte-identical — a shape filled purely with this value is invisible on a muted surface and needs its own `input`-colored border, the same rule as web's Secondary button.
- **Hairline Border** (`#e5e4ea` light / `#26252c` dark): dividers and card edges.
- **Input Stroke** (`#8c8b93` light / `#5d5d64` dark): form-control boundary, held to the 3:1 floor.
- **Focus Ring** (`#724ed8` light / `#9c85fc` dark): visible keyboard/switch-control focus, instant, never animated in.
- **Overlay Scrim** (`#0a090f`, identical in both halves): modal scrim — does not invert with the theme, since a scrim darkens whatever sits behind it.

### Semantic
- **Destructive** (`#d90000` light / `#82181a` dark) with **Destructive Text** (`#c51e1f` / `#f75e53`) for negative deltas and ink use.
- **Warning** (`#d48e00` / `#f0ba59`) with **Warning Text** (`#8f5d00` / `#f9ad26`).
- **Info** (`#0062c0` / `#0096f4`) with **Info Text** (`#006da3` / `#02a9f7`).
- **Success** (`#4ac06c` / `#75d78d`) with **Success Text** (`#007932` / `#06c95e`) for positive deltas.

**The Fill-vs-Text Rule** (shared with web). `destructive`/`warning`/`info`/`success` are fills tuned against their own `-Foreground` pair — not safe as ink on the canvas. The four `-Text` tokens are for semantic text and icons instead; all four clear 4.5:1 in both halves, measured on the clipped sRGB actually rendered.

**Sanctioned tints.** `primarySoft` (primary at 10%) and `primaryWash` (primary at 5%) are the only two tints in the system, expressed as 8-digit alpha hex so they composite correctly over whatever sits behind them — a fix for a bug class where a tint was once verified against the wrong assumed background.

**The Accent Footprint Rule** (shared with web, same seven placements). `primary` is capped at roughly 5% of any screen and appears only on: the current tab; one primary action per section; the active segment in a segmented control; a focused control's border/ring; an inline text link; `chart1` as the leading series; a selected state in a radio/choice group. A derived figure is not an action and does not get the accent; a status badge is not one of the seven.

## Typography

**Display Font:** Geist (variable, loaded from `assets/fonts/`)
**Data Font:** GeistMono — every headline figure and in-row amount.

**Character:** Same instrument-precise pairing as web, tuned one notch larger where a phone is held closer than a desktop is viewed.

### Hierarchy
- **Display** (Mono, 600, 28/34): the one headline figure on a screen.
- **Title** (Sans, 600, 20/26): page title — one per screen, unchanged from web's standardized value.
- **Section** (Sans, 600, 16/22): section head.
- **Body** (Sans, 400, 15/21): primary row line and paragraphs — 15px, not web's 14px; see Named Divergences.
- **Body Strong** (Sans, 500, 15/21): the row line that names the row.
- **Meta** (Sans, 400, 13/18): muted second/third lines under a row.
- **Label** (Sans, 400, 12/16): micro-label — muted, sentence case only (see Do's and Don'ts).
- **Action** (Sans, 600, 15/20): control labels.
- **Amount** (Mono, 400, 15/21): a figure inside a row.
- **Amount Small** (Mono, 400, 13/18): a figure on a secondary line.

The port collapsed 23 distinct literal `fontSize` values onto these ten roles. A screen needing a size not listed is telling you a role is missing, not that the scale is too small.

### Named Rules
**The Hierarchy Cap Rule** (shared with web). No more than four type roles are visibly active on one screen at once, and no more than three distinct text colors or three distinct weights are active at once. Hierarchy comes from size, weight, and color moving together, never from size alone.

## Layout

Route families mirror web, adapted from a side-rail to a tab bar: **Shell** (`(app)/(tabs)`) is a five-item bottom tab bar under 768px with a 220px rail above it, mirroring `web/components/layout/BottomNav.tsx`'s exact destination set and order (Home, Accounts, Budgets, Portfolio, More) — changing one platform's tab set means changing the other's. **Overview** (home, net worth) is stat-led. **Ledger** (accounts, transactions, budgets, portfolio, goals, loans, markets, reports, recurring) is a workbench where the list is the content. **Flow** (auth, onboarding, create/edit forms, import) is single-column, one decision per screen. **Settings** (settings, profile, preferences, security, household, subscription) is a long document with section heads, no cards-for-the-sake-of-cards.

### Density contract (measured on a booted simulator at 402pt)

Screen padding 16px. Gap between blocks 16px. Section gap 12px. List row height 52px. Data card padding 12px (24px stays for a genuinely standalone unit). Meter bar 4px. Segmented chip drawn at 34px with `hitSlop` making up the difference to a 48px touch target. Base unit 4px, unchanged; radius base 8px with `sm` 4 (badges), `md` 6 (controls), `lg` 8 (cards/lists), `xl` 12 (sheets) — tightened from a prior 6/10/14 scale.

**Touch targets are 48px** — see Named Divergences above; 44px remains the absolute floor a control may never go under.

### Named Rules
**The Spacing Scale Rule** (shared with web). Every gap, padding, and margin comes from one fixed scale — `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96px`, of which the density-contract values above (16 screen padding, 12 section gap, 52 row, 12 card padding) are the app's chosen steps for those specific roles, not a separate scale. An arbitrary value outside this set is always a bug. The step size communicates relationship: `4–8px` = one unit (an icon and its label), `16–24px` = distinct items in one section, `32px+` = distinct sections, `64px+` = distinct screen regions — reach for the step that matches what's actually being separated, not whatever looks roughly right.

## Elevation & Depth

Border-first, same strategy as web. `shadow.overlay` is the only shadow role in the system, reserved for sheets, dialogs, and popovers — things genuinely floating above the screen. An ordinary card never takes it.

### Named Rules
**The No-Nesting Rule** (shared with web). A bordered card never contains a second bordered element, and multiple independently-bordered elements (buttons, filter chips, mini-cards) are never stacked directly against each other with no shared container — three or more bordered boxes in a row read as a wall of boxes, not a coherent screen. Group them inside one container; use spacing or a divider for the internal boundary, not a second border. See `DESIGN_HISTORY.md`'s Known Cross-Platform Gaps for a live example on this app's own Accounts screen.

## Shapes

8px base radius: `sm` 4px (badges), `md` 6px (controls), `lg` 8px (cards, lists), `xl` 12px (sheets) — a smaller corner reads as an instrument rather than a soft card, the same reasoning as web's density pass.

## Components

### Buttons
- **Shape:** `md` radius (6px).
- **Height:** 48px, meeting the platform's own touch-target contract with margin.
- **Primary:** solid Restrained Violet fill with its paired foreground.

### List Row
The primitive this repo exists to satisfy — the mobile answer to web's row-restructure rule (data can't shrink to fit 320px, it restructures). A stacked left column: primary line in foreground ink (`bodyStrong`), muted lines beneath (`meta`), figure right-aligned (`amount`) so decimal points stack. 52px target height.

### Card
- **Corner Style:** `lg` radius (8px).
- **Background:** identical value to the screen canvas.
- **Shadow Strategy:** none — border-first, per Elevation & Depth.
- **Internal Padding:** 12px on data cards; 24px stays for a genuinely standalone unit.

### The state contract

Every interactive primitive ships all of: default; pressed (opacity shift plus a deeper fill where the label doesn't sit on the fill — never a color fade, which raises lightness and costs label contrast exactly when the finger is down); focused (2px ring border, instant, never animated in); disabled (50% opacity plus `accessibilityState.disabled`); loading (sets `disabled` and `accessibilityState.busy`, wins over an explicit `disabled={false}`); error (`input` boundary swaps to `destructiveText`, message below the field); success (carried by `Badge` or a banner, never by the control itself).

## Do's and Don'ts

### Do:
- **Do** treat dark mode as first-class — every color decision made for both halves via `useColorScheme()`, never a manually-toggled theme.
- **Do** keep the accent under ~5% of any screen, in the seven permitted placements only.
- **Do** put semantic color only on a delta or a status, never on an ordinary balance — amounts stay `foreground`.
- **Do** use an em dash for a genuinely missing value, never a bare `0` or blank cell; any `?? 0` destined for display is a bug.
- **Do** say what an aggregate actually is when it can't be computed honestly — "2 currencies," never a plausible wrong number.
- **Do** normalize API category/status keys (`HOUSING`, `RENT_MORTGAGE`) at the view-model layer via `lib/formatters/category-name`, so the row, its accessibility label, and any confirmation dialog agree — but never apply this to user-supplied text like portfolio or account names.
- **Do** keep uppercase micro-labels banned — sentence case, `label` role, muted, everywhere. This is enforced by CI and is a deliberate divergence from web's accepted uppercase convention (see Overview).
- **Do** hold every interactive target to at least 48px, never dropping below the 44px absolute floor.
- **Do** change color values via their OKLCH `colorSources` entry, never by hand-editing a committed hex.
- **Do** use exactly one label per concept, in the exact same case, on this platform and on web — a screen showing the same feature under a different name or casing than its web counterpart is the same defect as two labels for one concept within a single platform.
- **Do** check a new or changed screen against its web counterpart's actual information architecture before shipping — not just shared tokens and type roles, but what's shown directly on the screen vs. behind a drill-in. `web/DESIGN.md` is upstream: if this screen shows meaningfully different information than web's equivalent, that's a parity bug to raise, not a platform-adaptation decision to make silently.

### Don't:
- **Don't** use decorative gradients, emoji, confetti, generic illustrations, promotional pills, attention-seeking motion, or celebratory haptics on a balance.
- **Don't** paint a chart series with the accent color — `primary` and `chart1` are both violet 290 and become visually indistinguishable from each other if both are used.
- **Don't** nest a virtualized list (`FlatList`/`SectionList`/`VirtualizedList`) inside a `ScrollView` — it silently disables virtualization.
- **Don't** declare a literal `fontSize`, a raw pixel spacing value, or a hardcoded color outside `src/theme/tokens.ts` — always go through the scale/palette.
- **Don't** show the same object in two sections of one screen without a clear, visible boundary between them — even when both sections are legitimate and show genuinely different data (e.g. an account's period inflow/outflow vs. its current balance), no section framing between them makes it read as an accidental duplicate. Give each section its own heading and a clear container edge. See `DESIGN_HISTORY.md`.
- **Don't** apply a shadow to an ordinary card — `shadow.overlay` is reserved for sheets, dialogs, and popovers only.
- **Don't** render a page subtitle — a supporting sentence under a title is furniture on a 375px column; use `PageHeader`'s on-demand `helpText` instead.
