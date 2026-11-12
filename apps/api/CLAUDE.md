# WonderMoney API

Express 5 + TypeScript (ESM, strict) + MikroORM 7 on PostgreSQL, with a pg-boss worker
(`src/worker.ts`) built from the same code. Auth is better-auth, embedded in-process. Free and
self-hostable: no billing, plans or paywall. `README.md` covers setup (`pnpm bootstrap`) and
the everyday commands; `package.json` is the full script list.

Node 26 LTS from the root `.nvmrc`, the same major as the api and worker images. pnpm from
the repository root: `pnpm install && pnpm build:lib` first, since the API imports
`@wondermoney/shared` and `@wondermoney/react-email` from their built `dist/`.

## Database safety: read before any DB command

**`.env` decides which database you touch.** Every `migrate:*` and `seed:*` script connects to
whatever `DB_HOST`/`DB_PORT`/`DB_DATABASE` resolve to (process env first, then the *last*
assignment in `.env`), regardless of the `dev`/`prd` in its name. A `.env` can hold a block
for a remote database, and a port forward to one looks like `localhost`. The local compose
Postgres is on **5434**, so it is never confused with a forwarded `5432`. Run
`grep -E '^DB_' .env` and confirm the target before anything that writes.

- `scripts/assert-local-db.mjs` guards the scripts: `*:fresh` refuses any non-local host;
  `migrate:dev` / `seed:dev` need `ALLOW_REMOTE_DB=1` for one. A port-forward passes as
  local, so the guard is a seatbelt, not proof the target is disposable.
- **`migrate:dev:fresh` / `migrate:prd:fresh` drop the whole database.** Run them only on a
  throwaway local or CI database, and only with the human's explicit approval for that run.
  Move a real database forward with `pnpm migrate:dev` (apply pending, non-destructive); try a
  new migration on a scratch database.
- `pnpm migrate:prd:pending` lists what would run, read-only. Run it first.

### Migrations

- **Migrations are DDL only** (CREATE, ALTER, DROP). Data, including reference data, belongs
  in `src/database/seeders/`. Shipped migrations are immutable.
- **Baseline.** `Migration20261025000000` creates the whole schema; it replaced the original
  chain of 128 migrations. `src/migrate.ts` runs it on an empty database and only *records* it
  on one that ran the whole original chain (the hosted staging and production databases). A
  self-hosted 1.0.0 database ran the chain only up to `Migration20261004120000`: `migrate.ts`
  replays the two later chain migrations (`CHAIN_AFTER_1_0_0`) on it, then records the baseline.
  It refuses any other database part-way through that chain. Apply migrations through the `migrate:*`
  scripts, never a bare `mikro-orm migration:up`, which knows nothing about that rule.
- **Snapshot.** `src/database/migrations/.snapshot-wmdb.json` is what `migrate:dev:create` and
  `migrate:dev:check` diff the entities against; the apply scripts never write it. Commit it
  with every entity change: a hand-written migration still needs `migrate:dev:create` run once
  (discard the generated file) so the snapshot moves. CI applies the chain to an empty Postgres
  and fails on snapshot drift.
- The api image runs `node dist/migrate.js` before it starts; the worker image only warns
  about pending migrations. `migrate:prd` runs the compiled `dist/database/migrations`: after
  switching branches, `rm -rf dist/database/migrations && pnpm ts:migrations` so a stale
  compiled migration cannot run.
- For a constraint-changing or destructive migration on a database you care about, take a
  backup and apply it ahead of the code deploy.

## Testing philosophy

**A test must be able to fail for a reason a user would care about.** If the only way to make
it fail is to refactor (rename a symbol, reorder routes, reformat a migration, change copy, add
a queue option), it is not a test; delete it. So, never write:

1. Tests that read source, migration, config or `package.json` text off disk. Encode the
   invariant in a lint rule or a type. `no-restricted-imports` bans `fs` in `**/*.test.ts`
   (`eslint.config.ts`), with a short `FS_IN_TESTS_ALLOWLIST` for genuine fixtures.
2. Tests over applied migrations: verify once on a scratch database, then delete the test.
3. Tests over one-off backfill or ops scripts: delete the finished script with its test;
   promote a reusable one into a supported module with behavioural tests.
4. Tests that assert "X is still deleted"; the diff and the type-checker own that.
5. Tests of module structure (`router.stack`, enum values, decorator metadata, import graphs).
   For route order, mount the router with `supertest` and assert which handler answered
   (`routes/v1/__tests__/route-order.test.ts`).
