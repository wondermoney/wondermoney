#!/bin/sh
# WonderMoney installer.
#
# Downloads the self-hosting files from a WonderMoney release, writes .env with fresh secrets,
# starts the stack with Docker Compose and waits for the API to answer.
#
#   sh install.sh                       # the latest release, into ./wondermoney
#   sh install.sh --yes                 # no questions, default addresses
#   sh install.sh --version 1.4.0       # a specific release
#   sh install.sh --dir /srv/wondermoney --app-url https://money.example.com \
#                 --api-url https://money.example.com
#
# Re-running it on an existing install never rewrites .env: it offers to upgrade instead, and
# only the WM_VERSION line changes when it does. It never installs Docker.
#
# Environment: WM_HEALTH_TIMEOUT (seconds to wait for the API, 180 by default) and WM_REPO
# (the GitHub repository to download from, for testing a fork).
#
# README.md, "Install", and https://docs.wonder.money/en/docs/self-hosting/install document it.
set -eu

REPO=${WM_REPO:-wondermoney/wondermoney}
HEALTH_TIMEOUT=${WM_HEALTH_TIMEOUT:-180}

DEFAULT_APP_URL=http://localhost:3000
DEFAULT_API_URL=http://localhost:3001
DEFAULT_DIR=./wondermoney

VERSION=latest
VERSION_GIVEN=0
DIR=
YES=0
APP_URL=
API_URL=
SOURCE=
UPGRADE=0

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'install.sh: %s\n' "$1" >&2
  shift
  for line in "$@"; do
    printf '  %s\n' "$line" >&2
  done
  exit 1
}

usage() {
  cat <<'EOF'
WonderMoney installer

Usage: sh install.sh [options]

  --version <tag>   Release to install, e.g. 1.4.0 or v1.4.0 (default: the latest release)
  --dir <path>      Where to install (default: ./wondermoney)
  --yes             No questions: default addresses, and upgrade an existing install
  --app-url <url>   Address of the web app (default: http://localhost:3000)
  --api-url <url>   Address of the API (default: http://localhost:3001)
  --source <dir>    Copy the files from this checkout instead of a release (development, CI)
  -h, --help        Show this help

It writes .env with fresh secrets, starts the stack and waits for the API health endpoint.
Re-running it never rewrites .env; it offers to upgrade to the latest release instead.
EOF
}

# ─── Arguments ────────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --version | --dir | --app-url | --api-url | --source)
      [ $# -ge 2 ] || die "$1 needs a value." "Run with --help to see the options."
      opt=$1
      value=$2
      shift 2
      ;;
    --version=* | --dir=* | --app-url=* | --api-url=* | --source=*)
      opt=${1%%=*}
      value=${1#*=}
      shift
      ;;
    --yes)
      YES=1
      shift
      continue
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1" "Run with --help to see the options."
      ;;
  esac

  case "$opt" in
    --version)
      VERSION=$value
      VERSION_GIVEN=1
      ;;
    --dir) DIR=$value ;;
    --app-url) APP_URL=$value ;;
    --api-url) API_URL=$value ;;
    --source) SOURCE=$value ;;
  esac
done

[ -n "$VERSION" ] || die "--version needs a value."
[ -n "$DIR" ] || DIR=$DEFAULT_DIR

# ─── What the installer needs ─────────────────────────────────────────────────

command -v curl >/dev/null 2>&1 || die "curl is required and was not found." \
  "Debian/Ubuntu:  apt-get install curl" \
  "Fedora/RHEL:    dnf install curl" \
  "macOS:          brew install curl"

if ! command -v docker >/dev/null 2>&1; then
  die "Docker is required and was not found." \
    "Install Docker Engine with the Compose plugin: https://docs.docker.com/engine/install/" \
    "The installer does not install Docker for you."
fi

if ! docker compose version >/dev/null 2>&1; then
  die "The Docker Compose plugin is required (the 'docker compose' command)." \
    "Install it: https://docs.docker.com/compose/install/linux/" \
    "Check with: docker compose version"
fi

if ! docker info >/dev/null 2>&1; then
  die "Docker is installed but its daemon is not reachable." \
    "Start Docker (systemctl start docker) and make sure this user may use it (the docker group)."
fi

command -v openssl >/dev/null 2>&1 || die "openssl is required to generate the secrets." \
  "Debian/Ubuntu:  apt-get install openssl" \
  "Fedora/RHEL:    dnf install openssl" \
  "macOS:          brew install openssl"

# ─── Helpers ──────────────────────────────────────────────────────────────────

env_value() { # key file
  sed -n "s/^$1=//p" "$2" | tail -n 1
}

compose() {
  (cd "$DIR" && docker compose "$@")
}

# `curl ... | sh` leaves stdin as the pipe, so fall back to the terminal when there is one.
can_prompt() {
  [ -t 0 ] && return 0
  ( : </dev/tty ) 2>/dev/null
}

read_answer() {
  if [ -t 0 ]; then
    IFS= read -r answer || answer=
  else
    IFS= read -r answer </dev/tty || answer=
  fi
}

