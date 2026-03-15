#!/usr/bin/env bash
# Check NOAA ENC cells for updates and optionally rebuild + upload.
#
# Sends HTTP HEAD requests to NOAA for each cell in the specified regions,
# compares Last-Modified dates against a local state file, and reports
# which cells have changed. With --rebuild, runs the full pipeline for
# regions that have changes and optionally uploads.
#
# Usage:
#   tools/check-enc-updates.sh [--rebuild] [--upload] [--region REGION] [--quiet]
#
# Options:
#   --rebuild   Re-download changed cells, rebuild tiles, and update state
#   --upload    Upload rebuilt PMTiles to R2 (implies --rebuild)
#   --region R  Check only this region (default: all production regions)
#   --quiet     Only print if there are changes
#
# State is stored in tools/s57-pipeline/data/enc-update-state.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$SCRIPT_DIR/s57-pipeline"
STATE_FILE="$PIPELINE_DIR/data/enc-update-state.json"
NOAA_BASE="https://charts.noaa.gov/ENCs"

# Production regions (derived from pipeline's regions.py, excluding boston-test)
mapfile -t ALL_REGIONS < <(
  cd "$PIPELINE_DIR" && uv run python -c "
from s57_pipeline.regions import REGIONS
for r in REGIONS:
    if r != 'boston-test':
        print(r)
" 2>/dev/null
)

REBUILD=false
UPLOAD=false
QUIET=false
REGIONS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) REBUILD=true; shift ;;
    --upload) UPLOAD=true; REBUILD=true; shift ;;
    --region) REGIONS+=("$2"); shift 2 ;;
    --quiet) QUIET=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ${#REGIONS[@]} -eq 0 ]]; then
  REGIONS=("${ALL_REGIONS[@]}")
fi

# Load or create state file
if [[ -f "$STATE_FILE" ]]; then
  STATE=$(cat "$STATE_FILE")
else
  STATE="{}"
fi

# Read cell list for a region from the cached region JSON
get_region_cells() {
  local region="$1"
  local region_file="$PIPELINE_DIR/data/regions/${region}.json"
  if [[ ! -f "$region_file" ]]; then
    echo "Region file not found: $region_file" >&2
    echo "Run 'bun run tiles:download' first to build region cell lists." >&2
    return 1
  fi
  python3 -c "
import json, sys
data = json.load(open('$region_file'))
cells = data.get('cells', data) if isinstance(data, dict) else data
# Deduplicate
seen = set()
for c in cells:
    if c not in seen:
        seen.add(c)
        print(c)
"
}

# Get stored Last-Modified for a cell from state
get_stored_date() {
  local cell="$1"
  echo "$STATE" | python3 -c "
import json, sys
state = json.load(sys.stdin)
print(state.get('$cell', {}).get('last_modified', ''))
" 2>/dev/null || echo ""
}

# Check a single cell, return "changed" or "unchanged"
check_cell() {
  local cell="$1"
  local url="$NOAA_BASE/${cell}.zip"

  # HEAD request to get Last-Modified
  local headers
  headers=$(curl -sI --max-time 15 "$url" 2>/dev/null) || {
    echo "error"
    return
  }

  local http_code
  http_code=$(echo "$headers" | head -1 | grep -o '[0-9][0-9][0-9]' | head -1)
  if [[ "$http_code" != "200" ]]; then
    echo "error:$http_code"
    return
  fi

  local last_modified
  last_modified=$(echo "$headers" | grep -i '^last-modified:' | sed 's/^[^:]*: *//' | tr -d '\r')

  local stored
  stored=$(get_stored_date "$cell")

  if [[ "$last_modified" != "$stored" ]]; then
    echo "changed:$last_modified"
  else
    echo "unchanged"
  fi
}

# Main check loop
total_checked=0
total_changed=0
declare -A changed_regions  # track which regions have changes
declare -A all_updates      # cell -> new last_modified

for region in "${REGIONS[@]}"; do
  [[ "$QUIET" != true ]] && echo "=== Checking region: $region ==="

  cells=$(get_region_cells "$region") || exit 1
  cell_count=$(echo "$cells" | wc -l | tr -d ' ')
  region_changed=0
  checked=0

  while IFS= read -r cell; do
    [[ -z "$cell" ]] && continue
    checked=$((checked + 1))

    # Progress indicator (every 50 cells)
    if [[ "$QUIET" != true ]] && (( checked % 50 == 0 )); then
      echo "  ... checked $checked / $cell_count"
    fi

    result=$(check_cell "$cell")
    case "$result" in
      changed:*)
        new_date="${result#changed:}"
        all_updates["$cell"]="$new_date"
        region_changed=$((region_changed + 1))
        [[ "$QUIET" != true ]] && echo "  UPDATED: $cell (was: $(get_stored_date "$cell"), now: $new_date)"
        ;;
      error*)
        [[ "$QUIET" != true ]] && echo "  ERROR: $cell ($result)"
        ;;
    esac
  done <<< "$cells"

  total_checked=$((total_checked + checked))
  total_changed=$((total_changed + region_changed))

  if [[ $region_changed -gt 0 ]]; then
    changed_regions["$region"]=1
    echo "$region: $region_changed of $checked cells updated"
  else
    [[ "$QUIET" != true ]] && echo "$region: all $checked cells up to date"
  fi
done

echo ""
echo "Summary: $total_changed changed out of $total_checked cells checked"

if [[ $total_changed -eq 0 ]]; then
  echo "No updates needed."
  exit 0
fi

# Update state file with new dates
python3 -c "
import json, sys

state = json.loads('''$STATE''') if '''$STATE'''.strip() else {}

updates = {
$(for cell in "${!all_updates[@]}"; do
  echo "  '$cell': '${all_updates[$cell]}',"
done)
}

for cell, date in updates.items():
    state[cell] = {'last_modified': date}

with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2, sort_keys=True)
    f.write('\n')

print(f'State file updated: {len(updates)} cells')
"

if [[ "$REBUILD" != true ]]; then
  echo ""
  echo "Run with --rebuild to download changes and rebuild tiles."
  exit 0
fi

# Rebuild changed regions
echo ""
echo "=== Rebuilding changed regions ==="

for region in "${!changed_regions[@]}"; do
  echo "--- Downloading $region ---"
  cd "$PIPELINE_DIR"
  uv run python -m s57_pipeline download --region "$region"

  echo "--- Building $region ---"
  cd "$SCRIPT_DIR/.."
  bash tools/build-tiles.sh "$region"
done

if [[ "$UPLOAD" == true ]]; then
  echo ""
  echo "=== Uploading to R2 ==="
  bash "$SCRIPT_DIR/upload-tiles.sh"
fi

echo ""
echo "Done! Rebuilt regions: ${!changed_regions[*]}"
