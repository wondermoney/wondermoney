# Self-hosting WonderMoney

Run your own WonderMoney with Docker Compose: Postgres, the API, its background worker and the
web app. Nothing else is required. AI, market data, file storage and outgoing email are
optional and switched on in `.env`; features whose integration is not configured are hidden.

## Install

Requirements: Docker with the Compose plugin, `openssl`, and about 2 GB of RAM.

```sh
git clone --depth 1 https://github.com/wondermoney/wondermoney.git
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
| Ticker search and live prices | `EODHD_API_KEY` |
| A contact form and a support address in the app | `SUPPORT_EMAIL` (and optionally reCAPTCHA keys) |
| The in-app "Share Feedback" form, emailed to you | `SUPPORT_EMAIL` plus email (SMTP or Resend) |
| "Continue with Google" | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Bank sync | nothing on the server: each user adds their own Enable Banking key in Settings |
| Analytics for your own instance (off by default) | `NEXT_PUBLIC_GTM_ID`, `NEXT_PUBLIC_POSTHOG_KEY`, or `ANALYTICS_OUTBOX_MODE=live` with `POSTHOG_API_KEY` |

To read outgoing mail without a real provider, add `mail` to `COMPOSE_PROFILES` and set
`SMTP_HOST=mailpit`, `SMTP_PORT=1025`; mail appears at http://localhost:8025.

`COMPOSE_PROFILES` (e.g. `proxy,storage,mail`) switches on the optional services for every
`docker compose` command, so `up`, `pull` and `down` all include them.

### What your instance sends

Nothing leaves your server for the WonderMoney project. Without configuration, the only
outside call is the worker's daily download of euro exchange rates from the European Central
Bank. Everything else is switched on by its setting: email (SMTP or Resend), AI (`AI_BASE_URL` or
`ANTHROPIC_API_KEY`), market data (EODHD), file storage (S3), error tracking (`SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_DSN`), analytics (above), Google sign-in, reCAPTCHA, and bank sync (Enable
Banking, once a user adds their key). The docs site's self-hosting guide lists each one.

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

The API applies any new database migrations when it starts. To stay on a release, set
`WM_VERSION` (e.g. `WM_VERSION=1.4`) instead of `latest`.

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
bundled store.

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

Keep `.env` with your backups: `CREDENTIAL_ENCRYPTION_KEY_V1` is needed to read users' stored
bank credentials, and a restored database is useless without it.
