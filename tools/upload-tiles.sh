#!/usr/bin/env bash
# Upload all nautical-*.pmtiles files to Cloudflare R2.
# Skips files that haven't changed since last upload (by modtime).
# Usage: tools/upload-tiles.sh [--force]

set -euo pipefail

BUCKET="pelorus-nav"
STAMP_DIR="public"
FORCE=false

if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

uploaded=0
skipped=0

for file in public/nautical-*.pmtiles; do
  [[ -f "$file" ]] || continue

  name=$(basename "$file")
  stamp="${STAMP_DIR}/.uploaded-${name}"

  if [[ "$FORCE" != true ]] && [[ -f "$stamp" ]] && [[ "$file" -ot "$stamp" ]]; then
    echo "Skip $name (up to date, uploaded $(stat -f %Sm "$stamp"))"
    skipped=$((skipped + 1))
    continue
  fi

  echo "Uploading $name ($(du -h "$file" | cut -f1))..."
  wrangler r2 object put "${BUCKET}/${name}" --file "$file" --remote
  touch "$stamp"
  uploaded=$((uploaded + 1))
done

echo ""
echo "Done: $uploaded uploaded, $skipped skipped"
