# Worktree E2E setup

This worktree path is intended to make browser E2E runs deterministic.

## Recommended setup

Use Node 26 and pnpm. Keep web/API dependencies in this worktree; do not link
`node_modules` to another checkout. Resolve Next and Cypress from this worktree
and ensure the Cypress binary is installed before starting. Run setup and E2E
commands with the web package as their working directory (or use `pnpm --dir`):

```bash
WT="$(git rev-parse --show-toplevel)"
pnpm --dir "$WT/apps/web" e2e:worktree:preflight
```

The headless script starts Webpack with React devtools disabled. Do not run the
Next CLI from the monorepo root: it can resolve the wrong app root. For this
lane, reserve web port 3100, API port 3101 and worker health port 3102. Port
3000 may belong to another checkout; do not stop or reuse an unknown listener.
Set the API's `APP_URL` to the browser origin so Better Auth trusts it:
`APP_URL=http://localhost:3100`. Configure the API `PORT=3101` and worker
`WORKER_HEALTH_PORT=3102` in their local process environments.

```bash
WT="$(git rev-parse --show-toplevel)"
E2E_WEB_PORT=3100 \
E2E_API_BASE_URL=http://localhost:3101 \
E2E_PORTFOLIO_IMPORT_ENABLED=1 \
E2E_PORTFOLIO_IMPORT_EMAIL='local-test@example.invalid' \
E2E_PORTFOLIO_IMPORT_PASSWORD='local-test-password' \
NEXT_PUBLIC_API_URL=http://localhost:3101 \
pnpm --dir "$WT/apps/web" e2e:headless
```

If Cypress's binary is absent, install it for the existing worktree package
before the run with `pnpm --dir "$WT/apps/web" exec cypress install`. Do not
add project dependencies for the E2E lane.

## API and worker

- API should be running on `http://localhost:3101`; set `APP_URL` to
  `http://localhost:3100` for Better Auth's trusted browser origin.
- In API and worker terminals, load the approved private local-test environment
  (disposable DB, auth, and test-account settings), then use the exact worktree
  preload path below. The API runs on 3101; the worker health endpoint is 3102.

  ```bash
  WT="$(git rev-parse --show-toplevel)"
  APP_URL=http://localhost:3100 PORT=3101 \
    AWS_ACCESS_KEY_ID=S3RVER AWS_SECRET_ACCESS_KEY=S3RVER \
    NODE_OPTIONS="--import=$WT/apps/web/scripts/portfolio-import-e2e-provider.mjs" \
    pnpm --dir "$WT/apps/api" dev
  ```

  In the worker terminal, use the same private environment and preload with
  `WORKER_HEALTH_PORT=3102 pnpm --dir "$WT/apps/api" worker:dev`. Do not pass
  this preload to the web server, Cypress, or their launcher. It guards its
  disposable DB target and stubs only the public EODHD search boundary; other
  EODHD provider methods are blocked. Use only dummy test credentials and do
  not infer live provider compatibility from this fixture.
- On a freshly migrated database, start the worker once with `PGBOSS_MIGRATE=true`
  so pg-boss creates its schema; without it the worker exits with
  `pg-boss is not installed`.

## reCAPTCHA

- Set the non-production reCAPTCHA bypass env required by your lane before running E2E automation.
- Production must remain fail-closed.

## Portfolio import specs

The DEGIRO, complete synthetic IBKR, and original partial IBKR scenarios create
a local test user, create/delete portfolios, upload broker files, and run the
pg-boss import worker. The original IBKR export intentionally exercises one
oversell rejection; it is not treated as a complete portfolio history.
This is a hybrid browser/API harness: Cypress exercises account navigation,
portfolio creation and file upload in the browser, then uses the authenticated
public API for deterministic column/asset mapping and import confirmation. It
does not claim to exercise the removed in-app confirmation button.
Use only the provisioned disposable local Postgres (`127.0.0.1:55459`, database
`wm_issue59_e2e`) and a loopback S3-compatible store. Never point this lane at
shared or production infrastructure.

Required environment variables (better-auth, not Supabase):

- `E2E_PORTFOLIO_IMPORT_ENABLED=1`
- `E2E_PORTFOLIO_IMPORT_EMAIL` + `E2E_PORTFOLIO_IMPORT_PASSWORD` (better-auth email/password account)
- optional: `E2E_API_BASE_URL` (defaults to `http://localhost:3001`)

The old Supabase admin lane is gone: the driver signs the account in through
`<E2E_API_BASE_URL>/api/auth/sign-in/email` and provisions the linked appuser
with `POST /v1/auth/callback` using the better-auth bearer token.

Apply normal migrations and standard reference seed data first (never use
`migrate:fresh` in this fixture lane). Then seed the small catalog from actual
identities parsed out of the checked-in workbook and CSV. The setup script
validates the explicit fixture opt-in, non-production mode, exact loopback
host/port/database, and the labelled disposable Postgres container before
writing. It only inserts catalog rows; it does not create mocked import rows or
assertion-derived matches.

Provision a new database container for this run; never adopt an existing
container, even if its name and port look right. First confirm that
`127.0.0.1:55459` is unused. Create the required container and capture its full
ID from Docker's creation output:

```bash
container_id="$(docker create \
  --name wm-e2e-pg-55459 \
  --label opencode.owner=issue59 \
  --label opencode.disposable=true \
  --publish 127.0.0.1:55459:5432 \
  --env POSTGRES_DB=wm_issue59_e2e \
  --env POSTGRES_USER=<local-test-user> \
  --env POSTGRES_PASSWORD=<local-test-password> \
  postgres:17-alpine)"
docker start wm-e2e-pg-55459
export WM_E2E_DB_CONTAINER_ID="$container_id"
```

