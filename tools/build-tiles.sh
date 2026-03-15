#!/usr/bin/env bash
# Build PMTiles for one or all regions.
# Usage: build-tiles.sh <region|all|east-coast> [--download] [--force]
#   Regions are defined in s57-pipeline/s57_pipeline/regions.py
#   east-coast: builds all mainland regions (excludes USVI)
#   all: builds all regions including USVI
#   --download: download ENC cells before building
#   --force: force rebuild all cells

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$SCRIPT_DIR/s57-pipeline"
OUTPUT_DIR="$SCRIPT_DIR/../public"

REGION="${1:?Usage: build-tiles.sh <region|all|east-coast> [--download] [--force]}"
shift

DOWNLOAD=false
EXTRA_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--download" ]]; then
    DOWNLOAD=true
  else
    EXTRA_ARGS+=("$arg")
  fi
done

unify_coverage() {
  echo "=== Unifying coverage masks ==="
  cd "$PIPELINE_DIR"
  uv run python "$SCRIPT_DIR/unify-coverage.py" \
    "$OUTPUT_DIR"/nautical-*.coverage.geojson \
    -o "$OUTPUT_DIR/nautical-unified.coverage.geojson"
}

download_region() {
  local region="$1"
  echo "=== Downloading $region ==="
  cd "$PIPELINE_DIR"
  uv run python -m s57_pipeline download --region "$region"
}

build_region() {
  local region="$1"
  local output="$OUTPUT_DIR/nautical-${region}.pmtiles"
  local min_cells_arg=""

  case "$region" in
    boston-test) ;;
    usvi) ;;
    *) min_cells_arg="--min-cells 30" ;;
  esac

  if [[ "$DOWNLOAD" == true ]]; then
    download_region "$region"
  fi

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
    build_region southern-new-england
    build_region northern-new-england
    build_region new-york
    build_region mid-atlantic
    build_region south-atlantic
    unify_coverage
    ;;
  all)
    build_region southern-new-england
    build_region northern-new-england
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
