"""E2E coverage test: verify PMTiles has tile data across the region.

Samples random lat/lon points within the new-england region bbox and
checks that the built nautical.pmtiles file contains tile data at each
zoom level. Points without data at z8 (coastal scale) are classified as
inland and excluded from higher-zoom checks.

Requires:
- public/nautical.pmtiles built with `bun run tiles:full` (or similar)
- pmtiles Python package (dev dependency)

Run: cd tools/s57-pipeline && uv run pytest tests/test_coverage.py -v -s
"""

from __future__ import annotations

import math
import random
import time
from pathlib import Path

import pytest

# The PMTiles file is at the project root's public/ directory
PMTILES_PATH = Path(__file__).resolve().parents[3] / "public" / "nautical.pmtiles"

# new-england region bbox: (west, south, east, north)
REGION_BBOX = (-73.8, 40.5, -66.9, 47.5)

NUM_SAMPLES = 1_000

# If a point has tile data at this zoom, it's in nautical chart coverage.
# Points without data here are inland and excluded from higher-zoom checks.
COASTAL_DETECT_ZOOM = 8

# Coverage thresholds for coastal points (i.e. excluding inland)
# z0-8: should be ~100% (these are the overview/general/coastal cells)
LOW_ZOOM_RANGE = range(0, 9)
LOW_ZOOM_THRESHOLD = 0.99

# z9-14: all bands extend to z14, so coastal points should mostly have data
HIGH_ZOOM_RANGE = range(9, 15)
HIGH_ZOOM_THRESHOLD = 0.60


def _latlon_to_tile(lat: float, lon: float, z: int) -> tuple[int, int]:
    """Convert lat/lon to tile x/y at zoom z (Web Mercator / slippy map)."""
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int(
        (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi)
        / 2.0
        * n
    )
    x = max(0, min(n - 1, x))
    y = max(0, min(n - 1, y))
    return x, y


def _sample_points(
    bbox: tuple[float, float, float, float],
    n: int,
    seed: int = 42,
) -> list[tuple[float, float]]:
    """Generate n random (lat, lon) points within bbox."""
    west, south, east, north = bbox
    rng = random.Random(seed)
    return [(rng.uniform(south, north), rng.uniform(west, east)) for _ in range(n)]


@pytest.fixture(scope="module")
def pmtiles_reader():
    """Open the PMTiles file for the test module."""
    if not PMTILES_PATH.exists():
        pytest.skip(f"PMTiles not found at {PMTILES_PATH} — run pipeline first")

    from pmtiles.reader import MmapSource, Reader

    f = open(PMTILES_PATH, "rb")
    source = MmapSource(f)
    reader = Reader(source)
    yield reader
    f.close()


@pytest.fixture(scope="module")
def sample_points() -> list[tuple[float, float]]:
    """Fixed random sample of points within the region."""
    return _sample_points(REGION_BBOX, NUM_SAMPLES)


@pytest.fixture(scope="module")
def coastal_points(
    pmtiles_reader, sample_points: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    """Filter sample points to those with tile data at z8 (coastal coverage).

    Points without data at z8 are inland — no nautical charts expected.
    """
    t0 = time.monotonic()
    coastal = []
    for lat, lon in sample_points:
        x, y = _latlon_to_tile(lat, lon, COASTAL_DETECT_ZOOM)
        if pmtiles_reader.get(COASTAL_DETECT_ZOOM, x, y):
            coastal.append((lat, lon))
    elapsed = time.monotonic() - t0
    print(
        f"\n  Coastal filter: {len(coastal)}/{len(sample_points)} points "
        f"have data at z{COASTAL_DETECT_ZOOM} ({elapsed:.1f}s)"
    )
    assert len(coastal) > 100, (
        f"Too few coastal points ({len(coastal)}) — check that pmtiles has data"
    )
    return coastal


def test_low_zoom_coverage(
    pmtiles_reader,
    coastal_points: list[tuple[float, float]],
) -> None:
    """z0-8: coastal points should have near-100% tile coverage."""
    n = len(coastal_points)
    for z in LOW_ZOOM_RANGE:
        t0 = time.monotonic()
        missing = 0
        examples: list[tuple[float, float]] = []
        for lat, lon in coastal_points:
            x, y = _latlon_to_tile(lat, lon, z)
            if not pmtiles_reader.get(z, x, y):
                missing += 1
                if len(examples) < 5:
                    examples.append((lat, lon))

        elapsed = time.monotonic() - t0
        pct = (n - missing) / n
        print(f"  z{z:2d}: {pct:5.1%} covered ({elapsed:.1f}s)")
        assert pct >= LOW_ZOOM_THRESHOLD, (
            f"z{z}: {pct:.1%} coverage ({missing}/{n} missing), "
            f"expected >= {LOW_ZOOM_THRESHOLD:.0%}. Examples: {examples}"
        )


def test_high_zoom_coverage(
    pmtiles_reader,
    coastal_points: list[tuple[float, float]],
) -> None:
    """z9-14: coastal points should mostly have tile data.

    With all INTU bands extending to z14, geographic gaps should be
    filled by coarser-scale data.
    """
    n = len(coastal_points)
    for z in HIGH_ZOOM_RANGE:
        t0 = time.monotonic()
        covered = 0
        for lat, lon in coastal_points:
            x, y = _latlon_to_tile(lat, lon, z)
            if pmtiles_reader.get(z, x, y):
                covered += 1

        elapsed = time.monotonic() - t0
        pct = covered / n
        print(f"  z{z:2d}: {pct:5.1%} covered ({elapsed:.1f}s)")
        assert pct >= HIGH_ZOOM_THRESHOLD, (
            f"z{z}: only {pct:.1%} coverage ({covered}/{n}), "
            f"expected >= {HIGH_ZOOM_THRESHOLD:.0%}"
        )


def test_known_spots_all_zooms(pmtiles_reader) -> None:
    """Regression checks for specific spots that previously had gaps."""
    spots = [
        ("Boston Harbor", 42.35, -71.05),
        ("Buzzards Bay", 41.387, -71.033),
        ("Newport RI", 41.49, -71.33),
        ("Long Island Sound", 41.1, -72.5),
        ("Cape Cod Bay", 41.85, -70.2),
        ("Portland ME", 43.65, -70.25),
    ]

    for name, lat, lon in spots:
        gaps = []
        for z in range(0, 15):
            x, y = _latlon_to_tile(lat, lon, z)
            if not pmtiles_reader.get(z, x, y):
                gaps.append(z)
        status = "OK" if not gaps else f"GAPS at z: {gaps}"
        print(f"  {name}: {status}")
        assert not gaps, f"{name} ({lat}, {lon}) has no tile data at z: {gaps}"
