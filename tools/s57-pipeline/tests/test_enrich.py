"""Tests for GeoJSON enrichment, especially list attribute flattening."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from s57_pipeline.enrich import enrich_geojson


def _make_geojson(features: list[dict]) -> str:
    """Create a minimal GeoJSON FeatureCollection string."""
    return json.dumps({
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Point", "coordinates": [0, 0]},
            }
            for props in features
        ],
    })


def _enrich_and_read(features: list[dict], **kwargs) -> list[dict]:
    """Write features to temp GeoJSON, enrich, and return the enriched properties."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".geojson", delete=False
    ) as f:
        f.write(_make_geojson(features))
        path = Path(f.name)

    enrich_geojson(path, apply_scamin=False, **kwargs)

    with open(path) as f:
        data = json.load(f)
    path.unlink()
    return [feat["properties"] for feat in data["features"]]


class TestListFlattening:
    """Verify that list-valued properties are flattened to comma-separated strings."""

    def test_colour_array_flattened(self):
        """COLOUR ["1", "11"] → "1,11" """
        props = _enrich_and_read([{"COLOUR": ["1", "11"]}])[0]
        assert props["COLOUR"] == "1,11"

    def test_colour_single_array_flattened(self):
        """COLOUR ["6"] → "6" """
        props = _enrich_and_read([{"COLOUR": ["6"]}])[0]
        assert props["COLOUR"] == "6"

    def test_colour_integer_unchanged(self):
        """COLOUR 4 (integer) stays as integer."""
        props = _enrich_and_read([{"COLOUR": 4}])[0]
        assert props["COLOUR"] == 4

    def test_colour_string_unchanged(self):
        """COLOUR "4" (already a string) stays as string."""
        props = _enrich_and_read([{"COLOUR": "4"}])[0]
        assert props["COLOUR"] == "4"

    def test_catspm_array_flattened(self):
        """CATSPM ["27"] → "27" """
        props = _enrich_and_read([{"CATSPM": ["27"]}])[0]
        assert props["CATSPM"] == "27"

    def test_status_multi_array_flattened(self):
        """STATUS ["5", "8"] → "5,8" """
        props = _enrich_and_read([{"STATUS": ["5", "8"]}])[0]
        assert props["STATUS"] == "5,8"

    def test_three_element_colour_flattened(self):
        """COLOUR ["4", "3", "4"] → "4,3,4" """
        props = _enrich_and_read([{"COLOUR": ["4", "3", "4"]}])[0]
        assert props["COLOUR"] == "4,3,4"

    def test_non_list_props_unchanged(self):
        """Non-list properties (int, str) are not modified."""
        props = _enrich_and_read([{
            "BOYSHP": 4,
            "OBJNAM": "Test Buoy",
            "SCAMIN": 29999,
        }])[0]
        assert props["BOYSHP"] == 4
        assert props["OBJNAM"] == "Test Buoy"
        assert props["SCAMIN"] == 29999

    def test_multiple_list_props_all_flattened(self):
        """All list properties in a feature are flattened."""
        props = _enrich_and_read([{
            "COLOUR": ["1", "11"],
            "STATUS": ["5", "8"],
            "CATSPM": ["27"],
            "COLPAT": ["1"],
            "BOYSHP": 4,
        }])[0]
        assert props["COLOUR"] == "1,11"
        assert props["STATUS"] == "5,8"
        assert props["CATSPM"] == "27"
        assert props["COLPAT"] == "1"
        assert props["BOYSHP"] == 4  # not a list, unchanged

    def test_empty_array_becomes_empty_string(self):
        """Empty list [] → "" """
        props = _enrich_and_read([{"COLOUR": []}])[0]
        assert props["COLOUR"] == ""

    def test_lnam_refs_array_flattened(self):
        """LNAM_REFS (a list property from GDAL) is also flattened."""
        props = _enrich_and_read([{
            "LNAM_REFS": ["022602110BF0FB5F", "022602110BF1FB5F"],
        }])[0]
        assert props["LNAM_REFS"] == "022602110BF0FB5F,022602110BF1FB5F"
