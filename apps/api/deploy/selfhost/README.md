# Self-hosting WonderMoney

Run your own WonderMoney with Docker Compose: Postgres, the API, its background worker and the
web app. Nothing else is required. AI, market data, file storage and outgoing email are
optional and switched on in `.env`; features whose integration is not configured are hidden.

## Install

Requirements: Docker with the Compose plugin, `openssl`, and about 2 GB of RAM. The installer
checks for them and stops with instructions if one is missing; it never installs Docker itself.

```sh
curl -fsSLO https://github.com/wondermoney/wondermoney/releases/latest/download/install.sh
curl -fsSLO https://github.com/wondermoney/wondermoney/releases/latest/download/install.sh.sha256
sha256sum -c install.sh.sha256
sh install.sh
```

It downloads `docker-compose.yml`, `.env.example`, `generate-env.sh` and `backup/backup.sh` from
the release tag (not from `main`), writes `.env` with fresh secrets, pins `WM_VERSION` to that release, starts the
stack and waits up to three minutes for the API. It asks for the web app and the API address;
`--yes` takes the defaults, `http://localhost:3000` and `http://localhost:3001`.

| Flag | What it does |
|---|---|
| `--version 1.4.0` | Install a specific release instead of the latest |
| `--dir /srv/wondermoney` | Where to install (default `./wondermoney`) |
| `--yes` | No questions: default addresses, and upgrade an existing install |
| `--app-url`, `--api-url` | The addresses the web app and the API are served at |

Re-running it on an existing install never rewrites `.env`: it offers to upgrade to the latest
release, and only the `WM_VERSION` line changes when it does. With `--yes` it upgrades without
asking.

On macOS, `shasum -a 256 -c install.sh.sha256` checks the download instead of `sha256sum`.

### Read it first

The installer is a short POSIX `sh` script. Download it, read it, then run it:

```sh
curl -fsSLO https://github.com/wondermoney/wondermoney/releases/latest/download/install.sh
less install.sh
sh install.sh
```

Or do the same steps by hand, from the release tag:

```sh
# v1.4.0 here: the release you want
git clone --depth 1 --branch v1.4.0 https://github.com/wondermoney/wondermoney.git
cd wondermoney/apps/api/deploy/selfhost
./generate-env.sh        # writes .env with fresh secrets (refuses to overwrite an existing one)
docker compose up -d
```

Open http://localhost:3000 and create your account. The first account on a new instance can
always sign up; afterwards `SIGNUP_MODE` in `.env` decides who else can (`open`, `invite` or
`closed`).

On first start the API creates the database schema and loads the reference data (currencies,
categories, the asset catalog). This takes a minute or two; `docker compose logs -f api` shows
progress.

### Without an email provider

Until you configure SMTP or Resend, emails are not sent: they are written to the API log,
links included. To reset a password or accept an invite:

```sh
docker compose logs api | grep "Email not sent"
```

## Configure

Everything lives in `.env`; it is commented section by section. After editing it, run
`docker compose up -d` again (this recreates whatever changed).

| You want | Set |
|---|---|
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` (or `RESEND_API_KEY`) |
| CSV imports and receipt copies | an S3-compatible bucket, or the bundled store: `COMPOSE_PROFILES=storage` plus the values in `.env`'s file storage section |
| Receipt scanning, smart categorisation, CSV column mapping, the assistant | `AI_BASE_URL`, `AI_MODEL` (any OpenAI-compatible endpoint, including Ollama), or `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` and `AI_MODEL` |
| Ticker search and live prices | `EODHD_API_KEY`, or the free Stooq and CoinGecko providers for prices through `MARKET_DATA_PROVIDERS` |
| A contact form and a support address in the app | `SUPPORT_EMAIL` (and optionally reCAPTCHA keys) |
| The in-app "Share Feedback" form, emailed to you | `SUPPORT_EMAIL` plus email (SMTP or Resend) |
| "Continue with Google" | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| "Sign in with <name>" through your own identity provider (OIDC) | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (see the single sign-on guide) |
| Bank sync | nothing on the server: each user adds their own Enable Banking key in Settings. Or your own Enable Banking application for your household: `ENABLE_BANKING_APP_ID` and `ENABLE_BANKING_PRIVATE_KEY_FILE` (see `.env`) |
| Analytics for your own instance (off by default) | `NEXT_PUBLIC_GTM_ID`, `NEXT_PUBLIC_POSTHOG_KEY`, or `ANALYTICS_OUTBOX_MODE=live` with `POSTHOG_API_KEY` |

To read outgoing mail without a real provider, add `mail` to `COMPOSE_PROFILES` and set
`SMTP_HOST=mailpit`, `SMTP_PORT=1025`; mail appears at http://localhost:8025.

`COMPOSE_PROFILES` (e.g. `proxy,storage,mail`) switches on the optional services for every
`docker compose` command, so `up`, `pull` and `down` all include them.

### What your instance sends

Nothing leaves your server for the WonderMoney project. Without configuration, the only
outside call is the worker's daily download of euro exchange rates from the European Central
Bank. Everything else is switched on by its setting: email (SMTP or Resend), AI (`AI_BASE_URL` or
`ANTHROPIC_API_KEY`), market data (EODHD), file storage (S3), off-site backups
(`BACKUP_DESTINATION`), error tracking (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`), analytics
(above), Google sign-in, reCAPTCHA, and bank sync (Enable Banking, once a user adds their key or you set `ENABLE_BANKING_APP_ID`). The docs site's self-hosting guide lists each one.

