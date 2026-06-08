#!/usr/bin/env python3
"""Convert a NOAA RNC chart (BSB/KAP) into a raster PMTiles + coverage GeoJSON.

Mirrors the S-57 / basemap pipelines: an offline build step that produces a
`public/rnc-<id>.pmtiles` (web-mercator raster tiles, transparent outside the
chart neatline) and a `public/rnc-<id>.coverage.geojson` (the chart footprint),
which the client composites beneath the vector ENC (vector-preferred quilting).

The KAP is georeferenced (GDAL reads its GCPs); the neatline comes from the KAP
header `PLY` lines and is used both as a gdalwarp cutline (transparent border)
and as the client coverage polygon. The chart's compilation scale (`KNP/SC=`)
sets the usable zoom range.

Requires `gdal` and `pmtiles` on PATH (brew).

Usage:
  tools/rnc-pipeline/convert-kap.py <chart.KAP> --id bvi [--out public]

Source charts: NOAA discontinued RNC (Dec 2024); archived KAPs are on the
Wayback Machine, e.g.
  https://web.archive.org/web/2024id_/https://www.charts.noaa.gov/RNCs/25641.zip
The same tool ingests any georeferenced KAP (bring-your-own charts).
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# A 1:N chart is "native" near this slippy zoom; rendering past it is overscale.
# Roughly: zoom ≈ log2(559082264 / scale). 1:100k ≈ z12.4 → cap native at 13.
SCALE_TO_NATIVE_ZOOM = {
    400000: 11,
    200000: 12,
    100000: 13,
    80000: 13,
    40000: 14,
    20000: 15,
}


def native_zoom(scale: int) -> int:
    best = min(SCALE_TO_NATIVE_ZOOM, key=lambda s: abs(s - scale))
    return SCALE_TO_NATIVE_ZOOM[best]


def read_header(kap: Path) -> str:
    return kap.read_bytes()[:60000].replace(b"\x00", b"").decode("latin1")


def parse_neatline(header: str) -> list[list[float]]:
    """PLY/<n>,<lat>,<lon> → closed [lon,lat] ring."""
    ring = [
        [float(lon), float(lat)]
        for lat, lon in re.findall(r"PLY/\d+,([-0-9.]+),([-0-9.]+)", header)
    ]
    if len(ring) < 3:
        sys.exit("error: KAP header has no PLY neatline")
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def parse_scale(header: str) -> int:
    m = re.search(r"KNP/SC=(\d+)", header)
    return int(m.group(1)) if m else 0


def parse_name(header: str) -> str:
    m = re.search(r"BSB/NA=([^,\r\n]+)", header)
    return m.group(1).strip() if m else ""


def run(cmd: list[str]) -> None:
    print("  $", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("kap", type=Path)
    ap.add_argument("--id", required=True, help="chart id, e.g. 'bvi'")
    ap.add_argument("--out", type=Path, default=Path("public"))
    ap.add_argument(
        "--max-zoom",
        type=int,
        default=14,
        help="Cap base tile zoom (a 1:100k chart's native detail is ~z13; "
        "z15 is overscaled and ~4x larger).",
    )
    args = ap.parse_args()
    # EPSG:3857 projected resolution (m/px) at the target max zoom.
    target_res = 156543.03392804097 / (2**args.max_zoom)

    header = read_header(args.kap)
    ring = parse_neatline(header)
    scale = parse_scale(header)
    name = parse_name(header)
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    bbox = [min(lons), min(lats), max(lons), max(lats)]
    nz = native_zoom(scale)
    print(f"chart: {name!r}  scale 1:{scale}  bbox {bbox}  native z{nz}")

    args.out.mkdir(parents=True, exist_ok=True)
    coverage = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": args.id, "scale": scale, "name": name},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        ],
    }
    cov_path = args.out / f"rnc-{args.id}.coverage.geojson"
    cov_path.write_text(json.dumps(coverage))
    print(f"wrote {cov_path}")

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        neatline = td / "neatline.geojson"
        neatline.write_text(json.dumps(coverage))
        rgb = td / "rgb.tif"
        warped = td / "warped.tif"
        mbt = td / "chart.mbtiles"
        pmt = args.out / f"rnc-{args.id}.pmtiles"

        # Palette → RGB (keeps GCPs), warp to web mercator clipped to the
        # neatline with a transparent border, tile to PNG, build overviews.
        run(["gdal_translate", "-q", "-expand", "rgb", str(args.kap), str(rgb)])
        run([
            "gdalwarp", "-q", "-t_srs", "EPSG:3857", "-r", "bilinear",
            "-tr", str(target_res), str(target_res),
            "-cutline", str(neatline), "-crop_to_cutline", "-dstalpha",
            "-overwrite", str(rgb), str(warped),
        ])
        run([
            "gdal_translate", "-q", "-of", "MBTILES",
            "-co", "TILE_FORMAT=PNG", str(warped), str(mbt),
        ])
        # Overviews down to ~z8 so the chart also shows at regional zoom.
        run(["gdaladdo", "-q", "-r", "average", str(mbt),
             "2", "4", "8", "16", "32", "64"])
        if pmt.exists():
            pmt.unlink()
        run(["pmtiles", "convert", str(mbt), str(pmt)])
        print(f"wrote {pmt}")

    print(
        "\ncatalog entry — add to RASTER_CHARTS in src/data/chart-catalog.ts:\n"
        f'  {{ id: "{args.id}", name: "{name.title()}", scale: {scale},\n'
        f"    nativeZoom: {nz}, bbox: [{bbox[0]:.3f}, {bbox[1]:.3f}, "
        f"{bbox[2]:.3f}, {bbox[3]:.3f}] }}"
    )


if __name__ == "__main__":
    main()
