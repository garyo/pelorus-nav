# Pipeline TUI Progress Display Plan

## Problem

The pipeline dumps hundreds of "Converted layer_name" and "Tiled layer_name" messages per cell, making it hard to see the overall progress, warnings, and errors. A typical run with 50+ cells × 50+ layers produces thousands of lines.

## Goal

Replace raw print output with a compact, updating TUI that shows:
- Overall pipeline stage and progress
- Per-cell status (processing/done/error) without per-layer spam
- Warnings and errors prominently
- Final summary with timing

## Library Choice: Rich

**`rich`** (https://github.com/Textualize/rich) — the best fit:
- Live-updating display with `Live` context manager
- Progress bars with multiple concurrent tasks
- Tables, panels, colored text
- Works in all terminals including basic SSH
- Falls back gracefully to plain text if terminal doesn't support it
- Lightweight (~3MB), pure Python, no C extensions
- MIT licensed, extremely popular (50k+ GitHub stars)

Alternatives considered:
- **`tqdm`**: progress bars only, no rich layout
- **`textual`**: full TUI framework, overkill for a build script
- **`curses`**: low-level, not cross-platform, painful to use
- **`click.echo`**: no live updating

## Current Output Structure

```
Pass 1: Scanning INTU + M_COVR for 42 cells (7 workers)...
  INTU bands present: [2, 3, 5]
    INTU 2: z5-z8 (band 0)
    ...
  M_COVR: 40 cells with coverage
  Pass 1 complete (2.3s)

Pass 2: Processing 42 ENC files (5 parallel workers)
  Processing US5MA11M (z10-z14, band 2)...
    Converted DEPARE → depare.geojson        ← repeated ~50x per cell
    Converted LNDARE → lndare.geojson
    ...
    Tiled DEPARE → depare.pmtiles            ← repeated ~50x per cell
    Tiled LNDARE → lndare.pmtiles
    ...
  Processing US5MA12M ...
  ...
  Pass 2 complete (3m 45.2s)

Pass 3: Compositing...
  Phase 1: Reading tile sources...
  Phase 2: Compositing 12345 tiles...
  ...
```

## Proposed Display

### Pass 1 (Scanning) — simple spinner
```
⠋ Pass 1: Scanning coverage    12/42 cells    [━━━━━━━━━░░░░░░░░░░░] 29%
```

### Pass 2 (Convert + Tile) — the big one
```
Pass 2: Processing 42 cells (5 workers)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 28/42 cells  67%  ETA 1m 30s

  US5MA11M  ████████████████░░░░ tiling  32/50 layers
  US5MA12M  ██████░░░░░░░░░░░░░░ converting  12/50 layers
  US5MA16M  ██░░░░░░░░░░░░░░░░░░ converting  4/50 layers
  US3EC06M  ████████████████████ ✓ done (45.2s)
  US3EC07M  ████████████████████ ✓ done (38.1s)

  ⚠ Warning: US5MA19M has no M_COVR coverage
```

Key design choices:
- **Overall progress bar** at top — how many cells complete
- **Per-worker rows** showing active cells — what's running right now
- **Completed cells** cycle off the bottom (show last 2-3)
- **Warnings** stick at bottom, always visible
- **No per-layer messages** unless there's an error
- Layer count (32/50) gives progress without naming each one

### Pass 3 (Compositing) — progress bar + phases
```
Pass 3: Compositing
  Phase 1: Reading sources   ━━━━━━━━━━━━━━━━━━━━ 100%  12,345 tiles  (3.2s)
  Phase 2: Compositing       ━━━━━━━━━━░░░░░░░░░░  52%  6,410/12,345
    ├ 4,200 pass-through  ├ 1,800 same-band  ├ 410 multi-band
  Phase 3: Writing           pending
```

### Final Summary
```
Pipeline complete (4m 12.3s)
  42 cells processed, 12,345 tiles composited
  Output: ../../public/nautical-new-england.pmtiles (280 MB)

  ⚠ 2 warnings:
    US5MA19M: no M_COVR coverage
    3 multi-band tiles not fully filled
```

## Implementation Plan

### 1. Add `rich` dependency

```toml
# pyproject.toml
dependencies = [
    "mapbox-vector-tile>=2.0",
    "pmtiles>=3.7.0",
    "shapely>=2.0",
    "rich>=13.0",
]
```

### 2. Create `tools/s57-pipeline/s57_pipeline/progress.py`

New module that wraps Rich's `Live`, `Progress`, `Table`, and `Console`:

```python
from rich.console import Console
from rich.live import Live
from rich.progress import Progress, BarColumn, TaskProgressColumn, TimeRemainingColumn
from rich.table import Table
from rich.panel import Panel

class PipelineProgress:
    """Manages live-updating pipeline display."""

    def __init__(self, verbose: bool = False):
        self.console = Console()
        self.verbose = verbose  # if True, show per-layer messages too
        self.warnings: list[str] = []
        self.errors: list[str] = []

    def scan_phase(self, total_cells: int) -> ScanProgress:
        """Context manager for Pass 1."""
        ...

    def process_phase(self, total_cells: int, max_workers: int) -> ProcessProgress:
        """Context manager for Pass 2."""
        ...

    def composite_phase(self, total_tiles: int) -> CompositeProgress:
        """Context manager for Pass 3."""
        ...

    def print_summary(self, elapsed: float, output_path: str, ...):
        """Print final summary panel."""
        ...
```

Each phase context manager yields a progress tracker that the existing code calls into:

```python
class ProcessProgress:
    def cell_started(self, cell_name: str, min_zoom: int, max_zoom: int, band: int): ...
    def cell_layer_done(self, cell_name: str, layer_name: str, step: str): ...
    def cell_done(self, cell_name: str, elapsed: float): ...
    def cell_skipped(self, cell_name: str): ...
    def cell_error(self, cell_name: str, error: str): ...
    def warning(self, msg: str): ...
```

### 3. Modify `cli.py` — replace print() calls

Replace direct prints with progress tracker calls. The key change is in `_process_cell()` and `cmd_pipeline()`:

```python
# Before:
print(f"  Converted {layer_name} → {path.name}")

# After:
progress.cell_layer_done(cell_name, layer_name, "converted")
```

The progress object decides whether to display it (verbose mode) or just increment the counter.

### 4. Modify `convert.py` and `tile.py` — callback pattern

Instead of printing directly, accept an optional callback:

```python
def convert_enc(
    enc_path: Path,
    output_dir: Path,
    layers: list[str],
    on_layer_done: Callable[[str], None] | None = None,
) -> list[Path]:
    ...
    if on_layer_done:
        on_layer_done(layer_name)
    ...
```

This keeps convert.py/tile.py usable standalone (they still work with no callback) while allowing the pipeline orchestrator to hook in progress updates.

### 5. Modify `composite.py` — progress callback

The compositing phase already has good phase separation. Add a callback for tile progress:

```python
def composite_tiles(
    ...,
    on_progress: Callable[[int], None] | None = None,  # called with tiles_done count
):
```

### 6. Add `--verbose` / `-v` flag

```python
parser.add_argument("-v", "--verbose", action="store_true",
                    help="Show per-layer conversion/tiling messages")
```

- Default: compact TUI (per-cell progress only)
- `--verbose`: also show per-layer messages (current behavior, for debugging)
- When stdout is not a TTY (piped to file): fall back to plain text, no live updating

### 7. TTY detection fallback

```python
if not console.is_terminal:
    # Fall back to simple print() output (current behavior)
    # This handles: piping to file, CI, non-interactive terminals
```

## File Changes Summary

| File | Change |
|------|--------|
| `pyproject.toml` | Add `rich>=13.0` dependency |
| `s57_pipeline/progress.py` | **New** — PipelineProgress class with Rich display |
| `s57_pipeline/cli.py` | Replace print() with progress tracker calls; add `--verbose` flag |
| `s57_pipeline/convert.py` | Add optional `on_layer_done` callback parameter |
| `s57_pipeline/tile.py` | Add optional `on_layer_done` callback parameter |
| `s57_pipeline/composite.py` | Add optional `on_progress` callback parameter |

## Implementation Order

1. Add `rich` to deps, create `progress.py` with the display classes
2. Add callback parameters to convert.py, tile.py, composite.py (backward compatible)
3. Wire up cli.py to use PipelineProgress
4. Add `--verbose` flag and TTY fallback
5. Test with actual pipeline run

## Concurrency Considerations

Pass 2 runs 5+ worker threads simultaneously, each converting/tiling a different cell.
Naive approaches will produce flickering, interleaved output, or race conditions.

**Key design rules:**

1. **Single `Live` context owns the terminal.** All updates go through the shared
   `PipelineProgress` object — workers never print directly.

2. **Thread-safe state updates.** The progress tracker holds a `threading.Lock` around
   its internal state (active cells dict, completed count, warnings list). Worker
   callbacks acquire the lock, mutate state, and release. The `Live` refresh loop
   reads a snapshot under the lock to render. Rich's `Live(refresh_per_second=4)`
   rate-limits redraws so even rapid updates don't flicker.

3. **Fixed-slot worker display.** Instead of appending/removing rows dynamically,
   pre-allocate N rows (one per worker). Each row shows either the worker's current
   cell or "idle". This avoids layout jumps when cells complete at different times.

   ```
   Pass 2: Processing 42 cells (5 workers)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 28/42  67%  ETA 1m 30s

     [1] US5MA11M   tiling    32/50 layers
     [2] US5MA12M   converting 12/50 layers
     [3] US5MA16M   converting  4/50 layers
     [4] US3EC06M   ✓ done (45.2s)
     [5] (idle)
   ```

4. **Atomic cell transitions.** A cell goes through exactly three states:
   `started → (layer updates) → done/error`. The progress callback for each
   layer just increments a counter — no string formatting under contention.

5. **Warnings buffer.** Warnings are appended to a list and rendered below
   the progress display. They persist (don't scroll away) and are also
   included in the final summary.

6. **Composite phase is simpler.** Pass 3 uses multiprocessing (not threads)
   with a single progress counter incremented via a shared `Value` or
   callback from the main process collecting results. No concurrent display
   issues.

## Non-Goals

- No interactive TUI (no keyboard input, no scrolling)
- No log file output (use shell redirection: `pipeline ... 2>&1 | tee log.txt`)
- No Windows-specific terminal handling (Rich handles this)
