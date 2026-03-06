"""Tests for SCAMIN → minzoom, CSCL → zoom range, and scale band mapping."""

import json
import tempfile
from pathlib import Path

from s57_pipeline.scamin import (
    add_minzoom_to_geojson,
    compute_intu_zoom_ranges,
    cscl_to_minzoom,
    cscl_to_scale_band,
    cscl_to_zoom_range,
    intu_to_scale_band,
    intu_to_zoom_range,
    scamin_to_minzoom,
)


class TestScaminToMinzoom:
    def test_large_scale_returns_low_zoom(self) -> None:
        assert scamin_to_minzoom(10_000_000) == 3

    def test_threshold_boundary_5m(self) -> None:
        assert scamin_to_minzoom(5_000_000) == 3

    def test_threshold_boundary_1m(self) -> None:
        assert scamin_to_minzoom(1_000_000) == 6

    def test_threshold_boundary_200k(self) -> None:
        assert scamin_to_minzoom(200_000) == 9

    def test_threshold_boundary_50k(self) -> None:
        assert scamin_to_minzoom(50_000) == 11

    def test_threshold_boundary_20k(self) -> None:
        assert scamin_to_minzoom(20_000) == 12

    def test_threshold_boundary_10k(self) -> None:
        assert scamin_to_minzoom(10_000) == 13

    def test_small_scale_returns_default(self) -> None:
        assert scamin_to_minzoom(5_000) == 0

    def test_between_thresholds(self) -> None:
        assert scamin_to_minzoom(100_000) == 11
        assert scamin_to_minzoom(30_000) == 12

    def test_none_returns_default(self) -> None:
        assert scamin_to_minzoom(None) == 0

    def test_zero_returns_default(self) -> None:
        assert scamin_to_minzoom(0) == 0

    def test_negative_returns_default(self) -> None:
        assert scamin_to_minzoom(-100) == 0

    def test_float_input(self) -> None:
        assert scamin_to_minzoom(1_500_000.0) == 6


class TestCsclToMinzoom:
    def test_overview_scale(self) -> None:
        assert cscl_to_minzoom(675_000) == 0

    def test_coastal_scale(self) -> None:
        assert cscl_to_minzoom(350_000) == 6

    def test_approach_scale(self) -> None:
        assert cscl_to_minzoom(80_000) == 9

    def test_harbor_scale(self) -> None:
        assert cscl_to_minzoom(40_000) == 9

    def test_very_large_scale(self) -> None:
        assert cscl_to_minzoom(10_000) == 9


class TestCsclToZoomRange:
    def test_overview_scale(self) -> None:
        assert cscl_to_zoom_range(675_000) == (0, 5)

    def test_coastal_scale(self) -> None:
        assert cscl_to_zoom_range(350_000) == (6, 9)

    def test_approach_scale(self) -> None:
        assert cscl_to_zoom_range(80_000) == (9, 12)

    def test_harbor_scale(self) -> None:
        assert cscl_to_zoom_range(40_000) == (9, 14)


class TestCsclToScaleBand:
    def test_overview(self) -> None:
        assert cscl_to_scale_band(675_000) == 0

    def test_coastal(self) -> None:
        assert cscl_to_scale_band(350_000) == 1

    def test_approach(self) -> None:
        assert cscl_to_scale_band(80_000) == 2

    def test_harbor(self) -> None:
        assert cscl_to_scale_band(40_000) == 3

    def test_very_large_scale(self) -> None:
        assert cscl_to_scale_band(10_000) == 3


