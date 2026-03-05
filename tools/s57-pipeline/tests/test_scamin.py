"""Tests for SCAMIN → minzoom mapping."""

import json
import tempfile
from pathlib import Path

from s57_pipeline.scamin import (
    add_minzoom_to_geojson,
    cscl_to_minzoom,
    cscl_to_zoom_range,
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
        # 100k is between 200k (zoom 9) and 50k (zoom 11), so maps to zoom 11
        assert scamin_to_minzoom(100_000) == 11
        # 30k is between 50k (zoom 11) and 20k (zoom 12), so maps to zoom 12
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

    def test_approach_scale(self) -> None:
        assert cscl_to_minzoom(80_000) == 8

    def test_harbor_scale(self) -> None:
        assert cscl_to_minzoom(40_000) == 10

    def test_very_large_scale(self) -> None:
        assert cscl_to_minzoom(10_000) == 10


class TestCsclToZoomRange:
    def test_overview_scale(self) -> None:
        assert cscl_to_zoom_range(675_000) == (0, 9)

    def test_approach_scale(self) -> None:
        assert cscl_to_zoom_range(80_000) == (8, 12)

    def test_harbor_scale(self) -> None:
        assert cscl_to_zoom_range(40_000) == (10, 14)


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

            assert result["features"][0]["tippecanoe"]["minzoom"] == 0
        finally:
            input_path.unlink(missing_ok=True)

    def test_terrain_layer_gets_maxzoom(self) -> None:
        """Terrain polygon layers (DEPARE) get maxzoom from cell CSCL."""
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

        # Rename to depare.geojson so layer name detection works
        depare_path = input_path.parent / "depare.geojson"
        input_path.rename(depare_path)

        try:
            count = add_minzoom_to_geojson(depare_path, cell_cscl=675_000)
            assert count == 1

            with open(depare_path) as f:
                result = json.load(f)

            feat = result["features"][0]["tippecanoe"]
            assert feat["minzoom"] == 0
            assert feat["maxzoom"] == 9
        finally:
            depare_path.unlink(missing_ok=True)

    def test_line_layer_gets_maxzoom(self) -> None:
        """Line layers (COALNE) get maxzoom to avoid coarse outlines at high zoom."""
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
                },
            ],
        }

        with tempfile.NamedTemporaryFile(
            mode="w", suffix="_coalne.geojson", delete=False, prefix=""
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        coalne_path = input_path.parent / "coalne.geojson"
        input_path.rename(coalne_path)

        try:
            count = add_minzoom_to_geojson(coalne_path, cell_cscl=675_000)
            assert count == 1

            with open(coalne_path) as f:
                result = json.load(f)

            feat = result["features"][0]["tippecanoe"]
            assert feat["minzoom"] == 0
            assert feat["maxzoom"] == 9
        finally:
            coalne_path.unlink(missing_ok=True)

    def test_navaid_layer_gets_maxzoom(self) -> None:
        """Navaid point layers get maxzoom to avoid duplicates from overlapping cells."""
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
            mode="w", suffix="_boylat.geojson", delete=False, prefix=""
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        boylat_path = input_path.parent / "boylat.geojson"
        input_path.rename(boylat_path)

        try:
            count = add_minzoom_to_geojson(boylat_path, cell_cscl=675_000)
            assert count == 1

            with open(boylat_path) as f:
                result = json.load(f)

            feat = result["features"][0]["tippecanoe"]
            assert feat["minzoom"] == 0
            assert feat["maxzoom"] == 9
        finally:
            boylat_path.unlink(missing_ok=True)

    def test_infrastructure_no_maxzoom(self) -> None:
        """Infrastructure layers do NOT get maxzoom — sparse, cell-specific."""
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
            mode="w", suffix="_bridge.geojson", delete=False, prefix=""
        ) as f:
            json.dump(geojson, f)
            input_path = Path(f.name)

        bridge_path = input_path.parent / "bridge.geojson"
        input_path.rename(bridge_path)

        try:
            count = add_minzoom_to_geojson(bridge_path, cell_cscl=675_000)
            assert count == 1

            with open(bridge_path) as f:
                result = json.load(f)

            feat = result["features"][0]["tippecanoe"]
            assert feat["minzoom"] == 0
            assert "maxzoom" not in feat
        finally:
            bridge_path.unlink(missing_ok=True)

    def test_scamin_overrides_cscl(self) -> None:
        """Features WITH SCAMIN use it even when cell_cscl is provided."""
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

            feat = result["features"][0]["tippecanoe"]
            assert feat["minzoom"] == 11
            assert "maxzoom" not in feat
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
