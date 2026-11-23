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
| Curated resource lists | `src/lib/resources/curatedLists/`, "Curated resource lists" below | Podcasts, newsletters, YouTube channels, books, courses, forums, events |
| Calculators and the tools hub | `src/lib/toolsCatalog.ts` | One entry per tool: its task group on `/tools` and its related tools |
| Brand logos | `src/lib/brandLogos/`, `src/assets/brands/<category>/`, `src/components/shared/BrandLogo.tsx` | A 72 px WebP tile per brand from its own site, an entry with the source URL in the category's module (`banks.ts`, `brokers.ts`); names match without case, accents or spaces |
| Charts | `src/components/shared/charts.tsx` | Recharts with series that draw at once; import chart parts from here, never from `recharts` |
| Calculator guides | `src/components/calculators/ToolGuide.astro`, `guideBlocks.ts` | The guide column and its blocks (term list, worked-example figures, formula block); `HouseholdBudgetGuide.astro` uses all three |
| Feature pages | `src/components/landing/Feature*.tsx`, `featureDetails.ts` | One per `FEATURE_ROUTE_IDS` entry. Explanatory sections use `sections/FeatureExplainer.tsx`; a new page is an entry in `featureDetails.ts` (rendered by `FeatureDetail.tsx`) with `lp.<namespace>.*` copy in all six locales, and every claim checked against the user docs and the app |
| Page composition | `src/components/pages/` | Shared across locales |
| Global document/SEO | `src/layouts/Layout.astro`, `src/components/shared/SEO.astro` | Canonical and alternate links |
| Social preview images | `src/lib/og/`, `src/pages/og/[...path].ts` | Generated at build time, "OpenGraph images" below |
| Structured data | `src/lib/structuredData.ts`, `src/lib/toolDatasets.ts` | Organization, WebSite, the tool pages' WebApplication, BreadcrumbList and Dataset; only what the page shows |
| Visual rules | `DESIGN.md` | Tokens shared with `apps/web/DESIGN.md` |
| Redirects | `vercel.json` | Host-scoped 301s for retired pages |
| Analytics and attribution | `src/lib/gtm.ts`, `posthog.ts`, `landingSource.ts`, `curatedListTracking.ts` | Every event is consent-gated; how tool and list pages are tied to signups and activations is in `docs/landing-attribution.md` at the repository root |

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

## OPENGRAPH IMAGES

Every tool page (and the FIRE calculator), the tools hub, every feature page and every learn guide
without an `ogImage` of its own gets a 1200×630 social preview image, drawn at build time and
served as a static file at `/og/<page path>.png` (`/og/en/tools/mortgage-calculator.png`). Other
pages share `public/og-default.png`.

- `src/lib/og/ogImages.ts` decides what each image shows (the section, the page's visible title,
  one line under it, the page's lucide icon from `toolsCatalog.ts` or `featureMenu.ts`) and its
  alt text; a new tool or feature page gets its image from the catalog with no other change.
- `src/lib/og/renderOgImage.ts` draws it with `@napi-rs/canvas` (Skia) and the site's own Geist
  files, so the text is the same on any build machine and needs no system fonts. The colours are
  DESIGN.md tokens as sRGB.
- `src/pages/og/[...path].ts` is the prerendered endpoint; a page links its image by passing
  `ogImage` and `ogImageAlt` to its layout. `pnpm build`'s `scripts/check-sitemap.mjs` fails when a
  page's `og:image` was not built or a JSON-LD block does not parse.
- About 400 images add about 6 seconds and 24 MB of static files to a build. Set
  `OG_SAMPLES_DIR=<folder>` when running `src/lib/og/renderOgImage.test.ts` to look at samples.

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

## CURATED RESOURCE LISTS

Lists of outside resources live in `src/lib/resources/curatedLists/`, one module per list
(`podcasts.ts`, `newsletters.ts`, `youtube.ts`, `books.ts`, `courses.ts`, `forums.ts`,
`events.ts`), typed by `types.ts` (one entry shape per format) and registered in `index.ts`. Each page is
`/{locale}/{resources slug}/{list slug}` (`/pt/recursos/podcasts-financas-pessoais`), served for
every list by one route file per locale tree, `src/pages/{locale}/{resources slug}/[list].astro`,
and drawn by `CuratedListPage.astro` from `buildCuratedListPage` (`page.ts`). The page copy is
under `curatedLists` in the catalogues; the entries' own lines are in the data modules.
WonderMoney researches and writes the entries, and the owner may strike any of them.

**Choosing entries.** Each locale has its own 5 to 8 entries per list, chosen for its market and
never translated from another locale: pt Portuguese-language and Portugal-relevant, en the UK,
Ireland and international English, es Spain, fr France and Belgium, de Germany, Austria and
Switzerland, it Italy. Every entry, in every list, is independent: never the sales channel of a
bank, broker, insurer, fund house or credit intermediary (regulators and central banks are
welcome), with no get-rich-quick, crypto promotion, day trading or paid signals, and nothing named
after a private person. Each list's own rules are its `criteria` (shown on its page, copy under
`curatedLists.common.criteria`), and they hold on the day the entry is checked, read on its own
site or feed, never a third party's claim:

