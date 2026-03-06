"""Tests for S-52 display category and priority metadata."""

import json
import tempfile
from pathlib import Path

from s57_pipeline.s52_metadata import (
    DISPLAY_CATEGORY,
    DISPLAY_PRIORITY,
    add_s52_metadata,
)


class TestDisplayCategoryTable:
    def test_displaybase_layers(self) -> None:
        displaybase = [k for k, v in DISPLAY_CATEGORY.items() if v == "DISPLAYBASE"]
        assert "COALNE" in displaybase
        assert "DEPARE" in displaybase
        assert "SOUNDG" in displaybase
        assert "WRECKS" in displaybase

    def test_standard_layers(self) -> None:
        standard = [k for k, v in DISPLAY_CATEGORY.items() if v == "STANDARD"]
        assert "BOYLAT" in standard
        assert "LIGHTS" in standard
        assert "RESARE" in standard
        assert "BRIDGE" in standard

    def test_other_layers(self) -> None:
        other = [k for k, v in DISPLAY_CATEGORY.items() if v == "OTHER"]
        assert "BUISGL" in other
        assert "BERTHS" in other
        assert "PILPNT" in other

    def test_all_categories_valid(self) -> None:
        valid = {"DISPLAYBASE", "STANDARD", "OTHER"}
        for layer, cat in DISPLAY_CATEGORY.items():
            assert cat in valid, f"{layer} has invalid category {cat}"


class TestDisplayPriorityTable:
    def test_area_fills_lowest_priority(self) -> None:
        assert DISPLAY_PRIORITY["DEPARE"] == 1
        assert DISPLAY_PRIORITY["LNDARE"] == 1

    def test_lights_high_priority(self) -> None:
        assert DISPLAY_PRIORITY["LIGHTS"] == 8

    def test_all_priorities_in_range(self) -> None:
        for layer, pri in DISPLAY_PRIORITY.items():
            assert 0 <= pri <= 9, f"{layer} has priority {pri} out of range"


class TestAddS52Metadata:
    def _make_geojson(self, layer_name: str) -> Path:
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"OBJNAM": "test"},
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                },
            ],
        }
        tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".geojson", delete=False, prefix=""
        )
        json.dump(geojson, tmp)
        tmp.close()
        target = Path(tmp.name).parent / f"{layer_name.lower()}.geojson"
        Path(tmp.name).rename(target)
        return target

    def test_adds_displaybase_category(self) -> None:
        path = self._make_geojson("COALNE")
        try:
            count = add_s52_metadata(path)
            assert count == 1
            with open(path) as f:
                result = json.load(f)
            props = result["features"][0]["properties"]
            assert props["_disp_cat"] == "DISPLAYBASE"
            assert props["_disp_pri"] == 4
        finally:
            path.unlink(missing_ok=True)

    def test_adds_standard_category(self) -> None:
        path = self._make_geojson("BOYLAT")
        try:
            count = add_s52_metadata(path)
            assert count == 1
            with open(path) as f:
                result = json.load(f)
            props = result["features"][0]["properties"]
            assert props["_disp_cat"] == "STANDARD"
            assert props["_disp_pri"] == 6
        finally:
            path.unlink(missing_ok=True)

    def test_adds_other_category(self) -> None:
        path = self._make_geojson("BUISGL")
        try:
            count = add_s52_metadata(path)
            assert count == 1
            with open(path) as f:
                result = json.load(f)
            props = result["features"][0]["properties"]
            assert props["_disp_cat"] == "OTHER"
            assert props["_disp_pri"] == 7
        finally:
            path.unlink(missing_ok=True)

    def test_unknown_layer_returns_zero(self) -> None:
        path = self._make_geojson("UNKNOWN")
        try:
            count = add_s52_metadata(path)
            assert count == 0
        finally:
            path.unlink(missing_ok=True)
