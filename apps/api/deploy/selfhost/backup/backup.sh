#!/bin/sh
# WonderMoney backups: the entrypoint of the optional `backup` and `backup-offsite` services in
# docker-compose.yml (README.md, "Back up"). POSIX sh, for the Alpine images both run on.
#
# backup (the postgres image, BACKUP_ROLE=local):
#   schedule                 take a backup on BACKUP_SCHEDULE (the service's default command)
#   now                      take one now: BACKUP_DIR/<timestamp>/ with wondermoney.dump (pg_dump
#                            -Fc), storage.tar.gz (the storage-data volume) and SHA256SUMS
#   list                     the finished backups in BACKUP_DIR
#   restore <folder|latest>  replace the database and the storage volume with a backup; refuses
#                            while the API, the worker or the bundled store run (--yes: no question)
#
# backup-offsite (the rclone image, BACKUP_ROLE=offsite):
#   schedule                 copy on BACKUP_OFFSITE_SCHEDULE (the service's default command)
#   now                      copy every finished backup to BACKUP_DESTINATION, then delete the
#                            copies there older than BACKUP_OFFSITE_KEEP_DAYS
#   list                     the backups on BACKUP_DESTINATION
#   fetch <folder|latest>    copy one back into BACKUP_DIR, to restore it
#   config                   rclone's interactive remote setup, saved in ./rclone/rclone.conf
#
# A backup is written to BACKUP_DIR/.tmp-<timestamp> and renamed to <timestamp> only once every
# file is complete and on disk, so an interrupted run never leaves a folder that looks finished;
# the next run deletes what it left. Only folders named <timestamp> are ever pruned or copied
# off-site: nothing else in BACKUP_DIR (and never .env, which is not mounted here) leaves it.
set -eu

ROOT=/backups
STORAGE=/storage
ROLE=${BACKUP_ROLE:-local}
# 2026-11-12T020000Z: sorts by time, and has no colon for remotes that reject one.
STAMP_GLOB='[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z'
STAGING=.wm-restore

say() {
  printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  printf 'backup: %s\n' "$1" >&2
  shift
  for line in "$@"; do
    printf '  %s\n' "$line" >&2
  done
  exit 1
}

is_stamp() {
  # shellcheck disable=SC2254 # the pattern is the point
  case "$1" in
    $STAMP_GLOB) return 0 ;;
    *) return 1 ;;
  esac
}

# 2026-11-12T020000Z -> 20261112020000, for comparing with -lt.
stamp_number() {
  printf '%s\n' "$1" | tr -cd '0-9'
}

# The stamp-number of the moment <days> days ago.
cutoff_number() {
  date -u -d "@$(($(date -u +%s) - $1 * 86400))" +%Y%m%d%H%M%S
}

check_days() { # name value
  case "$2" in
    '' | *[!0-9]*) die "$1 must be a whole number of days (0 keeps every copy), not '$2'." ;;
  esac
}

# Serialises backups, restores and off-site copies (all of them share BACKUP_DIR). Waits for the
# running one unless the first argument is "nowait".
take_lock() {
  [ -d "$ROOT" ] || die "$ROOT is not mounted: check BACKUP_DIR in .env."
  exec 9>>"$ROOT/.lock"
  if ! flock -n 9; then
    [ "${1:-}" = nowait ] && die "Another backup, restore or off-site copy is running; try again once it finishes."
    say "waiting for the backup, restore or off-site copy already running"
    flock 9
  fi
}

# The finished backups in BACKUP_DIR, oldest first.
local_stamps() {
  for dir in "$ROOT"/*/; do
    name=${dir%/}
    name=${name##*/}
    if is_stamp "$name"; then
      printf '%s\n' "$name"
    fi
  done
}

