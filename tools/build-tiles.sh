#!/usr/bin/env bash
# Build PMTiles for one or all regions.
# Usage: build-tiles.sh <region|all> [--force]
#   region: boston-test, new-england, usvi, all
#   --force: force rebuild all cells

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$SCRIPT_DIR/s57-pipeline"
OUTPUT_DIR="$SCRIPT_DIR/../public"

REGION="${1:?Usage: build-tiles.sh <region|all> [--force]}"
shift
EXTRA_ARGS=("$@")

build_region() {
  local region="$1"
  local min_cells_arg=""
  local output

  case "$region" in
    boston-test)
      output="$OUTPUT_DIR/nautical-boston-test.pmtiles"
      ;;
    new-england)
      output="$OUTPUT_DIR/nautical-new-england.pmtiles"
      min_cells_arg="--min-cells 50"
      ;;
    usvi)
      output="$OUTPUT_DIR/nautical-usvi.pmtiles"
      ;;
    *)
      echo "Unknown region: $region" >&2
      exit 1
      ;;
  esac

  echo "=== Building $region ==="
  cd "$PIPELINE_DIR"
  # shellcheck disable=SC2086
  uv run python -m s57_pipeline pipeline \
    --region "$region" \
    $min_cells_arg \
    -o "$output" \
    "${EXTRA_ARGS[@]}"
}

if [ "$REGION" = "all" ]; then
  build_region new-england
  build_region usvi
else
  build_region "$REGION"
fi