- **podcasts, newsletters, YouTube**: published in the last six months (a podcast's RSS feed, a
  YouTube channel's `feeds/videos.xml?channel_id=…`, a newsletter's archive or feed), and free to
  follow (a free tier with paid extras is fine when the free issues stand alone);
- **forums**: a post in the last month, publicly joinable, written rules and active moderators
  (`moderation` says what we saw); Discord or Telegram only when publicly joinable and moderated;
  nothing centred on trading signals or crypto;
- **books**: an edition in the locale's language, native or translated, linked to its
  publisher's page for that edition, never a shop (`curatedLists.test.ts` rejects known
  retailers); no get-rich-quick titles;
- **courses**: open to follow or enrol in; free courses from public bodies (regulators, central
  banks, national plans, consumer associations, public universities' open courses) first, paid
  ones only from non-commercial providers with the `price` stated; no course funnels;
- **events**: organised by a national financial education plan, a central bank or regulator, a
  consumer association, a public library or a university, free to attend. See "Events" below.

**Each entry** records `name` (as published), `url` (its own site or channel page: https, no
query string, no affiliate or tracking code), `language`, `format`, `audience` ("who it's for")
and `value` ("what you'll get"), one line each that we write ourselves in the locale's form of
address (pt-PT "tu", de "Sie", fr "vous" with a no-break space before `: ; ? ! %` and `€`, es "tú" and it
"tu"), `related` (a calculator, the savings guide or a learn guide in that locale, only where one
genuinely fits; Portugal-specific calculators in the pt list only), `checked`, `lastPublished` and
`evidence` (the feed or archive where `lastPublished` was read), plus each format's own fields:
a forum's `platform` and `moderation`, a book's `author`, `publisher`, `year` and
`originalTitle`, a course's `provider`, `level`, `delivery`, `price` and `duration`, an event's
`organiser`, `starts`, `ends` and `where`, a programme's `organiser`, `when`, `lastHeld` and
`next`. The lines name no host, author or
other person beyond the show's own published name, and use no "best", rankings or audience sizes;
the page sorts entries alphabetically.

**Events.** The events list holds dated `event` entries and recurring `programme` entries (a
yearly financial literacy day, week or month; Global Money Week; World Investor Week). It needs at
least three programmes per locale (`CURATED_EVENTS_MIN_PROGRAMMES`), which never expire, and at
most 8 of each kind; dated events may be none. A programme must have held an edition in the last
13 months, or have its `next` dates announced. The page lists the dated events still to come by
start date, leaving out at build time those that ended, and hides in the browser any that end
after the build; when none is left it says so above the programmes. A dated event must still be
to come on the list's `reviewed` date. On 2026-11-20 none of the main organisers published a
machine-readable calendar of its public events: not Todos Contam, MaPS, the CNMV and the Plan de
Educación Financiera, the Banque de France, the Verbraucherzentralen or the Comitato EDUFIN (a
search form and a PDF export only). The feeds that exist are partial: DECO's agenda RSS (its next
ten events, mostly help desks), the Bank of England's events RSS, one Irish county library's
tag feed, an ICS per edition of the Banque de France's "Ensemble, dialoguons" on OpenAgenda, and
one Austrian fund's ICS. None is worth a refresh script in `landing-data-refresh.yml`, so the
list is reviewed by hand **every month** (`review: "monthly"`): drop the events that have
passed, add the newly announced ones from each organiser's agenda, set `next` on a programme once
its dates are out, then bump `reviewed`. The page warns 45 days after `reviewed`
(`CURATED_REVIEW_DAYS.monthly`).

**Exceptions to the minimum.** A list may hold fewer than five entries only when no other
candidate meets the criteria, and only with a named entry in `MIN_ENTRIES_EXCEPTIONS` in
`curatedLists.test.ts`; the test fails once a list is back to five, as a reminder to remove it.
Open on 2026-11-20:

- the Portuguese newsletters have 4: remove when Portefólio Perfeito launches its newsletter (it
  had only a waitlist then) or another qualifying newsletter turns up;
- the Portuguese forums have 4: the Literacia Financeira Discord could not be read without
  joining, and the other Portuguese communities were Brazilian, closed or commercial;
- the Italian forums have 4: the other Italian communities had no written rules, were off topic
  or blocked automated checks (FinanzaOnline, PensioniOggi);
