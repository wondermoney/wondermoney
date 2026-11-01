# Database scripts

Operator and developer tools that run against a database outside the request path. Run every
command from `apps/api`. They connect to whatever `DB_*` resolves to (see "`.env` /
environment targeting" in `apps/api/CLAUDE.md`), so check the target before running anything
that writes.

| Script | What it does | How to run | Writes? |
|---|---|---|---|
| `reset-demo-data.ts` (+ `reset-demo-data.helpers.ts`) | Upserts the demo household's accounts, budget, loans and portfolios from the seeder fixtures in `seeders/demo/`. Refuses to run while demo imports or background operations are pending. | `pnpm demo:reset:dev` (source) or `pnpm demo:reset` (built `dist`, `NODE_ENV=production`) | Yes |
| `refresh-demo-data.ts` | Adds the demo household's bank and portfolio transactions up to a date (default today), refreshes its budget and recomputes balances, so the demo stays current. Flags: `--dry-run`, `--as-of-date YYYY-MM-DD`. | `pnpm demo:refresh:dev [-- --dry-run]` or `pnpm demo:refresh` | Yes, unless `--dry-run` |
| `setup-test-user.ts` | Creates a new better-auth user (`test-dev-<timestamp>@wonder.money`, password `TestPassword123!`) with an account, transactions, a budget, goals and a portfolio with snapshots. Needs seeded reference data. | `pnpm setup:test` | Yes |
| `verify-tenant-filter.ts` | Checks tenant isolation, account privacy and the system bypass of the tenant filter. Seeds its own rows with raw SQL. Use a disposable, migrated, unseeded database. | `NODE_ENV=development NODE_OPTIONS='--import=tsx' node src/database/scripts/verify-tenant-filter.ts` | Yes (disposable DB only) |
| `verify-household-invite.ts` | Runs the household invite lifecycle through the services: create, seat cap, validate, consume, remove, owner teardown. Use a disposable, migrated, unseeded database. | `NODE_ENV=development SHOULD_INTERCEPT_EMAILS=true NODE_OPTIONS='--import=tsx' node src/database/scripts/verify-household-invite.ts` | Yes (disposable DB only) |
| `e2e-household-flow.sh` (+ `e2e-household-flow.auth.ts`) | Drives the household flow over HTTP against a running API: owner signup, invite, public validation, partner join, shared tenant, per-account privacy. Creates two users and removes them on exit. Needs `psql`, `curl` and `python3`. | `API_URL=http://localhost:3001 ENV_FILE=./.env PGHOST=… PGUSER=… PGPASSWORD=… PGDATABASE=… bash src/database/scripts/e2e-household-flow.sh` | Yes (cleans up after itself) |
| `export-categoriser-eval-sample.ts` | Exports a random sample of enriched transactions per confidence bucket, plus the system categories, to a new JSON file for blind labelling. | `NODE_ENV=<env> NODE_OPTIONS='--import=tsx' node src/database/scripts/export-categoriser-eval-sample.ts --output-path /abs/path/sample.json [--per-bucket 30]` | No (writes only the output file) |
| `categoriser-eval-page.html` | Standalone page for labelling the exported sample without seeing the model's pick. Exports `labels.json`. | Open the file in a browser and load the sample JSON | No |
| `score-categoriser-eval.ts` | Scores the labels against the sample into a precision-by-confidence-bucket table. | `node --import=tsx src/database/scripts/score-categoriser-eval.ts --sample-path <sample.json> --labels-path <labels.json>` | No |
| `repair-enable-banking-statuses.ts` | One-off repair of Enable Banking transaction statuses. Still pending on production; delete it, with `services/transaction/enable-banking-status-repair.service.ts`, once it has run. | `NODE_ENV=<env> NODE_OPTIONS='--import=tsx' node src/database/scripts/repair-enable-banking-statuses.ts [--apply] [--days=90]` | Only with `--apply` |

A script that exists only to repair or backfill data is deleted, together with its tests and
any module only it uses, once it has run on every environment. Add a row here for any new
script that stays.
