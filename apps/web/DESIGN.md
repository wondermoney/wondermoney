---
name: WonderMoney Product App
description: A calm, precise financial workbench — modern-minimal in the Stripe/Linear register, tuned in violet.
colors:
  background: "oklch(0.985 0.006 290)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(0.985 0.006 290)"
  card-foreground: "oklch(0.145 0 0)"
  primary: "oklch(0.48 0.17 290)"
  primary-foreground: "oklch(0.986 0.005 235.46)"
  secondary-muted-accent: "oklch(0.97 0.007 290)"
  secondary-muted-accent-foreground: "oklch(0.205 0 0)"
  muted-foreground: "oklch(0.53 0.012 290)"
  destructive: "oklch(0.54 0.245 27.325)"
  destructive-foreground: "oklch(0.971 0.013 17.38)"
  destructive-text: "oklch(0.53 0.2 27.325)"
  warning: "oklch(0.7 0.15 75)"
  warning-foreground: "oklch(0.27 0.05 75)"
  warning-text: "oklch(0.52 0.115 75)"
  info: "oklch(0.48 0.2 240)"
  info-foreground: "oklch(0.98 0.01 240)"
  info-text: "oklch(0.51 0.12 240)"
  success: "oklch(0.72 0.16 150)"
  success-foreground: "oklch(0.27 0.05 150)"
  success-text: "oklch(0.5 0.145 150)"
  overlay: "oklch(0.145 0.012 290)"
  border: "oklch(0.922 0.008 290)"
  input-stroke: "oklch(0.64 0.012 290)"
  ring: "oklch(0.54 0.2 290)"
  chart-1-violet: "oklch(0.52 0.17 290)"
  chart-2-amber: "oklch(0.62 0.14 70)"
  chart-3-teal: "oklch(0.5 0.13 170)"
  chart-4-vermillion: "oklch(0.58 0.19 30)"
  chart-5-sky: "oklch(0.54 0.13 235)"
typography:
  display:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "var(--font-geist-sans), sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1
  financial:
    fontFamily: "var(--font-geist-mono), sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tabular-nums"
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
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.secondary-muted-accent}"
    textColor: "{colors.secondary-muted-accent-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
---

# Design System: WonderMoney Product App

## Overview

**Creative North Star: "The Calm Ledger"**

WonderMoney's product app is a quiet financial command surface, not a marketing surface wearing a login screen. It sits in the modern-minimal register — the Stripe/Linear family — chosen over editorial (too literary for a working financial tool), atmospheric (a dark-tool register wrong for a trust-first consumer product), and playful (undersells "precise"). The theme is custom-tuned, not a catalog default: a single violet at hue 290, applied with extreme restraint, against neutrals that carry a faint 290 tint rather than reading as pure gray. Neutral surfaces and typographic hierarchy carry almost the entire interface; violet identifies the handful of primary interactions; green and red are reserved for strict financial meaning and never used decoratively.

The signature is the two-font split: Geist Sans carries language, Geist Mono carries every financial figure — balances, amounts, percentages, tickers, tabular dates. This is deliberate and load-bearing, not a default; it stays even where a denser-data reference product (Stripe's dashboard, studied directly for this system's density pass) sets numerals in its sans face instead, because Geist Mono is already the cheapest legibility win on a balance sheet and the split is this product's identity.

Dark mode is a first-class half of the system, not a courtesy pass over a light design. Every color decision here is made twice — once per theme — and a `dark:` variant wrapped around a hardcoded value is treated as the same bug written twice, not a fix. This is where the system's worst accessibility defects have historically hidden, because they were invisible in light mode.

The app must never feel promotional or gamified: no decorative gradients, emoji in functional UI, confetti, generic stock illustrations, promotional pills, or attention-seeking motion. Data appears before decoration; copy states what happened and what the person can do next.

**Key Characteristics:**
- Modern-minimal, Stripe/Linear-adjacent register, custom-tuned in violet 290 rather than a catalog theme
- Dark mode is first-class and paired, not derived
- Two-font split: Geist Sans for language, Geist Mono for every financial figure
- Neutral-dominant surface; violet capped near 5% of any viewport
- Borders over shadows — surface hierarchy comes from a hairline, not a lighter fill
- No promotional, gamified, or decorative visual language

