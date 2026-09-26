"""Tests for region definitions and catalog-based cell selection."""

from __future__ import annotations

import pytest

from s57_pipeline.enc_catalog import BBox, CatalogCell
from s57_pipeline.regions import (
    OVERVIEW_MARGIN_DEG,
    REGIONS,
    get_region_build_cells,
    get_region_cells,
    query_region,
    usage_band,
)

BOSTON: BBox = REGIONS["boston-test"].bbox


def _cell(name: str, bbox: BBox | None, status: str = "Active") -> CatalogCell:
    return CatalogCell(name, status, 1, 0, bbox)


def _inside(bbox: BBox) -> BBox:
    """A small box at the centre of ``bbox``."""
    x, y = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    return (x - 0.01, y - 0.01, x + 0.01, y + 0.01)


def _offset(bbox: BBox, dx: float) -> BBox:
    return (bbox[0] + dx, bbox[1], bbox[2] + dx, bbox[3])


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
        assert "southern-new-england" in REGIONS
        assert "northern-new-england" in REGIONS


class TestQueryRegion:
    def test_selects_active_cells_by_coverage(self) -> None:
        catalog = {
            c.name: c
            for c in (
                _cell("US5MA10M", _inside(BOSTON)),
                _cell(
                    "US4MA1AA", (BOSTON[0] - 1, BOSTON[1], BOSTON[0] + 0.01, BOSTON[3])
                ),
                _cell("US5CA01M", (-120.0, 35.0, -119.0, 36.0)),
            )
        }
        assert query_region(BOSTON, catalog) == ["US4MA1AA", "US5MA10M"]

    def test_excludes_cancelled_cells(self) -> None:
        catalog = {
            "US5WA12M": _cell("US5WA12M", None, status="Cancelled"),
            "US5OLD1M": _cell("US5OLD1M", _inside(BOSTON), status="Cancelled"),
            "US5SEAHH": _cell("US5SEAHH", _inside(BOSTON)),
        }
        assert query_region(BOSTON, catalog) == ["US5SEAHH"]

    def test_active_cell_without_coverage_is_skipped(self) -> None:
        assert query_region(BOSTON, {"US5NOCOV": _cell("US5NOCOV", None)}) == []


class TestRegionCells:
    def test_region_cells_use_region_bbox(self) -> None:
        catalog = {
            "US5MA10M": _cell("US5MA10M", _inside(BOSTON)),
            "US5CA01M": _cell("US5CA01M", (-120.0, 35.0, -119.0, 36.0)),
        }
        assert get_region_cells("boston-test", catalog) == ["US5MA10M"]

    def test_raises_on_unknown_region(self) -> None:
        with pytest.raises(KeyError):
            get_region_cells("nonexistent", {})

    def test_build_cells_add_nearby_overview_cells(self) -> None:
        near = _offset(_inside(BOSTON), -(OVERVIEW_MARGIN_DEG - 1))
        far = _offset(_inside(BOSTON), -(OVERVIEW_MARGIN_DEG + 10))
        catalog = {
            c.name: c
            for c in (
                _cell("US5MA10M", _inside(BOSTON)),
                _cell("US3NEAR1", near),
                _cell("US4NEAR1", near),  # approach band: not an overview cell
                _cell("US3FAR01", far),
                _cell("US3GONE1", near, status="Cancelled"),
            )
        }
        assert get_region_build_cells("boston-test", catalog) == [
            "US5MA10M",
            "US3NEAR1",
        ]

    def test_usage_band(self) -> None:
        assert usage_band("US5MA22M") == 5
        assert usage_band("US1GLBCF") == 1
