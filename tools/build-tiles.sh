#!/usr/bin/env bash
# Build PMTiles for one or all regions.
# Usage: build-tiles.sh <region|all|east-coast> [--force]
#   region: boston-test, new-england, new-york, mid-atlantic, south-atlantic, usvi
#   east-coast: builds all four mainland regions
#   all: builds all regions including USVI
#   --force: force rebuild all cells

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$SCRIPT_DIR/s57-pipeline"
OUTPUT_DIR="$SCRIPT_DIR/../public"

REGION="${1:?Usage: build-tiles.sh <region|all|east-coast> [--force]}"
shift
EXTRA_ARGS=("$@")

unify_coverage() {
  echo "=== Unifying coverage masks ==="
  cd "$PIPELINE_DIR"
  uv run python "$SCRIPT_DIR/unify-coverage.py" \
    "$OUTPUT_DIR"/nautical-*.coverage.geojson \
    -o "$OUTPUT_DIR/nautical-unified.coverage.geojson"
}

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
    new-york)
      output="$OUTPUT_DIR/nautical-new-york.pmtiles"
      min_cells_arg="--min-cells 30"
      ;;
    mid-atlantic)
      output="$OUTPUT_DIR/nautical-mid-atlantic.pmtiles"
      min_cells_arg="--min-cells 30"
      ;;
    south-atlantic)
      output="$OUTPUT_DIR/nautical-south-atlantic.pmtiles"
      min_cells_arg="--min-cells 30"
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

case "$REGION" in
  east-coast)
    build_region new-england
    build_region new-york
    build_region mid-atlantic
    build_region south-atlantic
    unify_coverage
    ;;
  all)
    build_region new-england
    build_region new-york
    build_region mid-atlantic
    build_region south-atlantic
    build_region usvi
    unify_coverage
    ;;
  *)
    build_region "$REGION"
    unify_coverage
    ;;
esac
