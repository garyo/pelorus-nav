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
  exit 1
fi