## Colors

The palette is a near-monochrome violet-tinted neutral system with a single sparing accent and strict, separately-tuned semantic colors for financial and status meaning.

### Primary
- **Restrained Violet** (`oklch(0.48 0.17 290)` light / `oklch(0.69 0.17 290)` dark): the one brand accent — CTAs, active navigation, focus rings, chart lead series, inline links. Same hue in both themes; only lightness flips, since a 0.48 violet is barely legible on a 0.145 dark canvas. Never a decorative fill.

### Neutral
- **Violet-Tinted Paper / Ink** (background `oklch(0.985 0.006 290)` light, `oklch(0.145 0.012 290)` dark; foreground `oklch(0.145 0 0)` light, `oklch(0.985 0 0)` dark): page canvas and primary text. The canvas is deliberately not pure white or zero-chroma gray — a small chroma toward 290 keeps borders from reading faintly yellow-green against it. Text stays achromatic; the tint would be imperceptible there and would only muddy it.
- **Quiet Violet Surface** (`oklch(0.97 0.007 290)` light / `oklch(0.269 0.012 290)` dark): shared literal value across secondary, muted, and accent roles — hover/selected neutral controls, quiet grouping, secondary surfaces. Because this value is identical to the canvas-adjacent surfaces in places, a shape built purely from this fill (e.g. a `secondary` button) needs its own border to stay visible — see Components.
- **Hairline Border** (`oklch(0.922 0.008 290)` light / `oklch(0.269 0.012 290)` dark): dividers and card edges. Surface hierarchy comes from this 1px line, not from a lighter fill — `card` and `background` are the same literal color in both themes.
- **Input Stroke** (`oklch(0.64 0.012 290)` light / `oklch(0.48 0.012 290)` dark): the boundary of a form control specifically — deliberately split from Hairline Border because a divider may be faint but a control's outline may not (held to WCAG 1.4.11's 3:1).
- **Focus Ring Violet** (`oklch(0.54 0.2 290)` light / `oklch(0.69 0.17 290)` dark): visible keyboard focus. Brand violet rather than neutral gray on purpose — the prior gray ring measured under the 3:1 floor for a focus indicator; violet clears it with margin.
- **Modal Scrim** (`oklch(0.145 0.012 290)`, identical in both themes): the one token that intentionally does not invert with the theme, because a scrim darkens whatever sits behind it.

### Semantic (financial and status)
- **Alert Red** (`oklch(0.54 0.245 27.325)` light / `oklch(0.396 0.141 25.723)` dark): errors, deletion, financial loss. Fill role — pairs with its own `-foreground`.
- **Amber Warning** (`oklch(0.7 0.15 75)` light / `oklch(0.82 0.13 80)` dark): caution.
- **Cool Blue Info** (`oklch(0.48 0.2 240)` light / `oklch(0.65 0.18 245)` dark): informational notices and links.
- **Positive Green** (`oklch(0.72 0.16 150)` light / `oklch(0.8 0.14 150)` dark): positive status. There is deliberately no in-gamut green that reaches 4.5:1 against a near-white foreground at a lighter lightness — this fill pairs with dark ink instead, same shape as Amber Warning.
- **Semantic text variants** (`destructive-text`, `warning-text`, `info-text`, `success-text`): the same four hues re-tuned specifically for use as body text/icons directly on the page or card surface, not as a fill. The fill tokens above measure well under 4.5:1 as text (`warning` is 2.62:1 on the light canvas); the `-text` tokens all clear 4.5:1 in both themes. **The Fill-vs-Text Rule.** A semantic color always has two forms — a fill tuned to sit under its own `-foreground`, and a `-text` tuned to sit directly on the canvas. Using a fill token as text, or a `-text` token as a fill's background, both fail contrast.

### Chart palette
- **Chart Violet** (slot 1, brand): `oklch(0.52 0.17 290)` / `oklch(0.64 0.16 290)`. Slot 1 is brand violet because a single-series chart (a net-worth line — the headline figure, not a categorical value) takes slot 1.
- **Chart Amber, Chart Teal, Chart Vermillion, Chart Sky** (slots 2–5): `oklch(0.62 0.14 70)`, `oklch(0.5 0.13 170)`, `oklch(0.58 0.19 30)`, `oklch(0.54 0.13 235)`, each with a paired dark-mode value.

