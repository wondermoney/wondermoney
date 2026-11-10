#!/usr/bin/env bash
# Keeps only the turbo cache entries the turbo runs of this CI job used (hit or written), as
# listed by their --summarize reports, so the cache that actions/cache saves holds one run's
# worth of entries instead of growing with every run.
#   .github/scripts/prune-turbo-cache.sh [cache dir, default .turbo/cache]
set -euo pipefail
CACHE_DIR="${1:-.turbo/cache}"
shopt -s nullglob
summaries=(.turbo/runs/*.json)
if [ ${#summaries[@]} -eq 0 ]; then
  echo "No turbo run summaries; leaving $CACHE_DIR as it is."
  exit 0
fi
used="$(mktemp)"
jq -r '.tasks[].hash' "${summaries[@]}" | sort -u > "$used"
kept=0
dropped=0
for entry in "$CACHE_DIR"/*; do
  name="$(basename "$entry")"
  # <hash>.tar.zst, <hash>-meta.json, <hash>-manifest.json
  if grep -qxF "${name%%[-.]*}" "$used"; then
    kept=$((kept + 1))
  else
    rm -rf "$entry"
    dropped=$((dropped + 1))
  fi
done
echo "Turbo cache: kept $kept files, dropped $dropped; $(du -sh "$CACHE_DIR" 2>/dev/null | cut -f1) in all."
