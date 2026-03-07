"""Tests for coverage.py clipping logic."""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import LineString, box, mapping

from s57_pipeline.coverage import clip_geojson, compute_clip_mask, compute_clip_segments


def _write_geojson(path: Path, features: list[dict]) -> None:
    """Write a GeoJSON FeatureCollection to a file."""
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    with open(path, "w") as f:
        json.dump(geojson, f)


def _make_feature(geometry, properties: dict | None = None) -> dict:
    """Create a GeoJSON feature dict from a Shapely geometry."""
    return {
        "type": "Feature",
        "geometry": mapping(geometry),
        "properties": properties or {},
    }


def _read_geojson(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


class TestClipGeojson:
    """Tests for clip_geojson in-place clipping."""

    def test_polygon_fully_inside_mask_removed(self, tmp_path: Path) -> None:
        """A polygon entirely inside the clip mask is removed."""
        geojson_path = tmp_path / "test.geojson"
        feature = _make_feature(box(1, 1, 2, 2), {"name": "small"})
        _write_geojson(geojson_path, [feature])

        clip_mask = box(0, 0, 10, 10)  # covers the feature entirely
        removed = clip_geojson(geojson_path, clip_mask)

        assert removed == 1
        result = _read_geojson(geojson_path)
        assert len(result["features"]) == 0

    def test_polygon_fully_outside_mask_kept(self, tmp_path: Path) -> None:
        """A polygon outside the clip mask is kept unchanged."""
        geojson_path = tmp_path / "test.geojson"
        feature = _make_feature(box(20, 20, 21, 21), {"name": "outside"})
        _write_geojson(geojson_path, [feature])

        clip_mask = box(0, 0, 10, 10)
        removed = clip_geojson(geojson_path, clip_mask)

        assert removed == 0
        result = _read_geojson(geojson_path)
        assert len(result["features"]) == 1

    def test_polygon_partially_clipped(self, tmp_path: Path) -> None:
        """A polygon overlapping the mask is clipped to the non-masked portion."""
        geojson_path = tmp_path / "test.geojson"
        # Feature spans 0-10 in x, mask covers 5-15 in x
        feature = _make_feature(box(0, 0, 10, 10), {"name": "partial"})
        _write_geojson(geojson_path, [feature])

        clip_mask = box(5, 0, 15, 10)
        removed = clip_geojson(geojson_path, clip_mask)

        assert removed == 0
        result = _read_geojson(geojson_path)
        assert len(result["features"]) == 1
        # Properties preserved
        assert result["features"][0]["properties"]["name"] == "partial"

    def test_linestring_clipped(self, tmp_path: Path) -> None:
        """A line crossing the mask boundary is clipped."""
        geojson_path = tmp_path / "test.geojson"
        line = LineString([(0, 5), (20, 5)])
        feature = _make_feature(line, {"type": "coastline"})
        _write_geojson(geojson_path, [feature])

        clip_mask = box(10, 0, 20, 10)
        removed = clip_geojson(geojson_path, clip_mask)

        assert removed == 0
        result = _read_geojson(geojson_path)
        assert len(result["features"]) == 1

    def test_linestring_fully_inside_mask_removed(self, tmp_path: Path) -> None:
        """A line entirely inside the clip mask is removed."""
        geojson_path = tmp_path / "test.geojson"
        line = LineString([(1, 1), (2, 2)])
        feature = _make_feature(line, {"type": "coastline"})
        _write_geojson(geojson_path, [feature])

        clip_mask = box(0, 0, 10, 10)
        removed = clip_geojson(geojson_path, clip_mask)

        assert removed == 1
        result = _read_geojson(geojson_path)
        assert len(result["features"]) == 0

    def test_empty_file_returns_zero(self, tmp_path: Path) -> None:
        """An empty feature collection returns 0 removed."""
        geojson_path = tmp_path / "test.geojson"
        _write_geojson(geojson_path, [])

        clip_mask = box(0, 0, 10, 10)
        removed = clip_geojson(geojson_path, clip_mask)

        assert removed == 0

    def test_multiple_features_mixed(self, tmp_path: Path) -> None:
        """Mix of kept, removed, and clipped features."""
        geojson_path = tmp_path / "test.geojson"
        features = [
            _make_feature(box(1, 1, 2, 2), {"name": "inside"}),   # removed
            _make_feature(box(20, 20, 21, 21), {"name": "outside"}),  # kept
            _make_feature(box(5, 5, 15, 15), {"name": "partial"}),  # clipped
        ]
        _write_geojson(geojson_path, features)

        clip_mask = box(0, 0, 10, 10)
        removed = clip_geojson(geojson_path, clip_mask)

        assert removed == 1  # only "inside" fully removed
        result = _read_geojson(geojson_path)
        assert len(result["features"]) == 2
        names = {f["properties"]["name"] for f in result["features"]}
        assert names == {"outside", "partial"}


class TestComputeClipMask:
    """Tests for compute_clip_mask."""

    def test_no_higher_bands_returns_none(self) -> None:
        """Highest band gets no clip mask."""
        coverage = {
            1: box(0, 0, 10, 10),
            3: box(2, 2, 5, 5),
        }
        assert compute_clip_mask(3, coverage) is None

    def test_higher_band_creates_mask(self) -> None:
        """Lower band gets higher-band coverage as clip mask."""
        coverage = {
            1: box(0, 0, 10, 10),
            3: box(2, 2, 5, 5),
        }
        mask = compute_clip_mask(1, coverage)
        assert mask is not None
        # Mask should be the band-3 polygon
        assert mask.equals(box(2, 2, 5, 5))

    def test_multiple_higher_bands_unioned(self) -> None:
        """Multiple higher bands are unioned into one mask."""
        coverage = {
            1: box(0, 0, 20, 20),
            3: box(2, 2, 5, 5),
            5: box(10, 10, 15, 15),
        }
        mask = compute_clip_mask(1, coverage)
        assert mask is not None
        # Mask should contain both higher-band areas
        assert mask.contains(box(3, 3, 4, 4))  # inside band 3
        assert mask.contains(box(11, 11, 14, 14))  # inside band 5

    def test_empty_coverage_returns_none(self) -> None:
        """Empty coverage index returns None."""
        assert compute_clip_mask(1, {}) is None


class TestComputeClipSegments:
    """Tests for compute_clip_segments zoom-aware clipping."""

    def test_no_higher_bands_single_segment(self) -> None:
        """Highest band gets a single unclipped segment."""
        coverage = {3: box(0, 0, 10, 10)}
        segments = compute_clip_segments(3, 0, 14, coverage, {3: 7})
        assert len(segments) == 1
        assert segments[0] == (0, 14, None)

    def test_one_higher_band_two_segments(self) -> None:
        """One higher band creates two segments: unclipped + clipped."""
        coverage = {
            0: box(0, 0, 20, 20),
            1: box(2, 2, 5, 5),
        }
        band_minzooms = {0: 0, 1: 5}
        segments = compute_clip_segments(0, 0, 14, coverage, band_minzooms)
        assert len(segments) == 2
        # First segment: z0-4, no clip
        assert segments[0][0] == 0
        assert segments[0][1] == 4
        assert segments[0][2] is None
        # Second segment: z5-14, clipped by band 1
        assert segments[1][0] == 5
        assert segments[1][1] == 14
        assert segments[1][2] is not None
        assert segments[1][2].equals(box(2, 2, 5, 5))

    def test_multiple_higher_bands_progressive_segments(self) -> None:
        """Multiple higher bands create progressive clip segments."""
        coverage = {
            0: box(0, 0, 30, 30),
            1: box(2, 2, 5, 5),
            2: box(10, 10, 15, 15),
        }
        band_minzooms = {0: 0, 1: 5, 2: 9}
        segments = compute_clip_segments(0, 0, 14, coverage, band_minzooms)
        assert len(segments) == 3
        # z0-4: no clip
        assert segments[0] == (0, 4, None)
        # z5-8: clip by band 1 only
        assert segments[1][0] == 5
        assert segments[1][1] == 8
        assert segments[1][2] is not None
        assert segments[1][2].contains(box(3, 3, 4, 4))  # band 1 area
        assert not segments[1][2].contains(box(11, 11, 14, 14))  # NOT band 2
        # z9-14: clip by band 1 + band 2
        assert segments[2][0] == 9
        assert segments[2][1] == 14
        assert segments[2][2] is not None
        assert segments[2][2].contains(box(3, 3, 4, 4))  # band 1 area
        assert segments[2][2].contains(box(11, 11, 14, 14))  # band 2 area

    def test_higher_band_starts_at_cell_minzoom(self) -> None:
        """Higher band starting at or before cell minzoom clips everything."""
        coverage = {
            0: box(0, 0, 20, 20),
            1: box(2, 2, 5, 5),
        }
        band_minzooms = {0: 0, 1: 0}
        segments = compute_clip_segments(0, 0, 14, coverage, band_minzooms)
        # All zooms should be clipped
        assert len(segments) == 1
        assert segments[0][0] == 0
        assert segments[0][1] == 14
        assert segments[0][2] is not None

    def test_empty_coverage_no_clipping(self) -> None:
        """No coverage data means no clipping."""
        segments = compute_clip_segments(0, 0, 14, {}, {})
        assert len(segments) == 1
        assert segments[0] == (0, 14, None)
