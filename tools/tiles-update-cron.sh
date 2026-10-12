#!/bin/zsh
# Wrapper for launchd nightly tile updates
# Logs to ~/Library/Logs/sailing-nav-tiles-update.log and pushes a summary of
# each run (regions rebuilt and why, timings, failures) to ntfy

set -euo pipefail

LOG="$HOME/Library/Logs/sailing-nav-tiles-update.log"
SUMMARY="$(mktemp -t pelorus-tiles-summary)"
trap 'rm -f "$SUMMARY"' EXIT
cd "$(cd "$(dirname "$0")/.." && pwd)"

# Push to ntfy: notify TITLE BODY [TAGS]
# Expected vars in ~/.config/pelorus-ntfy.env: NTFY_USER, NTFY_PASS
notify() {
  [[ -f "$HOME/.config/pelorus-ntfy.env" ]] || return 0
  source "$HOME/.config/pelorus-ntfy.env"
  [[ -n "${NTFY_USER:-}" && -n "${NTFY_PASS:-}" ]] || return 0
  local headers=(-H "Title: $1")
  if [[ -n "${3:-}" ]]; then
    headers+=(-H "Tags: $3")
  fi
  curl --max-time 10 -u "$NTFY_USER:$NTFY_PASS" "${headers[@]}" \
    --data-binary "$2" \
    https://ntfy.oberbrunner.com/pelorus-nav >> "$LOG" 2>&1 || true
}

echo "=== tiles:update started at $(date) ===" >> "$LOG"

# Self-update: pull latest from origin/main so new region definitions, build
# scripts, etc. are picked up automatically. --ff-only fails loudly if the
# working tree has local edits, which is what we want — a stale build is
# preferable to a silent merge, and the failure surfaces via the notify path.
echo "--- git pull --ff-only origin main ---" >> "$LOG"
if ! git pull --ff-only origin main >> "$LOG" 2>&1; then
  echo "=== git pull failed at $(date) ===" >> "$LOG"
  STATUS=1
# Test affordance: when /tmp/pelorus-tiles-force-fail exists, skip the real
# build and force the failure path. Used to smoke-test launchd + notifications
# end-to-end without waiting for a 2-hour rebuild.
elif [[ -f /tmp/pelorus-tiles-force-fail ]]; then
  echo "=== TEST MODE: flag file present, forcing failure ===" >> "$LOG"
  STATUS=1
elif bun run tiles:update --summary "$SUMMARY" >> "$LOG" 2>&1; then
  STATUS=0
else
  STATUS=1
fi

if [[ $STATUS -eq 0 ]]; then
  echo "=== tiles:update completed at $(date) ===" >> "$LOG"
  built=$(sed -n 's/^Built \([^ ]*\) in .*/\1/p' "$SUMMARY" | paste -sd, - | sed 's/,/, /g')
  title="Pelorus tiles: no rebuilds"
  if [[ -n "$built" ]]; then
    title="Pelorus tiles: rebuilt $built"
  fi
  tags=""
  if grep -q '^!!!' "$SUMMARY"; then
    tags="warning"
  fi
  notify "$title" "$(cat "$SUMMARY")" "$tags"
else
  echo "=== tiles:update FAILED at $(date) ===" >> "$LOG"
  osascript -e "display notification \"tiles:update failed — check $LOG\" with title \"Pelorus Nav\" sound name \"Basso\""
  notify "Pelorus tiles: update FAILED" \
    "$(cat "$SUMMARY"; echo "Logs are at $LOG")" "warning"
  exit 1
fi
