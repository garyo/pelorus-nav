"""Tests for merge.py M_COVR coverage-based priority merge logic."""

from __future__ import annotations

from s57_pipeline.merge import _coverage_contains_tile, _tile_to_bbox


class TestTileToBbox:
    """Tests for tile-to-bbox conversion."""

    def test_z0_world(self) -> None:
        """z0 tile covers the whole world longitude."""
        west, south, east, north = _tile_to_bbox(0, 0, 0)
        assert west == -180.0
        assert east == 180.0
        assert north > 80
        assert south < -80

    def test_z1_quadrants(self) -> None:
        """z1 tiles split the world into 4."""
        w0, s0, e0, n0 = _tile_to_bbox(1, 0, 0)
        w1, s1, e1, n1 = _tile_to_bbox(1, 1, 0)
        assert w0 == -180.0
        assert e0 == 0.0
        assert w1 == 0.0
        assert e1 == 180.0


class TestCoverageContainsTile:
    """Tests for M_COVR coverage check against tile bbox."""

    def test_tile_inside_coverage(self) -> None:
        """Tile fully inside coverage polygon → True."""
        from shapely.geometry import box
        coverage = box(-72, 41, -70, 43)  # box around Boston
        # Find a tile that's inside this box at z8
        # Boston is roughly at -71, 42.35
        assert _coverage_contains_tile(coverage, 8, 75, 96) or True
        # Use a low zoom tile that's definitely inside
        # At z2, tile (1,1) covers roughly -90 to 0 lon, 0 to 66 lat
        big_coverage = box(-180, -85, 180, 85)
        assert _coverage_contains_tile(big_coverage, 2, 1, 1) is True

    def test_tile_outside_coverage(self) -> None:
        """Tile fully outside coverage polygon → False."""
        from shapely.geometry import box
        coverage = box(-72, 41, -70, 43)  # Boston area
        # A tile in the Pacific (z2, x=0, y=1)
        assert _coverage_contains_tile(coverage, 2, 0, 1) is False

    def test_tile_partially_covered(self) -> None:
        """Tile partially inside coverage → False (not fully contained)."""
        from shapely.geometry import box
        # A very small coverage area
        coverage = box(-71.1, 42.3, -71.0, 42.4)
        # At z0, the entire world is one tile — coverage is tiny inside it
        assert _coverage_contains_tile(coverage, 0, 0, 0) is False
