#!/usr/bin/env bash
# Upload all nautical-* data files (PMTiles + coverage GeoJSON) to Cloudflare R2.
# Skips files that haven't changed since last upload (by modtime).
# Uses S3-compatible multipart upload (no file size limit).
#
# Required env vars: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# (can be set in .env file)
#
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

for file in public/nautical-*.pmtiles public/nautical-*.coverage.geojson; do
  [[ -f "$file" ]] || continue

  name=$(basename "$file")
  stamp="${STAMP_DIR}/.uploaded-${name}"

  if [[ "$FORCE" != true ]] && [[ -f "$stamp" ]] && [[ "$file" -ot "$stamp" ]]; then
    echo "Skip $name (up to date, uploaded $(stat -f %Sm "$stamp"))"
    skipped=$((skipped + 1))
    continue
  fi

  echo "Uploading $name ($(du -h "$file" | cut -f1))..."
  bun tools/r2-upload.ts "$BUCKET" "$name" "$file"
  touch "$stamp"
  uploaded=$((uploaded + 1))
done

echo ""
echo "Done: $uploaded uploaded, $skipped skipped"
