# WonderMoney Product App — Design History & Working Notes

`DESIGN.md` is now Impeccable's canonical design-system format (tokens + eight
fixed sections) and is the file to read for current rules. That schema has no
slot for a migration tracker, a drift/incident log, or an unbuilt component's
full spec — so this file preserves that institutional history instead of
deleting it. Nothing here is normative; where this file and `DESIGN.md`
disagree, `DESIGN.md` wins.

This file is **not** machine-checked. The previous `DESIGN.md` had a
`yarn test` guard (`scripts/design-system-sync-regression-checks.ts`) that
verified its token-export block matched `theme/globals.css` byte-for-byte.
That check was removed along with the export block it verified (2026-08-27) —
`theme/globals.css` is the only enforced source of truth for token values now;
this document and `DESIGN.md`'s frontmatter are both hand-maintained
snapshots and can drift from it silently.

## Source for the Card Nesting, Spacing Scale, and Hierarchy Cap rules

Added 2026-08-27, prompted by a live audit finding the shipped app had drifted from its own "modern-minimal / Stripe-Linear register" claim: nested/stacked bordered boxes, oversized padding relative to the documented density contract, and inconsistent labeling (see Known Cross-Platform Gaps below). Neither Stripe nor Linear publishes an official written design-system spec with exact numbers, so the rules in `DESIGN.md` are grounded in a mix of sources, cited here rather than asserted as verbatim Stripe/Linear documentation:

- **Card nesting**: no credible source documents either product nesting a bordered/shadowed card inside another. Linear's shipped UI (per community CSS extraction, not an official doc) uses a 3–4 step background/surface ladder with a border reserved for the outermost container only. NN/g's "Cards: UI-Component Definition" defines a card as one border + one background shift per grouped region, which structurally rules out stacking that signature twice.
- **Spacing scale**: the `4/8/12/16/24/32/48/64/96px` scale and its "gap size signals relationship" reading is Refactoring UI's popularized proximity principle, echoed by most SaaS design-teardown sources. Linear-specific numbers (section gaps ~96px, related-item gaps ~8px, card radius 12px) come from an unofficial but concrete community CSS extraction. Stripe-specific numbers (24px typical card padding, tighter 32–48px section padding on dashboard/product surfaces vs. 64–96px on marketing pages) come from independent design-teardown sources (shadcn.io's Stripe extraction, 925studios' Stripe Dashboard breakdown) rather than an official Stripe document.
- **Hierarchy cap**: Refactoring UI's rule of building hierarchy from size+weight+color together, capped at 2–3 active weights and 2–3 active text colors per screen. Linear's shipped type system (a signature ~510 medium weight doing most of the work, few discrete sizes) visibly follows this discipline per multiple independent extractions (DesignMD, LogRocket).
- **One label per concept**: weakest-sourced of the four — no external doc for either product states this explicitly. It's written as a project rule here, motivated by an observed live defect (see below), with only indirect support from NN/g's general content-standards-belong-in-the-design-system position and observed Stripe nav-label consistency.

Treat every pixel value in these rules as a credible, well-reasoned default consistent with widely-observed practice — not a verbatim citation of a Stripe or Linear internal spec. If either company ever publishes an authoritative number that contradicts one of these, that source wins.

## Known Cross-Platform Gaps (found 2026-08-27 audit)

A live side-by-side audit — `web/` at a 390px viewport via `agent-browser`, `mobile/` on an iOS Simulator, both on freshly-created test accounts — found the gaps below. All four were fixed the same day; kept here as the record of what was found and why, not as an open backlog.

