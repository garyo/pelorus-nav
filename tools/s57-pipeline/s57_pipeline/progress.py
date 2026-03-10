"""Rich-based TUI progress display for the S-57 pipeline.

Provides a PipelineProgress class that manages all display output.
Uses Rich Live for live-updating display when stdout is a TTY,
falls back to plain print() otherwise.
"""

from __future__ import annotations

import sys
import threading
from dataclasses import dataclass


def _is_tty() -> bool:
    """Check if stdout is a TTY."""
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


def _fmt_elapsed(seconds: float) -> str:
    """Format elapsed time as human-readable string."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes}m {secs:.1f}s"


@dataclass
class _CellState:
    """Mutable state for a cell being processed."""

    name: str
    info: str = ""
    step: str = "starting"  # "converting", "tiling", "done", "error", "skipped"
    layers_done: int = 0
    elapsed: float = 0.0
    error: str = ""


class PipelineProgress:
    """Manages live-updating pipeline display.

    Thread-safe: uses threading.Lock for state updates from parallel workers.
    Falls back to plain print() when stdout is not a TTY.
    """

    def __init__(self, verbose: bool = False) -> None:
        self.verbose = verbose
        self.warnings: list[str] = []
        self.errors: list[str] = []
        self._use_rich = _is_tty()
        self._lock = threading.Lock()

        # Pass 1 state
        self._scan_total = 0
        self._scan_done = 0

        # Pass 2 state
        self._process_total = 0
        self._process_done = 0
        self._max_workers = 0
        self._worker_slots: dict[int, _CellState | None] = {}
        self._cell_to_slot: dict[str, int] = {}
        self._recent_done: list[_CellState] = []

        # Pass 3 state
        self._composite_phases: dict[int, tuple[str, int, int, float]] = {}
        # phase -> (description, done, total, elapsed)

        # Rich objects (lazy init)
        self._console: object | None = None
        self._live: object | None = None

    def _get_console(self) -> object:
        """Lazy-init Rich Console."""
        if self._console is None:
            from rich.console import Console

            self._console = Console()
        return self._console  # type: ignore[return-value]

    def _start_live(self) -> None:
        """Start Rich Live context."""
        if not self._use_rich:
            return
        from rich.live import Live

        console = self._get_console()
        self._live = Live(
            "",
            console=console,  # type: ignore[arg-type]
            refresh_per_second=4,
            transient=True,
        )
        self._live.start()  # type: ignore[union-attr]

    def _stop_live(self) -> None:
        """Stop Rich Live context."""
        if self._live is not None:
            self._live.stop()  # type: ignore[union-attr]
            self._live = None

    def _update_display(self) -> None:
        """Rebuild and push the display to Rich Live."""
        if not self._use_rich or self._live is None:
            return

        from rich.table import Table
        from rich.text import Text

        lines = Text()

        # Pass 2 display
        if self._process_total > 0:
            pct = (
                int(self._process_done / self._process_total * 100)
                if self._process_total > 0
                else 0
            )
            bar_width = 40
            filled = int(bar_width * self._process_done / self._process_total) if self._process_total > 0 else 0
            bar = "\u2501" * filled + "\u2591" * (bar_width - filled)
            lines.append(
                f"Pass 2: Processing {self._process_total} cells"
                f" ({self._max_workers} workers)\n",
                style="bold",
            )
            lines.append(
                f"{bar} {self._process_done}/{self._process_total}"
                f" cells  {pct}%\n\n",
            )

            # Worker slots
            for slot_id in sorted(self._worker_slots):
                cell_state = self._worker_slots[slot_id]
                if cell_state is None:
                    lines.append(f"  [{slot_id}] ", style="dim")
                    lines.append("(idle)\n", style="dim")
                elif cell_state.step == "done":
                    lines.append(f"  [{slot_id}] {cell_state.name}  ", style="dim")
                    lines.append(
                        f"\u2713 done ({_fmt_elapsed(cell_state.elapsed)})\n",
                        style="green",
                    )
                elif cell_state.step == "error":
                    lines.append(f"  [{slot_id}] {cell_state.name}  ", style="dim")
                    lines.append(f"\u2717 error\n", style="red")
                elif cell_state.step == "skipped":
                    lines.append(f"  [{slot_id}] {cell_state.name}  ", style="dim")
                    lines.append("skipped\n", style="yellow")
                else:
                    lines.append(f"  [{slot_id}] {cell_state.name}  ")
                    lines.append(f"{cell_state.step}  ")
                    lines.append(f"{cell_state.layers_done} layers\n")

        # Warnings
        if self.warnings:
            lines.append("\n")
            for w in self.warnings[-5:]:  # Show last 5 warnings
                lines.append(f"  \u26a0 {w}\n", style="yellow")

        self._live.update(lines)  # type: ignore[union-attr]

    # ── Pass 1: Scanning ──

    def scan_start(self, total_cells: int) -> None:
        """Signal start of Pass 1 scanning."""
        self._scan_total = total_cells
        self._scan_done = 0
        if self._use_rich:
            self._start_live()
            self._update_scan_display()
        else:
            print(f"Pass 1: Scanning INTU + M_COVR for {total_cells} cells...")

    def scan_cell_done(self) -> None:
        """Signal one cell scanned."""
        with self._lock:
            self._scan_done += 1
        if self._use_rich:
            self._update_scan_display()

    def _update_scan_display(self) -> None:
        """Update the scan progress display."""
        if not self._use_rich or self._live is None:
            return
        from rich.text import Text

        pct = (
            int(self._scan_done / self._scan_total * 100)
            if self._scan_total > 0
            else 0
        )
        bar_width = 40
        filled = int(bar_width * self._scan_done / self._scan_total) if self._scan_total > 0 else 0
        bar = "\u2501" * filled + "\u2591" * (bar_width - filled)

        text = Text()
        text.append("Pass 1: Scanning coverage    ", style="bold")
        text.append(
            f"{self._scan_done}/{self._scan_total} cells    "
            f"{bar}  {pct}%"
        )
        self._live.update(text)  # type: ignore[union-attr]

    def scan_complete(self, elapsed: float, intu_info: str, mcovr_info: str) -> None:
        """Signal Pass 1 complete."""
        self._stop_live()
        if self._use_rich:
            console = self._get_console()
            console.print(  # type: ignore[union-attr]
                f"[bold]Pass 1: Scanning complete[/bold]"
                f" ({_fmt_elapsed(elapsed)})"
            )
            if intu_info:
                console.print(f"  {intu_info}")  # type: ignore[union-attr]
            if mcovr_info:
                console.print(f"  {mcovr_info}")  # type: ignore[union-attr]
        else:
            print(f"  Pass 1 complete ({_fmt_elapsed(elapsed)})")
            if intu_info:
                print(f"  {intu_info}")
            if mcovr_info:
                print(f"  {mcovr_info}")

    # ── Pass 2: Convert + Tile ──

    def process_start(self, total_cells: int, max_workers: int) -> None:
        """Signal start of Pass 2 processing."""
        self._process_total = total_cells
        self._process_done = 0
        self._max_workers = max_workers
        self._worker_slots = {i: None for i in range(1, max_workers + 1)}
        self._cell_to_slot = {}
        self._recent_done = []
        if self._use_rich:
            self._start_live()
            self._update_display()
        else:
            print(
                f"\nPass 2: Processing {total_cells} ENC files"
                f" ({max_workers} parallel workers)"
            )

    def cell_started(self, cell_name: str, info: str) -> None:
        """Signal a cell has started processing."""
        with self._lock:
            # Find a free slot
            slot_id = None
            for sid, state in self._worker_slots.items():
                if state is None or state.step in ("done", "error", "skipped"):
                    slot_id = sid
                    break
            if slot_id is None:
                # All slots full, reuse slot 1
                slot_id = 1

            cell_state = _CellState(name=cell_name, info=info, step="converting")
            self._worker_slots[slot_id] = cell_state
            self._cell_to_slot[cell_name] = slot_id

        if self._use_rich:
            with self._lock:
                self._update_display()
        elif self.verbose:
            print(f"  Processing {cell_name} ({info})...")

    def cell_layer_done(self, cell_name: str, layer_name: str, step: str) -> None:
        """Signal a layer within a cell is done (convert or tile step)."""
        with self._lock:
            slot_id = self._cell_to_slot.get(cell_name)
            if slot_id is not None:
                cell_state = self._worker_slots.get(slot_id)
                if cell_state is not None:
                    cell_state.layers_done += 1
                    cell_state.step = step

        if self._use_rich:
            with self._lock:
                self._update_display()
        elif self.verbose:
            print(f"    {step.title()} {layer_name}")

    def cell_done(self, cell_name: str, elapsed: float) -> None:
        """Signal a cell has completed successfully."""
        with self._lock:
            self._process_done += 1
            slot_id = self._cell_to_slot.get(cell_name)
            if slot_id is not None:
                cell_state = self._worker_slots.get(slot_id)
                if cell_state is not None:
                    cell_state.step = "done"
                    cell_state.elapsed = elapsed

        if self._use_rich:
            with self._lock:
                self._update_display()
        else:
            print(
                f"  {cell_name} done ({_fmt_elapsed(elapsed)})"
                f"  [{self._process_done}/{self._process_total}]"
            )

    def cell_skipped(self, cell_name: str) -> None:
        """Signal a cell was skipped (up to date)."""
        with self._lock:
            self._process_done += 1
            slot_id = self._cell_to_slot.get(cell_name)
            if slot_id is not None:
                cell_state = self._worker_slots.get(slot_id)
                if cell_state is not None:
                    cell_state.step = "skipped"

        if self._use_rich:
            with self._lock:
                self._update_display()
        else:
            print(f"  Skipping {cell_name} (tiles up to date)")

    def cell_error(self, cell_name: str, error: str) -> None:
        """Signal a cell had an error."""
        with self._lock:
            self._process_done += 1
            slot_id = self._cell_to_slot.get(cell_name)
            if slot_id is not None:
                cell_state = self._worker_slots.get(slot_id)
                if cell_state is not None:
                    cell_state.step = "error"
                    cell_state.error = error
            self.errors.append(f"{cell_name}: {error}")

        if self._use_rich:
            with self._lock:
                self._update_display()
        else:
            print(f"  Error processing {cell_name}: {error}")

    def process_complete(self, elapsed: float) -> None:
        """Signal Pass 2 complete."""
        self._stop_live()
        if self._use_rich:
            console = self._get_console()
            console.print(  # type: ignore[union-attr]
                f"[bold]Pass 2: Processing complete[/bold]"
                f" ({_fmt_elapsed(elapsed)})"
                f" \u2014 {self._process_done}/{self._process_total} cells"
            )
        else:
            print(f"  Pass 2 complete ({_fmt_elapsed(elapsed)})")

    # ── Pass 3: Compositing ──

    def composite_phase_start(
        self, phase: int, description: str, total: int
    ) -> None:
        """Signal start of a composite sub-phase."""
        with self._lock:
            self._composite_phases[phase] = (description, 0, total, 0.0)
        if self._use_rich:
            self._start_live()
            self._update_composite_display()
        else:
            if total > 0:
                print(f"  Phase {phase}: {description} ({total} items)...")
            else:
                print(f"  Phase {phase}: {description}...")

    def composite_progress(self, phase: int, done: int) -> None:
        """Update progress within a composite sub-phase."""
        with self._lock:
            if phase in self._composite_phases:
                desc, _old_done, total, elapsed = self._composite_phases[phase]
                self._composite_phases[phase] = (desc, done, total, elapsed)
        if self._use_rich:
            with self._lock:
                self._update_composite_display()

    def composite_phase_done(
        self, phase: int, elapsed: float, detail: str
    ) -> None:
        """Signal a composite sub-phase is complete."""
        with self._lock:
            if phase in self._composite_phases:
                desc, done, total, _old_elapsed = self._composite_phases[phase]
                self._composite_phases[phase] = (desc, total, total, elapsed)
        self._stop_live()
        if self._use_rich:
            console = self._get_console()
            desc = self._composite_phases.get(phase, ("", 0, 0, 0.0))[0]
            msg = f"  Phase {phase}: {desc} ({_fmt_elapsed(elapsed)})"
            if detail:
                msg += f" \u2014 {detail}"
            console.print(msg)  # type: ignore[union-attr]
        else:
            desc = self._composite_phases.get(phase, ("", 0, 0, 0.0))[0]
            msg = f"  Phase {phase}: {desc} ({_fmt_elapsed(elapsed)})"
            if detail:
                msg += f" - {detail}"
            print(msg)

    def _update_composite_display(self) -> None:
        """Update the composite progress display."""
        if not self._use_rich or self._live is None:
            return
        from rich.text import Text

        text = Text()
        text.append("Pass 3: Compositing\n", style="bold")

        for phase_id in sorted(self._composite_phases):
            desc, done, total, elapsed = self._composite_phases[phase_id]
            if total > 0:
                pct = int(done / total * 100)
                bar_width = 30
                filled = int(bar_width * done / total)
                bar = "\u2501" * filled + "\u2591" * (bar_width - filled)
                text.append(
                    f"  Phase {phase_id}: {desc}  "
                    f"{bar}  {pct}%  {done:,}/{total:,}\n"
                )
            else:
                text.append(f"  Phase {phase_id}: {desc}...\n")

        self._live.update(text)  # type: ignore[union-attr]

    def composite_complete(
        self, output_path: str, total_tiles: int, elapsed: float
    ) -> None:
        """Signal Pass 3 complete."""
        self._stop_live()
        if self._use_rich:
            console = self._get_console()
            console.print(  # type: ignore[union-attr]
                f"[bold]Pass 3: Compositing complete[/bold]"
                f" ({_fmt_elapsed(elapsed)})"
                f" \u2014 {total_tiles:,} tiles \u2192 {output_path}"
            )
        else:
            print(
                f"Composited \u2192 {output_path}"
                f" ({total_tiles:,} tiles, {_fmt_elapsed(elapsed)} total)"
            )

    # ── General ──

    def warning(self, msg: str) -> None:
        """Record and display a warning."""
        with self._lock:
            self.warnings.append(msg)
        if self._use_rich:
            if self._live is not None:
                self._update_display()
            else:
                console = self._get_console()
                console.print(f"  [yellow]\u26a0 Warning: {msg}[/yellow]")  # type: ignore[union-attr]
        else:
            print(f"  Warning: {msg}")

    def error(self, msg: str) -> None:
        """Record and display an error."""
        with self._lock:
            self.errors.append(msg)
        if self._use_rich:
            if self._live is not None:
                self._update_display()
            else:
                console = self._get_console()
                console.print(f"  [red]\u2717 Error: {msg}[/red]")  # type: ignore[union-attr]
        else:
            print(f"  Error: {msg}")

    def info(self, msg: str) -> None:
        """Display an informational message (outside live display)."""
        if self._use_rich:
            if self._live is not None:
                # Temporarily stop live to print, then restart
                self._stop_live()
                console = self._get_console()
                console.print(f"  {msg}")  # type: ignore[union-attr]
                self._start_live()
            else:
                console = self._get_console()
                console.print(f"  {msg}")  # type: ignore[union-attr]
        else:
            print(f"  {msg}")

    def print_summary(
        self,
        total_elapsed: float,
        output_path: str,
        cells_processed: int = 0,
        total_tiles: int = 0,
    ) -> None:
        """Print final pipeline summary."""
        if self._use_rich:
            from rich.panel import Panel

            console = self._get_console()

            lines = []
            lines.append(
                f"{cells_processed} cells processed,"
                f" {total_tiles:,} tiles composited"
            )
            lines.append(f"Output: {output_path}")

            if self.warnings:
                lines.append(f"\n\u26a0 {len(self.warnings)} warning(s):")
                for w in self.warnings:
                    lines.append(f"  {w}")

            if self.errors:
                lines.append(f"\n\u2717 {len(self.errors)} error(s):")
                for e in self.errors:
                    lines.append(f"  {e}")

            console.print(  # type: ignore[union-attr]
                Panel(
                    "\n".join(lines),
                    title=f"Pipeline complete ({_fmt_elapsed(total_elapsed)})",
                    border_style="green" if not self.errors else "red",
                )
            )
        else:
            print(f"\n=== Pipeline complete ({_fmt_elapsed(total_elapsed)}) ===")
            print(
                f"  {cells_processed} cells processed,"
                f" {total_tiles:,} tiles composited"
            )
            print(f"  Output: {output_path}")
            if self.warnings:
                print(f"\n  {len(self.warnings)} warning(s):")
                for w in self.warnings:
                    print(f"    {w}")
            if self.errors:
                print(f"\n  {len(self.errors)} error(s):")
                for e in self.errors:
                    print(f"    {e}")
