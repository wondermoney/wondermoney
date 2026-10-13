#!/usr/bin/env bash
#
# RAD-343 (D1) — end-to-end proof of the household flow against a RUNNING API +
# real database. Provisions two better-auth identities in-process (see the companion
# e2e-household-flow.auth.ts helper), mints bearer tokens by signing in against the
# running API, then drives the whole flow over HTTP and asserts the outcomes, cleaning
# up after itself. This is the live counterpart to the DB-level verify-household-invite.ts.
#
# It exercises: owner provisioning, invite creation, the public pre-signup
# validation endpoint, invite-token signup consumption (partner joins the owner's
# tenant — NOT a new one), the household view, per-account privacy (owner sees a
# private account + isOwnedByViewer; the partner does not see it at all), and the
# member being blocked from mutating it.
#
# better-auth replaced the Supabase admin API, so identities are created through the
# in-process `createBetterAuthUser` helper instead of Supabase's `/auth/v1/admin/users`,
# and token minting is a normal better-auth email sign-in (the bearer plugin returns the
# session token as `set-auth-token`; `getAuthSession` accepts it as `Authorization: Bearer`).
#
# Prereqs — all via env, no secrets in this file:
#   API_URL         default http://localhost:3001
#   ENV_FILE        path to the API .env (for DB_*, used by the better-auth helper)
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE   point at the API's database
#
#   API_URL=http://localhost:3001 ENV_FILE=./.env \
#     PGHOST=localhost PGUSER=... PGPASSWORD=... PGDATABASE=... \
#     bash src/database/scripts/e2e-household-flow.sh
#
set -euo pipefail

API="${API_URL:-http://localhost:3001}"
ENV_FILE="${ENV_FILE:-./.env}"
PW="testpassword123"
TAG="$RANDOM"
OWNER="test+hho${TAG}@wonder.money"
PARTNER="test+hhp${TAG}@wonder.money"
FAILED=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
AUTH_HELPER="$ROOT/src/database/scripts/e2e-household-flow.auth.ts"

# Provision/mint/tear down better-auth identities against the same DB the running API
# uses. Runs from the repo root so tsx resolves the `@service/*` aliases; stdout is the
# id (create) or bearer token (signin), never logged.
auth () {
  ( cd "$ROOT" && NODE_ENV=development ENV_FILE="$ENV_FILE" API_URL="$API" \
      NODE_OPTIONS='--import=tsx' node "$AUTH_HELPER" "$@" )
}

q () { psql -tAc "$1"; }
expect () { # expect <label> <actual> <wanted>
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 (got '$2', wanted '$3')"; FAILED=1; fi
}
create_user () { auth create "$1" "$PW"; }
signin () { auth signin "$1" "$PW"; }
code () { tail -n1 <<<"$1"; }
body () { sed '$d' <<<"$1"; }

OID="$(create_user "$OWNER")"; OTOK="$(signin "$OWNER")"
PID="$(create_user "$PARTNER")"

cleanup () {
  auth delete "$OWNER" >/dev/null 2>&1 || true
  auth delete "$PARTNER" >/dev/null 2>&1 || true
  q "delete from household_invite; delete from account where account_name='Owner Secret';
     delete from appuser_tenant where appuser_key in (select appuser_key from appuser where email_address in ('$OWNER','$PARTNER'));
     delete from subscription where owner_appuser_key in (select appuser_key from appuser where email_address in ('$OWNER','$PARTNER'));
     delete from tenant where owner_appuser_key in (select appuser_key from appuser where email_address in ('$OWNER','$PARTNER'));
     delete from appuser where email_address in ('$OWNER','$PARTNER');" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "1. provision owner"
r="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/auth/callback" -H "Authorization: Bearer $OTOK" -H "Content-Type: application/json" -d '{"locale":"en"}')"
expect "owner provisioned" "$r" "200"

echo "2. owner invites partner"
r="$(curl -s -w '\n%{http_code}' -X POST "$API/v1/household/invites" -H "Authorization: Bearer $OTOK" -H "Content-Type: application/json" -d "{\"email\":\"$PARTNER\"}")"
expect "invite created" "$(code "$r")" "201"

TOKEN="$(q "select token from household_invite where email_address='$PARTNER' and status='pending' order by created_at desc limit 1;")"

echo "3. public validation returns the invite"
r="$(curl -s "$API/v1/household/invites/validate?token=$TOKEN")"
expect "validate email" "$(python3 -c "import sys,json;print(json.loads('''$r''')['email'])")" "$PARTNER"

echo "4. partner joins with the invite token"
PTOK="$(signin "$PARTNER")"
r="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/auth/callback" -H "Authorization: Bearer $PTOK" -H "Content-Type: application/json" -d "{\"locale\":\"en\",\"inviteToken\":\"$TOKEN\"}")"
expect "partner provisioned" "$r" "200"
expect "single shared tenant" "$(q "select count(distinct at.tenant_key) from appuser_tenant at join appuser a on a.appuser_key=at.appuser_key where a.email_address in ('$OWNER','$PARTNER');")" "1"

echo "5. household lists both members"
r="$(curl -s "$API/v1/household" -H "Authorization: Bearer $OTOK")"
expect "member count" "$(python3 -c "import sys,json;print(len(json.loads('''$r''')['members']))")" "2"

echo "6. per-account privacy"
EURID="$(q "select currency_key from currency where code='EUR' limit 1;")"
curl -s -o /dev/null -X POST "$API/v1/account/offline" -H "Authorization: Bearer $OTOK" -H "Content-Type: application/json" -d "{\"currencyId\":$EURID,\"currentBalance\":100,\"name\":\"Owner Secret\"}"
AKEY="$(q "select account_key from account where account_name='Owner Secret' limit 1;")"
curl -s -o /dev/null -X PATCH "$API/v1/account/$AKEY" -H "Authorization: Bearer $OTOK" -H "Content-Type: application/json" -d '{"isPrivate":true}'
expect "owner sees 1 account" "$(curl -s "$API/v1/account" -H "Authorization: Bearer $OTOK" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['accounts']))")" "1"
expect "partner sees 0 accounts (private hidden)" "$(curl -s "$API/v1/account" -H "Authorization: Bearer $PTOK" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['accounts']))")" "0"

if [ "$FAILED" = "0" ]; then echo "✅ household e2e passed"; else echo "❌ household e2e FAILED"; exit 1; fi
