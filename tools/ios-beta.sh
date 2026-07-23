#!/usr/bin/env bash
#
# Build, sign, and upload an iOS TestFlight beta from this Mac in one command.
#   bun run ios:beta
#
# This replaces the manual "sync + Xcode Archive + upload" dance. It builds the
# web bundle, syncs it into the iOS project, archives a Release build (signing
# managed automatically via your App Store Connect API key), exports an .ipa,
# and uploads it to TestFlight.
#
# ── One-time setup ───────────────────────────────────────────────────────────
# 1. In App Store Connect → Users and Access → Integrations → App Store Connect
#    API, create a key with the "App Manager" role. Download the AuthKey_*.p8
#    (you only get one download) and note the Key ID and Issuer ID.
# 2. Create ios/.beta-config (gitignored) with:
#       ASC_KEY_ID=XXXXXXXXXX
#       ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#       ASC_KEY_PATH=/absolute/path/to/AuthKey_XXXXXXXXXX.p8
#       ASC_TEAM_ID=XXXXXXXXXX     # the paid team that owns the App Store Connect app
# 3. The App Store Connect app record (bundle id com.darkstarsystems.pelorus.app)
#    must exist under the darkstar team.
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Xcode's IPA-packaging step shells out to `rsync -E` (Apple extended
# attributes). Apple's /usr/bin/rsync re-invokes `rsync` from PATH for its
# other end, so a Homebrew rsync earlier in PATH answers instead and rejects
# --extended-attributes — the export then dies with "Copy failed". Put the
# system tools first for the whole build.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

CONFIG="ios/.beta-config"
if [ ! -f "$CONFIG" ]; then
  echo "✗ Missing $CONFIG — see the setup notes at the top of tools/ios-beta.sh" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$CONFIG"
set +a
: "${ASC_KEY_ID:?set ASC_KEY_ID in $CONFIG}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID in $CONFIG}"
: "${ASC_KEY_PATH:?set ASC_KEY_PATH in $CONFIG}"
: "${ASC_TEAM_ID:?set ASC_TEAM_ID in $CONFIG}"
[ -f "$ASC_KEY_PATH" ] || { echo "✗ ASC_KEY_PATH not found: $ASC_KEY_PATH" >&2; exit 1; }

# altool/xcodebuild look for the key under ~/.appstoreconnect/private_keys.
KEYDIR="$HOME/.appstoreconnect/private_keys"
mkdir -p "$KEYDIR"
cp -f "$ASC_KEY_PATH" "$KEYDIR/AuthKey_${ASC_KEY_ID}.p8"

# TestFlight requires a unique, increasing build number per marketing version.
BUILD_NUMBER="$(git rev-list --count HEAD)"
MARKETING_VERSION="$(node -p "require('./package.json').version")"
echo "==> Pelorus Nav $MARKETING_VERSION (build $BUILD_NUMBER)"

echo "==> Building web bundle + syncing iOS"
CAPACITOR=1 bun run build
bunx cap sync ios

APPDIR="ios/App"
BUILD="$APPDIR/build"
ARCHIVE="$BUILD/App.xcarchive"
EXPORT="$BUILD/export"
mkdir -p "$BUILD"
rm -rf "$ARCHIVE" "$EXPORT"

cat > "$BUILD/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>${ASC_TEAM_ID}</string>
  <key>destination</key><string>export</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
PLIST

AUTH=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$ASC_KEY_PATH"
  -authenticationKeyID "$ASC_KEY_ID"
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"
)

echo "==> Archiving (Release)"
xcodebuild -project "$APPDIR/App.xcodeproj" -scheme App -configuration Release \
  -archivePath "$ARCHIVE" -destination 'generic/platform=iOS' \
  DEVELOPMENT_TEAM="$ASC_TEAM_ID" \
  MARKETING_VERSION="$MARKETING_VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  "${AUTH[@]}" archive

echo "==> Exporting .ipa"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT" \
  -exportOptionsPlist "$BUILD/ExportOptions.plist" "${AUTH[@]}"

IPA="$(ls "$EXPORT"/*.ipa | head -1)"
echo "==> Uploading $IPA to TestFlight"
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "✓ Build $BUILD_NUMBER uploaded. It appears in TestFlight after processing (~5–15 min)."