wait_for_health() {
  port=$(env_value API_PORT "$DIR/.env")
  [ -n "$port" ] || port=3001
  bind=$(env_value BIND_ADDRESS "$DIR/.env")
  host=127.0.0.1
  if [ -n "$bind" ]; then
    case "$bind" in
      0.0.0.0 | '::') ;;
      *:*) host="[$bind]" ;;
      *) host=$bind ;;
    esac
  fi
  url="http://$host:$port/v1/health"

  printf 'Waiting for the API at %s ' "$url"
  deadline=$(($(date +%s) + HEALTH_TIMEOUT))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS -o /dev/null --connect-timeout 2 --max-time 5 "$url" 2>/dev/null; then
      printf 'ok\n'
      return 0
    fi
    printf '.'
    sleep 3
  done
  printf '\n'

  printf 'The API did not answer within %s seconds.\n' "$HEALTH_TIMEOUT" >&2
  compose ps >&2 || true
  printf 'Last lines of the API log:\n' >&2
  compose logs --tail 40 api >&2 || true
  die "Giving up." "Once the cause is fixed, run: cd $DIR && docker compose up -d"
}

print_summary() {
  installed=$(env_value WM_VERSION "$DIR/.env")
  [ -n "$installed" ] || installed=latest
  app_url=$(env_value APP_URL "$DIR/.env")
  api_url=$(env_value API_URL "$DIR/.env")

  say ""
  say "WonderMoney $installed is running in $DIR."
  say ""
  say "  Web app:  $app_url"
  say "  API:      $api_url"
  say ""
  say "Create your account at $app_url."
  say "Logs:   cd $DIR && docker compose logs -f api"
  if [ -f "$DIR/install.sh" ]; then
    say "Update: cd $DIR && ./install.sh --dir ."
  else
    say "Update: download install.sh from the latest release and run it with --dir $DIR"
  fi
  say ""

  if [ "$app_url" = "$api_url" ]; then
    case "$app_url" in
      http://localhost* | http://127.0.0.1* | 'http://[::1]'*) ;;
      *)
        say "The web app and the API share one address: to serve both on it with HTTPS, add"
        say "proxy to COMPOSE_PROFILES in $DIR/.env and run docker compose up -d (README.md, HTTPS)."
        ;;
    esac
  fi
}

# ─── Which release ────────────────────────────────────────────────────────────

# 1.4.0 and v1.4.0 both mean the tag v1.4.0 and the image tag 1.4.0.
strip_v() {
  case "$1" in
    v*) printf '%s\n' "${1#v}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

# Follows the redirect of /releases/latest, which needs no token and no API rate limit.
latest_tag() {
  headers=$(curl -fsSI "https://github.com/$REPO/releases/latest") ||
    die "Could not reach GitHub to find the latest release." \
      "Pass --version to install a specific one, e.g. --version 1.4.0."
  location=$(printf '%s\n' "$headers" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | tail -n 1)
  case "$location" in
    */tag/*) printf '%s\n' "${location##*/tag/}" ;;
    *) die "Could not find the latest WonderMoney release." \
      "Pass --version to install a specific one, e.g. --version 1.4.0." ;;
  esac
}

if [ "$VERSION" = latest ]; then
  TAG=$(latest_tag)
  VERSION=$(strip_v "$TAG")
else
  VERSION=$(strip_v "$VERSION")
  TAG="v$VERSION"
fi

mkdir -p "$DIR" || die "Could not create $DIR."
DIR=$(cd "$DIR" && pwd)

# ─── An existing install ──────────────────────────────────────────────────────

if [ -f "$DIR/.env" ] && [ -f "$DIR/docker-compose.yml" ]; then
  current=$(env_value WM_VERSION "$DIR/.env")
  [ -n "$current" ] || current=latest

  # `latest` on an install that asked for the latest release is not an upgrade.
  if [ "$current" = "$VERSION" ] || { [ "$current" = latest ] && [ "$VERSION_GIVEN" -eq 0 ]; }; then
    say "WonderMoney $current is already installed in $DIR."
    say "Making sure it is running..."
    compose up -d || die "docker compose up -d failed." \
      "See the output above; docker compose ps and docker compose logs show what happened."
    wait_for_health
    print_summary
    exit 0
  fi

  if [ "$YES" -ne 1 ]; then
    can_prompt || die "WonderMoney $current is installed in $DIR." \
      "Run with --yes to upgrade to $VERSION, or answer the question in a terminal."
    printf 'WonderMoney %s is installed in %s. Upgrade to %s? [y/N]: ' \
      "$current" "$DIR" "$VERSION" >&2
    answer=
    read_answer
    case "$answer" in
      y | Y | yes | YES) ;;
      *)
        say "Left as it was."
        exit 0
        ;;
    esac
  fi

  say "Upgrading WonderMoney $current to $VERSION in $DIR."
  UPGRADE=1
fi

# ─── The addresses ────────────────────────────────────────────────────────────

