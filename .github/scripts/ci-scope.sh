#!/usr/bin/env bash
# Decides whether a CI run checks the whole workspace or only what a pull request affects, and
# writes the turbo arguments for that to $GITHUB_OUTPUT as `affected`:
#   - empty: the full run. Pushes (develop and main, which the release pull request and the API
#     deploys gate on), manual runs, and pull requests that change anything outside apps/ and
#     packages/ other than Markdown (the lockfile, root configuration, workflows and scripts).
#   - `--affected`: a pull request that changes only apps/ and packages/. Turbo then runs a task
#     only in the packages the change touches and the packages that depend on them, comparing
#     against TURBO_SCM_BASE (ci.yml sets it to HEAD^1).
#
# On a pull request, actions/checkout checks out the merge commit, whose first parent is the
# base branch: HEAD^1..HEAD is exactly the pull request's change. The checkout needs
# fetch-depth: 2 for HEAD^1 to be there.
#   .github/scripts/ci-scope.sh
set -euo pipefail
OUTPUT="${GITHUB_OUTPUT:-/dev/stdout}"

full() {
  echo "Full run: $1."
  echo "affected=" >> "$OUTPUT"
  exit 0
}

[ "${GITHUB_EVENT_NAME:-}" = pull_request ] || full "a ${GITHUB_EVENT_NAME:-local} run checks everything"
git rev-parse -q --verify 'HEAD^1' >/dev/null || full "no base commit to compare with (fetch-depth: 2 missing?)"

changed="$(git diff --name-only 'HEAD^1' HEAD)"
outside="$(grep -v -E '^(apps|packages)/|\.md$' <<<"$changed" || true)"
if [ -n "$outside" ]; then
  echo "Changed outside apps/ and packages/:"
  while IFS= read -r file; do echo "  $file"; done <<<"$outside"
  full "the change reaches beyond the workspace packages"
fi

echo "Only apps/ and packages/ changed: checking the affected packages."
echo "affected=--affected" >> "$OUTPUT"
