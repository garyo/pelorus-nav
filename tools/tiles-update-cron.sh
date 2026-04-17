#!/bin/zsh
# Wrapper for launchd nightly tile updates
# Logs to ~/sailing-nav-tiles-update.log, notifies on failure

set -euo pipefail

LOG="$HOME/Library/Logs/sailing-nav-tiles-update.log"
cd /Users/garyo/src/pelorus-nav

echo "=== tiles:update started at $(date) ===" >> "$LOG"

# Test affordance: when /tmp/pelorus-tiles-force-fail exists, skip the real
# build and force the failure path. Used to smoke-test launchd + notifications
# end-to-end without waiting for a 2-hour rebuild.
if [[ -f /tmp/pelorus-tiles-force-fail ]]; then
  echo "=== TEST MODE: flag file present, forcing failure ===" >> "$LOG"
  STATUS=1
elif /Users/garyo/.bun/bin/bun run tiles:update >> "$LOG" 2>&1; then
  STATUS=0
else
  STATUS=1
fi

if [[ $STATUS -eq 0 ]]; then
  echo "=== tiles:update completed at $(date) ===" >> "$LOG"
  if [[ -f "$HOME/.config/pelorus-ntfy.env" ]]; then
    source "$HOME/.config/pelorus-ntfy.env"
    if [[ -n "${NTFY_USER:-}" && -n "${NTFY_PASS:-}" ]]; then
      curl --max-time 10 -u "$NTFY_USER:$NTFY_PASS" \
        -d "Pelorus tile rebuild succeeded. Logs are at $LOG" \
        https://ntfy.oberbrunner.com/misc >> "$LOG" 2>&1 || true
    fi
  fi
else
  echo "=== tiles:update FAILED at $(date) ===" >> "$LOG"
  osascript -e 'display notification "tiles:update failed — check $LOG" with title "Pelorus Nav" sound name "Basso"'
  # ntfy push notification
  # Expected vars: NTFY_USER, NTFY_PASS
  if [[ -f "$HOME/.config/pelorus-ntfy.env" ]]; then
    source "$HOME/.config/pelorus-ntfy.env"
    if [[ -n "${NTFY_USER:-}" && -n "${NTFY_PASS:-}" ]]; then
      curl --max-time 10 -u "$NTFY_USER:$NTFY_PASS" \
        -H "Tags: warning" \
        -d "Pelorus tile rebuild failed; check logs at $LOG" \
        https://ntfy.oberbrunner.com/misc >> "$LOG" 2>&1 || true
    fi
  fi
  exit 1
fi
