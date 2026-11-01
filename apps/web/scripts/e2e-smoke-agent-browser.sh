#!/usr/bin/env bash
# WonderMoney end-to-end smoke sweep, driven by the agent-browser CLI
# (npm i -g agent-browser && agent-browser install).
#
# Flow: log in -> add a manual bank account -> add a transaction on it ->
# create a portfolio -> add a transaction to it.
#
# Signup is intentionally NOT part of this script: production's signup form
# is gated by an invisible reCAPTCHA that reliably rejects automated browser
# traffic. Create a test account by hand once, then reuse it
# via WM_EMAIL/WM_PASSWORD below.
#
# Usage:
#   WM_EMAIL="you+smoke@wonder.money" WM_PASSWORD="..." \
#     ./scripts/e2e-smoke-agent-browser.sh
#
# Env vars:
#   WM_BASE_URL  Base app URL                          (default: https://app.wonder.money)
#   WM_EMAIL     Existing test account email            (required)
#   WM_PASSWORD  Existing test account password         (required)
#   WM_SESSION   agent-browser session name             (default: wm-smoke)
#   WM_HEADED    Set to 1 to show the browser window    (default: headless)
#
# Known app quirks this script routes around (or surfaces rather than hides):
#   - A fresh login currently redirects even fully-onboarded accounts back to
#     /en/onboarding/welcome and replays the whole wizard every time (looks
#     like completion state isn't checked/persisted server-side). Handled by
#     skip_onboarding_if_present() below.
#   - `agent-browser find text ... click` reliably triggers this app's Radix
#     dismissable-layer "click outside" handler and closes whatever modal/
#     popover is open, even when the clicked text is inside the modal. This
#     is probably also why selecting a transaction Category with the mouse
#     closes the whole Add Transaction modal. This script never
#     uses `find text ... click`; it uses `find role button` for real
#     buttons, and keyboard Arrow/Enter navigation (which does NOT trigger
#     the dismiss bug) for listbox options.
#   - The portfolio "Add Transaction" modal's Transaction type / Broker
#     comboboxes have no accessible name (only visible text), so they can't
#     be targeted with `find label`. They're located by grepping the ref out
#     of `snapshot --json`'s text tree instead (see combobox_ref_by_value).
#   - Submitting a *second* transaction into an existing portfolio in a
#     fresh session appears to silently no-op: the modal closes as if it
#     succeeded, no error is shown, but no create-transaction network call
#     is ever made (confirmed via HAR) and no row appears in Portfolio ->
#     Transactions. Reproduced across 4 different tickers and both keyboard
#     and ref-click interaction, so it isn't specific to this script's input
#     method. This script checks for the success toast and prints a loud
#     warning (without failing the whole run) if it's missing, since a
#     silent app-level regression here would otherwise look like a pass.

set -euo pipefail

WM_BASE_URL="${WM_BASE_URL:-https://app.wonder.money}"
WM_SESSION="${WM_SESSION:-wm-smoke}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"

if [[ -z "${WM_EMAIL:-}" || -z "${WM_PASSWORD:-}" ]]; then
  echo "WM_EMAIL and WM_PASSWORD are required (an existing test account -- see the comment header for why signup isn't scripted)." >&2
  exit 1
fi

HEADED_FLAG=""
if [[ "${WM_HEADED:-0}" == "1" ]]; then
  HEADED_FLAG="--headed"
fi

ab() { agent-browser --session "$WM_SESSION" $HEADED_FLAG "$@"; }

