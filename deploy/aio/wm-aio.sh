#!/bin/bash
# Starts WonderMoney's processes in one container, in order, as PUID:PGID:
#
#   Postgres  127.0.0.1:5432   unless DB_HOST or DATABASE_URL names your own
#   SeaweedFS 127.0.0.1:8333   S3 for file uploads, unless S3_ENDPOINT names your own store
#   API       127.0.0.1:3001   applies migrations first
#   worker    127.0.0.1:3002   (health only)
#   web       127.0.0.1:3100
#   Caddy     0.0.0.0:3000     the only published port: /v1/*, /api/auth/*, /.well-known/oauth-*
#                              and /.well-known/openai-apps-challenge to the API, the storage
#                              bucket to SeaweedFS, everything else to the web app
#
# When any of them exits the others are stopped and the container exits, so Docker's restart
# policy starts it again whole. Secrets are generated on the first start and kept in
# /config/secrets.env; the database and the uploaded files are in /config too.
set -euo pipefail

CONFIG_DIR=/config
SECRETS_FILE="$CONFIG_DIR/secrets.env"
RUN_DIR=/run/wondermoney
API_DIR=/home/node/app/apps/api
STORAGE_BUCKET=wondermoney-files
PORT_PUBLIC="${WM_PORT:-3000}"
PORT_API=3001
PORT_WORKER=3002
PORT_WEB=3100
PORT_S3=8333

log() { printf '[wondermoney] %s\n' "$*"; }
die() { printf '[wondermoney] ERROR: %s\n' "$*" >&2; exit 1; }

# ─── Settings ──────────────────────────────────────────────────────────────────

APP_URL="${APP_URL:-}"
APP_URL="${APP_URL%/}"
[ -n "$APP_URL" ] || die "Set APP_URL to the address you open WonderMoney at, such as http://192.168.1.10:3000 or https://money.example.com."
case "$APP_URL" in
  http://*|https://*) ;;
  *) die "APP_URL must start with http:// or https:// (it is \"$APP_URL\")." ;;
