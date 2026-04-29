#!/usr/bin/env bash
# Unified tile pipeline orchestrator.
#
# Usage: build-tiles.sh [operations] [region selection] [modifiers]
#
# Operations (combine as needed; default: --check):
#   --check           Check NOAA for ENC updates (report only)
#   --download        Download ENC cells
#   --build           Convert + tile + composite regions
#   --upload          Upload PMTiles + coverage to R2
#   --update          Shorthand for --check --download --build --upload
#   --composite-only  Re-composite only (skip convert/tile)
#
# Region selection (default: all production):
#   --region <name>   Specific region (repeatable)
#   --east-coast      Mainland only (no usvi, no boston-test)
#   (no flag)         All production regions (no boston-test)
#
# Modifiers:
#   --force           Force rebuild / re-upload regardless of state
#   --force-download  Re-download all cells even if already up to date
#   --zoom-shift N    Pass zoom-shift to pipeline (default: 2)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

# Load .env for R2 upload credentials (if present)
if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROJECT_DIR/.env"
  set +a
fi
PIPELINE_DIR="$SCRIPT_DIR/s57-pipeline"
OUTPUT_DIR="$PROJECT_DIR/public"
STAMP_DIR="$OUTPUT_DIR"
R2_BUCKET="pelorus-nav"
TILE_DATA_DIR="$PROJECT_DIR/tile-data"

# Ensure tile-data dir and symlink exist (safe for fresh clones)
mkdir -p "$TILE_DATA_DIR"
if [[ ! -e "$PIPELINE_DIR/data" ]]; then
  ln -s "$TILE_DATA_DIR" "$PIPELINE_DIR/data"
elif [[ ! -L "$PIPELINE_DIR/data" ]]; then
  echo "Error: $PIPELINE_DIR/data exists but is not a symlink." >&2
  echo "Fix with: mv $PIPELINE_DIR/data/* $TILE_DATA_DIR/ && rmdir $PIPELINE_DIR/data && ln -s $TILE_DATA_DIR $PIPELINE_DIR/data" >&2
  exit 1
fi

# Shared source of truth for region ids/bboxes: tools/regions.json
# (also consumed by the Python pipeline and the client catalog).
# All production regions = every region in the JSON, minus the dev-only boston-test.
REGIONS_JSON="$SCRIPT_DIR/regions.json"
ALL_PROD_REGIONS=()
while IFS= read -r rid; do
  [[ -n "$rid" ]] && ALL_PROD_REGIONS+=("$rid")
done < <(jq -r '.[] | select(.id != "boston-test") | .id' "$REGIONS_JSON")
EAST_COAST_REGIONS=(southern-new-england northern-new-england new-york mid-atlantic south-atlantic)

# --- Parse arguments ---

OP_CHECK=false
OP_DOWNLOAD=false
OP_BUILD=false
OP_UPLOAD=false
COMPOSITE_ONLY=false
FORCE=false
FORCE_DOWNLOAD=false
EAST_COAST=false
ZOOM_SHIFT=""
REGIONS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)      OP_CHECK=true ;;
    --download)   OP_DOWNLOAD=true ;;
    --build)      OP_BUILD=true ;;
    --upload)     OP_UPLOAD=true ;;
    --update)     OP_CHECK=true; OP_DOWNLOAD=true; OP_BUILD=true; OP_UPLOAD=true ;;
    --composite-only) COMPOSITE_ONLY=true ;;
    --force)          FORCE=true ;;
    --force-download) FORCE_DOWNLOAD=true ;;
    --east-coast)     EAST_COAST=true ;;
    --zoom-shift) shift; ZOOM_SHIFT="$1" ;;
    --region)     shift; REGIONS+=("$1") ;;
    --help|-h)
      awk 'NR==1{next} /^$/{exit} {sub(/^# ?/,""); print}' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
  shift
done

# Default operation: --check
if ! $OP_CHECK && ! $OP_DOWNLOAD && ! $OP_BUILD && ! $OP_UPLOAD; then
  OP_CHECK=true
fi

