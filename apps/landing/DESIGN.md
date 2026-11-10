---
name: WonderMoney Marketing Site
description: A conversion-first, Stripe/Linear-register marketing site on the product app's Direction A tokens, in the same restrained violet.
colors:
  background: "oklch(98.5% 0.006 290)"
  foreground: "oklch(14.5% 0 0)"
  card: "oklch(98.5% 0.006 290)"
  primary: "oklch(48% 0.17 290)"
  primary-foreground: "oklch(98.6% 0.005 235.46)"
  secondary: "oklch(97% 0.007 290)"
  secondary-foreground: "oklch(20.5% 0 0)"
  muted: "oklch(97% 0.007 290)"
  muted-foreground: "oklch(53% 0.012 290)"
  accent: "oklch(97% 0.007 290)"
  accent-foreground: "oklch(20.5% 0 0)"
  destructive: "oklch(54% 0.245 27.325)"
  destructive-foreground: "oklch(97.1% 0.013 17.38)"
  destructive-text: "oklch(53% 0.2 27.325)"
  warning: "oklch(70% 0.15 75)"
  warning-foreground: "oklch(27% 0.05 75)"
  warning-text: "oklch(52% 0.115 75)"
  info: "oklch(48% 0.2 240)"
  info-foreground: "oklch(98% 0.01 240)"
  info-text: "oklch(51% 0.12 240)"
  success: "oklch(72% 0.16 150)"
  success-foreground: "oklch(27% 0.05 150)"
  success-text: "oklch(50% 0.145 150)"
  overlay: "oklch(14.5% 0.012 290)"
  border: "oklch(92.2% 0.008 290)"
  input-stroke: "oklch(64% 0.012 290)"
  ring: "oklch(54% 0.2 290)"
  chart-1-violet: "oklch(52% 0.17 290)"
  chart-2-amber: "oklch(62% 0.14 70)"
  chart-3-teal: "oklch(50% 0.13 170)"
  chart-4-vermillion: "oklch(58% 0.19 30)"
  chart-5-sky: "oklch(54% 0.13 235)"
  paper-2: "oklch(97% 0.007 290)"
  paper-3: "oklch(92.5% 0.008 290)"
  ink-2: "oklch(37% 0 0)"
  border-2: "oklch(95% 0.006 290)"
typography:
  display:
    fontFamily: "Geist Variable, Geist, sans-serif"
    fontSize: "clamp(2.5rem, 5vw + 0.5rem, 4.75rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Geist Variable, Geist, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Geist Variable, Geist, sans-serif"
    fontWeight: 400
  label:
    fontFamily: "Geist Variable, Geist, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  financial:
    fontFamily: "Geist Mono Variable, Geist Mono, monospace"
    fontWeight: 400
    fontFeature: "tabular-nums"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  card: "8px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    border: "1px {colors.input-stroke}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: WonderMoney Marketing Site

## Overview

**Creative North Star: "The Calm Ledger"** — shared with the product app (`../web/DESIGN.md`). This is the same product's public face, not a separate brand: same violet, same restraint, same Stripe/Linear-adjacent modern-minimal register, chosen over editorial (too literary for a conversion-first site), atmospheric (a dark-tool register wrong for a trust-first consumer finance product), and playful (undersells "precise").

`apps/web/DESIGN.md` is upstream, and since the 2026-11 Hallmark polish this file's tokens match the app's Direction A values (`apps/web/theme/globals.css`) one for one. Where this file is silent, that file rules; every place this file diverges is named below with its reason, so a real decision stays legible instead of reading as drift.

**Named divergences from web (upstream):**
- **Light theme only.** The product app treats dark mode as first-class and paired; the marketing site ships light only. This is a scope decision — the marketing site's job is conversion for a visitor who hasn't chosen a theme preference for a product they don't use yet — not an oversight or a "dark mode not implemented yet."
- **Token storage form differs, values don't.** This project runs Tailwind in compat-config mode (`tailwind.config.mjs`, not a native `@theme` block) and stores decomposed OKLCH triplets consumed via `oklch(var(--x))` — e.g. `--primary: 48% 0.17 290`, wrapped at the call site — rather than web's complete `oklch(0.48 0.17 290)` values. The two apps agree on every shared value; only the CSS syntax for expressing it differs.
- **Additive tokens** `--paper-2` (= the app's secondary surface), `--paper-3`, `--ink-2`, `--border-2` and `--radius-card` (= the app's 8px card radius) exist here without a web equivalent, for section-background layering and softer secondary text that a dense product UI doesn't need as often as a scrolling marketing page does.

