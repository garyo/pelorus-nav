#!/usr/bin/env bash
# Build the Android APK and upload to Dropbox for sideloading.
# Usage: tools/upload-apk.sh [--build]
#   --build   Run cap:build first (default: upload existing APK)
set -euo pipefail

APK="android/app/build/outputs/apk/debug/app-debug.apk"
REMOTE="garyo-dropbox:software/pelorus-nav"

if [[ "${1:-}" == "--build" ]]; then
  echo "Building APK..."
  bun run cap:build
fi

if [[ ! -f "$APK" ]]; then
  echo "APK not found at $APK — run with --build or bun run cap:build first"
  exit 1
fi

# Include git SHA and date in the uploaded filename
SHA=$(git rev-parse --short HEAD)
DATE=$(date +%Y-%m-%d)
DEST="pelorus-nav-${DATE}-${SHA}.apk"

echo "Uploading $APK → $REMOTE/$DEST"
rclone copyto "$APK" "$REMOTE/$DEST"

# Also keep a "latest" copy for easy download
rclone copyto "$APK" "$REMOTE/pelorus-nav-latest.apk"

echo "Done. Uploaded as $DEST and pelorus-nav-latest.apk"