### The mobile app

The WonderMoney app for iOS and Android works with your server: on the sign-in screen, tap
**Use a different server** and enter your server's address, the `API_URL` from your `.env`. With
one hostname that is the same address as the web app, e.g. `money.example.com`. It must be
reachable from the phone, over HTTPS in practice.

## HTTPS

One hostname is enough. The bundled proxy (the `proxy` profile) serves the web app and the API
on the same address: `/v1/*` and `/api/auth/*` go to the API, everything else to the web app. It
is [Caddy](https://caddyserver.com), so it fetches and renews the certificate itself.

In `.env`:

```
APP_URL=https://money.example.com
API_URL=https://money.example.com
COMPOSE_PROFILES=proxy
TRUST_PROXY=1
BIND_ADDRESS=127.0.0.1
```

Then `docker compose up -d`, point the hostname's DNS at this machine, and open
https://money.example.com. Ports 80 and 443 must be reachable from the internet: Caddy answers
the certificate challenge on 80. `PROXY_HTTP_PORT` and `PROXY_HTTPS_PORT` change the published
ports.

`BIND_ADDRESS=127.0.0.1` keeps the plain-HTTP ports (the web app, the API, and the optional
storage and Mailpit) on this machine, so only the proxy is reachable from outside.

No cookie domain is needed: the session cookie belongs to the one hostname, so
`AUTH_COOKIE_DOMAIN` and `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` stay empty. If they are set, the API
ignores them.

To try the proxy locally, set `APP_URL=http://localhost` and `API_URL=http://localhost`. It then
serves plain HTTP on port 80, with no certificate.

### Another reverse proxy

Any other reverse proxy works: give it one hostname and route the same two path prefixes to the
API. With Caddy on the host:

```
money.example.com {
  handle /v1/* {
    reverse_proxy localhost:3001
  }
  handle /api/auth/* {
    reverse_proxy localhost:3001
  }
  handle {
    reverse_proxy localhost:3000
  }
}
```

### Two hostnames

A hostname for each still works. Give the web app and the API their own name:

```
money.example.com {
  reverse_proxy localhost:3000
}

api.money.example.com {
  reverse_proxy localhost:3001
}
```

Then in `.env`:

```
APP_URL=https://money.example.com
API_URL=https://api.money.example.com
AUTH_COOKIE_DOMAIN=.example.com
NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=.example.com
TRUST_PROXY=1
```

The cookie domain lets the web app read the sign-in session the API sets, because they are on
different subdomains. The bundled `proxy` profile serves one hostname only; leave it off.

`TRUST_PROXY` is how many proxies sit in front of the API: `1` for one reverse proxy (the
bundled `proxy` profile, Caddy, nginx, Traefik, a Cloudflare Tunnel), `2` with Cloudflare's proxy
in front of yours, or a comma-separated list of the proxies' addresses. The API uses it to tell
visitors apart for its sign-in limits. Leave it empty when browsers reach the API port directly;
set to anything else there, it would let a visitor fake their address in `X-Forwarded-For`.

## Upgrade

```sh
docker compose pull
docker compose up -d
```

`./install.sh --dir .` does the same for the latest release and pins `WM_VERSION` to it; the
installer leaves a copy of itself in the directory. The API applies any new database migrations
when it starts. To stay on a release, set `WM_VERSION` (e.g. `WM_VERSION=1.4`) instead of
`latest`.

## Monitor

`GET /v1/health` answers 200 while the API process runs; the container health check uses it.
`GET /v1/health/ready` is for uptime monitors: it answers 200 when Postgres responds, no job has
waited too long to start (`HEALTH_MAX_JOB_AGE_MINUTES`, 60 by default) and the worker finished
its 5-minute heartbeat job in the last 15 minutes, and 503 with the failing check otherwise. It
also reports the server's `version` and `commit`.

With [Uptime Kuma](https://github.com/louislam/uptime-kuma), add an "HTTP(s) - Keyword"
monitor for `https://money.example.com/v1/health/ready` (your `APP_URL` followed by
`/v1/health/ready`) with the keyword `"status":"ok"` and a 60-second interval.
`docker compose ps` also shows the `worker` container as unhealthy when its job runner stops or
it loses Postgres.

## Back up

Everything that matters is the Postgres database, plus the `storage-data` volume if you use the
bundled store. Keep `.env` somewhere other than the server as well (a password manager is a good
place): `CREDENTIAL_ENCRYPTION_KEY_V1` is needed to read users' stored bank credentials, a restored
database is of little use without it, and the backups below never include it.

### Scheduled backups

Add `backup` to `COMPOSE_PROFILES` in `.env` (e.g. `COMPOSE_PROFILES=proxy,backup`) and run
`docker compose up -d`. Every day at 02:00 the `backup` service writes a folder to `./backups`:

```
backups/2026-11-12T020000Z/
  wondermoney.dump    pg_dump -Fc of the database
  storage.tar.gz      the storage-data volume (empty unless you use the bundled store)
  SHA256SUMS
```

Folders older than seven days are deleted after each successful backup. A backup is written to a
hidden `.tmp-` folder and renamed only once it is complete, so an interrupted run never leaves a
folder that looks finished; the next run removes what it left. The folders and files are readable
by root only.

| Setting | Default | |
|---|---|---|
| `BACKUP_DIR` | `./backups` | Where the folders go on this machine |
| `BACKUP_SCHEDULE` | `0 2 * * *` | A cron expression: minute, hour, day, month, weekday |
| `BACKUP_KEEP_DAYS` | `7` | Days to keep; `0` keeps every backup |
| `BACKUP_TZ` | `UTC` | Time zone of the schedules, e.g. `Europe/Lisbon` (folder names stay UTC) |

The same service runs one-off commands, with or without the profile:

```sh
docker compose run --rm backup now     # take a backup now
docker compose run --rm backup list    # the backups in BACKUP_DIR
docker compose logs backup             # what the scheduled runs did
```

A file stored in an outside S3 service (R2, B2, AWS) is not in these backups: use the provider's
own versioning or replication for the bucket.

### Off-site copies

A backup on the same disk does not survive the disk. The `backup-offsite` service copies the
finished backup folders to any [rclone](https://rclone.org/overview/) remote (S3, Backblaze B2,
SFTP, Google Drive and many more) every day at 02:30:

```sh
docker compose run --rm backup-offsite config    # set up a remote; saved in ./rclone/rclone.conf
```

Then in `.env`:

```
COMPOSE_PROFILES=backup,backup-offsite
BACKUP_DESTINATION=b2:my-bucket/wondermoney
```

and `docker compose up -d`. `docker compose run --rm backup-offsite now` copies at once, and
`list` shows what is at the destination. It copies (it never mirrors deletions), so a backup
deleted locally stays off-site until it is older than `BACKUP_OFFSITE_KEEP_DAYS` (30 by default,
`0` keeps everything); `BACKUP_OFFSITE_SCHEDULE` (`30 2 * * *`) sets when it runs. Only the
timestamped folders are copied: nothing else in `BACKUP_DIR`, and never `.env`, which the service
cannot see.

### Restore

Restore stops if the API, the worker or the bundled store is running, so stop them first:

```sh
docker compose stop proxy web worker api storage
docker compose run --rm backup restore 2026-11-12T020000Z    # or: restore latest
docker compose up -d
```

It checks the files against `SHA256SUMS`, asks to confirm (`--yes` skips the question), loads the
dump into a new database and swaps it in only once it loaded completely, then replaces the
contents of `storage-data` with `storage.tar.gz`. Restore with the same release or a newer one:
the API applies newer migrations on start, but cannot undo them.

To restore from the off-site copy, on a new server for example, fetch the folder into
`BACKUP_DIR` first (with `.env` and `./rclone/rclone.conf` back in place):

```sh
docker compose run --rm backup-offsite fetch latest    # or a folder name from `list`
```

Restoring replaces everything that is in the database now. If you might want it back, run
`docker compose run --rm backup now` first, and then restore the folder by name, not `latest`.

### By hand

Without the profile, `pg_dump` and `pg_restore` in the postgres container do the same for the
database:

```sh
# Back up
docker compose exec -T postgres pg_dump -U wondermoney -Fc wondermoney > wondermoney-$(date +%F).dump

# Restore: stop the app, recreate the database, load the dump, start again
docker compose stop proxy api worker web
docker compose exec -T postgres dropdb -U wondermoney wondermoney
docker compose exec -T postgres createdb -U wondermoney wondermoney
docker compose exec -T postgres pg_restore -U wondermoney -d wondermoney < wondermoney-2026-10-04.dump
docker compose up -d
```

Use your own `POSTGRES_USER`/`POSTGRES_DB` if you changed them.