cleanup() { ab close >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Finds the ref of a combobox currently *displaying* $1 as its visible text,
# for comboboxes with no accessible name (find label can't target these).
combobox_ref_by_value() {
  ab snapshot -i --json 2>/dev/null | python3 -c "
import json, sys, re
target = sys.argv[1]
data = json.load(sys.stdin)
snap = data['data']['snapshot']
for line in snap.splitlines():
    m = re.search(r'combobox \[.*?ref=(e\d+)\]:\s*(.+)$', line)
    if m and m.group(2).strip() == target:
        print(m.group(1))
        break
" "$1"
}

skip_onboarding_if_present() {
  local attempts=0
  ab wait 1000
  while [[ "$(ab get url)" == *"/onboarding"* && $attempts -lt 8 ]]; do
    echo "    (onboarding redirect detected: $(ab get url), attempt $((attempts + 1)))"
    attempts=$((attempts + 1))
    if ab find role button click --name "Start setup" 2>/dev/null; then :
    elif ab find role button click --name "Continue without account" 2>/dev/null; then :
    elif ab find role button click --name "Skip this step" 2>/dev/null; then :
    elif ab find role button click --name "Continue" --exact 2>/dev/null; then :
    else
      break
    fi
    ab wait --load networkidle
    ab wait 300
  done
}

echo "==> Logging in as $WM_EMAIL"
ab open "$WM_BASE_URL/en/auth/login"
ab find label "Email" fill "$WM_EMAIL"
ab find label "Password" fill "$WM_PASSWORD"
ab find role button click --name "Sign In" --exact
ab wait --load networkidle

if [[ "$(ab get url)" == *"/auth/login"* ]]; then
  echo "Login failed -- check WM_EMAIL/WM_PASSWORD." >&2
  exit 1
fi

skip_onboarding_if_present

echo "==> Adding a manual bank account"
ACCOUNT_NAME="Smoke Checking $RUN_ID"
ab open "$WM_BASE_URL/en/accounts"
ab wait --load networkidle
ab find role button click --name "Add Account" --exact
ab wait 500
ab find role button click --name "Unlinked"
ab wait 500
ab find label "Name" fill "$ACCOUNT_NAME"
ab find placeholder "00.00" fill "1000"
ab find role button click --name "Create account" --exact
ab wait --load networkidle

echo "==> Adding a transaction on \"$ACCOUNT_NAME\""
ab open "$WM_BASE_URL/en/accounts/transactions"
ab wait --load networkidle
ab find role button click --name "Add Transaction" --exact
ab wait 500
ab find label "Description" fill "Smoke test $RUN_ID"

# Account: searchable combobox, may hold >1 account across repeat runs --
# type the exact name and confirm with Enter rather than trust the default.
ab find label "Account" click
ab wait 300
ab keyboard type "$ACCOUNT_NAME"
ab wait 500
ab press Enter
ab wait 300

# Transaction type: real accessible label, but options are a listbox --
# clicking an option text closes the modal (see header comment), so use
# keyboard nav. "ATM" is pre-highlighted first; 2 downs reaches "Card payment".
ab find label "Transaction type" click
ab wait 300
ab press ArrowDown
ab press ArrowDown
ab press Enter
ab wait 300

# Merchant: type to search, then click the real "Create merchant ..." button
# (a genuine <button>, safe to target by role) rather than the option list.
ab find label "Merchant" click
ab wait 300
ab keyboard type "Smoke Merchant $RUN_ID"
ab wait 700
ab find role button click --name "Create merchant"
ab wait 300

ab find placeholder "00.00" fill "1.23"

# Category: also a listbox, also fine via keyboard nav (unlike a mouse
# click, which closes the whole modal).
ab find label "Category" click
ab wait 300
ab press ArrowDown
ab press ArrowDown
ab press Enter
ab wait 300

ab find role button click --name "Create transaction" --exact
ab wait --load networkidle

echo "==> Creating a portfolio"
PORTFOLIO_NAME="Smoke Portfolio $RUN_ID"
ab open "$WM_BASE_URL/en/portfolio"
ab wait --load networkidle
if ! ab find role button click --name "Create your first portfolio" 2>/dev/null; then
  # Repeat runs: no "create first portfolio" empty state anymore, use the
  # icon-only "+" button next to "Add Transaction" instead (no accessible
  # name at all -- 3rd <button> in <main>).
  cat <<'JS' | ab eval --stdin
document.querySelectorAll('main button')[2]?.click();
JS
fi
ab wait 500
ab find label "Name" fill "$PORTFOLIO_NAME"
ab find role button click --name "Create" --exact
ab wait --load networkidle

echo "==> Adding a transaction to \"$PORTFOLIO_NAME\""
ab find role button click --name "Add Transaction" --exact
ab wait 600

TYPE_REF="$(combobox_ref_by_value "Transaction type")"
ab click "@$TYPE_REF"
ab wait 400
ab press Enter # first item, "Buy", is pre-highlighted on a fresh open
ab wait 300

BROKER_REF="$(combobox_ref_by_value "Broker")"
ab click "@$BROKER_REF"
ab wait 400
ab press ArrowDown
ab press ArrowDown
ab press Enter # Degiro -> Interactive Broker -> Trading212
ab wait 300

ab find placeholder "Search for a ticker or company name, e.g. AAPL or Microsoft" fill "AAPL"
ab wait 1200
ab press ArrowDown
ab press Enter
ab wait 400
ab find label "Quantity" fill "5"
ab find placeholder "00.00" fill "195.50"
ab find role button click --name "Add" --exact
ab wait 1200

if ab snapshot -c 2>/dev/null | grep -qi "transaction saved"; then
  echo "==> Portfolio transaction confirmed via success toast."
else
  echo "!! WARNING: no 'Transaction saved' toast seen after submitting the portfolio transaction." >&2
  echo "!! This app has a known silent-failure bug here (see header comment) -- verify manually" >&2
  echo "!! at $WM_BASE_URL/en/portfolio/transactions before trusting this run." >&2
fi

echo "==> Done. Account: $ACCOUNT_NAME | Portfolio: $PORTFOLIO_NAME"
