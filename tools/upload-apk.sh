#!/usr/bin/env bash
# Build the Android APK and upload to Dropbox for sideloading.
# Usage: tools/upload-apk.sh [--no-build]
#   --no-build   Skip build, upload existing APK (with freshness check)
#   Default: always builds first to prevent shipping stale assets.
set -euo pipefail

REMOTE="garyo-dropbox:software/pelorus-nav"

if [[ "${1:-}" != "--no-build" ]]; then
  echo "Building release APK..."
  bun run cap:build
fi

# Prefer release APK, fall back to debug
APK="android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$APK" ]]; then
  APK="android/app/build/outputs/apk/debug/app-debug.apk"
fi

if [[ ! -f "$APK" ]]; then
  echo "APK not found — run without --no-build"
  exit 1
fi

# Verify the bundled JS contains the current git SHA (catches stale assets)
SHA=$(git rev-parse --short HEAD)
BUNDLE="android/app/src/main/assets/public/assets/index-"*.js
if ! grep -q "$SHA" $BUNDLE 2>/dev/null; then
  echo "ERROR: Web assets are stale (git SHA $SHA not found in JS bundle)."
  echo "Run 'bun run cap:build' first."
  exit 1
fi

DATE=$(date +%Y-%m-%d)
DEST="pelorus-nav-${DATE}-${SHA}.apk"

echo "Uploading $APK → $REMOTE/$DEST"
rclone copyto "$APK" "$REMOTE/$DEST"

# Also keep a "latest" copy for easy download
rclone copyto "$APK" "$REMOTE/pelorus-nav-latest.apk"

echo "Done. Uploaded as $DEST and pelorus-nav-latest.apk"
