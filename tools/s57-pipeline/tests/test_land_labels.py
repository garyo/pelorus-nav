"""Tests for island-name label anchor selection (land_labels.py)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import box

from s57_pipeline.land_labels import (
    BANDS,
    HIDDEN,
    OFFSET_ANCHORS,
    UNCONSTRAINED,
    annotate_land_label_anchors,
    candidate_box,
    encode_anchors,
    label_box_size,
    overlap_fractions,
)

LA_KEYS = [f"_la{z}" for z in BANDS]
LAT = 41.6
LON = -71.35


def _square(lon: float, lat: float, half: float) -> dict:
    return _rect(lon - half, lat - half, lon + half, lat + half)


def _rect(x0: float, y0: float, x1: float, y1: float) -> dict:
    ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    return {"type": "Polygon", "coordinates": [ring]}


def _point(lon: float, lat: float) -> dict:
    return {"type": "Point", "coordinates": [lon, lat]}


def _feature(geometry: dict, name: str | None = None) -> dict:
    props: dict = {"RCID": 1}
    if name is not None:
        props["OBJNAM"] = name
    return {"type": "Feature", "properties": props, "geometry": geometry}


def _annotate(tmp_path: Path, features: list[dict]) -> list[dict]:
    path = tmp_path / "lndare.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    annotate_land_label_anchors(tmp_path)
    return [f["properties"] for f in json.loads(path.read_text())["features"]]


# A large unnamed island whose west shore is ~145 m east of the islet's.
BIG_ISLAND = _rect(LON + 0.002, LAT - 0.01, LON + 0.02, LAT + 0.01)


class TestCandidateBox:
    def test_top_anchor_puts_label_below_point(self):
        x0, y0, x1, y1 = candidate_box("T", 0, 0, w=10, h=2, r=1)
        assert (x0, y0, x1, y1) == (-5, -3, 5, -1)

    def test_right_anchor_puts_label_west(self):
        x0, _, x1, _ = candidate_box("R", 0, 0, w=10, h=2, r=1)
        assert (x0, x1) == (-11, -1)

    def test_top_left_anchor_puts_label_below_right(self):
        x0, y0, x1, y1 = candidate_box("TL", 0, 0, w=10, h=2, r=2**0.5)
        assert (x0, x1) == pytest.approx((1, 11))
        assert (y0, y1) == pytest.approx((-3, -1))

    def test_bottom_right_anchor_puts_label_above_left(self):
        x0, y0, x1, y1 = candidate_box("BR", 0, 0, w=10, h=2, r=2**0.5)
        assert (x0, x1) == pytest.approx((-11, -1))
        assert (y0, y1) == pytest.approx((1, 3))


class TestLabelBoxSize:
    def test_text_size_clamped_above_z14(self):
        w14, h14, _ = label_box_size(14, 10, 0)
        w15, h15, _ = label_box_size(15, 10, 0)
        # Same pixel size, half the metres per pixel.
        assert (w15, h15) == pytest.approx((w14 / 2, h14 / 2))

    def test_width_scales_with_name_length(self):
        assert label_box_size(12, 20, 40)[0] == pytest.approx(
            2 * label_box_size(12, 10, 40)[0]
        )


class TestOverlapFractions:
    def test_partial_inside_and_disjoint(self):
        land = [box(0, 0, 10, 10), box(20, 0, 21, 1)]
        boxes = np.array(
            [[5, 0, 15, 10], [19, -1, 23, 3], [100, 100, 110, 110], [0, 0, 10, 10]],
            dtype=float,
        )
        assert overlap_fractions(land, boxes) == pytest.approx([0.5, 1 / 16, 0.0, 1.0])

    def test_no_land(self):
        assert overlap_fractions([], np.array([[0, 0, 1, 1]], dtype=float)) == [0.0]


class TestEncodeAnchors:
    def test_all_acceptable_is_unconstrained(self):
        assert encode_anchors({"C": 0.0, "T": 0.05}) == UNCONSTRAINED

    def test_none_acceptable_hides(self):
        assert encode_anchors({"C": 0.5, "T": 0.2}) == HIDDEN

    def test_lowest_overlap_first_and_at_most_two(self):
        scores = {"C": 0.5, "T": 0.08, "R": 0.0, "L": 0.02}
        assert encode_anchors(scores) == "R,L"

    def test_center_wins_near_tie(self):
        scores = {"T": 0.001, "C": 0.004, "R": 0.5}
        assert encode_anchors(scores) == "C,T"


class TestAnnotateLandLabelAnchors:
    def test_islet_beside_big_island_avoids_east_anchors(self, tmp_path: Path):
        props = _annotate(
            tmp_path,
            [
                _feature(_square(LON, LAT, 0.00025), "Gooseberry Island"),
                _feature(BIG_ISLAND),
            ],
        )
        code = props[0]["_la13"]
        assert code not in (UNCONSTRAINED, HIDDEN)
        assert set(code.split(",")) <= {"R", "TR", "BR"}
        assert code.split(",")[0] == "R"

    def test_isolated_islet_unconstrained(self, tmp_path: Path):
        props = _annotate(tmp_path, [_feature(_square(LON, LAT, 0.00025), "Lone")])
        assert [props[0][k] for k in LA_KEYS] == [UNCONSTRAINED] * len(LA_KEYS)

    def test_point_islet_never_centered(self, tmp_path: Path):
        props = _annotate(
            tmp_path, [_feature(_point(LON, LAT), "Rock"), _feature(BIG_ISLAND)]
        )
        codes = [props[0][k] for k in LA_KEYS]
        constrained = [c for c in codes if c not in (UNCONSTRAINED, HIDDEN)]
        assert constrained
        for code in constrained:
            assert set(code.split(",")) <= set(OFFSET_ANCHORS)

    def test_unnamed_features_untouched(self, tmp_path: Path):
        props = _annotate(
            tmp_path,
            [_feature(_square(LON, LAT, 0.00025), "Islet"), _feature(BIG_ISLAND)],
        )
        assert props[1] == {"RCID": 1}

    def test_same_name_pieces_ignore_each_other(self, tmp_path: Path):
        # One island split at a cell edge into two touching halves.
        props = _annotate(
            tmp_path,
            [
                _feature(_rect(LON - 0.002, LAT, LON, LAT + 0.001), "Hope Island"),
                _feature(_rect(LON, LAT, LON + 0.002, LAT + 0.001), "Hope Island"),
            ],
        )
        for p in props:
            assert [p[k] for k in LA_KEYS] == [UNCONSTRAINED] * len(LA_KEYS)

    def test_existing_properties_kept(self, tmp_path: Path):
        props = _annotate(tmp_path, [_feature(_point(LON, LAT), "Rock")])
        assert props[0]["RCID"] == 1
        assert props[0]["OBJNAM"] == "Rock"

    def test_missing_file_is_noop(self, tmp_path: Path):
        annotate_land_label_anchors(tmp_path)
        assert not (tmp_path / "lndare.geojson").exists()

    def test_unparsable_file_is_noop(self, tmp_path: Path):
        path = tmp_path / "lndare.geojson"
        path.write_text("{not json")
        annotate_land_label_anchors(tmp_path)
        assert path.read_text() == "{not json"
