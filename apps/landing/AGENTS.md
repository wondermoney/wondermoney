# MARKETING SITE KNOWLEDGE BASE

## OVERVIEW

Astro 7 marketing site (wonder.money) with React 19 islands, Tailwind 4, learn content as
Markdown in the repository, and application/API seams. Node 26 (root `.nvmrc`) and pnpm from the repository
root; `pnpm dev:landing` at the root starts it. It has six locale-prefixed route trees
(`pt`, `en`, `es`, `fr`, `de`, `it`), with `pt` as the default locale. Deployed through
Vercel's Git integration as SSR output (`@astrojs/vercel`); localized pages are largely
prerendered.

## STRUCTURE

```text
src/pages/             # Root redirect and mirrored locale route files
src/components/pages/  # Shared page archetypes/composition
src/components/shared/ # Layout, SEO, structured data
src/lib/               # Locale, routes, static paths, content collection readers
src/content/           # Learn content (Markdown per locale) and local content modules
src/locales/           # Translation catalogues (mirrored in public/locales/)
scripts/               # Offer and claims alignment checks, and the data-snapshot refresh scripts
public/                # Static assets
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Route parity | `src/pages/`, "Localized routes" below | Thin locale wrappers |
| Localized URLs | `src/lib/routes.ts` | Typed localized slug map |
| Static content expansion | `src/lib/pageStaticPaths.ts` | Top-level, feature, tool and ad pages |
| Learn content | `src/content/`, "Learn content" below | Guides, glossary terms, monthly items; read through `src/lib/contentCollections.ts` |
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
- Analytics IDs in `src/lib/gtm.ts` and `src/lib/posthog.ts` are public client keys. Secrets
  stay in Vercel environment variables, never in code.

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

## LEARN CONTENT

Guides (`/learn/<slug>`), glossary terms (`/glossary/<slug>`) and monthly items
(`/learn/monthly/<slug>`) are Markdown files, one per document and locale:
`src/content/<guides|glossary|monthly>/<locale>/<slug>.md`. The directory is the locale and the
file name is the URL slug. The frontmatter schemas, with a comment on each field, are in
`src/content/schemas.ts`; the Markdown body is the guide's text, the term's explanation or the
monthly item's commentary.

- To add a document, copy a sibling in the same collection and locale, then rename it to the
  new slug (lowercase words and hyphens). A monthly item also needs `title`, `year` and `month`;
  none exist yet, so the build warns that the `monthly` collection is empty until the first one.
- A slug is a route and a canonical URL: keep it once published, even when it lacks accents
  (`patrimonio-liquido`). Correct the title instead.
- `relatedTerms` and `relatedGuide` hold slugs in the same locale; the build fails on one with no
  file.
- `relatedCalculator` (a term) and `relatedCalculators` (a guide, at most three; the page shows
  two) name tools by a key from `LEGACY_TOOL_ROUTE_ID_BY_KEY` in `src/lib/routes.ts` (such as
  `debt-to-income-calculator`), the tool's slug in the document's locale or its route id; `fire`
  names the FIRE calculator. The build fails on a name that resolves to no tool, rather than
  linking the tools hub. Use a key in both en and pt: the parity check compares the values.
- en and pt hold the same guides and terms (matched by category and calculators), so add each
  document in both. es, fr, de and it have none and show the hubs' "coming soon" state.
- `topicKey` pairs the translations of one document for hreflang alternates; no document sets it
  yet.
- `src/content/content.test.ts` validates every file, its path, its references and the en/pt
  parity; run it after editing content.

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
| `data/fuelStations/` (`index.ts` and a JSON file per district) | DGEG station prices, the cheapest per district and municipality | daily in production builds; fallback refreshed monthly, automated | `node scripts/build-fuel-stations.mjs` |
| `data/goldPrice.ts` | NBP gold price per gram, converted with the ECB euro reference rate | daily in production builds; fallback refreshed monthly, automated | `node scripts/build-gold-price.mjs` |
| `data/sp500History.ts` | Damodaran `histretSP.xls` and Shiller `ie_data.xls`, downloaded by hand | each January, after the year-end data is out | `node scripts/build-sp500-history.mjs <histretSP.xls> <date> <ie_data.xls> <date>` |
| `calculators/portugalCpi.ts` | BPstat series 12704686 (INE annual CPI); no script yet | each year once INE publishes the full year (February to March) | Edit by hand: the URL and steps are in the file's header comment |
| `data/erseTariffs.ts` | ERSE tariff documents (diretivas, price simulator) | quarterly: check in the first week of January, April, July and October | Edit by hand, bump `version`, update the "downloaded on" date |
| `data/electricityProfiles.ts` | E-REDES BTN consumption profiles A, B and C (`Perfil_Consumo_Injeção_E-REDES_<year>.xlsx`, published each December) | each January, for the new year | `node scripts/build-electricity-profiles.mjs --url <new year's xlsx>` (or `--from-file`) |
| `data/solarProduction/` (`index.ts` and a JSON file per district) | PVGIS 5.3 API (EU JRC): for each district capital, the optimal tilt (`PVcalc`), the TMY's selected months (`tmy`) and those years' hourly PV output (`seriescalc`), PVGIS-SARAH3. The API has no CORS, so the page cannot call it | when PVGIS publishes a new version or extends its database (the version is in the API path) | `node scripts/build-solar-production.mjs --cache-dir <dir>` (about 200 calls; `--offline` rebuilds from the cache) |
| `calculators/electricityCycles.ts` | ERSE period hours (Despacho n.º 26 126-A/2004, ciclo diário 2009, Diretiva n.º 3/2026) | when ERSE changes the periods; BTN meters move to the Diretiva n.º 3/2026 hours in the second half of 2027 | Edit by hand against the official table and rerun the profiles script |
| `data/brokerFees.ts` | Each broker's own price list (preçário, fee page or PDF), linked per row in `sources` | quarterly: check in the first week of January, April, July and October; the page warns after about four months | Edit by hand, update each row's `checked` and `BROKER_FEES_REVIEWED`, run `brokerFees.test.ts` |
| IMT and stamp duty (`purchaseTaxes.ts`), IMI (`propertyTax.ts`), IUC (`vehicleTax.ts`), IRS withholding and Social Security (`payroll.ts`), IAS and benefits (`unemploymentBenefit.ts`, `statePension.ts`, `sickPay.ts`) | Portal das Finanças, Diário da República, Segurança Social | each January, and again when the State Budget or a Portaria changes them | Edit by hand against the official table, update the module's year and review date, run the calculator's tests |