class TestIntuToZoomRange:
    """Test base INTU zoom ranges (enc-tiles reference, no overlap adjustment)."""

    def test_overview_intu_1(self) -> None:
        assert intu_to_zoom_range(1) == (0, 6)

    def test_general_intu_2(self) -> None:
        assert intu_to_zoom_range(2) == (7, 8)

    def test_coastal_intu_3(self) -> None:
        assert intu_to_zoom_range(3) == (9, 10)

    def test_approach_intu_4(self) -> None:
        assert intu_to_zoom_range(4) == (11, 12)

    def test_harbour_intu_5(self) -> None:
        assert intu_to_zoom_range(5) == (13, 14)

    def test_berthing_intu_6(self) -> None:
        assert intu_to_zoom_range(6) == (15, 16)

    def test_unknown_intu(self) -> None:
        assert intu_to_zoom_range(99) == (0, 14)

    def test_with_computed_ranges(self) -> None:
        """When zoom_ranges are passed, they override base values."""
        ranges = {3: (9, 12, 2), 5: (13, 14, 4)}
        assert intu_to_zoom_range(3, ranges) == (9, 12)
        assert intu_to_zoom_range(5, ranges) == (13, 14)
        # INTU not in ranges falls back to base
        assert intu_to_zoom_range(1, ranges) == (0, 6)


class TestComputeIntuZoomRanges:
    """Test data-driven zoom range computation based on present INTU bands."""

    def test_all_bands_present(self) -> None:
        """With all bands, ranges match base (no gaps to fill)."""
        result = compute_intu_zoom_ranges({1, 2, 3, 4, 5, 6})
        assert result[1] == (0, 6, 0)
        assert result[2] == (7, 8, 1)
        assert result[3] == (9, 10, 2)
        assert result[4] == (11, 12, 3)
        assert result[5] == (13, 14, 4)
        assert result[6] == (15, 16, 5)

    def test_missing_approach_band(self) -> None:
        """Missing INTU 4 — INTU 3 extends to fill the gap."""
        result = compute_intu_zoom_ranges({1, 2, 3, 5, 6})
        assert result[3] == (9, 12, 2)  # extended maxzoom from 10 to 12
        assert result[5] == (13, 14, 4)  # unchanged

    def test_missing_multiple_bands(self) -> None:
        """Missing INTU 2 and 4 — each lower band extends."""
        result = compute_intu_zoom_ranges({1, 3, 5})
        assert result[1] == (0, 8, 0)   # extended from 6 to 8 (next is INTU 3 at z9)
        assert result[3] == (9, 12, 2)  # extended from 10 to 12 (next is INTU 5 at z13)
        assert result[5] == (13, 14, 4)  # highest present, unchanged

    def test_single_band(self) -> None:
        """Single band extends down to z0."""
        result = compute_intu_zoom_ranges({5})
        assert result[5] == (0, 14, 4)  # minzoom=0 (lowest present), maxzoom unchanged

    def test_lowest_band_extends_to_z0(self) -> None:
        """The lowest present band always starts at z0."""
        result = compute_intu_zoom_ranges({3, 5})
        assert result[3] == (0, 12, 2)  # min extended to 0, max extended to 12
        assert result[5] == (13, 14, 4)

    def test_empty_set(self) -> None:
        result = compute_intu_zoom_ranges(set())
        assert result == {}

    def test_invalid_intus_ignored(self) -> None:
        result = compute_intu_zoom_ranges({99, 100})
        assert result == {}


class TestIntuToScaleBand:
    def test_overview(self) -> None:
        assert intu_to_scale_band(1) == 0

    def test_general(self) -> None:
        assert intu_to_scale_band(2) == 1

    def test_coastal(self) -> None:
        assert intu_to_scale_band(3) == 2

    def test_approach(self) -> None:
        assert intu_to_scale_band(4) == 3

    def test_harbour(self) -> None:
        assert intu_to_scale_band(5) == 4

    def test_berthing(self) -> None:
        assert intu_to_scale_band(6) == 5

    def test_unknown(self) -> None:
        assert intu_to_scale_band(99) == 0