ask() { # label default
  can_prompt || die "No terminal to ask for the $1." \
    "Pass --app-url and --api-url, or --yes for the defaults."
  printf '%s [%s]: ' "$1" "$2" >&2
  answer=
  read_answer
  [ -n "$answer" ] || answer=$2
  printf '%s\n' "$answer"
}

normalize_url() { # url label
  case "$1" in
    *[[:space:]]*) die "The $2 contains a space: $1" ;;
    http://?* | https://?*) ;;
    *) die "Not an address: $1" "The $2 must start with http:// or https://." ;;
  esac
  url=$1
  while [ "${url%/}" != "$url" ]; do url=${url%/}; done
  printf '%s\n' "$url"
}

if [ ! -f "$DIR/.env" ]; then
  if [ -z "$APP_URL" ]; then
    if [ "$YES" -eq 1 ]; then
      APP_URL=$DEFAULT_APP_URL
    else
      APP_URL=$(ask "Web app address" "$DEFAULT_APP_URL")
    fi
  fi
  APP_URL=$(normalize_url "$APP_URL" "web app address")

  if [ -z "$API_URL" ]; then
    if [ "$YES" -eq 1 ]; then
      API_URL=$DEFAULT_API_URL
    else
      API_URL=$(ask "API address" "$DEFAULT_API_URL")
    fi
  fi
  API_URL=$(normalize_url "$API_URL" "API address")
fi

# ─── The files, from the release tag ──────────────────────────────────────────

tmp=$(mktemp -d "${TMPDIR:-/tmp}/wondermoney-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

base="https://raw.githubusercontent.com/$REPO/$TAG/apps/api/deploy/selfhost"
if [ -n "$SOURCE" ]; then
  say "Using the files in $SOURCE instead of the $TAG release."
else
  say "Downloading the self-hosting files from the $TAG release..."
fi

for file in docker-compose.yml .env.example generate-env.sh; do
  if [ -n "$SOURCE" ]; then
    [ -f "$SOURCE/$file" ] || die "$SOURCE/$file is missing."
    cp "$SOURCE/$file" "$tmp/$file"
  else
    curl -fsSL "$base/$file" -o "$tmp/$file" ||
      die "Could not download $file from $base" \
        "Check that the release $TAG exists, or pass another --version."
  fi
done

# The script of the optional backup services, for the releases whose compose file has them.
if grep -q 'backup/backup.sh' "$tmp/docker-compose.yml"; then
  mkdir -p "$tmp/backup"
  if [ -n "$SOURCE" ]; then
    [ -f "$SOURCE/backup/backup.sh" ] || die "$SOURCE/backup/backup.sh is missing."
    cp "$SOURCE/backup/backup.sh" "$tmp/backup/backup.sh"
  else
    curl -fsSL "$base/backup/backup.sh" -o "$tmp/backup/backup.sh" ||
      die "Could not download backup/backup.sh from $base" \
        "Check that the release $TAG exists, or pass another --version."
  fi
fi

mkdir -p "$DIR"
cp "$tmp/docker-compose.yml" "$tmp/.env.example" "$tmp/generate-env.sh" "$DIR/"
chmod +x "$DIR/generate-env.sh"
if [ -f "$tmp/backup/backup.sh" ]; then
  mkdir -p "$DIR/backup"
  cp "$tmp/backup/backup.sh" "$DIR/backup/backup.sh"
  chmod +x "$DIR/backup/backup.sh"
fi

# Keep a copy beside the install, so the update line in the summary works. A run through
# `curl | sh` has no file to copy; the line then points at a fresh download instead.
if [ -f "$0" ]; then
  cp "$0" "$DIR/install.sh" 2>/dev/null || true
  chmod +x "$DIR/install.sh" 2>/dev/null || true
fi

# ─── .env ─────────────────────────────────────────────────────────────────────

# Replaces one KEY= line, leaving every other line and the file's mode alone. Used for
# WM_VERSION on an upgrade, so .env is never regenerated: new secrets would end existing
# sessions and make stored bank credentials unreadable.
set_env() { # key value file
  tmpfile="$3.tmp.$$"
  awk -v key="$1" -v value="$2" '
    $0 ~ "^" key "=" { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$3" >"$tmpfile"
  chmod 600 "$tmpfile"
  mv "$tmpfile" "$3"
}

if [ ! -f "$DIR/.env" ]; then
  say "Generating .env with fresh secrets..."
  (cd "$DIR" && sh ./generate-env.sh) || die "generate-env.sh failed."
  set_env APP_URL "$APP_URL" "$DIR/.env"
  set_env API_URL "$API_URL" "$DIR/.env"
fi
set_env WM_VERSION "$VERSION" "$DIR/.env"

# ─── Start and wait ───────────────────────────────────────────────────────────

if [ "$UPGRADE" -eq 1 ]; then
  say "Pulling WonderMoney $VERSION..."
  compose pull || die "docker compose pull failed." \
    "Check that the release $VERSION published its images, and the output above."
fi

say "Starting WonderMoney $VERSION (the first start pulls the images)..."
compose up -d || die "docker compose up -d failed." \
  "See the output above; docker compose ps and docker compose logs show what happened."

wait_for_health
print_summary