- the Italian courses have 4: the Politecnico di Milano's free "Finanza per tutti" qualifies but
  has no address without a query string. The repository's leak check fails on some personal names:
when an entry trips it, drop the entry rather than allowlisting the name.

**Review cadence.** Re-check every entry of every list every six months from its `reviewed` date
(the current lists: by May 2027; the events list every month), against the rules above. Drop entries that no longer pass, add
replacements to keep 5 to 8, update each kept entry's `checked` and `lastPublished`, then bump
the list's `reviewed`. The page shows the review date, and 183 days after it (45 for events,
`CURATED_REVIEW_DAYS`) a note that the list is due for review, both at build time and in the
browser. `curatedLists.test.ts` checks the counts, the fields, the URLs, the activity windows,
the related links, the wording and the copy in every locale; run it after every edit.

**Adding a list**: add its route id and six slugs to
`ROUTE_SLUGS` and `CURATED_LIST_ROUTE_IDS` in `src/lib/routes.ts`, its format to `CuratedFormat`
and an entry shape (`types.ts`, with its lines in `buildCuratedListPage`, `page.ts`), a module
beside the others (copy the closest one) with its `formats`, `criteria`, `review` and an existing
Hairline figure, an entry in `CURATED_LISTS`, and its copy under `curatedLists.lists.<id>` plus
`curatedLists.common.formats.<format>` and any new `criteria` in all six catalogues
(`src/locales` and `public/locales` alike). The route files, the sitemap, hreflang, the language switcher and the resources hub card
follow from those; no new page file is needed.

## CALCULATOR DATA REFRESH