class TestAddMinzoomToGeojson:
    def test_adds_tippecanoe_minzoom(self) -> None:
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"SCAMIN": 50_000},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                },
                {
                    "type": "Feature",
                    "properties": {"SCAMIN": 1_000_000},
                    "geometry": {"type": "Point", "coordinates": [1, 1]},
                },
            ],
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        try:
            count = add_minzoom_to_geojson(input_path)
            assert count == 2

            with open(input_path) as f:
                result = json.load(f)

            assert result["features"][0]["tippecanoe"]["minzoom"] == 11
            assert result["features"][1]["tippecanoe"]["minzoom"] == 6
        finally:
            input_path.unlink(missing_ok=True)

    def test_handles_missing_scamin(self) -> None:
        """Without SCAMIN, no per-feature minzoom is set (tile-level bounds control)."""
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"NAME": "test"},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                },
            ],
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        try:
            count = add_minzoom_to_geojson(input_path)
            assert count == 1

            with open(input_path) as f:
                result = json.load(f)

            # No per-feature minzoom/maxzoom set
            assert "minzoom" not in result["features"][0]["tippecanoe"]
            assert "maxzoom" not in result["features"][0]["tippecanoe"]
        finally:
            input_path.unlink(missing_ok=True)

    def test_no_per_feature_maxzoom(self) -> None:
        """Tile-level bounds are the sole zoom control; no per-feature maxzoom."""
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"DRVAL1": 5},
                    "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
                },
            ],
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix="_depare.geojson", delete=False, prefix=""
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        depare_path = input_path.parent / "depare.geojson"
        input_path.rename(depare_path)

        try:
            count = add_minzoom_to_geojson(depare_path, cell_cscl=675_000)
            assert count == 1

            with open(depare_path) as f:
                result = json.load(f)

            feat = result["features"][0]
            assert "minzoom" not in feat["tippecanoe"]
            assert "maxzoom" not in feat["tippecanoe"]
            assert feat["properties"]["_scale_band"] == 0
        finally:
            depare_path.unlink(missing_ok=True)

    def test_scamin_sets_minzoom_no_maxzoom(self) -> None:
        """SCAMIN sets minzoom; no per-feature maxzoom (tile-level bounds handle it)."""
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"SCAMIN": 50_000},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                },
            ],
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        try:
            count = add_minzoom_to_geojson(input_path, cell_cscl=675_000)
            assert count == 1

            with open(input_path) as f:
                result = json.load(f)

            feat = result["features"][0]
            assert feat["tippecanoe"]["minzoom"] == 11  # from SCAMIN
            assert "maxzoom" not in feat["tippecanoe"]
            assert feat["properties"]["_scale_band"] == 0
        finally:
            input_path.unlink(missing_ok=True)

    def test_scale_band_without_cscl(self) -> None:
        """Without cell_cscl, _scale_band defaults to 0."""
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                },
            ],
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        try:
            add_minzoom_to_geojson(input_path)

            with open(input_path) as f:
                result = json.load(f)

            assert result["features"][0]["properties"]["_scale_band"] == 0
        finally:
            input_path.unlink(missing_ok=True)

    def test_separate_output_file(self) -> None:
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"SCAMIN": 200_000},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                },
            ],
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        output_path = input_path.parent / f"{input_path.stem}_out.geojson"

        try:
            add_minzoom_to_geojson(input_path, output_path)

            with open(output_path) as f:
                result = json.load(f)

            assert result["features"][0]["tippecanoe"]["minzoom"] == 9
        finally:
            input_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)

    def test_intu_preferred_over_cscl_for_scale_band(self) -> None:
        """When both INTU and CSCL are provided, INTU sets scale_band."""
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                },
            ],
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        try:
            # INTU 5 = harbour (band 4), CSCL 675k = overview (band 0)
            # INTU should win for scale_band
            count = add_minzoom_to_geojson(
                input_path, cell_cscl=675_000, cell_intu=5
            )
            assert count == 1

            with open(input_path) as f:
                result = json.load(f)

            feat = result["features"][0]
            # No per-feature zoom — tile-level bounds handle it
            assert "minzoom" not in feat["tippecanoe"]
            assert "maxzoom" not in feat["tippecanoe"]
            assert feat["properties"]["_scale_band"] == 4
        finally:
            input_path.unlink(missing_ok=True)

    def test_intu_scale_band_5(self) -> None:
        """INTU 6 (berthing) gives scale_band 5."""
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                },
            ],
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        try:
            add_minzoom_to_geojson(input_path, cell_intu=6)

            with open(input_path) as f:
                result = json.load(f)

            assert result["features"][0]["properties"]["_scale_band"] == 5
        finally:
            input_path.unlink(missing_ok=True)