**The Hue Discipline Rule.** Every violet in the system is hue 290 — shared with the marketing site — with no exceptions for a slightly-off-hue convenience value. **The Chart Hue-Lock Rule.** Each chart slot keeps its hue fixed across both themes; only lightness and chroma move. Assign chart series in order 1→5 and never cycle a sixth color — fold an overflow series into "Other" instead. **The Accent Footprint Rule.** Primary violet is capped at roughly 5% of any viewport, and appears only on: the current navigation item, one primary action per section, the active tab underline, a focused control's border/ring, an inline text link, the chart's leading series, and a selected segmented/radio state. Nothing else earns it — not a status badge, not a filter's unchecked state.

## Typography

**Display Font:** Geist Sans (with system sans-serif fallback)
**Financial Font:** Geist Mono (with system sans-serif fallback) — every balance, amount, percentage, ticker, and tabular date, in prose and in tables alike.

**Character:** Confident and instrument-like rather than editorial — a tight, functional sans for language paired with a true tabular-figure mono for money, so numbers always compare cleanly down a column.

### Hierarchy
- **Display** (800, 36px→text-4xl, tight tracking): one page title only, per page.
- **Headline** (600, 30px): major section heading.
- **Title** (600, 20px): card or group title; also the unified page-title treatment used on data-surface (Ledger/Overview) routes after the 2026 density pass.
- **Body** (400, 16px, line-height 1.75): default paragraph text.
- **Label** (400, 14px): metadata, helper text, secondary information — sentence case, never uppercase-tracked as a systemwide default (see Do's and Don'ts for the accepted house exception).
- **Financial** (400, 16px, tabular-nums, Geist Mono): any rendered money value, in a table cell or inline in prose.

Use sentence case, one display-level heading per page, unskipped heading levels, and locale-aware formatting for all three shipped locales (`en`, `pt`, `es`).

### Named Rules
**The Hierarchy Cap Rule.** No more than four type roles are visibly active on one screen at once (page title, section label, primary content, secondary/metadata), and no more than three distinct text colors or three distinct font weights are active at once. Hierarchy is established by size, weight, *and* color moving together — never by size alone. A screen that needs a fifth visual "level" to stay readable is a sign a section needs restructuring, not a new type role. (Grounded in the Refactoring UI hierarchy discipline, which both Stripe's and Linear's shipped UIs visibly follow — see `DESIGN_HISTORY.md`.)

## Layout

Mobile is a one-column document with bottom navigation and at least 16px page padding. Desktop adds a 14rem grouped side-rail (three labeled groups — Day-to-day, Investments, Planning — plus an ungrouped Home) alongside the content column; the rail is `hidden` below the `lg` breakpoint, and the bottom bar is its mobile equivalent, so the 44px touch-target floor applies to the bottom bar, not the desktop rail.

Route families carry distinct shapes: **Overview** (dashboard) is stat-led — a headline figure and its trend lead, cards follow. **Ledger** routes (accounts, transactions, budgets, portfolio, goals, reports) are a workbench — the table or chart *is* the content, filters sit adjacent to it. **Flow** routes (auth, onboarding, the budget wizard) are single-column, one decision per screen, with progress stated rather than implied. **Settings** is a long constrained document (`max-w-4xl`), not a grid of cards.

Data-surface routes (Ledger, Overview) run denser than Flow/Settings: 14px body/table-cell text, 12px sentence-case column headers, ~52px table rows, 16px card padding on data cards (24px stays for standalone units elsewhere). Breakpoints are Tailwind defaults (640/768/1024/1280/1536px); design QA checks 375, 768, and 1280px in both themes.

### Named Rules
**The Spacing Scale Rule.** Every gap, padding, and margin value comes from one fixed scale — `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96px` — and nothing else; an arbitrary value like `18px` or `27px` is always a bug, not a judgment call. The scale step itself communicates relationship, so picking the right step is a layout decision, not a cosmetic one: `4–8px` = elements that are one unit (an icon and its label, a value and its delta), `16–24px` = distinct items within the same section (rows in a list, fields in a form), `32–48px` = distinct sections on the same screen, `64–96px` = distinct page-level regions. Two elements separated by a section-level gap (32px+) that are actually one unit read as unrelated; two elements separated by a unit-level gap (8px) that are actually different sections read as visually fused. (Grounded in the Refactoring UI / observed Stripe-Linear proximity discipline — see `DESIGN_HISTORY.md`.)

