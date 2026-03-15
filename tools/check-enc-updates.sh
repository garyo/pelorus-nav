#!/usr/bin/env bash
# Thin wrapper — delegates to the Python implementation.
# Usage: tools/check-enc-updates.sh [--rebuild] [--upload] [--region REGION] [--quiet] [-j N]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/s57-pipeline"
exec uv run python "$SCRIPT_DIR/check-enc-updates.py" "$@"