# Runs this script with <command> on <schedule>, through busybox crond, for as long as the
# container runs. crond starts jobs with an empty environment, so the job reads this one's back
# from a file; its output goes to the container's log.
schedule() { # schedule-variable-name schedule
  set -f
  # shellcheck disable=SC2086 # counting the fields is the point
  set -- "$1" $2
  set +f
  if [ $# -ne 6 ]; then
    die "$1 must be a cron expression of five fields, e.g. '0 2 * * *' for 02:00 every day."
  fi
  name=$1
  shift
  expression="$*"

  umask 077
  mkdir -p /run/wondermoney-backup/crontabs
  export -p >/run/wondermoney-backup/env
  printf '%s . /run/wondermoney-backup/env && /bin/sh %s now >/proc/1/fd/1 2>/proc/1/fd/2\n' \
    "$expression" "$0" >/run/wondermoney-backup/crontabs/root
  if [ "$ROLE" = offsite ]; then
    say "off-site copies to $BACKUP_DESTINATION scheduled: '$expression' ($name, time zone ${TZ:-UTC})"
  else
    say "backups scheduled: '$expression' ($name, time zone ${TZ:-UTC})"
  fi
  exec crond -f -d 8 -c /run/wondermoney-backup/crontabs
}

# ─── The backup service ───────────────────────────────────────────────────────

# The postgres connection comes from the libpq variables the compose file sets.
require_database() {
  [ -n "${PGHOST:-}" ] && [ -n "${PGUSER:-}" ] && [ -n "${PGDATABASE:-}" ] ||
    die "PGHOST, PGUSER and PGDATABASE must be set (docker-compose.yml sets them)."
}

prune_local() {
  days=${BACKUP_KEEP_DAYS:-7}
  check_days BACKUP_KEEP_DAYS "$days"
  [ "$days" -gt 0 ] || return 0
  cutoff=$(cutoff_number "$days")
  for name in $(local_stamps); do
    if [ "$(stamp_number "$name")" -lt "$cutoff" ]; then
      rm -rf "${ROOT:?}/$name"
      say "deleted $name (older than $days days)"
    fi
  done
}

backup_now() {
  require_database
  check_days BACKUP_KEEP_DAYS "${BACKUP_KEEP_DAYS:-7}"
  umask 077
  take_lock

  # What an interrupted run left: nothing else can be writing, as this run holds the lock.
  for leftover in "$ROOT"/.tmp-*; do
    [ -e "$leftover" ] || continue
    rm -rf "$leftover"
    say "deleted ${leftover##*/}, left by an interrupted run"
  done

  stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
  final="$ROOT/$stamp"
  tmp="$ROOT/.tmp-$stamp"
  [ ! -e "$final" ] || die "$final already exists."
  mkdir "$tmp"
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP

  say "backing up database $PGDATABASE"
  pg_dump --format=custom --file="$tmp/wondermoney.dump"
  # Reads the dump's table of contents back, so a truncated file fails here and not at restore.
  pg_restore --list "$tmp/wondermoney.dump" >/dev/null

  if [ -d "$STORAGE" ]; then
    say "backing up the storage-data volume"
    tar -czf "$tmp/storage.tar.gz" -C "$STORAGE" --exclude "./$STAGING" .
  fi

  (
    cd "$tmp"
    if [ -f storage.tar.gz ]; then
      sha256sum wondermoney.dump storage.tar.gz
    else
      sha256sum wondermoney.dump
    fi >SHA256SUMS
  )
  sync
  mv "$tmp" "$final"
  sync
  trap - EXIT INT TERM HUP
  say "backup finished: $stamp ($(du -sh "$final" | cut -f1))"

  prune_local
}

list_local() {
  [ -d "$ROOT" ] || die "$ROOT is not mounted: check BACKUP_DIR in .env."
  found=0
  for name in $(local_stamps); do
    printf '%s  %s\n' "$name" "$(du -sh "$ROOT/$name" | cut -f1)"
    found=1
  done
  [ "$found" -eq 1 ] || say "no backups in BACKUP_DIR yet"
}

# Running containers of these compose services answer on the project network by their service
# name; stopped ones do not. The trailing dot keeps the host's search domains out of it.
running_services() {
  for service in "$@"; do
    if getent hosts "$service." >/dev/null 2>&1; then
      printf '%s ' "$service"
    fi
  done
}

restore() {
  require_database
  folder=
  yes=0
  for arg in "$@"; do
    case "$arg" in
      --yes | -y) yes=1 ;;
      -*) die "Unknown option: $arg" ;;
      *)
        [ -z "$folder" ] || die "restore takes one folder."
        folder=$arg
        ;;
    esac
  done
  [ -n "$folder" ] || die "Which backup? docker compose run --rm backup restore <folder>, or latest." \
    "docker compose run --rm backup list shows them."

  if [ "$folder" = latest ]; then
    folder=$(local_stamps | tail -n 1)
    [ -n "$folder" ] || die "There is no backup in BACKUP_DIR."
  fi
  folder=${folder%/}
  is_stamp "$folder" || die "Not a backup folder: $folder" \
    "Give the folder's name as docker compose run --rm backup list shows it, e.g. 2026-11-12T020000Z."
  dir="$ROOT/$folder"
  [ -f "$dir/wondermoney.dump" ] || die "$folder has no wondermoney.dump."

  say "checking $folder"
  if [ -f "$dir/SHA256SUMS" ]; then
    (cd "$dir" && sha256sum -c -s SHA256SUMS) || die "$folder does not match its SHA256SUMS: a file is damaged."
  fi
  pg_restore --list "$dir/wondermoney.dump" >/dev/null || die "$folder/wondermoney.dump is not readable."
  with_storage=0
  if [ -f "$dir/storage.tar.gz" ]; then
    [ -d "$STORAGE" ] || die "The storage-data volume is not mounted at $STORAGE."
    tar -tzf "$dir/storage.tar.gz" >/dev/null || die "$folder/storage.tar.gz is not readable."
    with_storage=1
  fi

  # Nothing may write to the database (or the store) while it is replaced.
  if [ "$with_storage" -eq 1 ]; then
    running=$(running_services api worker storage)
  else
    running=$(running_services api worker)
  fi
  if [ -n "$running" ]; then
    die "Stop the app first: ${running% } still running." \
      "docker compose stop proxy web worker api storage" \
      "then run the restore again, and docker compose up -d afterwards."
  fi
  sessions=$(psql -d postgres -XAtq -v ON_ERROR_STOP=1 -v db="$PGDATABASE" <<'SQL'
SELECT count(*) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid();
SQL
  )
  if [ "$sessions" != 0 ]; then
    die "$sessions other connection(s) to database $PGDATABASE are open: stop whatever uses it first." \
      "docker compose stop proxy web worker api storage"
  fi

  if [ "$yes" -ne 1 ]; then
    [ -t 0 ] || die "Pass --yes to restore without a terminal to confirm in."
    if [ "$with_storage" -eq 1 ]; then
      what="database $PGDATABASE and the storage-data volume"
    else
      what="database $PGDATABASE"
    fi
    printf 'Replace %s with backup %s? Their current contents are lost. [y/N]: ' "$what" "$folder" >&2
    answer=
    IFS= read -r answer || answer=
    case "$answer" in
      y | Y | yes | YES) ;;
      *) die "Left as it was." ;;
    esac
  fi

  take_lock nowait

  # Into a new database first: the current one stays as it is until the dump loaded in full.
  new="${PGDATABASE}_restoring"
  old="${PGDATABASE}_replaced"
  psql -d postgres -Xq -v ON_ERROR_STOP=1 -v new="$new" -v old="$old" -v owner="$PGUSER" <<'SQL'
