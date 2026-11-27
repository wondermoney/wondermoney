# All-in-one image

`ghcr.io/wondermoney/wondermoney-aio` is WonderMoney in one container, for Unraid's Community
Applications (`deploy/unraid`) and other NAS app stores. `wm-aio.sh` starts, in order and as
`PUID:PGID` (99:100 by default, Unraid's nobody:users):

| Process | Listens on | Skipped when |
|---|---|---|
| Postgres 16 | 127.0.0.1:5432, data in `/config/postgres` | `DB_HOST` or `DATABASE_URL` is set |
| SeaweedFS (S3) | 127.0.0.1:8333, data in `/config/storage` | `S3_ENDPOINT` is set, or `BUNDLED_STORAGE=false` |
| API (migrations first) | 127.0.0.1:3001 | |
| worker | 127.0.0.1:3002 (health) | |
| web app | 127.0.0.1:3100 | |
| Caddy | 0.0.0.0:3000, the only published port | |

Caddy routes `/v1/*`, `/api/auth/*`, `/.well-known/oauth-*` and `/.well-known/openai-apps-challenge` to the API, `/wondermoney-files/*` (the storage bucket, so
presigned uploads go to the same address as the app) to SeaweedFS, and everything else to the web
app. When any process exits the script stops the rest and exits, and the restart policy starts the
container again. On `docker stop` it stops the apps (5 s, then killed), then storage (2 s, then
killed) while Postgres writes its shutdown checkpoint. Postgres is never killed from inside: only
Docker's stop timeout cuts it short, so the Unraid template sets `--stop-timeout=30`.

The secrets the compose install keeps in `.env` are generated on the first start into
`/config/secrets.env` and read from there afterwards; a value set on the container wins.

It is assembled from the published api and web images of the same version, not built from
source; `publish-images.yml` builds it after them. To try a change locally:

```sh
docker build -f deploy/aio/Dockerfile --build-arg WM_VERSION=1.9.0 -t wondermoney-aio:dev .
docker run --rm -p 3000:3000 -e APP_URL=http://localhost:3000 -v "$PWD/aio-config:/config" wondermoney-aio:dev
```

The settings are those of `apps/api/deploy/selfhost/.env.example`, except `API_URL` (always
`APP_URL`) and `TRUST_PROXY` (`loopback` plus `TRUSTED_PROXIES`, which also tells Caddy whose
`X-Forwarded-For` to keep). The user guide is the docs page `self-hosting/unraid`.
