# WonderMoney API

The backend of [WonderMoney](https://wonder.money), a free, open-source personal finance
app: accounts and transactions, bank sync, budgets, goals, loans, households and
investment portfolios. Express 5, TypeScript and MikroORM on PostgreSQL, with a pg-boss
background worker running from the same codebase.

**Running your own instance?** See [`deploy/selfhost`](deploy/selfhost/README.md): one
Docker Compose file with Postgres, the API, the worker and the web app.

This README is for working on the code.

## Requirements

- Node 26 (the repository's `.nvmrc`; the images run Node 26 too) and pnpm
- Docker, for the local Postgres

## Quick start

From the repository root, `pnpm install` and `pnpm build:lib` first (the API imports the two
workspace packages). Then, in `apps/api`:

```bash
pnpm bootstrap     # writes a local .env, starts Postgres, migrates, seeds
pnpm dev          # API on http://localhost:3001
pnpm worker:dev   # background worker (optional for most work)
```

`pnpm bootstrap` (`scripts/bootstrap.mjs`) is idempotent and never overwrites an existing
`.env`. It copies `.env.sample`, whose `DB_*` block matches the `postgres` service in
`docker-compose.yml` (published on port 5434), then runs `docker compose up -d postgres`,
`pnpm migrate:dev` and `pnpm seed:dev`.

Everything else in `.env` is optional. AI, market data, file storage, email and Sentry
are each switched off when not configured, and the features that need them are hidden
(`GET /v1/instance` reports which are on).

The seeders create three accounts you can sign in with: an admin, a demo account with
generated data and an empty one. Their passwords come from `SEED_ADMIN_PASSWORD`,
`SEED_DEMO_PASSWORD` and `SEED_EMPTY_PASSWORD`, with a fixed development default.

## `.env` decides which database you touch

Every `migrate:*` and `seed:*` script connects to whatever `DB_HOST` / `DB_PORT` /
`DB_DATABASE` resolve to, **regardless of the `dev` or `prd` in the script name**.

1. **Keep `.env` local, with exactly one `DB_*` block.** dotenv keeps the *last*
   assignment, so a second block pasted at the bottom silently wins.
2. **`migrate:dev:fresh` / `migrate:prd:fresh` DROP the whole database.** They refuse to
   run unless `DB_HOST` is local (`scripts/assert-local-db.mjs`). To move a real
   database forward, use the non-destructive `pnpm migrate:dev`.

## Commands

```bash
pnpm dev / pnpm worker:dev   # watch mode
pnpm debug                   # API with --inspect
pnpm build && pnpm start     # production build; `pnpm worker` for the worker

pnpm test                    # vitest
pnpm test:coverage           # thresholds are enforced
pnpm type-check              # typecheck
pnpm lint / pnpm lint:fix    # eslint
pnpm knip                    # unused files, exports and dependencies

pnpm migrate:dev:create      # scaffold a migration
pnpm migrate:dev             # apply pending migrations (non-destructive)
pnpm migrate:prd:pending     # list pending migrations (read-only)
pnpm seed:dev
```

Docker Compose runs the same stack in watch mode: `docker compose up --build`.

A husky `pre-commit` hook runs `eslint --fix` on staged files.

## Conventions

- **Migrations are schema only.** Never insert, update or delete data in a migration;
  data belongs in `src/database/seeders/`. Shipped migrations are immutable. The API
  applies pending migrations on start, and on an empty database it also loads the
  reference data.
- **Tenancy.** A tenant is a household (an owner plus at most one partner). A global
  MikroORM filter scopes reads to the request's tenant, and private accounts are hidden
  from the other member. Raw SQL paths carry explicit tenant and privacy predicates.
- **Optional integrations** fail closed: a missing provider makes its feature report as
  disabled (HTTP 501, `feature_disabled`), never a crash at boot.
- **Tests** must be able to fail for a reason a user would care about: assert outcomes,
  not call traces or source text. Tests never touch the network or your `.env`.
- Controllers are plain async functions, routers export default, imports use the path
  aliases in `tsconfig.json` (`@service/*`, `@entity/*`, …).

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the workflow.

## Layout

```
src/
├── app.ts, server.ts, worker.ts, migrate.ts
├── config/          # env parsing and validation (zod)
├── controller/      # request handlers
├── routes/v1/       # Express routers
├── middleware/      # auth, tenancy, rate limits
├── services/        # domain modules: account, ai, auth, bank-sync, budget, email, …
├── jobs/            # pg-boss workers and schedules
└── database/        # entities, repositories, migrations, seeders, filters
```

## License

[AGPL-3.0](LICENSE). If you run a modified version as a service for others, you must
offer them its source.
