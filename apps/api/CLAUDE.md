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

Coverage thresholds in `vitest.config.ts` are enforced in CI (`pnpm test:coverage`). Locally,
run the files you touch, then `pnpm verify:changed` from the repository root before pushing (the
root `CLAUDE.md`, "Verifying a change"); CI runs the whole suite.

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
  `better_auth` schema and the twoFactor/jwt/bearer/passkey plugins, plus generic OAuth for
  single sign-on when `OIDC_*` is set (`services/auth/oidc.ts`: provider `oidc`, allowed and admin
  groups, `OIDC_ONLY`; the admin claim is kept as `user.oidcAdmin` and mirrored onto
  `Appuser.accountType`). `getAuthSession()` reads the
  session cookie or `Authorization: Bearer` and sets `req.authUser`. MFA is implicit: no full
  session exists until 2FA completes; a passkey sign-in (user verification required) counts as
  both factors. better-auth tables have no MikroORM entities: change them with hand-written DDL
  migrations that leave `.snapshot-wmdb.json` alone. Middleware: `requireAuth`, `optionalAuth`,
  `requireBearerAuth` (the auth callback); `adminAuth`/`serviceAuth` are API-key auth.
- `getUser` sets **`req.user`** (the `Appuser`); `resolveTenantForRequest` sets **`req.tenant`**
  and `req.householdRole`, and arms the tenant filter. Keep the two distinct. Authed data routes
  use the `authedTenant` stack (`middleware/stacks.ts`): `requireAuth → getUser →
  resolveTenantForRequest → assertTenantResolved → blockDemoMutation → blockViewerWrite`.
- **A tenant is a household** of up to `HOUSEHOLD_MAX_MEMBERS` people (default 6; pending invites
  hold a seat), sharing accounts, transactions, budgets, categories, goals and portfolios.
  `AppuserTenant.role` is `owner` (exactly one, `Tenant.ownerAppuserKey`), `admin`, `member` or
  `viewer`. `householdCan(role, action)` (`services/household/household-permissions.ts`) is the
  one rule: a manager (owner, admin) acts on and grants only roles below their own; only the
  owner transfers ownership (`POST /v1/household/transfer-ownership`). A viewer's writes answer
  403 `household_read_only` except the personal ones in `VIEWER_PERSONAL_WRITES`
  (`middleware/household.ts`); `household-viewer-policy.test.ts` walks every mounted route.
- **Tenant filter** (`database/filters/tenant-filter.ts`): a global default-deny MikroORM
  filter. With no tenant context set (workers, invite provisioning) it is a deliberate system
  bypass. `assertTenantResolved` throws when `req.user` is set but `req.tenant` is not.
- **Privacy and sharing** (`services/account/account-access.ts` holds the rule): a shared account
  (`isPrivate = false`) is seen and changed by every member; a private one by its owner and the
  members with an `AccountShare` (`read` or `write`), and by nobody else, in any list, detail or
  aggregate (a 404, never a 403). A viewer reads only. The tenant filter applies it through
  `visibleAccountCond`; raw SQL, Kysely and QueryBuilder paths (account metrics, cashflow, budget
  spending, portfolio, exports) bypass the filter, so they carry explicit tenant predicates and
  `visibleAccountSql`. Any new raw query needs both. Writes to an account's data go through
  `assertAccountWritable` (403 `account_read_only`), or the `requireWritableAccount` /
  `requireWritableTransaction` route guards; `account-write-guard.http.test.ts` walks every write
  route and `hidden-account-aggregates.http.test.ts` every aggregate. Shares are changed by the
  account owner or the household owner (`PUT /v1/account/:accountId/shares`); a removed member's
  shares stay, and nobody else gains access to their private accounts.
- **Member attribution** (`services/household/member-attribution.ts`) is who money belongs to for
  reporting, never who sees it: a transaction's own "Spent by" (`attributedAppuserKey`,
  `attributedToShared`), else its account's owner, or Shared on a joint account (`isJoint`) or
  for someone who left. The `memberKeys` filter (`TransactionScope.members`) only narrows rows
  the visibility rule already allows.
- **Ownership shares** (`services/household/account-ownership.ts`, `AccountOwnership`) split an
  account between members in basis points, for per-member net worth only (`?member=`); spending
  reports keep member attribution. No rows: attribution stands (owner, or Shared when joint).
  Rows add up to 10000 (checked by the service and a deferred trigger) and replace the joint
  switch for net worth; a former member's share counts as Shared until they rejoin. Parts are
  split by largest remainder (`Money.allocate`), so members plus Shared equal the household total.
  Changed by the account owner or the household owner (`PUT /v1/account/:accountId/ownership`),
  only for active members who can see the account.
- **Invites**: `HouseholdInvite` is a 7-day single-use token carrying the role to join with; a
  pending one holds a seat. The seat count and the write run under the tenant row lock
  (`lockTenant`). A new signup joins through the auth callback's `inviteToken`; an existing,
  signed-in user joins only by confirming (`POST /v1/household/invites/:token/accept`), and
  only from a household holding no accounts or transactions (nothing is merged). Signing in
  never moves anyone: `provisionHomeTenant` keeps an active membership, else restores the
  user's own household, else creates one. `GET /v1/household/invites/validate` is public.
  Leaving or removal deactivates the membership and soft-deletes the member's bank
  connections; a removed member's sessions and push devices end too. The owner cannot leave.
- Verify scripts in `database/scripts/`: `verify-tenant-filter.ts`, `verify-household-invite.ts`,
  `e2e-household-flow.sh`.