| Where | Gap | Resolution |
| --- | --- | --- |
| `web/en/accounts` vs. `web/en/budgets` | The "Preview" empty-state badge rendered `PREVIEW` (uppercase) on Accounts and `Preview` (sentence-case) on Budgets — one screen apart, same concept. | **Fixed.** `BudgetsEmptyState.tsx` was the outlier — `AccountsEmptyStateV2.tsx` and `DashboardBudgetsEmptyState.tsx` had already converged on the uppercase bordered corner-tag treatment via RAD-647; `BudgetsEmptyState.tsx` never got updated. Converged onto that same existing pattern. |
| `mobile/` Accounts screen | The same account (`AB Bank Acc EUR`) appeared twice on one screen: once as a stat row under "By currency" (Insights, period Inflow/Outflow), once as a full bordered card lower down (accounts list, current balance). | **Corrected characterization, then fixed.** Not a code bug — confirmed by reading `accounts-screen.tsx`: two intentionally different sections. The real defect was insufficient section framing. **Fixed** by adding a "Balances" heading above the accounts list, so Insights and Balances read as two named sections instead of one repeating itself. |
| `mobile/` Accounts screen | Stacked 3+ independently-bordered elements directly against each other at the top of the screen (two action buttons, a third full-width button, then 3 bordered filter chips) with no shared container. | **Fixed.** `SegmentedControl` now uses one shared track border instead of a border per segment (fixes this pattern on 2 other screens too — portfolio performance chart, market asset price chart). "View transactions" and "Recurring bills and subscriptions" switched from bordered to `ghost` variant, leaving only "Add manual account" bordered/filled. |
| `mobile/` Budgets vs. `web/` Budgets | Web showed budget categories (Housing/Food/Transportation) with progress bars directly on the Budgets screen; mobile's list screen showed only an aggregate (Remaining/Planned/Spent) with categories behind a chevron drill-in. | **Product decision made 2026-08-27: converge on web's shape.** `budgets-screen.tsx`'s `BudgetCard` now renders each `budget.categories` entry with its own progress bar directly on the list, below the existing aggregate hero figure — the category data was already computed (`BudgetViewModel.categories`), just not rendered at the list level. |
| `mobile/` Home screen | By contrast, this screen was genuinely clean — plain dividered list rows, one card only for a genuine callout, no box-stacking. | Not a defect — kept as evidence the problem was inconsistency, not a uniformly bad mobile implementation. |

## Full audit follow-through (2026-08-27, same day as the rule-strengthening above)

A "both platforms, all major screens" sweep (Dashboard, Accounts, Budgets, Portfolio, Financial Markets, Goals, Loans, Reports, Settings/Billing on web; Home, Accounts, Budgets, Portfolio, Markets, Goals, Loans, Reports, More on mobile) found the No-Nesting and One-Label violations above were not isolated — the same two patterns repeated across most empty/preview states on both platforms. Fixed same day:

