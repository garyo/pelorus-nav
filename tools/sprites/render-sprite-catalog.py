#!/usr/bin/env python3
"""Render a PDF catalog of all S-52 sprites with metadata and anchor points.

Usage:
    uv run --with reportlab --with svglib python tools/sprites/render-sprite-catalog.py

Output: tools/sprites/s52-sprite-catalog.pdf
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from svglib.svglib import svg2rlg

SCRIPT_DIR = Path(__file__).parent
# Use day-theme SVGs (inline colors) rather than raw source (CSS class refs)
S52_DAY = SCRIPT_DIR / "s52" / "day"
S52_SOURCE = SCRIPT_DIR / "s52" / "source"  # for pivot point extraction
SYMBOLS_JSON = SCRIPT_DIR / "s52" / "symbols.json"
ICON_SETS_TS = SCRIPT_DIR.parent.parent / "src" / "chart" / "styles" / "icon-sets.ts"
OUTPUT = SCRIPT_DIR / "s52-sprite-catalog.pdf"

# Page layout
PAGE_W, PAGE_H = letter
MARGIN = 36  # 0.5 inch
COLS = 4
CELL_W = (PAGE_W - 2 * MARGIN) / COLS
CELL_H = 140  # points per cell
ICON_RENDER_SIZE = 64  # max icon render dimension in points
HEADER_H = 30


def load_symbols_json() -> dict:
    if SYMBOLS_JSON.exists():
        with open(SYMBOLS_JSON) as f:
            return json.load(f)
    return {}


def load_maplibre_offsets() -> dict[str, tuple[float, float]]:
    """Parse S52_OFFSETS from icon-sets.ts."""
    offsets: dict[str, tuple[float, float]] = {}
    if not ICON_SETS_TS.exists():
        return offsets
    text = ICON_SETS_TS.read_text()
    # Find the S52_OFFSETS block
    match = re.search(
        r"const S52_OFFSETS.*?=\s*\{(.*?)\};", text, re.DOTALL
    )
    if not match:
        return offsets
    block = match.group(1)
    for m in re.finditer(r"(\w+):\s*\[([^]]+)\]", block):
        name = m.group(1)
        vals = m.group(2).split(",")
        if len(vals) == 2:
            try:
                offsets[name] = (float(vals[0].strip()), float(vals[1].strip()))
            except ValueError:
                pass
    return offsets


def get_svg_pivot(svg_path: Path) -> tuple[float, float] | None:
    """Extract the pivot point (0,0) position from SVG viewBox."""
    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
        vb = root.get("viewBox")
        if vb:
            parts = vb.split()
            if len(parts) == 4:
                min_x, min_y = float(parts[0]), float(parts[1])
                vb_w, vb_h = float(parts[2]), float(parts[3])
                # Pivot (0,0) in SVG coords → relative position in viewBox
                px = -min_x / vb_w if vb_w else 0.5
                py = -min_y / vb_h if vb_h else 0.5
                return (px, py)  # 0..1 relative coords
    except Exception:
        pass
    return None


def main() -> None:
    symbols_meta = load_symbols_json()
    ml_offsets = load_maplibre_offsets()

    # Collect all day-theme SVGs (with inline colors)
    svg_files = sorted(S52_DAY.glob("*.svg"))
    if not svg_files:
        print(f"No SVGs found in {S52_DAY}")
        return

    print(f"Found {len(svg_files)} day-theme SVGs")
    print(f"Loaded {len(symbols_meta)} entries from symbols.json")
    print(f"Loaded {len(ml_offsets)} entries from S52_OFFSETS")

    c = Canvas(str(OUTPUT), pagesize=letter)

    # Title page
    c.setFont("Helvetica-Bold", 18)
    c.drawString(MARGIN, PAGE_H - MARGIN - 20, "S-52 Sprite Catalog")
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN, PAGE_H - MARGIN - 38, f"{len(svg_files)} symbols from {S52_DAY.relative_to(SCRIPT_DIR.parent.parent)} (day theme, inline colors)")
    c.drawString(MARGIN, PAGE_H - MARGIN - 52, "Red dot = SVG pivot point (0,0).  Blue crosshair = MapLibre offset (applied at render time).")
    c.drawString(MARGIN, PAGE_H - MARGIN - 66, "Green dot = final anchor position (pivot + offset).")
    c.showPage()

    col = 0
    row = 0
    rows_per_page = int((PAGE_H - 2 * MARGIN - HEADER_H) / CELL_H)

    for i, svg_path in enumerate(svg_files):
        if col == 0 and row == 0:
            # Page header
            c.setFont("Helvetica", 8)
            c.drawString(MARGIN, PAGE_H - MARGIN - 10, f"S-52 Sprite Catalog — page {c.getPageNumber()}")
            c.setStrokeColorRGB(0.8, 0.8, 0.8)
            c.line(MARGIN, PAGE_H - MARGIN - 14, PAGE_W - MARGIN, PAGE_H - MARGIN - 14)

        x0 = MARGIN + col * CELL_W
        y_top = PAGE_H - MARGIN - HEADER_H - row * CELL_H

        name = svg_path.stem
        meta = symbols_meta.get(name, {})
        desc = meta.get("description", "")
        s52_offset = meta.get("offset", None)
        ml_offset = ml_offsets.get(name, None)
        # Get pivot from source SVG (has viewBox with pivot info)
        source_svg = S52_SOURCE / svg_path.name
        pivot = get_svg_pivot(source_svg) if source_svg.exists() else get_svg_pivot(svg_path)

        # Cell border (light gray)
        c.setStrokeColorRGB(0.9, 0.9, 0.9)
        c.rect(x0, y_top - CELL_H, CELL_W, CELL_H)

        # Render SVG — saveState/restoreState isolates any canvas transforms
        # that SVG rendering may apply (prevents page rotation artifacts).
        try:
            drawing = svg2rlg(str(svg_path))
            if drawing:
                # Scale to fit
                dw = drawing.width or 1
                dh = drawing.height or 1
                scale = min(ICON_RENDER_SIZE / dw, ICON_RENDER_SIZE / dh, 3.0)
                rw = dw * scale
                rh = dh * scale

                # Center the icon in the cell
                icon_x = x0 + (CELL_W - rw) / 2
                icon_y = y_top - 8 - rh

                drawing.width = rw
                drawing.height = rh
                drawing.scale(scale, scale)
                c.saveState()
                renderPDF.draw(drawing, c, icon_x, icon_y)
                c.restoreState()

                # Draw pivot point (red dot)
                if pivot:
                    px_rel, py_rel = pivot
                    # SVG y=0 is at top, reportlab y=0 is at bottom
                    dot_x = icon_x + px_rel * rw
                    dot_y = icon_y + (1 - py_rel) * rh
                    c.setFillColorRGB(1, 0, 0)
                    c.circle(dot_x, dot_y, 2, fill=1, stroke=0)

                    # Draw MapLibre offset indicator (blue crosshair)
                    if ml_offset:
                        # Offsets are in pixels; scale roughly to match
                        ox = ml_offset[0] * scale * 0.5
                        oy = -ml_offset[1] * scale * 0.5  # flip y
                        off_x = dot_x + ox
                        off_y = dot_y + oy
                        c.setStrokeColorRGB(0, 0, 1)
                        c.setLineWidth(0.5)
                        c.line(off_x - 4, off_y, off_x + 4, off_y)
                        c.line(off_x, off_y - 4, off_x, off_y + 4)

                    # Draw final anchor (green dot = pivot + offset)
                    if ml_offset:
                        c.setFillColorRGB(0, 0.7, 0)
                        c.circle(off_x, off_y, 1.5, fill=1, stroke=0)

        except Exception as e:
            c.setFont("Helvetica", 7)
            c.setFillColorRGB(0.8, 0, 0)
            c.drawString(x0 + 4, y_top - 40, f"render err: {e}")
            c.setFillColorRGB(0, 0, 0)

        # Text metadata below icon
        text_y = y_top - CELL_H + 38

        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x0 + 4, text_y, name)

        c.setFont("Helvetica", 6.5)
        if desc:
            # Truncate long descriptions
            if len(desc) > 40:
                desc = desc[:38] + "..."
            c.drawString(x0 + 4, text_y - 10, desc)

        info_y = text_y - 20
        if s52_offset:
            c.setFillColorRGB(0.3, 0.3, 0.3)
            c.drawString(x0 + 4, info_y, f"S-52 offset: [{s52_offset[0]}, {s52_offset[1]}]")
            info_y -= 9

        if ml_offset:
            c.setFillColorRGB(0, 0, 0.6)
            c.drawString(x0 + 4, info_y, f"ML offset: [{ml_offset[0]}, {ml_offset[1]}]")
            info_y -= 9
        elif name in symbols_meta:
            c.setFillColorRGB(0.5, 0.5, 0.5)
            c.drawString(x0 + 4, info_y, "ML offset: [0, 0]")
            info_y -= 9

        # Advance grid
        col += 1
        if col >= COLS:
            col = 0
            row += 1
            if row >= rows_per_page:
                row = 0
                c.showPage()

    if col > 0 or row > 0:
        c.showPage()

    c.save()
    print(f"Written: {OUTPUT}")


if __name__ == "__main__":
    main()