The site keeps its long-standing violet identity rather than pivoting hue: a full switch to blue was considered and declined specifically to preserve existing brand recognition (logo, App Store listing, prior marketing). What changed in the current system is the *execution* — chroma, value, and how sparingly the accent is spent — not the hue family.

**Retired in the 2026-11 polish** (were divergences, now match the app): the 6px base radius and 10px card radius (now 8px / 8px, controls 6px); the universal red destructive (now the app's `oklch(54% 0.245 27.325)` with a `-text` variant); the violet-tinted ink (now achromatic `oklch(14.5% 0 0)`); the 78% hairline (now the app's 92.2% hairline, with a separate 64% input stroke for form controls); and Geist Mono uppercase labels (labels are now the body face, sentence case, untracked).

**Key Characteristics:**
- Modern-minimal, Stripe/Linear/Vercel-adjacent register, same violet 290 and same token values as the product app
- Light-only; radius 8px cards, 6px controls, 4px badges, as in the app
- Two-font split: Geist Sans for language, Geist Mono reserved for financial figures only (balances, amounts, percentages, prices) with tabular numerals; never for labels
- Real product screenshots as primary marketing content, never stock photography or invented metrics
- Hairline-driven surface language — borders over shadows, same as web

## Colors

A near-monochrome violet-tinted neutral system with a single sparing accent, matching the product app's palette value for value.

### Primary
- **Restrained Violet** (`oklch(48% 0.17 290)`): CTA fill, active nav state, focus rings, one highlighted data point per view. Capped at roughly 5% of any viewport — the same footprint discipline as `web/`.

### Neutral
- **Violet-Tinted Paper** (`oklch(98.5% 0.006 290)`): page canvas, card, and popover surface — all three share this exact value; hierarchy comes from a hairline border, not a lighter fill.
- **Ink** (`oklch(14.5% 0 0)`): primary text. Achromatic, as in the app: the tint would be imperceptible in text and only muddy it.
- **Quiet Violet Surface** (`oklch(97% 0.007 290)`; secondary, muted, accent and `--paper-2` all share it): hover/selected neutral controls, quiet grouping, muted section backgrounds. A shape filled only with it (a secondary button) carries the Input Stroke border too, or it disappears.
- **Deeper Surface** (`oklch(92.5% 0.008 290)`, `--paper-3`, additive): a second surface step for bars and tracks.
- **Hairline Border** (`oklch(92.2% 0.008 290)`): dividers and card edges — decoration, allowed to be faint.
- **Input Stroke** (`oklch(64% 0.012 290)`, `--input`): the outline of a text field, select or the secondary button. Held to WCAG 1.4.11's 3:1, which a hairline is not.
- **Secondary Text** (`oklch(37% 0 0)`, `--ink-2`, additive): a softer text step for long marketing/content pages. Muted foreground (`oklch(53% 0.012 290)`) is the helper/metadata step, 5:1 on the canvas.
- **Lighter Divider** (`oklch(95% 0.006 290)`, `--border-2`, additive): internal table/prose dividers lighter than the hairline.
- **Focus Ring Violet** (`oklch(54% 0.2 290)`): every focusable element, instant, 2px with a 2px offset (a global `:focus-visible` rule backs up components that draw no ring). On the violet pivot banner the ring switches to `primary-foreground`.
- **Overlay** (`oklch(14.5% 0.012 290)`): scrims.

### Semantic
The app's four semantic hues, each in two forms (**the Fill-vs-Text Rule**): a fill tuned to sit under its own `-foreground`, and a `-text` tuned to sit directly on the canvas or a 10% tint of itself. Never use a fill as text or a `-text` as a fill.
- **Alert Red** `destructive` `oklch(54% 0.245 27.325)` / `destructive-text` `oklch(53% 0.2 27.325)`: loss, debt, errors.
- **Amber Warning** `warning` `oklch(70% 0.15 75)` / `warning-text` `oklch(52% 0.115 75)`.
- **Cool Blue Info** `info` `oklch(48% 0.2 240)` / `info-text` `oklch(51% 0.12 240)`.
- **Positive Green** `success` `oklch(72% 0.16 150)` (dark ink foreground) / `success-text` `oklch(50% 0.145 150)`: gains, positive deltas.