- **`PreviewBadge` component** (`web/components/ui/PreviewBadge.tsx`) replaces 9 separate hand-rolled implementations that had drifted into 6+ visual treatments (uppercase bordered tag, sentence-case pill, plain uppercase text, plain sentence-case text, muted box) across Accounts (2 separate empty-state components), Budgets, Portfolio (3 components), Goals, Financial Markets, and Loans. All 9 already shared one translation key (`common.preview`) — this was a pure visual consolidation, zero i18n risk.
- **Financial Markets asset-preview nesting** — confirmed via DOM inspection (not just screenshots) that one outer card contained 4 separately-bordered children (Price history, Fundamentals, Financials, Earnings). Flattened to one card with a background-step chart block and a divided 3-column metrics row.
- **Portfolio empty-state nesting** (web) — outer card had a redundantly-bordered metrics-grid sub-container and a redundantly-bordered holdings list. Both flattened to dividers-only, matching the outer card's single border.
- **Loans empty-state nesting** (web) — the worst case, 3 levels deep (outer card → bordered preview box → the preview box's own content). Flattened to 1 level; the two metric tiles inside now use a background-step (`bg-background` inside `bg-muted/30`) rather than a border, which the research confirms is the correct technique, not a compromise.
- **Portfolio empty-state nesting** (mobile) — same shape as web, found and fixed the same way: dropped the inner box's border, converged its distinct "filled chip" preview label onto the same shared component as everything else.
- **`PreviewLabel` component** (`mobile/src/components/ui/preview-label.tsx`) — mobile's own 4-way version of the same drift (three different type roles plus one filled-chip variant across Accounts, Budgets, Goals, Portfolio, and Portfolio detail), consolidated the same way.

Several pre-existing hardcoded decorative colors were found and left alone during this pass (sample ticker-avatar and sample-category colors in `AccountsEmptyStateV2.tsx`, `PortfolioEmptyState.tsx`, `PortfolioHoldingsEmptyState.tsx`) — flagged to the user as an optional follow-up rather than fixed, since they're unrelated to the nesting/badge work and changing them is a real (if small) visual decision.

**Loans empty-state content parity — resolved 2026-08-27, mobile now matches web.** `mobile/src/features/loans/loans-screen.tsx` gained a `LoanPreview` (Mortgage / Bank / Active, Outstanding principal, Remaining term) reusing web's exact sample values and copy, translated across `en`/`pt-PT`/`es`. Verified by an added Jest assertion.

**Deferred, needs its own dedicated pass — too large for this session:**
- **Reports information architecture** — web's `/reports` shows all 6 report types stacked inline (Sankey, Cashflow, Spending by Category, Net Worth History, Budget vs Actual, Portfolio Performance); mobile has all 6 as separate ~150-line screens reachable from a hub menu. Composing them into one inline mobile screen is comparable in size to building a new screen, not a consolidation fix — explicitly deferred by the user rather than squeezed into this session.

## Accessibility constraints (carried forward, still binding)

- Target WCAG 2.2 AA: ≥4.5:1 normal text, ≥3:1 large text and meaningful UI
  boundaries, visible focus, keyboard reachability, semantic names/roles.
- Support screen-reader users, keyboard-only users, low-vision and
  color-vision-deficient users, people using zoom or 375px screens,
  reduced-motion users, and people under financial or consent decision stress.
- Color never acts alone — financial signs carry `+`/`-` or a label/icon;
  consent state is written in text and exposed semantically.
- Dynamic confirmation/error content uses an appropriate polite status or
  assertive alert. Modal primitives restore focus; a non-modal surface (like
  the planned consent banner) never traps it.
- Long translations and 200% zoom must reflow without clipping, obscured
  controls, or horizontal scroll of primary content.
- All interactive mobile targets are ≥44px.

`theme/contrast.test.ts` (part of `pnpm test`) verifies every semantic
fill/`-foreground` pair, the `-text` tokens, `--ring`, and chart hue-lock
directly against `theme/globals.css`.

## Drift log

### Known drift (open as of last verification, 2026-08-27)

| Location | Drift | Rule for new work |
| --- | --- | --- |
| `components/ui/input.tsx` (adornment branch) | Uses `ring-ring` at 2px via `has-[:focus-visible]`, while every other primitive uses `focus-visible:ring-2` directly. Behavior matches; the mechanism differs. | Prefer the plain `focus-visible:ring-2 focus-visible:ring-ring` form in new controls. |

### Resolved drift

Recorded so the history is legible; these are no longer live issues. Two
entries below (login illustration, budget wizard hardcoded grays) were still
listed as *open* in the prior `DESIGN.md` but were verified fixed in code
during the 2026-08-27 rebuild — moved here rather than carried forward as
stale open items.

| Location | Was | Resolved by |
| --- | --- | --- |
| `(no-layout)/auth/login/page.tsx` | A legacy undraw illustration on a login split-panel, against data-forward guidance. | Verified 2026-08-27: current `login/page.tsx` is a single centered column with `Logo` + `LoginForm`, no split-panel or illustration. |
| `(no-layout)/budgets/wizard/**` | Hardcoded slate/zinc/gray surfaces and green/blue semantic fills with no `dark:` variants. | Verified 2026-08-27: no `slate-`/`zinc-`/`gray-` classes remain in the wizard route tree. |
| `components/ui/input.tsx` (plain branch), `components/ui/textarea.tsx` | `focus-visible:none` (invalid Tailwind) and `focus-visible:outline-hidden` removed the UA outline — no focus indicator at all (WCAG 2.4.7). | Both apply `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`, matching Button. |
| `app/[locale]/(no-layout)/**` (auth + join), `components/auth/**` | Hardcoded `bg-slate-100`/`bg-white`/`text-gray-*`/`border-gray-200`, no `dark:` variants — auth surface ignored the token system. | Migrated to `bg-muted`/`bg-card`/`text-foreground`/`text-muted-foreground`/`border-border`; `brand-*` swapped for `--primary`. |
| `components/portfolio/PortfolioBenchmarkChart.tsx` | Benchmark series hardcoded `oklch(0.372 0 0)` / `oklch(0.708 0 0)`. | Uses `var(--muted-foreground)`. |
| `components/ui/Alert.tsx` | `success` referenced a `--success` token that never existed; `warning`/`info`/`destructive` set body text to fill tokens that fail contrast in one mode each. | All four variants use the `-text` tokens for text, icon, and border. |
| `components/ui/card.tsx` | Default `shadow-xs` contradicted the border-first depth strategy. | Shadow removed; cards are border-defined. |
| `theme/globals.css` + `WorkInProgress.tsx` | `.animate-gradient` drove an animated purple-pink-blue gradient card. | Utility and keyframes deleted. |
| `components/layout/Sidebar.tsx` | Demo-mode badge hardcoded `bg-violet-100`/`text-violet-700` + dark variants. | Now `bg-primary/10` + `text-primary`, one class set for both themes. |
| `lib/utils/useNumberColor.tsx` | Branched on `useTheme()` for the zero case, used `text-green-600`/`text-red-500` (3.08:1 / 3.66:1 on light canvas). | Uses `-text` tokens and `text-muted-foreground`; no client theme dependency. |
| `theme/globals.css` | 8 `--sidebar*` tokens with zero consumers; dark `--sidebar-primary` was an unrelated blue. | Removed along with their `@theme` mappings. |
| Uppercase letterspaced micro-labels | Previously documented as "out" in favor of sentence case, and marked "resolved" — but 40+ live call sites (including the sidebar's own nav-group labels) never actually converted. | 2026-08-27: reclassified as the accepted house style instead of fighting established, pervasive practice. See `DESIGN.md` Do's and Don'ts. |

### Accepted debt policy

None accepted for the foundation as of the last full pass. Any future
exception must identify affected users, exact location, owner, and exit
condition before it is considered accepted.

## The Stripe density study (Aug 2026)

Prompted by a `hallmark study` of the Stripe Dashboard, supplied as a
reference by the founder. This is **extracted DNA, not a copy**: structure,
density, and restraint. None of Stripe's brand marks, exact accent, wordmark,
or illustration style were adopted.

### What the reference does, and status as audited

1. **Accent footprint under 5%.** Shipped and measured: 0.85% fill, 8
   accent-painted elements on `/en/accounts/transactions` at 1440×950 (active
   nav item, 2 primary buttons, 2 outline buttons, 2 inline links, 1
   tolerance false-positive). Two source-level fixes got it there: row-select
   checkboxes no longer draw their unchecked border in the accent, and
   `RecurringStatusBadge` no longer paints `confirmed`/`detected` states in
   the accent — a status badge isn't one of the seven permitted accent
   placements.
2. **Dense vertically, airy horizontally.** Shipped — cell gutters widened to
   `px-3 / lg:px-6`.
3. **Declarative headers.** Shipped — the four pages that carried a
   supporting sentence under the title (settings, budgets, markets explorer,
   reports) no longer do.
4. **Tables sit on the canvas.** Shipped — the two loan tables that were
   wrapped in padded cards now sit on hairline rules instead.
5. **Dark elevates by lightness, never shadow.** Confirmed, unchanged —
   already the system's approach.

### The eleven data-presentation rules

All shipped unless noted.

1. **Split the amount from its unit.** `<Amount>` splits a formatted currency
   string via `formatToParts`, setting the currency part in muted ink;
   position isn't hardcoded (prefix in `en`, suffix in `pt`). Adopted across
   budgets, portfolio, dashboard, accounts, reports. Charts are the
   deliberate exception — an axis/tooltip formatter must return a string, so
   those route through `useChartFormatters` instead.
2. **Color is not how sign is communicated; the minus sign is.** Amounts are
   `--foreground`; semantic color appears on a *delta* or a *status*, not a
   balance. `getFinancialValueClassName` (which painted every negative/positive
   value red/green across 11 call sites) is gone.
3. **Missing is `—`, never `0`, never blank.** Any `?? 0` on a value destined
   for display is treated as a bug.
4. **If an aggregate can't be computed honestly, say what it is.** E.g. "2
   prices" rather than a fabricated sum/average/first-value.
5. **A headline figure always carries its comparison, adjacent and muted.**
   `StatCard` takes `comparisonValue`/`comparisonLabel` (like-for-like),
   `deltaPercent` (direction chip), or `helper` (other companion figure).
   Cross-currency comparisons are withheld rather than summed — a dishonest
   aggregate per rule 4.
6. **State provenance and freshness.** `AccountSyncBadge`, portfolio
   `updatedAt`, `AccountsFreshness` on transactions/dashboard, `StatCard`'s
   `helper` line. `AccountsFreshness` reports the *weakest link* (stalest
   connection, or an error) rather than the freshest, since the freshest
   would actively mislead about a list fed by several accounts. Manual
   accounts are excluded rather than counted as infinitely stale.
7. **Filters carry their own counts — declined, Aug 2026.** Built (RAD-561),
   then removed (RAD-576/578): 9 months of unread facet-count queries, 8
   extra `COUNT`s per request. Founder decision to delete rather than wire
   up. Revisit only as one grouped query through `applyFilters`, consumed the
   same day it's added.
8. **Status is a word in a badge, never color alone.** Small radius, tinted
   fill, label always present, inline with the title (not a trailing
   column).
9. **Timestamps are short and human.** `formatShortDateForLocale` /
   `useFormatShortDate` drop the year inside the current year, keep it
   outside, use a numeric (non-zero-padded) day.
10. **One row, several facts, no wrapping.** Stacked left column (primary
    line + two muted lines beneath: institution/account/date), figures
    right-aligned so decimals stack. Category/amount/balance stay their own
    columns because they carry interactive controls.
11. **On mobile the row restructures; it does not shrink** — one divergence.
    Label/value pairs stacked under a title. Unlike the reference (where
    amount is the title, since it's listing payments), the transactions card
    keeps the merchant as the title, since a transaction list is scanned by
    who was paid, not by amount.

### Declined, deliberately

| Reference does | We do not | Why |
| --- | --- | --- |
| Money in the sans; mono for machine IDs only | Money stays in Geist Mono | The two-font split is the product's signature; Geist Mono is already load-bearing everywhere. Founder decision, Aug 2026. |
| Two-tier top nav on data surfaces | The grouped side-rail stays | Buys ~240px of table width but is a full shell rebuild across every route and locale; the rail already works. |
| A "Pinned"/"Recent" block under the rail groups | Not adopted | Founder decision, Aug 2026. |
| Accent at ~`oklch(0.55 0.24 272)` | Violet 290 stays | That indigo is Stripe's brand; ours is shared with `lp/`. Take the footprint discipline, not the hue. |

### Density contract (data-surface routes: Ledger, Overview)

All rows below are **done** as of the last audit unless marked otherwise.
Page title unified on 20px/600 across 14 of 16 `h1`s (404 page and one
error-card heading are correctly exceptions). Section head 20px/600. Body/cell
14px. Column header 12px muted sentence case. Row height ~52px (measured, not
estimated). Column gutter 24–32px. Card padding 16px on data cards, 24px
stays for standalone units. Radius base 8px, badges 4px, controls 6px.

Two corrections worth keeping on record because they were wrong when first
written from a screenshot rather than measured: the page-title target was
estimated at 30px but the app's own dominant treatment was already 20px on
ten routes (the real defect was four *other* sizes coexisting, not the size
itself); a row-height figure of "~64px" was true only of budget tables, not
the transactions table the contract targeted (which measured 53px).

**The subtitle question — resolved.** Whether to drop the muted sentence
under a page title (as the reference does) was left open because the
audience differs: this is a consumer product launched in Portugal/Spain,
where a page name may not be self-evident the way "Payments" is to a Stripe
developer. As of the Aug 2026 audit, subtitles were removed anyway
(observation 3 above) — recorded here since the original reasoning for
keeping them is still worth knowing if the decision is ever revisited.

### The seven accent placements

`--primary` may appear on, and only on: the current navigation item; one
primary action per section; the active tab's underline; a focused control's
border/ring; an inline text link; `--chart-1` as the leading series; a
selected state in a segmented or radio group. Anything else that wants
attention uses weight, size, or position instead.

### Component archetypes — status

All resolved as of Aug 2026 except one dropped and one intentionally not
unified:

- **`InspectorDrawer`** — built. Right-hand panel opening over a list without
  navigating away; dismissible by Escape and explicit close, traps focus,
  becomes a full-height sheet below `md`.
- **`SegmentedFilterCards`** — dropped, not built. No real call site existed
  (goals' Active/Archived is a view switch and correctly stays a
  `TabsList`); revisit only if a real row-level segmented filter emerges.
- **`FilterChip`** — built. Dashed-outline chip with a leading `⊕` opening
  its own popover; overflow reads "More filters."
- **`ObjectHeader`** — built. Breadcrumb, then the value as the page title
  with an inline status badge (e.g. `$41.60 USD [Paid]`). Live on account,
  transaction, goal, and budget detail pages.
- **`Skeleton`** — built, matches the real proportions (column widths, row
  count, banner) of the page it replaces, not a generic block.
- **`DateRangePopover`** — never built under that name, deliberately.
  `DatePickerRange` (transactions/portfolio) and
  `reports/filters/DateRangePicker` (reports) already ship the same preset
  rail + two-month-side-by-side shape. They remain two components with two
  preset models (reports carries preset *detection* the other doesn't) —
  merging them was judged a real refactor for approximately zero user-visible
  benefit, and left deliberately rather than quietly marked done.
- **`Timeline`** — built. Vertical dotted rail with dated events, for
  payout/sync-style histories.

### Chart voice

Sharpens the chart-ramp rules in `DESIGN.md`: 2px lines, no markers except
the live/last point; the comparison series is always grey, never a second
accent color; axis labels appear at the extremes only, not every tick; area
fill is a gradient fading to ~5% and only under a single series (it decorates
the line, it does not encode magnitude from a baseline); a price/balance
series never anchors at zero, but a magnitude comparison (bars) always does.

### Migration order and final status (Aug 2026 audit)

Ordered by how much clarity each buys. All steps below shipped except step 5,
which was built and then deliberately reverted.

| # | Step | Status |
| --- | --- | --- |
| 1 | Stop coloring amounts by sign | Done — `getFinancialValueClassName` removed |
| 2 | `<Amount>` primitive | Done, adopted everywhere money renders in the DOM |
| 3 | Comparison beside headline figures | Done — `StatCard` |
| 4 | Provenance line | Done — `AccountsFreshness` |
| 5 | Counts on filters | Declined — built in RAD-561, deleted in RAD-576/578 |
| 6 | Row restructure | Done — 9 columns to 7, stacked left column |
| 7 | Radius + unified page titles | Done |
| 8 | Micro-labels; subtitles | Resolved — subtitles removed |
| 9 | Row height and gutters | Done |
| 10 | `ObjectHeader` on detail routes | Done — goals, accounts, portfolio, loans |
| 11 | `InspectorDrawer` on transactions, then accounts | Done |
| 12 | `FilterChip` + date-range picker | Done (see `DateRangePopover` note above) |
| 13 | Real skeletons, per route | Done — all ten routes |

## Planned: `ConsentBanner` (RAD-178 Task 6)

Not implemented as of this writing — defined here ahead of implementation.

**Purpose and structure.** A non-modal `aside`/region labelled by its
heading, mounted once in the locale root layout. Sits above the page edge
without an overlay or focus trap, so the page and signup CTA stay operable.
Content: concise purpose explanation, privacy-policy link, necessary-purpose
statement, equally understandable choices to use necessary only, customize,
or allow all, plus an always-reachable collapsed "Privacy choices" control
after a decision. Necessary storage is always active; analytics and ads are
separate purpose decisions, both off on first view; malformed/unknown consent
renders as denied; ads consent is never preselected. Copy is translated via
`next-intl` in `en`/`pt`/`es` — no hardcoded legal text.

**Variants and deterministic states**

| State | Visible behavior | Required controls / announcement |
| --- | --- | --- |
| `default` | Compact bottom surface with explanation; page stays interactive | Privacy link, "Use necessary only", "Customize", "Allow all" |
| `customize` | Expands within the same surface; never a blocking modal | Necessary row locked/explained; analytics + ads toggles off; "Save choices"; "Back" |
| `saved` | Confirms selected purposes, then collapses | Polite live status; focus returns to "Privacy choices" after collapse |
| `collapsed` | Small neutral "Privacy choices" control remains available | One 44px-minimum trigger restoring `customize` with current values |
| `failure` | Keeps surface and selections visible; explains save failed | Inline `role="alert"`, "Try again", all choice controls remain usable |

**Focus and keyboard order.** `default`: privacy link → "Use necessary only"
→ "Customize" → "Allow all". `customize`: "Back" → necessary explanation
(non-interactive) → analytics control → ads control → privacy link → "Save
choices". Opening `customize` moves focus to its heading; returning places
focus on "Customize"; saving announces the result and focuses the collapsed
trigger. Every target is ≥44px, has a visible ring, works with Enter/Space,
and follows DOM/visual order. Escape collapses back to default but never
silently records a choice.

**Non-coercion and navigation invariants.** "Use necessary only" and "Allow
all" have equivalent size, legibility, and proximity — neither hidden behind
customization, and violet is never used to make consent more permissive-looking
than refusal. No countdown, repeated animation, guilt copy, prechecked
optional purpose, or blocked scroll. Consent persistence, attribution-envelope
creation, analytics startup, and any network failure are independent of CTA
navigation — clicking signup/login always navigates immediately; the banner
never intercepts or delays that click. The banner may overlap only safe-area
padding, never the CTA.

**State harness for visual QA.** Use `/{locale}/auth/signup` (starting with
`/en/auth/signup`) since it renders a primary nav action and legal links
without an authenticated fixture. Add a development-only
`consentPreview=default|customize|saved|collapsed|failure` override when this
ships; production must ignore it. Capture every state at 375/768/1280px in
both themes; verify tab order, focus return, reduced motion, long `pt`/`es`
labels, safe-area spacing, no horizontal scroll, and real signup-link
navigation while consent is undecided and while persistence is failing.
