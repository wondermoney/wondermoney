#!/usr/bin/env bash
# Vercel's "Ignored Build Step" (`ignoreCommand` in vercel.json) for the projects deployed by
# Vercel's Git integration: apps/docs, apps/landing and packages/react-email. Exit 0 skips the
# build; any other exit builds.
#
# Skips only when nothing under the given paths changed since the commit of the branch's last
# deployment ($VERCEL_GIT_PREVIOUS_SHA), so a release that brings several commits to main at once
# still builds for a change in any of them (HEAD^..HEAD saw only the last one). A branch with no
# deployment yet builds in production; a preview branch's first push compares with its parent
# commit, as before, rather than building every project for every new branch. Builds whenever the
# commits can't be fetched or compared.
#   bash ../../scripts/vercel-ignore-build.sh <path>...   (paths relative to the project's root)
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "No paths given: building."
  exit 1
fi
previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$previous" ]; then
  if [ "${VERCEL_ENV:-}" = production ]; then
    echo "No previous production deployment: building."
    exit 1
  fi
  echo "No previous deployment on this branch: comparing with the parent commit."
  previous="HEAD^"
fi
# Vercel clones shallowly, so an older commit may be missing from the clone.
if ! git cat-file -e "${previous}^{commit}" 2>/dev/null \
  && ! git fetch --quiet --depth=1 origin "$previous" 2>/dev/null; then
  echo "Can't fetch ${previous}, the last deployed commit: building."
  exit 1
fi
if git diff --quiet "$previous" HEAD -- "$@"; then
  echo "Nothing under $* changed since ${previous}: skipping the build."
  exit 0
fi
echo "Changes under $* since ${previous} (or they can't be compared): building."
exit 1
