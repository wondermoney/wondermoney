# WonderMoney Mobile — Design History & Working Notes

`DESIGN.md` is now Impeccable's canonical design-system format and is the
file to read for current rules. This file preserves the port's accepted-debt
log, removed-copy rationale, and other institutional history that has no slot
in that schema. Nothing here is normative; where this file and `DESIGN.md`
disagree, `DESIGN.md` wins. Companion to `../web/DESIGN_HISTORY.md`.

Two CI guards still run against the live code, independent of this file's
format: `src/theme/__tests__/design-system-sync.test.ts` (OKLCH→hex
conversion, contrast floors, chart hue-lock — reads `tokens.ts` directly, not
any markdown) and `src/theme/__tests__/design-drift.test.ts` (greps `src/`
for reintroduced anti-patterns: ad-hoc font sizes, uppercase labels, sign-based
coloring, raw pixel spacing, deprecated palette aliases, etc.). Neither was
touched by the `DESIGN.md` rewrite — both were already independent of the
document's structure.

## Source for the Card Nesting, Spacing Scale, and Hierarchy Cap rules

See `../web/DESIGN_HISTORY.md`'s section of the same name — the research and its sourcing are shared across both platforms, added 2026-08-27 after a live audit found the shipped app (both platforms) had drifted from the documented Stripe/Linear register. Short version: neither Stripe nor Linear publishes an official numeric design spec, so these rules are grounded in credible teardowns and the Refactoring UI proximity/hierarchy discipline, not verbatim internal docs — treat the numbers as well-reasoned defaults, not citations.

## Known Cross-Platform Gaps (found 2026-08-27 audit)

See `../web/DESIGN_HISTORY.md`'s table of the same name for the full list, resolutions, and screenshots' worth of detail (a live side-by-side audit, `web/` at 390px viewport, `mobile/` on an iOS Simulator, fresh test accounts on both). All were fixed the same day. The gaps specific to this repo's own screens:

- **Accounts screen showed the same account in two sections without clear separation** — a stat row under "By currency" (Insights: period inflow/outflow) and a full bordered card lower down (the accounts list: current balance). Corrected 2026-08-27 after reading `accounts-screen.tsx`: not a duplicate-rendering bug, both sections are intentional and show different numbers. **Fixed** by adding a "Balances" heading (`accounts.balances`, all 3 locales) above the accounts list — verified by an added assertion in `accounts-screen.test.tsx`; the on-device simulator check was inconclusive due to a stale Metro bundle, not a code issue.
- **Accounts screen stacked 3+ independently-bordered elements** at the top (two action buttons, a third full-width button, three filter chips) — a direct violation of the No-Nesting rule. **Fixed**: `SegmentedControl` now draws one shared track border instead of a border per segment (`src/components/ui/segmented-control.tsx`, also fixes portfolio-performance-chart and asset-price-chart); "View transactions" and "Recurring bills and subscriptions" switched to the `ghost` button variant.
- **Budgets screen showed only an aggregate** (Remaining/Planned/Spent) where web shows categories directly with progress bars. **Product decision (2026-08-27): converge on web's shape.** `BudgetCard` in `budgets-screen.tsx` now renders each `budget.categories` entry with its own progress bar on the list screen — the data was already computed, just not rendered there.
- For contrast: this repo's **Home screen** was the one screen the audit found genuinely clean — plain dividered rows, no box-stacking — proof the problem was inconsistency, not a uniformly bad mobile implementation.

## Full audit follow-through (2026-08-27)

See `../web/DESIGN_HISTORY.md`'s section of the same name for the full sweep and web-side fixes. This repo's own findings and fixes:

- **`PreviewLabel` component** (`src/components/ui/preview-label.tsx`) replaces 5 separate implementations across Accounts, Budgets, Goals, Portfolio, and Portfolio detail that had drifted into 4 different treatments (three type-role variants plus one filled-chip pill on the Portfolio empty state). All shared one translation key (`common.preview`) already — pure visual consolidation.
- **Portfolio empty-state nesting** — the outer "No portfolios available" card had a redundantly-bordered inner "Total value preview" box, same shape as web's equivalent screen. Dropped the inner border, kept the background-step (`palette.muted`) it already had. Verified via a Jest assertion (`portfolio-screens.test.tsx`) rather than the simulator, which was serving a stale bundle through several relaunches during this session.

**Loans empty-state — resolved 2026-08-27.** `loans-screen.tsx` gained a `LoanPreview` matching web's sample content (Mortgage / Bank / Active, Outstanding principal, Remaining term) — this screen previously showed a bare "No loans" message with no preview at all, unlike every other empty state in the app. New translation keys (`previewSubtitle`, `previewProvider`, `previewTermValue`, `remainingTerm`) added across `en`/`pt-PT`/`es`, reusing the existing `type.MORTGAGE`/`status.ACTIVE`/`outstanding` keys rather than duplicating them.

