#!/usr/bin/env bash
# Prints a "Thanks to" section for a release's notes: every author of a pull request in the
# release, with first-time contributors marked. Bots are left out. See CONTRIBUTING.md,
# "Release notes".
#
#   .github/scripts/release-thanks.sh vX.Y.Z               # since the latest release
#   .github/scripts/release-thanks.sh vX.Y.Z vA.B.C        # since an earlier tag
#
# It reads GitHub's generated notes for the release, so it credits exactly the pull requests
# the generated draft lists, after .github/release.yml's exclusions. The tag need not exist
# yet: GitHub then generates the notes for main's head (TARGET overrides the branch).
# Generating notes creates nothing, but GitHub only lets people with write access to the
# repository ask for them. Needs gh, signed in.
set -euo pipefail

TAG="${1:?usage: release-thanks.sh vX.Y.Z [previous-tag]}"
PREVIOUS="${2:-}"
REPO="${GITHUB_REPOSITORY:-wondermoney/wondermoney}"
TARGET="${TARGET:-main}"

args=(-f "tag_name=$TAG" -f "target_commitish=$TARGET")
[ -n "$PREVIOUS" ] && args+=(-f "previous_tag_name=$PREVIOUS")

notes="$(gh api --method POST "repos/$REPO/releases/generate-notes" "${args[@]}" --jq .body)"

# Each pull request is a line "* <title> by @<login> in https://github.com/.../pull/<n>"; the
# greedy match takes the last " by @", in case a title contains one. Logins ending in [bot]
# are apps, not people.
authors="$(printf '%s\n' "$notes" |
  sed -nE 's#^\* .* by @([A-Za-z0-9-]+(\[bot\])?) in https://[^ ]+/pull/[0-9]+$#\1#p' |
  grep -v '\[bot\]$' | sort -fu || true)"
# The "New Contributors" lines: "* @<login> made their first contribution in <url>".
first_timers="$(printf '%s\n' "$notes" |
  sed -nE 's#^\* @([A-Za-z0-9-]+) made their first contribution in .*#\1#p' | sort -fu || true)"

if [ -z "$authors" ]; then
  echo "No pull request authors in the generated notes for $TAG." >&2
  exit 1
fi

printf '## Thanks to\n\n'
while IFS= read -r login; do
  if grep -qixF -- "$login" <<<"$first_timers"; then
    printf -- '- @%s (first contribution)\n' "$login"
  else
    printf -- '- @%s\n' "$login"
  fi
done <<<"$authors"
