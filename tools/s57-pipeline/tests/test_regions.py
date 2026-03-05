"""Tests for region definitions and query functions."""

import json
from pathlib import Path
from unittest.mock import patch, MagicMock

from s57_pipeline.regions import (
    REGIONS,
    get_region_cells,
    query_region,
)


class TestRegionDefinitions:
    def test_all_regions_have_required_fields(self) -> None:
        for name, region in REGIONS.items():
            assert region.name, f"{name} must have a name"
            assert len(region.bbox) == 4, f"{name} bbox must have 4 values"
            assert region.description, f"{name} must have a description"

    def test_bbox_values_are_valid(self) -> None:
        for name, region in REGIONS.items():
            west, south, east, north = region.bbox
            assert -180 <= west <= 180, f"{name}: invalid west"
            assert -90 <= south <= 90, f"{name}: invalid south"
            assert west < east, f"{name}: west must be < east"
            assert south < north, f"{name}: south must be < north"

    def test_known_regions_exist(self) -> None:
        assert "boston-test" in REGIONS
        assert "new-england" in REGIONS


class TestQueryRegion:
    def test_returns_cached_results(self, tmp_path: Path) -> None:
        cache_file = tmp_path / "test.json"
        cache_file.write_text(json.dumps({
            "bbox": [-71.15, 42.2, -70.8, 42.45],
            "cells": ["US2EC04M", "US5MA10M"],
            "count": 2,
        }))
        result = query_region((-71.15, 42.2, -70.8, 42.45), cache_path=cache_file)
        assert result == ["US2EC04M", "US5MA10M"]

    def test_writes_cache_on_api_call(self, tmp_path: Path) -> None:
        cache_file = tmp_path / "regions" / "test.json"
        mock_response = json.dumps({
            "features": [
                {"attributes": {"DSNM": "US5MA10M.000"}},
                {"attributes": {"DSNM": "US5MA11M"}},
            ]
        }).encode()

        mock_resp = MagicMock()
        mock_resp.read.return_value = mock_response
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch("s57_pipeline.regions.urllib.request.urlopen", return_value=mock_resp):
            result = query_region((-71.15, 42.2, -70.8, 42.45), cache_path=cache_file)

        assert "US5MA10M" in result
        assert "US5MA11M" in result
        assert cache_file.exists()
        cached = json.loads(cache_file.read_text())
        assert cached["count"] == len(result)

    def test_deduplicates_cells(self) -> None:
        mock_response = json.dumps({
            "features": [
                {"attributes": {"DSNM": "US5MA10M.000"}},
                {"attributes": {"DSNM": "US5MA10M"}},
            ]
        }).encode()

        mock_resp = MagicMock()
        mock_resp.read.return_value = mock_response
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch("s57_pipeline.regions.urllib.request.urlopen", return_value=mock_resp):
            result = query_region((-71.15, 42.2, -70.8, 42.45))

        assert result.count("US5MA10M") == 1

    def test_strips_000_extension(self) -> None:
        mock_response = json.dumps({
            "features": [
                {"attributes": {"DSNM": "US5MA10M.000"}},
            ]
        }).encode()

        mock_resp = MagicMock()
        mock_resp.read.return_value = mock_response
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch("s57_pipeline.regions.urllib.request.urlopen", return_value=mock_resp):
            result = query_region((-71.15, 42.2, -70.8, 42.45))

        assert result == ["US5MA10M"]


class TestGetRegionCells:
    def test_calls_query_with_correct_bbox(self) -> None:
        with patch("s57_pipeline.regions.query_region", return_value=["US5MA10M"]) as mock:
            result = get_region_cells("boston-test")
            assert result == ["US5MA10M"]
            bbox_arg = mock.call_args[0][0]
            assert bbox_arg == REGIONS["boston-test"].bbox

    def test_raises_on_unknown_region(self) -> None:
        try:
            get_region_cells("nonexistent")
            assert False, "Should have raised KeyError"
        except KeyError:
            pass