**Deferred, needs its own dedicated pass:** Reports information architecture (this repo's Reports is a menu of 6 report types; web shows all 6 inline) — see `../web/DESIGN_HISTORY.md` for the full framing and why it was explicitly deferred rather than squeezed into this session.

## Copy removed during the compaction pass, and why

Cut for a stated reason each, not for length:

| Copy | Where | Why it went |
| --- | --- | --- |
| "opens in the app" ×13 | More | The default expectation, identical on every row, doubled each row's height. Kept in the accessibility label (a screen-reader user has no chevron) and kept visible on the two rows that genuinely leave the app. |
| "Legal documents, support, and app information" | More | Described a screen that is mostly Budgets, Loans, Profile and Reports. Wrong as well as redundant. |
| "Search for a ticker by name or symbol" | Markets | Sat directly under a field whose placeholder read "Search by name or symbol". |
| "Based on balances currently available in EUR" | Home | Restated the € already printed on every figure below it. |
| "Read-only balances currently available…" | Accounts | Rendered twice on the same screen. |
| "The completeness of this estimate is unknown" | Home | The view model's else-branch — fired on every ordinary load and hedged a figure that was fine. The `partial` variant stays: that one is the honest qualifier the data-surface rules ask for. |
| "Recorded activity for the selected server period" | Accounts → Insights | A sentence explaining a section that names itself. |
| Three separate "No X for this period" lines | Accounts → Insights | Three ways of saying one thing. Now one. |
| `€24,680.50 EUR` | Portfolio, ×7 sites | `Intl` already emits the symbol; the ISO code was appended on top. `Amount` mutes the unit, it does not double it. |

## Data the API shouts

Several endpoints return raw keys rather than display names — `HOUSING`,
`RENT_MORTGAGE`, `CAFE_RESTAURANTS_BARS`, `BUY`, `DEPOSIT` — while other
endpoints return the same values in sentence case. One budget screen managed
both at once: shouted parents above sentence-case children.

`lib/formatters/category-name` normalizes at the **view model** wherever one
exists, so the row, its accessibility label, and any confirmation dialog
agree. It replaces underscores, sentence-cases all-caps words, leaves short
ones alone so `TV`, `ETF`, and `IVA` survive, and knows that `AND`/`OF` are
joining words rather than acronyms. **It is not applied to user-supplied
text** — portfolio and account names are whatever the person typed;
normalizing those would be rewriting their data.

## Percentages that cannot be computed

Two reports printed `(0%)` when the prior period was zero — telling the
reader "unchanged" beside a figure saying otherwise. A percentage change from
a zero baseline is undefined, so the view models return `null` and the
screens say there is nothing to compare, in muted ink rather than a direction
color. This diverges from web deliberately (see `DESIGN.md`'s Named
Divergences): the net-worth view model's own comment already noted
"percent-of-zero is undefined, not 'no change'" before returning 0 to mirror
web. The delta calculation keeps its zero baseline correctly either way —
only the percentage differs.

## Accepted debt

Recorded rather than quietly carried.

| Location | Debt | Exit condition |
| --- | --- | --- |
| Default category color | `#2563EB` in `category-manage-screen.tsx` — an arbitrary blue not in the palette. | It's a *data* default: changing it changes what gets persisted for new categories. Worth changing to `chart5`, deliberately, as its own task. |
| Google brand marks | `#4285F4` / `#EA4335` / `#FBBC05` / `#34A853` in `social-sign-in-buttons.tsx`. | Not debt. Google's brand guidelines require exact values; tokenizing them would be wrong. |
| Category colors | User-chosen hex, stored server-side, rendered as-is. | Not debt — user data. The ink on top is chosen by luminance at render, from the two halves' `foreground` values. |
| App lock | Needs enrolled biometrics, so it can't be exercised on a simulator. | Reviewed from source only. Verify on a device before trusting it. |
| Asset pricing on staging | Portfolio value reads €0.00 with a real holding. | Not a UI fault — staging has no quote for the instrument. |

## Density contract — before/after, with reasoning

Measured on a booted simulator at 402pt, then re-measured after each change;
values live in `themeTokens.layout`.

| Property | Was | Now | Why |
| --- | --- | --- | --- |
| Screen padding | 24 | 16 | 39 screens spent a fifth of the width on air. |
| Gap between blocks | 24 / 20 | 16 | 41 screens. |
| Section gap | mixed | 12 | — |
| List row | 64–104 | 52 | The web reference sits at ~52. |
| Data card padding | 16–24 | 12 | 24 stays for a genuinely standalone unit. |
| Meter bar | 6–10 | 4 | Nine screens, five different values — a meter is a supporting reading, not the headline. |
| Segmented chip | 48 drawn | 34 drawn / 48 to the finger | `hitSlop` makes up the difference; guarded by a test. |

**On the reclaimed space.** The Home screen's title moved from y=158 to y=78
and the screen went from overflowing to fitting whole; More went from 7
visible rows to 11. None of that came from shrinking type — it came from
deleting a wordmark, a repeated hint, three card borders, and 8pt of padding
per row.

**Everything spaces from the scale.** Four screens once declared `padding:
24` as a bare number, and every token-based sweep of the density pass walked
straight past them, so they kept the old spacing while the rest of the app
tightened. That class of drift is now guarded by `design-drift.test.ts`.
