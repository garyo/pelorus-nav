"""Shared tile math utilities."""

from __future__ import annotations

import math


def tile_to_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Convert tile (z, x, y) to (west, south, east, north) bbox in degrees."""
    n = 2**z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return (west, south, east, north)


def latlon_to_tile(lat: float, lon: float, z: int) -> tuple[int, int]:
    """Convert (lat, lon) to tile (x, y) at zoom level z."""
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int(
        (1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi)
        / 2.0
        * n
    )
    x = max(0, min(n - 1, x))
    y = max(0, min(n - 1, y))
    return x, y
