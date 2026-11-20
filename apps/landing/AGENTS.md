# MARKETING SITE KNOWLEDGE BASE

## OVERVIEW

Astro 7 marketing site (wonder.money) with React 19 islands, Tailwind 4, Sanity-backed
content, and application/API seams. Node 26 (root `.nvmrc`) and pnpm from the repository
root; `pnpm dev:landing` at the root starts it. It has six locale-prefixed route trees
(`pt`, `en`, `es`, `fr`, `de`, `it`), with `pt` as the default locale. Deployed through
Vercel's Git integration as SSR output (`@astrojs/vercel`); localized pages are largely
prerendered.

## STRUCTURE

```text
src/pages/             # Root redirect and mirrored locale route files
src/components/pages/  # Shared page archetypes/composition
src/components/shared/ # Layout, SEO, structured data
src/lib/               # Locale, routes, static paths, Sanity queries
src/content/           # Local content/config
src/locales/           # Translation catalogues (mirrored in public/locales/)
scripts/               # Offer and claims alignment checks, and the data-snapshot refresh scripts
public/                # Static assets
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Route parity | `src/pages/`, "Localized routes" below | Thin locale wrappers |
| Localized URLs | `src/lib/routes.ts` | Typed localized slug map |
| Static content expansion | `src/lib/pageStaticPaths.ts` | Guides, glossary, tools, monthly pages |
| Calculators and the tools hub | `src/lib/toolsCatalog.ts` | One entry per tool: its task group on `/tools` and its related tools |
| Page composition | `src/components/pages/` | Shared across locales |
| Global document/SEO | `src/layouts/Layout.astro`, `src/components/shared/SEO.astro` | Canonical and alternate links |
| Visual rules | `DESIGN.md` | Tokens shared with `apps/web/DESIGN.md` |
| Redirects | `vercel.json` | Host-scoped 301s for retired pages |

## CONVENTIONS

- Keep localization structural and typed: locale values and route maps use literal types/`satisfies`.
- Locale page files remain thin; shared behavior belongs in route/static-path helpers or page archetypes.
- Hydrate React islands only when interaction requires it; prefer Astro/server-rendered markup otherwise.
- Preserve canonical URLs, hreflang alternates, structured data, and localized slugs together.
- Public claims and the offer are guarded: `src/lib/claimsAlignment.test.ts` and
  `scripts/check-offer-alignment.mjs` (both run by `pnpm test`) fail on unsupported product
  claims or a stale offer in any locale.
- Follow nearby formatting: the site has no formatter (no Prettier config or format script, as in
  `apps/docs` and `apps/mobile`), and existing Astro/TS style is mixed. Do not reformat files you
  are not otherwise changing.
- `pt` copy is European Portuguese and addresses the reader as **tu** ("Começa grátis", "as tuas
  contas"), never "você" or the formal third person (`CONTRIBUTING.md` has the rule and examples).
- Analytics IDs in `src/lib/gtm.ts` and `src/lib/posthog.ts` are public client keys, and
  the Sanity project id in `astro.config.mjs` is public too. Secrets stay in Vercel environment
  variables, never in code.

## LOCALIZED ROUTES

Localized Astro route files mirror the six locale trees, plus the root redirect to `/pt`.

```text
src/pages/{locale}/index.astro
src/pages/{locale}/features/[feature].astro
src/pages/{locale}/tools/[tool].astro
src/pages/{locale}/learn/[slug].astro
src/pages/{locale}/glossary/[slug].astro
src/pages/{locale}/...        # Same route surface in every locale
src/pages/index.astro         # Root redirect only
```

- Locale wrappers select locale and shared page archetype; keep content lookup and business logic out of route files.
- Static/dynamic path expansion belongs in `src/lib/pageStaticPaths.ts`; localized slug definitions belong in `src/lib/routes.ts`.
- Localized routes normally export `prerender = true`; preserve intentional exceptions explicitly.
- Add/remove/rename a route across all six locale trees and update route-symmetry tests in the same change.
- Preserve the `/` to `/pt` redirect unless the default-locale policy changes deliberately.
- The standalone pages (`STANDALONE_PAGE_ROUTE_IDS` in `src/lib/routes.ts`) each have one route
  file per locale, named by that locale's slug. Their Portuguese-slug addresses in the other
  locales are 301s in `vercel.json`; `src/lib/routes.test.ts` fails on a second copy or a missing
  redirect.
- Paid-traffic landing pages under `/{locale}/go/` are `noindex,follow` and kept out of the sitemap.
- Older slugs of top-level, feature and tool pages live in `src/lib/legacySlugs.ts`. Astro config
  generates Vercel HTTP 301 redirects from those maps. `pnpm build` checks each rule in
  Vercel output and verifies that the sitemap lists its destination only.
- Verify generated URLs for all six locales, not only the default route.

## CALCULATOR DATA REFRESH

Dated data modules live in `src/lib/calculators/data/` (plus a few tables inside the calculator
modules). Each carries its own "as of" date, which the page shows. The open-API snapshots refresh
themselves: `.github/workflows/landing-data-refresh.yml` runs the market-data scripts on the 6th of
every month and the ERSE offers script every Monday (and either set by hand: Actions > Landing
data refresh), and opens or updates one pull request per set into `develop` when the figures
changed, from `bot/landing-data-refresh` (market data) or `bot/landing-offers-refresh` (offers).
Those pull requests get no CI run (they are opened with `GITHUB_TOKEN`): close and reopen them
before merging. A script that fails fails the job and leaves the data as it was. Everything else
is refreshed by hand, on the calendar below. Run the commands from `apps/landing`.

| Module | Source | Cadence | Refresh |
|---|---|---|---|
| `data/euribor.ts` | BPstat, Euribor monthly averages | monthly, automated | `node scripts/build-euribor.mjs` |
| `data/depositRates.ts` | ECB MIR deposit rates | monthly, automated | `node scripts/build-deposit-rates.mjs` |
| `data/electricityPrices.ts` | Eurostat `nrg_pc_204` | half-yearly (new half-year around Oct and Apr), automated monthly | `node scripts/build-electricity-prices.mjs` |
| `data/fuelPrices.ts` | DGEG daily national average prices (weekly samples) | weekly prices; refreshed monthly, automated | `node scripts/build-fuel-prices.mjs` |
| `data/electricityOffers.ts` | ERSE price simulator export (`csvPath` in its `Settings.json`): every supplier's household electricity offer. Types in `calculators/electricityOfferTypes.ts`; loaded only with a dynamic `import()` | weekly, automated (Mondays) | `node scripts/build-electricity-offers.mjs` (`--from-file <zip>` for a saved export) |
| `data/sp500History.ts` | Damodaran `histretSP.xls` and Shiller `ie_data.xls`, downloaded by hand | each January, after the year-end data is out | `node scripts/build-sp500-history.mjs <histretSP.xls> <date> <ie_data.xls> <date>` |
| `calculators/portugalCpi.ts` | BPstat series 12704686 (INE annual CPI); no script yet | each year once INE publishes the full year (February to March) | Edit by hand: the URL and steps are in the file's header comment |
| `data/erseTariffs.ts` | ERSE tariff documents (diretivas, price simulator) | quarterly: check in the first week of January, April, July and October | Edit by hand, bump `version`, update the "downloaded on" date |
| `data/electricityProfiles.ts` | E-REDES BTN consumption profiles A, B and C (`Perfil_Consumo_Injeção_E-REDES_<year>.xlsx`, published each December) | each January, for the new year | `node scripts/build-electricity-profiles.mjs --url <new year's xlsx>` (or `--from-file`) |
| `calculators/electricityCycles.ts` | ERSE period hours (Despacho n.º 26 126-A/2004, ciclo diário 2009, Diretiva n.º 3/2026) | when ERSE changes the periods; BTN meters move to the Diretiva n.º 3/2026 hours in the second half of 2027 | Edit by hand against the official table and rerun the profiles script |
| IMT and stamp duty (`purchaseTaxes.ts`), IMI (`propertyTax.ts`), IUC (`vehicleTax.ts`), IRS withholding and Social Security (`payroll.ts`), IAS and benefits (`unemploymentBenefit.ts`, `statePension.ts`, `sickPay.ts`) | Portal das Finanças, Diário da República, Segurança Social | each January, and again when the State Budget or a Portaria changes them | Edit by hand against the official table, update the module's year and review date, run the calculator's tests |

When the data changes a number a page quotes in prose, update the pages in all six locales in the
same pull request.

## ANTI-PATTERNS

- Never add a page to one locale tree only.
- Never duplicate route/content fetching logic across six wrappers.
- Never copy full page markup into locale wrappers or translate slugs outside the typed route table.
- Never silently omit missing Sanity content for one locale without an explicit fallback policy.
- Never assume `output: server` means localized pages are runtime-only; they explicitly prerender.
- Never put Markdown or other non-route files under `src/pages/`: Astro publishes them as pages.

## COMMANDS

```bash
pnpm dev
pnpm type-check   # astro check
pnpm lint         # ESLint, read-only; pnpm lint:fix applies fixes
pnpm test         # Vitest plus the offer alignment check
pnpm build
```

CI runs type-check, lint, test and build with the rest of the workspace.