SET client_min_messages TO warning;
DROP DATABASE IF EXISTS :"new";
DROP DATABASE IF EXISTS :"old";
CREATE DATABASE :"new" OWNER :"owner";
SQL
  say "restoring database $PGDATABASE from $folder"
  if ! pg_restore --dbname="$new" --no-owner --no-privileges --exit-on-error "$dir/wondermoney.dump"; then
    psql -d postgres -Xq -v new="$new" <<'SQL' || true
SET client_min_messages TO warning;
DROP DATABASE IF EXISTS :"new";
SQL
    die "pg_restore failed; database $PGDATABASE was left as it was."
  fi
  # One transaction: either both renames happen or neither. A rename fails while anyone is
  # connected to that database.
  if ! psql -d postgres -Xq -v ON_ERROR_STOP=1 -v db="$PGDATABASE" -v new="$new" -v old="$old" <<'SQL'
SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') AS had_db \gset
BEGIN;
\if :had_db
ALTER DATABASE :"db" RENAME TO :"old";
\endif
ALTER DATABASE :"new" RENAME TO :"db";
COMMIT;
SET client_min_messages TO warning;
DROP DATABASE IF EXISTS :"old";
SQL
  then
    die "Could not swap in the restored database (is something connected to $PGDATABASE?)." \
      "$PGDATABASE was left as it was; the restored copy is in database $new."
  fi

  if [ "$with_storage" -eq 1 ]; then
    say "restoring the storage-data volume from $folder"
    rm -rf "${STORAGE:?}/$STAGING"
    mkdir "$STORAGE/$STAGING"
    tar -xzf "$dir/storage.tar.gz" -C "$STORAGE/$STAGING"
    find "$STORAGE" -mindepth 1 -maxdepth 1 ! -name "$STAGING" -exec rm -rf {} +
    find "$STORAGE/$STAGING" -mindepth 1 -maxdepth 1 -exec mv {} "$STORAGE/" \;
    rmdir "$STORAGE/$STAGING"
  else
    say "$folder has no storage.tar.gz: the storage-data volume was left as it was"
  fi

  say "restored $folder. Start the app again: docker compose up -d"
}

# ─── The backup-offsite service ───────────────────────────────────────────────

require_destination() {
  [ -n "${BACKUP_DESTINATION:-}" ] ||
    die "Set BACKUP_DESTINATION in .env to an rclone remote and path, e.g. b2:my-bucket/wondermoney." \
      "docker compose run --rm backup-offsite config sets up the remote."
}

# <destination>/<name>, for a destination of remote:, remote:path or remote:path/.
remote_path() {
  case "$BACKUP_DESTINATION" in
    *: | */) printf '%s%s\n' "$BACKUP_DESTINATION" "$1" ;;
    *) printf '%s/%s\n' "$BACKUP_DESTINATION" "$1" ;;
  esac
}

