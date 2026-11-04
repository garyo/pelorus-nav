"""Tests for Inland ENC support: GDAL table supplement, layer folding,
and intended use from compilation scale."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from s57_pipeline.convert import fold_inland, intended_use
from s57_pipeline.inland import (
    INLAND_ATTRIBUTES,
    INLAND_OBJECT_CLASSES,
    is_inland_cell,
    s57_tables_dir,
    standardize_attributes,
)


def _codes(path: Path) -> dict[str, list[str]]:
    with open(path, encoding="latin-1") as f:
        return {row[0]: row for row in csv.reader(f) if row}


def test_tables_add_the_inland_definitions_to_gdals() -> None:
    tables = s57_tables_dir()
    classes = _codes(tables / "s57objectclasses.csv")
    attributes = _codes(tables / "s57attributes.csv")
    assert classes["17032"][2] == "slcons"
    assert attributes["17012"][2] == "catslc"
    # GDAL's own definitions are kept, and nothing is defined twice.
    assert classes["122"][2] == "SLCONS"
    assert len(classes) > len(INLAND_OBJECT_CLASSES) + 100
    assert all(row[0] in attributes for row in INLAND_ATTRIBUTES)
    for name in ("s57agencies.csv", "s57expectedinput.csv"):
        assert (tables / name).exists()


def test_standardize_attributes_fills_only_unset_standard_names() -> None:
    props: dict[str, object] = {"catlam": 2, "catslc": 7, "CATSLC": 8}
    standardize_attributes(props)
    assert props["CATLAM"] == 2
    assert props["CATSLC"] == 8


def _write(path: Path, features: list[dict]) -> None:
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


def _feature(**props: object) -> dict:
    point = {"type": "Point", "coordinates": [-92.0, 44.4]}
    return {"type": "Feature", "geometry": point, "properties": props}


def test_fold_inland_appends_to_the_standard_layer(tmp_path: Path) -> None:
    standard = tmp_path / "bcnlat.geojson"
    inland = tmp_path / "bcnlat.inland.geojson"
    _write(standard, [_feature(CATLAM=1)])
    _write(inland, [_feature(catlam=2)])
    assert fold_inland(inland, standard) == standard
    features = json.loads(standard.read_text())["features"]
    assert [f["properties"]["CATLAM"] for f in features] == [1, 2]
    assert not inland.exists()


def test_fold_inland_creates_a_missing_standard_layer(tmp_path: Path) -> None:
    standard = tmp_path / "slcons.geojson"
    inland = tmp_path / "slcons.inland.geojson"
    _write(inland, [_feature(catslc=7)])
    fold_inland(inland, standard)
    features = json.loads(standard.read_text())["features"]
    assert features[0]["properties"]["CATSLC"] == 7


def test_intended_use_places_inland_cells_by_scale() -> None:
    assert intended_use(5, 25_000) == 5
    assert intended_use(7, 5_000) == 5  # Inland ENC, 1:5,000: harbour
    assert intended_use(7, 3_000) == 6
    assert intended_use(7, 40_000) == 4
    assert intended_use(7, None) == 7
    assert intended_use(None, 5_000) is None


def test_is_inland_cell() -> None:
    assert is_inland_cell("U37UM723")
    assert not is_inland_cell("US5MA22M")