esac
rest="${APP_URL#*://}"
case "$rest" in
  */*) die "APP_URL is the address alone, without a path (it is \"$APP_URL\")." ;;
esac

PUID="${PUID:-99}"
PGID="${PGID:-100}"
[[ "$PUID" =~ ^[0-9]+$ && "$PGID" =~ ^[0-9]+$ ]] || die "PUID and PGID must be numbers."
[ "$PUID" != 0 ] || die "PUID must not be 0: Postgres refuses to run as root."

# Comma-separated addresses or CIDR ranges of reverse proxies in front of this container (SWAG,
# Nginx Proxy Manager, Traefik, a Cloudflare tunnel). Their X-Forwarded-For is believed, so the
# API's sign-in limits see each visitor's address instead of the proxy's.
TRUSTED_PROXIES="$(printf '%s' "${TRUSTED_PROXIES:-}" | tr -d ' ')"
if [ -n "$TRUSTED_PROXIES" ] && ! [[ "$TRUSTED_PROXIES" =~ ^[0-9A-Fa-f.:/,]+$ ]]; then
  die "TRUSTED_PROXIES is a comma-separated list of IP addresses or CIDR ranges, such as 172.17.0.0/16."
fi

# Whitespace around DATABASE_URL is dropped and a blank one is unset, as the API reads it.
DATABASE_URL="${DATABASE_URL:-}"
DATABASE_URL="${DATABASE_URL#"${DATABASE_URL%%[![:space:]]*}"}"
DATABASE_URL="${DATABASE_URL%"${DATABASE_URL##*[![:space:]]}"}"
if [ -n "$DATABASE_URL" ]; then export DATABASE_URL; else unset DATABASE_URL; fi

USE_BUNDLED_DB=true
[ -z "${DB_HOST:-}" ] && [ -z "${DATABASE_URL:-}" ] || USE_BUNDLED_DB=false
# The API refuses DATABASE_URL beside any DB_* setting. The Unraid template always passes its
# defaults for the port, name and user, so with DATABASE_URL they are dropped; a database host as
# well is two answers to one question.
if [ -n "${DATABASE_URL:-}" ]; then
  [ -z "${DB_HOST:-}" ] || die "Set either DATABASE_URL or the database host (DB_HOST), not both."
  unset DB_HOST DB_PORT DB_DATABASE DB_USERNAME DB_PASSWORD
fi
USE_BUNDLED_STORAGE=true
[ -z "${S3_ENDPOINT:-}" ] || USE_BUNDLED_STORAGE=false
[ "${BUNDLED_STORAGE:-true}" != false ] || USE_BUNDLED_STORAGE=false

# ─── The user everything runs as ───────────────────────────────────────────────

if ! getent group "$PGID" >/dev/null; then
  addgroup -g "$PGID" wondermoney
fi
group_name="$(getent group "$PGID" | cut -d: -f1)"
if ! getent passwd "$PUID" >/dev/null; then
  adduser -D -H -h "$CONFIG_DIR" -s /sbin/nologin -u "$PUID" -G "$group_name" wondermoney
fi
as_user() { su-exec "$PUID:$PGID" "$@"; }

mkdir -p "$CONFIG_DIR" "$RUN_DIR/caddy"
chown "$PUID:$PGID" "$CONFIG_DIR"
chown -R "$PUID:$PGID" "$RUN_DIR"
# The web app's start script writes the NEXT_PUBLIC_* values into its files, so they must be the
# user's. Only on the first start after a PUID change: it is thousands of files.
if [ "$(stat -c %u /app/apps/web/server.js)" != "$PUID" ]; then
  chown -R "$PUID:$PGID" /app
fi
# MikroORM keeps its metadata cache in the API's folder.
mkdir -p "$API_DIR/temp"
chown -R "$PUID:$PGID" "$API_DIR/temp"

# ─── Secrets ───────────────────────────────────────────────────────────────────
# A value set on the container wins; otherwise the one in secrets.env; otherwise a new one is
# generated and written there. Regenerating CREDENTIAL_ENCRYPTION_KEY_V1 would make every stored
# bank credential unreadable, which is why the file is kept and never rewritten.

touch "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"
chown "$PUID:$PGID" "$SECRETS_FILE"

random_hex() { node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'; }
random_base64() { node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))'; }

secret() {
  local name="$1" kind="$2" stored
  if [ -n "${!name:-}" ]; then
    export "${name?}"
    return
  fi
  stored="$(grep -m1 "^$name=" "$SECRETS_FILE" | cut -d= -f2- || true)"
  if [ -z "$stored" ]; then
    if [ "$kind" = base64 ]; then stored="$(random_base64)"; else stored="$(random_hex)"; fi
    printf '%s=%s\n' "$name" "$stored" >>"$SECRETS_FILE"
    log "Generated $name in $SECRETS_FILE."
  fi
  printf -v "$name" '%s' "$stored"
  export "${name?}"
}

secret BETTER_AUTH_SECRET hex
secret CREDENTIAL_ENCRYPTION_KEY_V1 base64
secret EMAIL_OPT_OUT_SIGNING_SECRET hex
secret ADMIN_API_KEY hex
secret INTERNAL_SERVICE_API_KEY hex
if $USE_BUNDLED_DB; then secret POSTGRES_PASSWORD hex; fi
if $USE_BUNDLED_STORAGE; then
  secret STORAGE_ACCESS_KEY hex
  secret STORAGE_SECRET_KEY hex
fi

# ─── Process supervision ───────────────────────────────────────────────────────

declare -a PIDS=() NAMES=()
stopping=false

start() {
  local name="$1"
  shift
  "$@" &
  PIDS+=("$!")
  NAMES+=("$name")
  log "Started $name (pid $!)."
}

# Stops in two steps. The apps (Caddy, web, worker, API) get SIGTERM and 5 s to drain, and are
# killed after that. Then, together, the file store gets SIGTERM and 2 s (its graceful stop can
# wait on its own internal streams indefinitely, and by then nothing is writing to it), and
# Postgres its fast shutdown (SIGINT). Postgres is never killed from here: its shutdown checkpoint
# can take seconds on a slow disk (Unraid's /mnt/user), and only Docker's stop timeout (30 s in
# the Unraid template) cuts it short.

# Sends `signal` to the named processes and waits up to `seconds` for them (0: as long as they
# take), then kills the rest.
stop_group() {
  local signal="$1" seconds="$2"
  shift 2
  local i deadline=$((SECONDS + seconds)) left
  declare -A wanted=()
  for name in "$@"; do wanted[$name]=1; done
  for ((i = ${#PIDS[@]} - 1; i >= 0; i--)); do
    [ -n "${wanted[${NAMES[i]}]:-}" ] && kill "-$signal" "${PIDS[i]}" 2>/dev/null || true
  done
  while :; do
    left=()
    for ((i = 0; i < ${#PIDS[@]}; i++)); do
      [ -n "${wanted[${NAMES[i]}]:-}" ] && kill -0 "${PIDS[i]}" 2>/dev/null && left+=("${NAMES[i]}")
    done
    ((${#left[@]} == 0)) && return
    if ((seconds > 0 && SECONDS >= deadline)); then
      log "Still running after ${seconds}s, killing: ${left[*]}."
      for ((i = 0; i < ${#PIDS[@]}; i++)); do
        [ -n "${wanted[${NAMES[i]}]:-}" ] && kill -KILL "${PIDS[i]}" 2>/dev/null || true
      done
      return
    fi
    sleep 0.2
  done
}

stop_all() {
  $stopping && return
  stopping=true
  stop_group TERM 5 caddy web worker api
  # Postgres starts its shutdown first, so the store's two seconds run while it writes its
  # checkpoint; a second SIGINT below changes nothing.
  local i
  for i in "${!PIDS[@]}"; do
    [ "${NAMES[i]}" = postgres ] && kill -INT "${PIDS[i]}" 2>/dev/null || true
  done
  stop_group TERM 2 storage
  stop_group INT 0 postgres
  wait 2>/dev/null || true
  log "Stopped."
}

# shellcheck disable=SC2329 # run by the trap below
on_signal() {
  log "Stopping."
  stop_all
  exit 0
}
trap on_signal TERM INT

# Waits for `check` to pass, giving up after `seconds` or as soon as a started process exits.
wait_for() {
  local what="$1" seconds="$2"
  shift 2
  local deadline=$((SECONDS + seconds)) pid
  until "$@" >/dev/null 2>&1; do
    for pid in "${PIDS[@]}"; do
      kill -0 "$pid" 2>/dev/null || { log "A process exited while waiting for $what."; stop_all; exit 1; }
    done
    if ((seconds > 0 && SECONDS >= deadline)); then
      log "$what did not become ready within $seconds seconds."
      stop_all
      exit 1
    fi
    sleep 1
  done
  log "$what is ready."
}

# shellcheck disable=SC2329 # run by wait_for
http_ok() { curl -fsS -o /dev/null "$1"; }

# ─── Postgres ──────────────────────────────────────────────────────────────────

if $USE_BUNDLED_DB; then
  PGDATA="$CONFIG_DIR/postgres"
  mkdir -p "$PGDATA" "$RUN_DIR/postgresql"
  chown "$PUID:$PGID" "$PGDATA" "$RUN_DIR/postgresql"
  chmod 700 "$PGDATA"
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    log "Creating the database in $PGDATA."
    pwfile="$RUN_DIR/pgpass"
    printf '%s' "$POSTGRES_PASSWORD" >"$pwfile"
    chown "$PUID:$PGID" "$pwfile"
    as_user initdb -D "$PGDATA" -U wondermoney --pwfile="$pwfile" -A scram-sha-256 -E UTF8 --no-locale >/dev/null
    rm -f "$pwfile"
    fresh_db=true
  else
    fresh_db=false
    major="$(cat "$PGDATA/PG_VERSION")"
    [ "$major" = 16 ] || die "The database in $PGDATA is from Postgres $major; this image runs Postgres 16."
  fi
  # su-exec, not as_user: the started process must be the one signals reach.
  start postgres su-exec "$PUID:$PGID" postgres -D "$PGDATA" \
    -c listen_addresses=127.0.0.1 -c port=5432 -c unix_socket_directories="$RUN_DIR/postgresql"
  wait_for Postgres 60 as_user pg_isready -q -h 127.0.0.1 -p 5432 -U wondermoney -d postgres
  if $fresh_db; then
    PGPASSWORD="$POSTGRES_PASSWORD" as_user psql -q -h 127.0.0.1 -U wondermoney -d postgres -c 'CREATE DATABASE wondermoney'
  fi
  export DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=wondermoney DB_USERNAME=wondermoney DB_PASSWORD="$POSTGRES_PASSWORD"
fi

# ─── File storage ──────────────────────────────────────────────────────────────

if $USE_BUNDLED_STORAGE; then
  mkdir -p "$CONFIG_DIR/storage"
  chown "$PUID:$PGID" "$CONFIG_DIR/storage"
  # Not through `start`: its info lines (I1123 ...) are filtered out, warnings and errors kept.
  # The process substitution leaves $! as weed itself, so signals still reach it.
  env -i PATH="$PATH" HOME="$RUN_DIR" \
    AWS_ACCESS_KEY_ID="$STORAGE_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$STORAGE_SECRET_KEY" \
    su-exec "$PUID:$PGID" weed -logtostderr=true -v=0 server -dir="$CONFIG_DIR/storage" \
    -ip=127.0.0.1 -ip.bind=127.0.0.1 -s3 -s3.port="$PORT_S3" \
    2> >(while IFS= read -r line; do [[ $line == I[0-9]* ]] || printf '%s\n' "$line" >&2; done) &
  PIDS+=("$!")
  NAMES+=(storage)
  log "Started storage (pid $!)."
  wait_for "File storage" 120 http_ok "http://127.0.0.1:$PORT_S3/healthz"
  until buckets="$(echo s3.bucket.list | as_user weed shell -master=127.0.0.1:9333 2>/dev/null)"; do sleep 2; done
  if ! grep -qw "$STORAGE_BUCKET" <<<"$buckets"; then
    echo "s3.bucket.create -name $STORAGE_BUCKET" | as_user weed shell -master=127.0.0.1:9333 >/dev/null
    log "Created the storage bucket."
  fi
  # Browsers upload to and download from the same address as the app; Caddy routes the bucket's
  # path to the store, which checks the signature against that address.
  export AWS_ACCESS_KEY_ID="$STORAGE_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$STORAGE_SECRET_KEY"
  export S3_ENDPOINT="http://127.0.0.1:$PORT_S3" S3_PUBLIC_ENDPOINT="$APP_URL" S3_BUCKET="$STORAGE_BUCKET"
  export S3_REGION="${S3_REGION:-us-east-1}"
fi

# ─── API, worker and web app ───────────────────────────────────────────────────

export APP_URL API_URL="$APP_URL"
# Caddy is the API's only client; behind it, the proxies the user named.
export TRUST_PROXY="loopback${TRUSTED_PROXIES:+,$TRUSTED_PROXIES}"
export PGBOSS_MIGRATE=true
unset STORAGE_ACCESS_KEY STORAGE_SECRET_KEY POSTGRES_PASSWORD

cd "$API_DIR"
start api env PORT="$PORT_API" su-exec "$PUID:$PGID" sh -c 'node dist/migrate.js && exec node dist/server.js'
wait_for "The API (migrations included)" 600 http_ok "http://127.0.0.1:$PORT_API/v1/health"

start worker env PORT="$PORT_WORKER" WORKER_HEALTH_PORT="$PORT_WORKER" PGBOSS_SCHEDULE=true \
  su-exec "$PUID:$PGID" node dist/worker.js

# The web app gets only its own settings, never the database password or the API's secrets.
web_env=(PATH="$PATH" HOME="$RUN_DIR" NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
  PORT="$PORT_WEB" HOSTNAME=127.0.0.1 API_INTERNAL_URL="http://127.0.0.1:$PORT_API"
  NEXT_PUBLIC_API_URL="$APP_URL" NEXT_PUBLIC_APP_URL="$APP_URL")
for name in NEXT_PUBLIC_AUTH_COOKIE_DOMAIN NEXT_PUBLIC_DEMO_EMAIL NEXT_PUBLIC_DOCS_URL NEXT_PUBLIC_GTM_ID \
  NEXT_PUBLIC_POSTHOG_KEY NEXT_PUBLIC_PRIVACY_URL NEXT_PUBLIC_RECAPTCHA_SITE_KEY NEXT_PUBLIC_SENTRY_DSN \
  NEXT_PUBLIC_TERMS_URL RECAPTCHA_SECRET_KEY IOS_APP_TEAM_ID IOS_APP_BUNDLE_ID ANDROID_APP_PACKAGE \
  ANDROID_APP_CERT_SHA256 TZ; do
  [ -z "${!name:-}" ] || web_env+=("$name=${!name}")
done
cd /app
start web env -i "${web_env[@]}" su-exec "$PUID:$PGID" wm-web-entrypoint
cd /

# ─── Caddy ─────────────────────────────────────────────────────────────────────

caddyfile="$RUN_DIR/caddy/Caddyfile"
{
  echo '{'
  echo '  admin off'
  echo '  auto_https off'
  echo '  persist_config off'
  if [ -n "$TRUSTED_PROXIES" ]; then
    echo '  servers {'
    echo "    trusted_proxies static ${TRUSTED_PROXIES//,/ }"
    echo '  }'
  fi
  echo '}'
  echo ":$PORT_PUBLIC {"
  echo "  handle /v1/* {"
  echo "    reverse_proxy 127.0.0.1:$PORT_API"
  echo '  }'
  echo "  handle /api/auth/* {"
  echo "    reverse_proxy 127.0.0.1:$PORT_API"
  echo '  }'
  echo "  handle /.well-known/oauth-* {"
  echo "    reverse_proxy 127.0.0.1:$PORT_API"
  echo '  }'
  echo "  handle /.well-known/openai-apps-challenge {"
  echo "    reverse_proxy 127.0.0.1:$PORT_API"
  echo '  }'
  if $USE_BUNDLED_STORAGE; then
    echo "  handle /$STORAGE_BUCKET/* {"
    echo "    reverse_proxy 127.0.0.1:$PORT_S3"
    echo '  }'
  fi
  echo '  handle {'
  echo "    reverse_proxy 127.0.0.1:$PORT_WEB"
  echo '  }'
  echo '}'
} >"$caddyfile"
chown "$PUID:$PGID" "$caddyfile"

start caddy env -i PATH="$PATH" HOME="$RUN_DIR/caddy" XDG_DATA_HOME="$RUN_DIR/caddy" XDG_CONFIG_HOME="$RUN_DIR/caddy" \
  su-exec "$PUID:$PGID" caddy run --config "$caddyfile" --adapter caddyfile
wait_for "The web app" 120 http_ok "http://127.0.0.1:$PORT_WEB/"
log "WonderMoney is running at $APP_URL"

# ─── Run until something stops ─────────────────────────────────────────────────

set +e
wait -n -p exited "${PIDS[@]}"
status=$?
set -e
for i in "${!PIDS[@]}"; do
  [ "${PIDS[i]}" = "${exited:-}" ] && log "${NAMES[i]} exited with status $status; stopping the others."
done
stop_all
exit 1