Utilities: `bg-success`, `bg-success/10`, `text-success-text`, `border-destructive-text/30` and so on (`tailwind.config.mjs`). The product-preview mockups use only these and the chart tokens; a Tailwind stock palette class (`text-emerald-600`, `bg-slate-50`) is a bug.

### Chart palette
Same five slots as the app, hue fixed per slot, assigned in order and never cycled: `chart-1` violet `oklch(52% 0.17 290)` (single-series and net-worth lines take slot 1), `chart-2` amber `oklch(62% 0.14 70)`, `chart-3` bluish-green `oklch(50% 0.13 170)`, `chart-4` vermillion `oklch(58% 0.19 30)`, `chart-5` sky `oklch(54% 0.13 235)`. Recharts series take `oklch(var(--chart-n))`; legends render their text in `foreground`, never in the series colour.

## Typography

**Display Font:** Geist Variable (with Geist, then system sans-serif fallback)
**Body Font:** Geist Variable, weight 400
**Financial Font:** Geist Mono Variable, with tabular numerals (`.font-mono` sets `font-variant-numeric: tabular-nums` globally) — every balance, amount, percentage and price. Nothing else: not labels, not tickers set as names, not captions.

**Character:** Confident and precise, matching the app's pairing — a geometric sans for language, with the mono face reserved for the numbers so a figure always reads as a figure.

### Hierarchy
- **Display** (600–700, `clamp(2.5rem, 5vw + 0.5rem, 4.75rem)`, tracking -0.02em to -0.03em): hero headline only.
- **Body** (400): default paragraph text; running prose capped near 60–65ch.
- **Label** (Geist Sans, 400–500, one step smaller, sentence case, untracked): figure labels, column heads, footer column heads, captions. No uppercase transform and no letter-spacing — the tracked-caps label was retired in the 2026-11 polish, as in the app's 2026-10 one (Hallmark gate 67).
- **Kicker inside a heading:** where a page names its subject above a figurative headline ("Envelope budgeting" over "Give every euro a job before you spend it"), the name is the heading's first line, a `block` span inside the `h1`/`h2` at a smaller size in the same ink and weight — never a separate small label above it (gate 54).

### Named Rules
**The Single-Family Discipline Rule.** Geist Sans and Geist Mono only, sitewide — no serif, no second grotesque anywhere on the site, no exceptions for a single landing page.

## Layout

Three macrostructure families, chosen by page purpose rather than one shape stretched over everything:
- **Feature Stack** (homepage, since the 2026-11 full redesign): a hero with the headline, one line and the action on five columns beside the net worth card on seven, then a sticky left pane (the section head and an index of the features, marking the one in view) beside the features scrolling on the right, each a title, a line, a link to its feature page and its product preview. Below it, left-aligned sections on the 12-column grid: works with, the privacy statement, free and open source, questions, and the hero's action again in a closing band.
- **Workbench** (pricing, about, features, `/go/` ad-landers, affiliates/referral): real dashboard and transaction-preview screenshots are the primary content — the page is a guided tour of the product in use. Page length varies by section-archetype selection (a `/go/` lander is shorter than the homepage) but the underlying shape is shared.
- **Workbench variant** (calculator tool pages): a sticky input panel plus a live-updating result panel — same tool-first shape as Workbench, adapted for an interactive instrument rather than a scroll.
- **Long Document** (glossary, learn guides, monthly digest, lead-magnet guides): continuous prose with inline section heads, no hero macrostructure, no marketing scaffolding.

**Nav:** an edge-aligned bar, sticky at the top, full width with a hairline under it and the content on the page container: the wordmark, then the real destination set (Features dropdown, Resources dropdown, FAQ, About), then Login and the one sign-up action at the far edge. Replaced the floating pill in the 2026-11 full redesign.

**Footer:** index columns: four link columns (Features, Resources, Open source, Company) and the free guide form across the top on the 12-column grid, then a hairline, the wordmark with what WonderMoney is, and the legal row with the 6-language switcher. Sentence-case column heads in the body face. The legal links, the guide capture and the language switcher are functional elements that don't shrink for minimalism's sake.

**Global chrome invariant.** The wordmark, Header, and Footer are one implementation reused across all 100+ routes and all 6 locales — redesigning any of the three re-skins the entire site at once, so changes to them are never page-scoped.