6. Tests that are mostly `toHaveBeenCalledWith(<literal copied from the implementation>)`.
   Assert the outcome: a returned value, a persisted row, an HTTP response. Assert a genuine
   cross-cutting contract once, table-driven (`jobs/__tests__/enqueue-singleton-key.test.ts`).
7. Tests that pin exact customer-facing copy, prices or word counts; assert the shape.

**TDD is mandatory** for money and balance calculations, tenancy and account-privacy scoping,
auth/CSRF/rate limiting, webhook idempotency and replay, concurrency and data integrity.
Elsewhere it is optional.

**One behaviour, one layer.** Test scoping where the query is built and arithmetic where it
lives, not again at route, controller and service. **Names** say what the system does; ticket
numbers belong in commit messages. **Tests never touch the network or `.env`:**
`vitest.setup.ts` mocks `dotenv` to a no-op and makes `globalThis.fetch` throw; stub it
explicitly (`vi.stubGlobal('fetch', vi.fn())`).

Coverage thresholds in `vitest.config.ts` are enforced in CI (`pnpm test:coverage`).

## Code conventions

- **Path aliases, never cross-layer relative imports:** `@app/*` → `src/*`, `@entity/*` →
  `src/database/entity/*`, `@controller/*`, `@route/*` (`src/routes/v1/*`), `@service/*`,
  `@utils/*`, `@validators/*`, `@middleware/*`, `@config/*` (see `tsconfig.json`).
- Controllers are exported async functions, never classes; validate the request envelope with
  a Zod schema and `zParse(schema, req)`. Routers are default exports; static paths go before
  parameter paths.
- Entities extend `Base` (`createdAt`/`updatedAt`/`deletedAt`; deletes are soft) and name
  keys `entityNameKey` (`appuserKey`, `tenantKey`). Use `DI.em` inside the request context;
  every route runs in a MikroORM `RequestContext`.
- Throw the typed errors from `@utils/errors` (`BadRequestError`, `NotFoundError`,
  `FeatureDisabledError` → 501 `feature_disabled`, ...); the global handler logs them, sends
  them to Sentry and emits `Retry-After` when an error carries `retryAfter`.
- Log with Pino: `logger.info({ context }, 'message')`.
- `package.json#exports` points at the server process, not a side-effect-free library entry.
- Database and worker rules: `src/database/AGENTS.md`, `src/jobs/AGENTS.md`.

## Auth, users and tenancy

- **better-auth** is mounted at `/api/auth` (before `express.json()`), with its tables in the
  `better_auth` schema and the twoFactor/jwt/bearer/passkey plugins. `getAuthSession()` reads the
  session cookie or `Authorization: Bearer` and sets `req.authUser`. MFA is implicit: no full
  session exists until 2FA completes; a passkey sign-in (user verification required) counts as
  both factors. better-auth tables have no MikroORM entities: change them with hand-written DDL
  migrations that leave `.snapshot-wmdb.json` alone. Middleware: `requireAuth`, `optionalAuth`,
  `requireBearerAuth` (the auth callback); `adminAuth`/`serviceAuth` are API-key auth.
- `getUser` sets **`req.user`** (the `Appuser`); `resolveTenantForRequest` sets **`req.tenant`**
  and arms the tenant filter. Keep the two distinct. Authed data routes use the `authedTenant`
  stack (`middleware/stacks.ts`): `requireAuth → getUser → resolveTenantForRequest →
  assertTenantResolved → blockDemoMutation`.
- **A tenant is a household**: an owner plus at most one partner (`AppuserTenant.role`
  `owner`/`member`), sharing accounts, transactions, budgets, categories, goals and portfolios.
- **Tenant filter** (`database/filters/tenant-filter.ts`): a global default-deny MikroORM
  filter. With no tenant context set (workers, invite provisioning) it is a deliberate system
  bypass. `assertTenantResolved` throws when `req.user` is set but `req.tenant` is not.
- **Privacy**: `Account.isPrivate` hides an account, its transactions, its `RecurringSeries`
  and every aggregate from the other member. Raw SQL, Kysely and QueryBuilder paths (account
  metrics, cashflow, budget spending, portfolio) bypass the ORM filter, so they carry explicit
  tenant and privacy predicates. Any new raw query needs both.
- **Invites**: `HouseholdInvite` is a 7-day single-use token, and a pending one holds the seat.
  Joining is for new signups only (the auth callback consumes `inviteToken` and skips creating
  a tenant). `GET /v1/household/invites/validate` is public. Leaving deactivates the
  membership and soft-deletes the member's bank connections; the owner cannot be removed.
- Verify scripts in `database/scripts/`: `verify-tenant-filter.ts`, `verify-household-invite.ts`,
  `e2e-household-flow.sh`.
