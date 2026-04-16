#!/bin/zsh
# Wrapper for launchd nightly tile updates
# Logs to ~/sailing-nav-tiles-update.log, notifies on failure

set -euo pipefail

LOG="$HOME/sailing-nav-tiles-update.log"
cd /Users/garyo/src/pelorus-nav

echo "=== tiles:update started at $(date) ===" >> "$LOG"

if /Users/garyo/.bun/bin/bun run tiles:update >> "$LOG" 2>&1; then
  echo "=== tiles:update completed at $(date) ===" >> "$LOG"
else
  echo "=== tiles:update FAILED at $(date) ===" >> "$LOG"
  osascript -e 'display notification "tiles:update failed — check ~/sailing-nav-tiles-update.log" with title "Pelorus Nav" sound name "Basso"'
  # ntfy push — credentials live in ~/.config/pelorus-ntfy.env (untracked)
  # Expected vars: NTFY_USER, NTFY_PASS
  if [[ -f "$HOME/.config/pelorus-ntfy.env" ]]; then
    source "$HOME/.config/pelorus-ntfy.env"
    if [[ -n "${NTFY_USER:-}" && -n "${NTFY_PASS:-}" ]]; then
      curl --max-time 10 -u "$NTFY_USER:$NTFY_PASS" \
        -d "Pelorus tile rebuild failed; check logs at $LOG" \
        https://ntfy.oberbrunner.com/misc >> "$LOG" 2>&1 || true
    fi
  fi
  exit 1
fi
