#!/usr/bin/env python3
"""Generate the BYO-import e2e fixture: a tiny raster mbtiles → pmtiles.

Four magenta 256x256 PNG tiles at z10 in the mid-Pacific (~150°W 30°S) —
deliberately outside every catalog chart's bbox so chart-import.spec.ts can
assert the imported chart (and nothing else) is what the app shows there.

Run from this directory (requires the `pmtiles` CLI, `brew install pmtiles`):
    python3 make-import-fixture.py
Commits: import-fixture.pmtiles (the .mbtiles intermediate is not kept).
"""

import sqlite3
import struct
import subprocess
import zlib
from pathlib import Path

HERE = Path(__file__).parent
Z = 10
XS = (85, 86)  # ~150.1–149.4°W
YS = (601, 602)  # ~29.8–30.5°S (XYZ scheme)
BOUNDS = "-150.117,-30.449,-149.414,-29.841"


def magenta_png() -> bytes:
    """Minimal 256x256 solid-magenta RGBA PNG, no image libs needed."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data))
        )

    ihdr = struct.pack(">IIBBBBB", 256, 256, 8, 6, 0, 0, 0)  # RGBA8
    row = b"\x00" + b"\xff\x00\xff\xff" * 256  # filter 0 + magenta pixels
    idat = zlib.compress(row * 256)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


def main() -> None:
    mbtiles = HERE / "import-fixture.mbtiles"
    pmtiles = HERE / "import-fixture.pmtiles"
    mbtiles.unlink(missing_ok=True)

    db = sqlite3.connect(mbtiles)
    db.execute("CREATE TABLE metadata (name TEXT, value TEXT)")
    db.execute(
        "CREATE TABLE tiles (zoom_level INT, tile_column INT, tile_row INT,"
        " tile_data BLOB)"
    )
    db.executemany(
        "INSERT INTO metadata VALUES (?, ?)",
        [
            ("name", "E2E Import Fixture"),
            ("format", "png"),
            ("bounds", BOUNDS),
            ("minzoom", str(Z)),
            ("maxzoom", str(Z)),
            ("type", "overlay"),
        ],
    )
    png = magenta_png()
    for x in XS:
        for y in YS:
            tms_y = (1 << Z) - 1 - y  # mbtiles rows are TMS (south-up)
            db.execute("INSERT INTO tiles VALUES (?, ?, ?, ?)", (Z, x, tms_y, png))
    db.commit()
    db.close()

    subprocess.run(["pmtiles", "convert", str(mbtiles), str(pmtiles)], check=True)
    mbtiles.unlink()
    print(f"wrote {pmtiles} ({pmtiles.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