When the data changes a number a page quotes in prose, update the pages in all six locales in the
same pull request.

## DAILY DATA

The cheapest fuel stations (fuel prices page) and the gold price page show data that changes every
day. Production deploys only from `main`, so instead of committing data daily the production build
fetches it:

- `pnpm build` runs `scripts/build-daily-snapshots.mjs` before `astro build`. In a production build
  (`VERCEL_ENV=production`) it runs the two refresh scripts above, one request per source, with the
  site's own User-Agent. Each validates the whole response and replaces its committed files only
  when every check passed. A source that fails or fails a check leaves its committed snapshot in
  place, with a warning in the build log; the build carries on and the page shows that snapshot's
  older date, and after two days (five for gold) a notice that the data is old. The step never
  fails the build.
- Preview, CI and local builds use the committed snapshots and call nothing.
  `LANDING_DAILY_SNAPSHOTS=1` fetches in any build, `=0` never; `LANDING_SNAPSHOT_FETCH_FAIL=1`
  makes every fetch fail, to see the fallback.
- `.github/workflows/landing-daily-deploy.yml` calls a Vercel deploy hook at 05:23 UTC every day,
  which rebuilds production from the commit `main` already has. `vercel.json` passes
  `--always-build-production` to the ignored-build-step script so that rebuild is not skipped.
- The committed snapshots are the fallback; the monthly data refresh keeps them recent.
- Committed station snapshots hold no station names and no street addresses (`redacted: true`):
  many stations are sole traders named after their owner, and many streets are named after people.
  Only a Vercel build (`VERCEL=1`), whose files are never committed, writes them; the page shows
  the brand and locality ("GALP · Colmeias") when the name is missing. `fuelStations.test.ts` fails
  if a committed file carries either.

**One-time setup (a maintainer, in Vercel and GitHub).** Until it is done the workflow logs a
notice and does nothing, and the pages show the committed snapshots.

1. In the Vercel project of the landing site: Settings > Git > Deploy Hooks. Create a hook named
   `daily-data` for the branch `main`, and copy its URL.
2. In GitHub: Settings > Secrets and variables > Actions > New repository secret, named
   `LANDING_DEPLOY_HOOK_URL`, with that URL. Anyone with the URL can trigger a deploy, so keep it
   in the secret only; revoke the hook in Vercel and create a new one if it leaks.
3. Run Actions > Landing daily deploy by hand once, and check that Vercel builds a production
   deployment (not "Ignored") whose log shows `Daily snapshots: refreshed`.

## ANTI-PATTERNS

- Never add a page to one locale tree only.
- Never duplicate route/content fetching logic across six wrappers.
- Never copy full page markup into locale wrappers or translate slugs outside the typed route table.
- Never add a guide or glossary term to en or pt alone: the other needs its translation.
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