## Elevation & Depth

Borders over shadows. Page and content hierarchy comes from background/card/muted/border tokens, not from color blocks or drop shadows — ordinary content cards carry a neutral 1px border and no shadow at rest. Shadows are reserved for genuinely elevated, temporary surfaces: dialogs, sheets, and popovers use a prominent shadow (`shadow-lg`); the desktop shell itself uses only a subtle `shadow-xs` plus a hairline ring. Dark mode elevates by lightness, never by adding shadow weight.

### Named Rules
**The Border-First Rule.** `card` and `popover` share the exact same literal color as `background` in both themes — surfaces don't get a lighter fill to read as "raised." A hairline border is the only signal, and it must be present wherever hierarchy needs to read.

**The No-Nesting Rule.** A bordered or shadowed container never contains a second bordered or shadowed container — zero levels of card-in-card, anywhere. To group content *within* a card, in order of preference: (1) vertical spacing alone, using the Spacing Scale Rule's step to signal the relationship, (2) a full-width 1px divider, (3) a single background-color step (e.g. `card` → `muted`) with no added border. This is how Stripe and Linear both actually build grouped regions — an elevation *ladder* of background shifts, not repeated borders — and it is the single most common way this system currently drifts from that register: multiple sibling action buttons, filter chips, and cards stacked directly against each other with no shared container read as a wall of boxes rather than one coherent section. If a reviewer can see two nested rounded-rectangle-plus-border shapes, that's the defect; collapse to one container and re-express the inner boundary as a divider or a background step.

## Shapes

Radius base is 8px (`0.5rem`), with a small/medium/large/extra-large scale of 4/6/8/12px — badges take the smallest step, controls the middle, cards and containers the base. This was deliberately tightened from a 10px base as part of a density pass: a smaller corner reads as a precision instrument rather than a soft consumer card. Borders are consistently 1px hairlines; there is no decorative clipping, cut corners, or non-rectangular silhouette anywhere in the system.

## Components

### Buttons
- **Shape:** `rounded-md` (6px) on every size variant.
- **Primary:** solid Restrained Violet fill with its paired foreground; 40px height at default size (`xs`/`sm`/`lg`/`icon` scale around it); 16px horizontal padding.
- **Outline:** primary-tinted, not neutral — a violet border and violet text on the plain background. This is the "wants attention without being the one action" variant; it is the wrong choice for a form control (use Input) and the wrong choice for a tertiary or third-party action (use Secondary or Ghost).
- **Secondary:** filled with Quiet Violet Surface — and because that fill is byte-identical to the app's muted surface in places, Secondary always carries an explicit Input Stroke border too, or the button becomes an invisible shape on a matching background.
- **Ghost / Link:** no fill; text-only, using foreground or primary respectively.
- **Hover / Focus / Active:** every button ships all interaction states — hover shifts the fill, `focus-visible` shows the Focus Ring Violet instantly (never animated in), `active` scales to 0.98 with `motion-reduce` disabling the scale, `disabled` drops opacity and suppresses hover, and a `loading` state disables the control and marks it `aria-busy` rather than letting a spinner overlay a still-clickable button.

**The Loud/Quiet Register Rule.** Semantic color is spent two distinct ways and the two must never mix on one element. **Loud**: a solid fill plus its `-foreground` — Button (destructive), Badge — where the element *is* the status. **Quiet**: no surface tint at all, just a `-text`-colored border at low alpha plus `-text`-colored text on the plain card surface — inline banners, callouts, alerts, toasts — where the status annotates content that's doing the talking. Primary violet is the one exception allowed a tint on the quiet register, at 10% alpha.

### Cards / Containers
- **Corner Style:** 8px radius (`rounded-lg`).
- **Background:** identical literal color to the page canvas.
- **Shadow Strategy:** none at rest — see Elevation & Depth.
- **Border:** neutral 1px Hairline Border.
- **Internal Padding:** 24px for standalone units; 16px on data-surface cards.