- `blockDemoMutation` keeps the demo account read-only; demo is recognised by
  `Appuser.accountType` / `tenantType === DEMO`.
- **Rate limits** are named families in `middleware/rate-limit.ts`. An auth or credential family
  is never `relaxable` and is keyed on IP only. `TRUST_PROXY` sets Express `trust proxy`;
  `configureClientIp` copies the resolved `req.ip` into `x-wondermoney-client-ip`, the header
  better-auth's limiter reads, so both limiters key on the same address. Behind one proxy, set
  `TRUST_PROXY=1`.

## Integrations

Every integration is optional and fails closed: unconfigured, its feature reports as disabled
(`GET /v1/instance`, HTTP 501 `feature_disabled`) instead of failing at boot.

- **Bank sync: Enable Banking, bring-your-own-key.** Each user supplies their own Enable
  Banking application credential. There is no sandbox bank; testing the connect flow needs a
  real credential. Legacy `nordigen*` names (`NordigenRequisition`,
  `Account.nordigenRequisitionKey`, `Transaction.nordigenInternalTransactionId`, the
  `DELETE /v1/banking/requisition/:requisitionId` route) are from the removed GoCardless
  integration. They stay: the unique constraint on `nordigenInternalTransactionId` deduplicates
  every transaction ingested before Enable Banking, and web and mobile use the route and DTO
  field.
- **Synced transaction types.** A credit syncs as `DEPOSIT`, a debit as `PAYMENT`.
  `services/transaction/transfer-matching.service.ts` then pairs opposite rows on two accounts
  of one tenant (same amount and currency, at most 3 days apart, unique closest match) as
  `TRANSFER_OUT`/`TRANSFER_IN`. Across currencies it converts the outgoing amount at the stored
  rate for its day (no rate, no pair) and accepts it within `TRANSFER_MATCH_FX_TOLERANCE`
  (default 0.02), only between accounts the same members can see. A user-set type is never
  overwritten; the file header has the full rule.
- **Market data: EODHD** (`EODHD_API_KEY`, read by the API and the worker's price jobs).
  `services/market-data/eodhd.service.ts` builds the client lazily and maps every failure
  through `handleEodhdError`: 404 → 404, `rate_limit` → 429 with the provider's `retryAfter`
  (default 60 s), `auth_error` → 500 (our credential; it should alert), or 502 when the status is
  403 (plan entitlement), `timeout` → 504, network/server/parse → 502, `client_error` → 400.
  The upstream message never reaches the client. Routes (`routes/v1/financial-markets.ts`) are
  wrapped by the per-identity `marketData` limiter and an in-memory, per-process `apicache`
  that stores only 2xx responses; watchlist routes are uncached. A failed call with no cached
  entry fails loud; nothing serves stale data.
- **AI** (`services/ai/ai-provider.ts`): per feature (assistant, CSV mapping, enrichment,
  monthly story, OCR), Azure when `AZURE_OPENAI_*` (or `AZURE_AI_FOUNDRY_*` for enrichment) is
  complete, else Anthropic when `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are set, else any
  OpenAI-compatible endpoint via `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` and
  `AI_MODEL_<FEATURE>`, else disabled. A half-configured provider counts as absent. The assistant
  streams through `services/ai/ai-model.ts`; every other feature calls `completeJson` in
  `services/ai/complete-json.ts` (`generateObject`).
- **Email** (`services/email/email-transport.ts`): Resend when `RESEND_API_KEY` is set, SMTP
  when `SMTP_HOST` is, otherwise the log driver writes the whole message, links included, to
  the log. `EMAIL_DRIVER` overrides; `EMAIL_FROM`/`EMAIL_FROM_NAME` set the sender (`RESEND_FROM_*`
  are deprecated fallbacks; don't document them). Templates come from `@wondermoney/react-email`. Sends run as
  pg-boss jobs.
- **File storage** (`services/storage/s3.ts`): AWS S3 or any S3-compatible store (`S3_ENDPOINT`,
  `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`).
- Sentry and PostHog are optional too. Analytics outbox rows are written and delivered only
  with `ANALYTICS_OUTBOX_MODE=live` (`isAnalyticsOutboxEnabled`); the worker purges undelivered
  rows older than 30 days.

## Deploys

The api and worker images are the `api` and `worker` targets of `Dockerfile` in this
directory; `.github/workflows/publish-images.yml` publishes them for self-hosters.
Maintainers deploy the hosted instance separately; its URLs, hosts, backups and environment
scopes are not part of this repository, so keep them out of code, docs and fixtures.