Use only test-local database credentials and keep them out of shell transcripts
and logs. The fixture guard requires `WM_E2E_DB_CONTAINER_ID` to be the full
64-character ID returned by this new `docker create`; it has no default and
refuses a different inspected container ID, image, name, labels, or any port
binding except `127.0.0.1:55459` to container port `5432/tcp`. Export this
variable in the same environment used for guarded catalog seeding and for both
the API and worker processes running the EODHD fixture preloader. Never weaken
the guard to reuse an existing container or remote/shared database.

### Local S3-compatible storage

The browser uploads the file directly to the signed S3 URL. An API-only
connectivity check does not exercise browser CORS. Use the already approved
temporary S3rver 3.7.1 installation (outside the project; no dependency or
lockfile changes) with the disposable bucket `wm-issue59-e2e`. Configure the
bucket with an exact local browser origin and the upload method/header used by
the signed PUT:

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>http://localhost:3100</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>content-type</AllowedHeader>
  </CORSRule>
</CORSConfiguration>
```

Save this as `cors.xml` in the approved private temporary setup directory, then
start the temporary server using its existing installation and a private data
directory:

```bash
node "$S3RVER_DIR/node_modules/s3rver/bin/s3rver.js" \
  --directory "$S3_DATA_DIR" \
  --address 127.0.0.1 \
  --port 9000 \
  --silent \
  --no-vhost-buckets \
  --configure-bucket wm-issue59-e2e "$CORS_XML"
```

For API and worker only, use `S3_ENDPOINT=http://127.0.0.1:9000`,
`S3_PUBLIC_ENDPOINT=http://127.0.0.1:9000`, and the test bucket above. S3rver's
documented local dummy signing pair is `AWS_ACCESS_KEY_ID=S3RVER` and
`AWS_SECRET_ACCESS_KEY=S3RVER`; configure those same test-only values in the
API/worker environment or signed uploads fail with `InvalidAccessKeyId`. Never
use real cloud credentials here, disable signature verification, or expose a
presigned URL/query string in logs.

Verify with an actual browser upload: inspect the OPTIONS preflight for the
`http://localhost:3100` origin, PUT method and `content-type` header, then
confirm the signed PUT reaches local S3 and returns a CORS-readable response.
Do not treat an API-side HEAD/GET check as proof that browser preflight/upload
works. The last diagnostic did not capture the exact PUT status code; it did
observe the browser PUT, the configured origin on its response, an ETag, and no
S3 error code.

The API and worker may load the opt-in EODHD test preloader with
`NODE_OPTIONS=--import=<absolute-path-to-portfolio-import-e2e-provider.mjs>`.
It patches only the public `Eodhd.prototype.search` boundary: bundled security
identities return deterministic search candidates, `EUR.USD` returns a
provider-success empty result, and any unrecognized query throws. Other EODHD
methods throw rather than reaching a provider. Use a dummy e2e-only
`EODHD_API_KEY`. Parsing, asset resolution, persistence, and worker behavior
remain real. This proves the local public-boundary behavior, not compatibility
with live EODHD HTTP/API responses.

With the owned API at port 3101, worker, and test S3 running, use web port 3100:

```bash
E2E_WEB_PORT=3100 E2E_API_BASE_URL=http://localhost:3101 \
  E2E_PORTFOLIO_IMPORT_ENABLED=1 \
  E2E_PORTFOLIO_IMPORT_EMAIL='local-test@example.invalid' \
  E2E_PORTFOLIO_IMPORT_PASSWORD='local-test-password' \
  npx cypress run --e2e --spec "cypress/e2e/portfolio-import.cy.ts"
```

The canonical full `pnpm e2e:headless` run collects six specs and 14 tests;
four assistant scenarios remain intentionally pending. The import assertions
expect stored trade fees to reduce realized gains and the failed-row
diagnostics in the import preview (`rows.failed`), so all three import cases
pass only once both of those API changes are on the branch under test. With
`E2E_PORTFOLIO_IMPORT_ENABLED` unset, the scenarios intentionally remain
pending so normal smoke runs do not mutate shared infrastructure.

## Smoke specs and CI

The specs other than `portfolio-import` need only the web dev server: they
check anonymous redirects, the login page and mobile navigation, and never
reach the API. CI runs them in the `Web E2E smoke` job (`.github/workflows/ci.yml`)
with no API or database. Locally the same run is:

```bash
pnpm --dir "$WT/apps/web" exec cypress install   # once; allowBuilds skips the binary
pnpm --dir "$WT/apps/web" e2e:headless
```

`cypress/support/e2e.ts` ignores the browser's benign "ResizeObserver loop"
notification (Radix's popper Select raises it when the list opens); every other
uncaught application error still fails the test.

## Ports

- Port 3100 is the web app, 3101 the API, 3102 the worker health endpoint,
  55459 the disposable Postgres and 9000 the loopback S3rver for this lane.
- Do not stop or reuse listeners you do not own; choose an available `E2E_WEB_PORT` if needed.

## Environment variables

Validate required non-secret presence only:

- `NEXT_PUBLIC_API_URL` (optional in dev; defaults to `http://localhost:3001`)
- `NEXT_PUBLIC_POSTHOG_KEY`

The preflight script will not print secret values.