# The finished backups on the destination, oldest first. Empty when it does not exist yet
# (rclone's exit status 3); any other failure, such as a wrong password, stops the script.
remote_stamps() {
  errors=$(mktemp)
  status=0
  listing=$(rclone lsf --dirs-only "$BACKUP_DESTINATION" 2>"$errors") || status=$?
  if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then
    cat "$errors" >&2
  fi
  rm -f "$errors"
  [ "$status" -ne 3 ] || return 0
  [ "$status" -eq 0 ] || die "Could not list $BACKUP_DESTINATION (rclone exit status $status)."
  printf '%s\n' "$listing" | while IFS= read -r entry; do
    name=${entry%/}
    if is_stamp "$name"; then
      printf '%s\n' "$name"
    fi
  done | sort
}

offsite_now() {
  require_destination
  days=${BACKUP_OFFSITE_KEEP_DAYS:-30}
  check_days BACKUP_OFFSITE_KEEP_DAYS "$days"
  take_lock

  if [ -z "$(local_stamps)" ]; then
    say "no finished backups in BACKUP_DIR to copy"
    return 0
  fi
  say "copying backups to $BACKUP_DESTINATION"
  # Copy, not sync: a backup deleted here (or a BACKUP_DIR emptied by accident) stays off-site
  # until it is older than BACKUP_OFFSITE_KEEP_DAYS.
  rclone copy "$ROOT" "$BACKUP_DESTINATION" --include "/$STAMP_GLOB/**"

  [ "$days" -gt 0 ] || return 0
  cutoff=$(cutoff_number "$days")
  names=$(remote_stamps)
  for name in $names; do
    if [ "$(stamp_number "$name")" -lt "$cutoff" ]; then
      rclone purge "$(remote_path "$name")"
      say "deleted $name from $BACKUP_DESTINATION (older than $days days)"
    fi
  done
  say "off-site copy finished"
}

list_remote() {
  require_destination
  found=0
  names=$(remote_stamps)
  for name in $names; do
    printf '%s\n' "$name"
    found=1
  done
  [ "$found" -eq 1 ] || say "no backups on $BACKUP_DESTINATION yet"
}

fetch() {
  require_destination
  [ $# -eq 1 ] || die "Which backup? docker compose run --rm backup-offsite fetch <folder>, or latest." \
    "docker compose run --rm backup-offsite list shows them."
  folder=${1%/}
  if [ "$folder" = latest ]; then
    names=$(remote_stamps)
    folder=$(printf '%s\n' "$names" | tail -n 1)
    [ -n "$folder" ] || die "There is no backup on $BACKUP_DESTINATION."
  fi
  is_stamp "$folder" || die "Not a backup folder: $folder"
  [ ! -e "$ROOT/$folder" ] || die "$folder is already in BACKUP_DIR."
  umask 077
  take_lock

  tmp="$ROOT/.tmp-fetch-$folder"
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  say "copying $folder from $BACKUP_DESTINATION"
  rclone copy "$(remote_path "$folder")" "$tmp"
  [ -f "$tmp/wondermoney.dump" ] || die "$folder on $BACKUP_DESTINATION has no wondermoney.dump."
  if [ -f "$tmp/SHA256SUMS" ]; then
    (cd "$tmp" && sha256sum -c -s SHA256SUMS) || die "$folder does not match its SHA256SUMS: a file is damaged."
  fi
  sync
  mv "$tmp" "$ROOT/$folder"
  trap - EXIT INT TERM HUP
  say "fetched $folder. Restore it: docker compose run --rm backup restore $folder"
}

# ─── Commands ─────────────────────────────────────────────────────────────────

command=${1:-schedule}
[ $# -eq 0 ] || shift

case "$ROLE:$command" in
  local:schedule) schedule BACKUP_SCHEDULE "${BACKUP_SCHEDULE:-0 2 * * *}" ;;
  local:now) backup_now ;;
  local:list) list_local ;;
  local:restore) restore "$@" ;;
  offsite:schedule)
    require_destination
    schedule BACKUP_OFFSITE_SCHEDULE "${BACKUP_OFFSITE_SCHEDULE:-30 2 * * *}"
    ;;
  offsite:now) offsite_now ;;
  offsite:list) list_remote ;;
  offsite:fetch) fetch "$@" ;;
  offsite:config) exec rclone config "$@" ;;
  local:* | offsite:*)
    die "Unknown command: $command" \
      "backup:          schedule, now, list, restore <folder|latest> [--yes]" \
      "backup-offsite:  schedule, now, list, fetch <folder|latest>, config"
    ;;
  *) die "BACKUP_ROLE must be local or offsite, not '$ROLE'." ;;
esac