# Resolve region list
if [[ ${#REGIONS[@]} -eq 0 ]]; then
  if $EAST_COAST; then
    REGIONS=("${EAST_COAST_REGIONS[@]}")
  else
    REGIONS=("${ALL_PROD_REGIONS[@]}")
  fi
fi

# --- Timing helpers ---

format_elapsed() {
  local secs=$1
  printf "%dm%02ds" $((secs / 60)) $((secs % 60))
}

# --- Operations ---

CHANGED_REGIONS=()

do_check() {
  echo "=== Checking NOAA for ENC updates ==="
  local start=$SECONDS

  local region_args=()
  for r in "${REGIONS[@]}"; do
    region_args+=(--region "$r")
  done

  local json_output
  json_output=$(cd "$PIPELINE_DIR" && uv run python "$SCRIPT_DIR/check-enc-updates.py" \
    "${region_args[@]}" --json)

  # Parse JSON output for changed regions
  CHANGED_REGIONS=()
  while IFS= read -r region; do
    [[ -n "$region" ]] && CHANGED_REGIONS+=("$region")
  done < <(echo "$json_output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data.get('changed_regions', []):
    print(r)
")

  local total_checked total_changed
  total_checked=$(echo "$json_output" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total_checked',0))")
  total_changed=$(echo "$json_output" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total_changed',0))")

  echo "Checked $total_checked cells: $total_changed changed"

  # Also check for cells with failed builds — these need rebuilding
  # even if NOAA dates haven't changed.
  local failed_regions
  failed_regions=$(cd "$PIPELINE_DIR" && uv run python -c "
import sys
sys.path.insert(0, '.')
from s57_pipeline.state import StateDB
from s57_pipeline.regions import REGIONS, get_region_cells
db = StateDB()
failed = {name for name, in db._conn.execute(
    'SELECT cell_name FROM cell_build_state WHERE success = 0'
).fetchall()}
db.close()
if not failed:
    sys.exit(0)
regions = set()
for r in REGIONS:
    if r == 'boston-test':
        continue
    cells = set(get_region_cells(r))
    if cells & failed:
        regions.add(r)
for r in sorted(regions):
    print(r)
" 2>/dev/null || true)

  while IFS= read -r region; do
    if [[ -n "$region" ]]; then
      # Add to CHANGED_REGIONS if not already present
      local found=false
      for existing in "${CHANGED_REGIONS[@]}"; do
        [[ "$existing" == "$region" ]] && found=true && break
      done
      if ! $found; then
        CHANGED_REGIONS+=("$region")
      fi
    fi
  done <<< "$failed_regions"

  if [[ ${#CHANGED_REGIONS[@]} -gt 0 ]]; then
    echo "Regions to update: ${CHANGED_REGIONS[*]}"
  else
    echo "All regions up to date."
  fi

  local elapsed=$((SECONDS - start))
  echo "Check completed in $(format_elapsed $elapsed)"
  echo ""
}

do_download() {
  local region="$1"
  echo "--- Downloading $region ---"
  local start=$SECONDS
  local extra_args=()
  if $FORCE_DOWNLOAD; then
    extra_args+=(--force)
  fi
  cd "$PIPELINE_DIR"
  uv run python -m s57_pipeline download --region "$region" ${extra_args[@]+"${extra_args[@]}"}
  local elapsed=$((SECONDS - start))
  echo "Download $region: $(format_elapsed $elapsed)"
}

do_build() {
  local region="$1"
  local output="$OUTPUT_DIR/nautical-${region}.pmtiles"
  local start=$SECONDS

  local min_cells_arg=""
  case "$region" in
    boston-test|usvi) ;;
    *) min_cells_arg="--min-cells 30" ;;
  esac

  local extra_args=()
  if $COMPOSITE_ONLY; then
    extra_args+=(--composite-only)
  fi
  if $FORCE; then
    extra_args+=(--force)
  fi
  if [[ -n "$ZOOM_SHIFT" ]]; then
    extra_args+=(--zoom-shift "$ZOOM_SHIFT")
  fi

  echo "--- Building $region ---"
  cd "$PIPELINE_DIR"
  # shellcheck disable=SC2086
  uv run python -m s57_pipeline pipeline \
    --region "$region" \
    $min_cells_arg \
    -o "$output" \
    ${extra_args[@]+"${extra_args[@]}"}

  local elapsed=$((SECONDS - start))
  local size="(not found)"
  if [[ -f "$output" ]]; then
    size=$(du -h "$output" | cut -f1)
  fi
  echo "Build $region: $(format_elapsed $elapsed), output: $size"
}

do_upload() {
  echo "=== Uploading to R2 ==="
  local start=$SECONDS
  local uploaded=0
  local skipped=0

  for file in "$OUTPUT_DIR"/nautical-*.pmtiles "$OUTPUT_DIR"/nautical-*.coverage.geojson "$OUTPUT_DIR"/nautical-*.search.json; do
    [[ -f "$file" ]] || continue

    local name
    name=$(basename "$file")
    local stamp="${STAMP_DIR}/.uploaded-${name}"

    if ! $FORCE && [[ -f "$stamp" ]] && [[ "$file" -ot "$stamp" ]]; then
      echo "Skip $name (up to date)"
      skipped=$((skipped + 1))
      continue
    fi

    echo "Uploading $name ($(du -h "$file" | cut -f1))..."
    bun "$SCRIPT_DIR/r2-upload.ts" "$R2_BUCKET" "$name" "$file"
    touch "$stamp"
    uploaded=$((uploaded + 1))
  done

  local elapsed=$((SECONDS - start))
  echo "Upload: $uploaded uploaded, $skipped skipped in $(format_elapsed $elapsed)"
  echo ""
}

unify_coverage() {
  echo "=== Unifying coverage masks ==="
  # Only include production region coverage files. A glob would pick up dev-only
  # files (boston-test, s64-test) and pollute the mask — e.g. S-64 test ENCs
  # include "AA" cells positioned near Denver, CO that would otherwise show as
  # spurious chart coverage when zoomed out.
  local inputs=()
  for r in "${ALL_PROD_REGIONS[@]}"; do
    local f="$OUTPUT_DIR/nautical-$r.coverage.geojson"
    if [[ -f "$f" ]]; then
      inputs+=("$f")
    else
      echo "Warning: missing coverage file $f" >&2
    fi
  done
  if [[ ${#inputs[@]} -eq 0 ]]; then
    echo "Error: no production coverage files found" >&2
    exit 1
  fi
  cd "$PIPELINE_DIR"
  uv run python "$SCRIPT_DIR/unify-coverage.py" \
    "${inputs[@]}" \
    -o "$OUTPUT_DIR/nautical-unified.coverage.geojson"
}

update_check_state() {
  echo "=== Saving ENC update state ==="
  local region_args=()
  for r in "${REGIONS[@]}"; do
    region_args+=(--region "$r")
  done
  cd "$PIPELINE_DIR"
  uv run python "$SCRIPT_DIR/check-enc-updates.py" "${region_args[@]}" --save-state --quiet
}

# --- Main ---

TOTAL_START=$SECONDS

# Step 1: Check (if requested)
if $OP_CHECK; then
  do_check
fi

# Determine which regions to build
BUILD_REGIONS=("${REGIONS[@]}")
if $OP_CHECK && ! $FORCE; then
  # Narrow to only changed regions
  if [[ ${#CHANGED_REGIONS[@]} -eq 0 ]]; then
    BUILD_REGIONS=()
  else
    BUILD_REGIONS=("${CHANGED_REGIONS[@]}")
  fi
fi

# Step 2: Download (if requested)
if $OP_DOWNLOAD && [[ ${#BUILD_REGIONS[@]} -gt 0 ]]; then
  echo "=== Downloading ENC cells ==="
  for region in "${BUILD_REGIONS[@]}"; do
    do_download "$region"
  done
  echo ""
fi

# Step 3: Build (if requested)
if $OP_BUILD; then
  if [[ ${#BUILD_REGIONS[@]} -eq 0 ]]; then
    echo "No regions to build (all up to date)."
  else
    echo "=== Building tiles ==="
    for region in "${BUILD_REGIONS[@]}"; do
      do_build "$region"
      echo ""
    done
    unify_coverage
    echo ""
  fi
fi

# Step 4: Upload (if requested)
if $OP_UPLOAD && [[ ${#BUILD_REGIONS[@]} -gt 0 ]]; then
  do_upload
fi

# Update state after successful build+upload
if $OP_CHECK && $OP_BUILD && [[ ${#BUILD_REGIONS[@]} -gt 0 ]]; then
  update_check_state
fi

# Total timing
TOTAL_ELAPSED=$((SECONDS - TOTAL_START))
echo "=== Total time: $(format_elapsed $TOTAL_ELAPSED) ==="