Dated data modules live in `src/lib/calculators/data/` (plus a few tables inside the calculator
modules). Each carries its own "as of" date, which the page shows. The open-API snapshots refresh
themselves: `.github/workflows/landing-data-refresh.yml` runs the market-data scripts on the 6th of
every month, the ERSE offers script every Monday, the OMIE prices script on the 8th and the PPR
funds script on the 10th (and any set by hand: Actions > Landing data refresh), and opens or
updates one pull request per set into `develop` when the figures changed, from
`bot/landing-data-refresh` (market data), `bot/landing-offers-refresh` (offers),
`bot/landing-omie-refresh` (OMIE) or `bot/landing-ppr-refresh` (PPR funds). The offers run also
checks the indexed-offer formulas against the new export (`indexedPricing.test.ts`).
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
| `data/omiePrices.ts` and `public/data/omie-pt-quarter-hours.json` | OMIE's Portuguese day-ahead prices (daily `marginalpdbcpt` files), weighted by the E-REDES BTN C profile, with the E-REDES and REN loss profiles: monthly averages by period for the last 12 months, and their quarter-hours (with the profile) for the load-diagram mode | monthly (the 8th), automated, its own set | `node scripts/build-omie-prices.mjs` (`--to YYYY-MM`, `--cache <dir>`) |
| `data/indexedFormulas.ts` | Each indexed offer's energy formula, from the supplier's own ficha, terms or tariff page (URL and date read per formula; never third-party simulators) | quarterly, and when the offers refresh shows an indexed supplier's documents or prices changed | Edit by hand, update each `readOn` and `INDEXED_FORMULAS_REVIEWED`, run `indexedPricing.test.ts` |
| `data/savingsCertificatesRate.ts` | IGCP's monthly notice "Taxas de Juro dos Certificados de Aforro ... em (month) de (year)": the Série F rate for new subscriptions, the calculator's default base rate. IGCP sets it on the third-to-last business day of a month for the next month, so the run on the 6th reads the current month's | monthly, automated | `node scripts/build-savings-certificates-rate.mjs` (after IGCP's notice, around the 26th, for the next month's rate) |
| `data/sp500History.ts` | Damodaran `histretSP.xls` and Shiller `ie_data.xls`, downloaded by hand | each January, after the year-end data is out | `node scripts/build-sp500-history.mjs <histretSP.xls> <date> <ie_data.xls> <date>` |
| `calculators/portugalCpi.ts` | BPstat series 12704686 (INE annual CPI); no script yet | each year once INE publishes the full year (February to March) | Edit by hand: the URL and steps are in the file's header comment |
| `data/erseTariffs.ts` | ERSE tariff documents (diretivas, price simulator) | quarterly: check in the first week of January, April, July and October | Edit by hand, bump `version`, update the "downloaded on" date |
| `data/electricityProfiles.ts` | E-REDES BTN consumption profiles A, B and C (`Perfil_Consumo_Injeção_E-REDES_<year>.xlsx`, published each December) | each January, for the new year | `node scripts/build-electricity-profiles.mjs --url <new year's xlsx>` (or `--from-file`) |
| `data/solarProduction/` (`index.ts` and a JSON file per district) | PVGIS 5.3 API (EU JRC): for each district capital, the optimal tilt (`PVcalc`), the TMY's selected months (`tmy`) and those years' hourly PV output (`seriescalc`), PVGIS-SARAH3. The API has no CORS, so the page cannot call it; any other tilt, orientation or point goes through `/api/solar-production` ("Server routes") | when PVGIS publishes a new version or extends its database (the version is in the API path) | `node scripts/build-solar-production.mjs --cache-dir <dir>` (about 200 calls; `--offline` rebuilds from the cache) |
| `calculators/electricityCycles.ts` | ERSE period hours (Despacho n.º 26 126-A/2004, ciclo diário 2009, Diretiva n.º 3/2026) | when ERSE changes the periods; BTN meters move to the Diretiva n.º 3/2026 hours in the second half of 2027 | Edit by hand against the official table and rerun the profiles script |
| `data/brokerFees.ts` | Each broker's own price list (preçário, fee page or PDF), linked per row in `sources` | quarterly: check in the first week of January, April, July and October; the page warns after about four months | Edit by hand, update each row's `checked` and `BROKER_FEES_REVIEWED`, run `brokerFees.test.ts` |
| `data/pprFunds.ts` | CMVM Portal do Investidor, "Lista de PPR sob a forma de Fundos de Investimento": the screen services its page calls (every share class's returns, TEC and risk class), its "Exportar em Excel" file (the managers) and its IFI links. Types in `calculators/pprTypes.ts` | monthly (the 10th), automated, its own set (ppr) | `node scripts/build-ppr-products.mjs` |
| `data/pprInsurance.ts` | ASF "Plataforma de comparação de PPR" (Norma Regulamentar n.º 11/2024-R): its JSON lists of the products on sale, `https://www.asf.com.pt/o/servicosasf/get-list-ppr/1/0/<type>` (1 insurance not linked to funds, 2 linked to funds, 3 pension funds). The site's bot check answers browsers only, so the lists are saved by hand | yearly, in May (insurers report by 15 April for the year before), and when a product launch matters; the page warns from June of the second year after the figures' year | Open the three URLs in a browser, save them as `asf-1.json`, `asf-2.json` and `asf-3.json` in an empty folder, then `node scripts/build-ppr-products.mjs --asf-dir <folder>` and run the PPR tests |
| `data/pprTaxRules.ts` | Portal das Finanças consolidated EBF (art. 21.º) and CIRS (art. 78.º, n.º 7), Diário da República consolidated Decreto-Lei n.º 158/2002 (arts. 4.º and 6.º) | each January, and when a State Budget or a change to those laws is published | Edit by hand, update `PPR_TAX_RULES_REVIEWED`, run `pprComparison.test.ts` |
| IMT and stamp duty (`purchaseTaxes.ts`), IMI (`propertyTax.ts`), IUC (`vehicleTax.ts`), IRS withholding and Social Security (`payroll.ts`), IAS and benefits (`unemploymentBenefit.ts`, `statePension.ts`, `sickPay.ts`) | Portal das Finanças, Diário da República, Segurança Social | each January, and again when the State Budget or a Portaria changes them | Edit by hand against the official table, update the module's year and review date, run the calculator's tests |

When the data changes a number a page quotes in prose, update the pages in all six locales in the
same pull request.

## SERVER ROUTES

Localized pages are prerendered; `src/pages/api/` holds the server endpoints
(`export const prerender = false`), which run in the site's Vercel function.

- `GET /api/solar-production` (`src/pages/api/solar-production.ts`): a typical year of PV
  production from PVGIS (EU JRC) for any tilt, orientation and point in mainland Portugal,
  Madeira or the Azores, for the solar section of the electricity comparator. The contract
  (query, limits, rounding, coverage boxes, response) is in
  `src/lib/calculators/solarProductionQuery.ts`, the handler in `solarProductionApi.ts`, and the
  typical-year method in `solarPvgis.ts`, shared with `scripts/build-solar-production.mjs`.
  Inputs are rounded (coordinates to 0.05°, tilt and azimuth to 1°, losses to 1 %) and any other
  spelling of a query is redirected to the canonical one, so the CDN keeps one cached copy per
  rounded query (`s-maxage` 30 days); errors are `no-store`. It keeps no store and never logs
  coordinates. When it fails, the page falls back to the nearest district's committed table.
- **Rate limiting** is not in the code. The rounding and the CDN cache bound how often PVGIS is
  called. If the route needs a limit, add a Vercel Firewall rate-limit rule on the path
  `/api/solar-production` in the Vercel dashboard (the landing project: Firewall > Rules); it is
  configured there, not in this repository.

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