### Inputs / Fields
- **Style:** Input Stroke border, transparent/plain background, 6px radius, visible label above the field (placeholders are supplemental, never the only label).
- **Focus:** a 2px Focus Ring Violet with a ring offset, applied directly via `focus-visible:ring-2` on the control itself.
- **Error:** the border and focus ring switch to `destructive-text` via `aria-invalid`; validation copy appears immediately below the field.
- **Disabled:** reduced opacity, hover suppressed.

### Navigation
Desktop: a 14rem grouped side-rail. The current page gets a violet-tinted 5% background wash plus a 2px left rule and violet text — a full 10% wash was tried and found to fail contrast against the rail's own muted background, not just the canvas. A section containing the current page gets the rule and violet text but no fill, so an expanded parent and its active child don't both compete for attention. Everything else is plain foreground text with a neutral 5% hover wash. Mobile: a bottom tab bar is the equivalent surface, sized to the 44px touch-target floor.

## Do's and Don'ts

### Do:
- **Do** treat dark mode as first-class: make every color decision for both themes at once, using tokens — never a `dark:` variant wrapped around a hardcoded value.
- **Do** keep the accent (Restrained Violet) under ~5% of any viewport, limited to the seven permitted placements listed under Colors.
- **Do** put semantic color (red/green/amber/blue) only on a delta, a status badge, or an exceptional state — never as the default color of an ordinary balance or amount, which stays plain foreground/mono text.
- **Do** accompany every color-coded financial sign with a `+`/`-` or an explicit label/icon; color alone never carries meaning.
- **Do** use Geist Mono with tabular figures for every rendered money value, in tables and in prose.
- **Do** use an em dash (`—`) for a genuinely missing value — never a bare `0` or a blank cell standing in for "no data."
- **Do** use sentence-case, letter-tracked uppercase micro-labels as the house convention for small structural labels (nav-group headers, column eyebrows) — this reversed an earlier "sentence case only" rule once it became clear the uppercase-tracked pattern was already the dominant, load-bearing convention across the app, including in the navigation chrome itself.
- **Do** keep every interactive primitive's full state contract: default, hover, focus-visible, active, disabled, loading, error, and success, each expressed distinctly.
- **Do** hold every mobile interactive target to at least 44×44px.
- **Do** use exactly one label per concept, everywhere it appears — the string used in the nav item, the page title, any badge, and the equivalent screen in `mobile/` must all be the identical string, in the identical case. A concept that shows up as `PREVIEW` on one screen and `Preview` on the next is the same defect as two different names for the same feature — see `DESIGN_HISTORY.md` for a confirmed live example.
- **Do** verify a new or changed web screen against its `mobile/` counterpart's information architecture before shipping either — not just shared tokens, the actual section order and what's shown directly vs. behind a drill-in. `mobile/DESIGN.md` names web as upstream for a reason: a screen that shows different information, not just different styling, than its counterpart is a parity bug.

### Don't:
- **Don't** use decorative gradients, emoji in functional UI, confetti, generic stock/undraw-style illustrations, promotional badges ("Get Started!"), or attention-seeking motion anywhere in the product surface.
- **Don't** build a secondary-filled shape (button, chip) without its own visible border — the secondary/muted/accent fill is byte-identical to adjacent surfaces in places and disappears without one.
- **Don't** use the `outline` button variant as a neutral or tertiary action — it is primary-tinted and reads as "wants attention."
- **Don't** add elevation via shadow to an ordinary content card; hierarchy comes from the border, not a lift.
- **Don't** cycle chart colors past slot 5, or let a chart series change hue between light and dark mode.
- **Don't** use a switch to disguise an opt-in as a default-on preference — switches are for immediate binary settings, checkboxes are for explicit acknowledgements.
- **Don't** fade a fill toward the canvas to build a pressed/active state (e.g. `bg-primary/80`) — fading raises lightness and can drop label contrast below the floor; use `active:scale` or a distinct darker token instead.
- **Don't** stack multiple independently-bordered elements (buttons, chips, mini-cards) directly against each other with no shared container — three or more bordered boxes in a row read as a wall of boxes, not a section. Group them inside one container and let internal spacing or dividers carry the separation, per the No-Nesting Rule.
