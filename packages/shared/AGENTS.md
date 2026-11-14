# @wondermoney/shared

Code shared by the API, the web app and the mobile app: the EODHD market-data client, bank and
broker CSV parsers, transaction file importers (OFX, QIF, CAMT.053, YNAB, Actual, generic CSV),
locale rule presets and a few small helpers. A private workspace package; `README.md` lists what
it exports.

## Two ways in

- **The API imports the built `dist/`** through the package root (`@wondermoney/shared`). After
  changing anything under `lib/` or `index.ts`, run `pnpm build:lib` (here or at the repository
  root) before running or testing the API.
- **Web and mobile import source**, and only through the subpath entries in `package.json`
  `exports` (`/decimal`, `/amount-expression`, `/bank-sync`, `/crypto-wallet`,
  `/dashboard-layout`, `/name-match`). Those entries run in a browser and in React Native, so
  they must stay dependency-free: no Node built-ins, no `big.js`, `csv-parse`, `xlsx` or
  `eodhd`, and no import from the rest of `lib/`. A new client entry needs its own line in
  `exports`.

## Layout

- `index.ts`, `lib/index.ts`: the root entry the API uses.
- `lib/csv/`, `lib/import/`: statement parsers and transaction file importers.
- `lib/rule-presets/`: reviewed `wondermoney-rules` files per country.
  `apps/docs/scripts/rule-presets.mjs` writes them into the Rules docs page, and the docs lint
  fails when that page is stale: after changing a preset, run
  `pnpm --filter @wondermoney/docs rule-presets`.
- `lib/services/eodhd/`: the EODHD client. It has no cache; the API caches responses.
- `tests/`: vitest suites and fixtures.

## Commands

```bash
pnpm test         # vitest
pnpm lint
pnpm type-check
pnpm build:lib    # dist/ for the API
```

## Conventions

- Test fixtures hold invented data only: no real statement, name, IBAN or address (the root
  `CLAUDE.md`, "Branches", and the leak check in `CONTRIBUTING.md`).
- Nothing here reads environment variables or touches the network except the EODHD client,
  which takes its key from the caller.