- `blockDemoMutation` keeps the demo account read-only; demo is recognised by
  `Appuser.accountType` / `tenantType === DEMO`. `blockDemoAuthAccountChanges` does the same on
  better-auth's own `/api/auth` routes. `POST /v1/auth/demo` (`DEMO_SIGN_IN_ENABLED`, off by
  default) signs in the one demo account without a password after the checks in
  `services/auth/demo-sign-in.service.ts`; every demo session ends two hours after it starts
  (`services/auth/demo-session.ts`). `pnpm demo:seed` creates the account on a real database.
- **Rate limits** are named families in `middleware/rate-limit.ts`. An auth or credential family
  is never `relaxable` and is keyed on IP only. `TRUST_PROXY` sets Express `trust proxy`;
  `configureClientIp` copies the resolved `req.ip` into `x-wondermoney-client-ip`, the header
  better-auth's limiter reads, so both limiters key on the same address. Behind one proxy, set
  `TRUST_PROXY=1`.

## Integrations

Every integration is optional and fails closed: unconfigured, its feature reports as disabled
(`GET /v1/instance`, HTTP 501 `feature_disabled`) instead of failing at boot.

- **Bank sync: Enable Banking, bring-your-own-key.** Each user supplies their own Enable
  Banking application credential, unless the operator sets an instance-wide one
  (`ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY_FILE`; the rule is in
  `services/enable-banking/instance-credential-policy.ts`). A user's own credential always wins;
  without `ENABLE_BANKING_PRODUCTION_CONTRACT` the instance one serves a single household
  (Restricted Production mode). A connection keeps the credential it was made with
  (`EnableBankingConnection.enableBankingCredentialKey`, null for the instance one). There is no
  sandbox bank; testing the connect flow needs a real credential. Legacy `nordigen*` names (`NordigenRequisition`,
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
- **Market data** goes through one registry (`services/market-data/registry.ts`) over the ordered
  `MARKET_DATA_PROVIDERS` (default `eodhd`; `stooq` and `coingecko` are opt-in for operators). It
  falls through per capability and per symbol, and stored prices record their `source`.
  **EODHD** (`EODHD_API_KEY`, read by the API and the worker's price jobs):
  `services/market-data/eodhd.service.ts` builds the client lazily and maps every failure
  through `handleEodhdError`: 404 → 404, `rate_limit` → 429 with the provider's `retryAfter`
  (default 60 s), `auth_error` → 500 (our credential; it should alert), or 502 when the status is
  403 (plan entitlement), `timeout` → 504, network/server/parse → 502, `client_error` → 400.
  The upstream message never reaches the client. Routes (`routes/v1/financial-markets.ts`) are
  wrapped by the per-identity `marketData` limiter and an in-memory, per-process `apicache`
  that stores only 2xx responses; watchlist routes are uncached. A failed call with no cached
  entry fails loud; nothing serves stale data.
- **AI** (`services/ai/ai-provider.ts`): per feature (assistant, CSV mapping, enrichment,
  monthly story, OCR, PDF statement import), Azure when `AZURE_OPENAI_*` (or `AZURE_AI_FOUNDRY_*` for enrichment) is
  complete, else Anthropic when `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are set, else any
  OpenAI-compatible endpoint via `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` and
  `AI_MODEL_<FEATURE>`, else disabled. A half-configured provider counts as absent. PDF statement import sends page
  images, so it needs a model named for it (`AI_MODEL_STATEMENT_IMPORT`) on an OpenAI-compatible
  endpoint. The assistant
  streams through `services/ai/ai-model.ts`; every other feature calls `completeJson` in
  `services/ai/complete-json.ts` (`generateObject`).
- **Email** (`services/email/email-transport.ts`): Resend when `RESEND_API_KEY` is set, SMTP
  when `SMTP_HOST` is, otherwise the log driver writes the whole message, links included, to
  the log. `EMAIL_DRIVER` overrides; `EMAIL_FROM`/`EMAIL_FROM_NAME` set the sender (`RESEND_FROM_*`
  are deprecated fallbacks; don't document them). Templates come from `@wondermoney/react-email`. Sends run as
  pg-boss jobs.
- **Mobile push** (`services/push`): off unless `PUSH_ENABLED=true`; sends through the Expo push
  service over HTTP (`expo-push-client.ts`, optional `EXPO_ACCESS_TOKEN`) from the `push-send`
  queue, which also reads Expo's receipts and disables tokens reported as `DeviceNotRegistered`.
  A `PushDevice` belongs to the better-auth session it registered with and ends with it. Push
  categories are separate `push*` switches on `EmailNotificationPreference`, all off by default.
  Notification text never carries an amount or a merchant (`push-messages.ts`).
- **File storage** (`services/storage/s3.ts`): AWS S3 or any S3-compatible store (`S3_ENDPOINT`,
  `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`).
- **Merchant logos** (`services/transaction/merchant-logo.ts`): off unless
  `MERCHANT_LOGO_URL_TEMPLATE` (an https URL with `{domain}`) is set; then the API fetches the
  logo for a merchant's website domain itself and serves it from
  `GET /v1/account/transaction-merchants/:merchantId/logo`, so the provider never sees a viewer.
  A household's own `logoUrl` wins and is loaded by the clients directly. Unset, nothing is
  fetched and no logo URL is built.
- Sentry and PostHog are optional too. Analytics outbox rows are written and delivered only
  with `ANALYTICS_OUTBOX_MODE=live` (`isAnalyticsOutboxEnabled`); the worker purges undelivered
  rows older than 30 days.

## Deploys

The api and worker images are the `api` and `worker` targets of `Dockerfile` in this
directory; `.github/workflows/publish-images.yml` publishes them for self-hosters.
Maintainers deploy the hosted instance separately; its URLs, hosts, backups and environment
scopes are not part of this repository, so keep them out of code, docs and fixtures.