## Elevation & Depth

Hairlines over shadows, same strategy as `web/`: 1px `--border` divisions do the structural work; cards lean on a hairline before reaching for a shadow. The sticky nav bar carries a blur backdrop over a near-opaque canvas and a hairline under it, no shadow.

**The Pattern Rule.** Homepage sections may carry one background pattern each (a grid or a dot field, `BackgroundPattern.tsx` and the `.pattern-*` classes in `globals.css`), drawn in the hairline ink and masked to fade out, never at full strength behind text and never on two adjacent sections. Product previews sit on opaque card surfaces above them. Added at the owner's request in the 2026-11 redesign.

## Shapes

The app's radius scale, from one `--radius: 0.5rem`: `sm` 4px (badges), `md` 6px (buttons, inputs), `lg` 8px (cards, containers, preview frames; `--radius-card` is the same 8px), `xl` 12px. Borders are 1px hairlines.

## Components

### Buttons (CTA voice)
- **Shape:** 6px radius (`rounded-md`), 40px default height (the app's control height) — not a soft pill.
- **Primary:** solid Restrained Violet fill. Copy always names the action ("See why it's changing," "Open calculator") — never "Click here" or a bare "Learn more," and never an arrow glued to the label.
- **Secondary:** Quiet Violet Surface fill with an Input Stroke border and ink text; **Outline** is neutral (input-stroke border, canvas fill) on this site.
- **States:** hover shifts the fill, `focus-visible` ring instant, `active` scales to 0.98 (off under reduced motion), `disabled` drops opacity with `cursor: not-allowed`.
- **Rule:** exactly one primary-styled CTA per section/viewport — never two primary buttons side by side.

### Cards / Preview Frames
- **Corner Style:** 8px radius, the app's card radius.
- **Background:** identical value to the page canvas (`bg-card`, never `bg-white`).
- **Shadow Strategy:** none at rest — hairline border only.
- **No nesting:** a bordered card never holds a second bordered card; inner groups use a background step (`bg-muted`) or a divider, as in the app.
- **Status cards** use the quiet register: a `-text` border at low alpha and an inline icon beside the heading — no tinted coin, no thick side stripe.

### Motion
- Composed and minimal — pages are fully visible on load, never staged in with scroll-reveal choreography.
- Accordions open by animating `grid-template-rows` 0fr→1fr, never `height`; bars grow by `transform: scaleX`, never `width`.
- One exception: a one-time number count-up on trust-bar/stat elements, playing once on first viewport entry and respecting `prefers-reduced-motion`.
- Micro-interactions only: hover states, instant `focus-visible` rings (never animated in), button press states, dropdown/accordion open-close.
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` — no bounce, no overshoot, no parallax, no autoplay.
- `prefers-reduced-motion: reduce` collapses all motion to instant or a ≤150ms opacity crossfade.
- Silent success over celebratory toasts for form submissions and copy actions. Hover-tooltip delay 800ms; focus-tooltip delay 0ms.

## Do's and Don'ts

### Do:
- **Do** keep the accent under ~5% of any viewport — CTA fill, active nav state, focus rings, one highlighted data point.
- **Do** use real product screenshots and hand-built SVG diagrams on marketing pages (Tier-A/B enrichment) — never stock photography, never an invented metric.
- **Do** keep tool pages function-first: the calculator input/output IS the content, with no decorative enrichment competing against it.
- **Do** keep content pages to typography only — no hero imagery, no marketing CTA interrupting the reading flow beyond one contextual CTA at the end.
- **Do** treat the wordmark, Header, and Footer as one shared implementation — never fork them per page.
- **Do** preserve the violet hue family in any future re-tuning; a hue pivot away from it was considered once and declined to protect existing brand recognition.

### Don't:
- **Don't** double up two primary-styled CTA buttons side by side in one section.
- **Don't** add scroll-reveal choreography or staged-in page loads — the page is fully visible on load by design.
- **Don't** confuse the shadcn `--accent` token (a neutral hover surface) with "the accent" in casual conversation — the brand accent is `--primary`/`--ring`.
- **Don't** rename the existing shadcn-convention CSS variable names (`--background`, `--primary`, `--border`, etc.) — 100+ files consume them directly; only their values changed from HSL to OKLCH, not their names.
- **Don't** introduce a second display or body typeface — Geist Sans and Geist Mono only, sitewide.
