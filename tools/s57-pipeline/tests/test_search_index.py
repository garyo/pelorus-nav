"""Tests for search index extraction."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from s57_pipeline.search_index import extract_search_index, write_search_index


def _make_geojson(_layer_name: str, features: list[dict]) -> str:
    """Create a GeoJSON FeatureCollection string."""
    return json.dumps({
        "type": "FeatureCollection",
        "features": features,
    })


def _make_feature(
    name: str | None,
    geometry: dict | None = None,
    **extra_props: object,
) -> dict:
    """Create a GeoJSON Feature with optional OBJNAM."""
    props: dict = {}
    if name is not None:
        props["OBJNAM"] = name
    props.update(extra_props)
    if geometry is None:
        geometry = {"type": "Point", "coordinates": [-71.0, 42.35]}
    return {
        "type": "Feature",
        "properties": props,
        "geometry": geometry,
    }


def _setup_cells(
    tmp: Path,
    cells: dict[str, dict[str, list[dict]]],
) -> list[str]:
    """Set up cell directories with GeoJSON files.

    Args:
        tmp: Temp work directory.
        cells: {cell_name: {layer_name: [features]}}.

    Returns:
        List of cell names.
    """
    for cell_name, layers in cells.items():
        geojson_dir = tmp / cell_name / "geojson"
        geojson_dir.mkdir(parents=True)
        for layer_name, features in layers.items():
            path = geojson_dir / f"{layer_name.lower()}.geojson"
            path.write_text(_make_geojson(layer_name, features))
    return list(cells.keys())


def test_extracts_named_point_features():
    """Named point features are extracted with correct centroid."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cell_names = _setup_cells(tmp_path, {
            "US5MA22M": {
                "BUAARE": [
                    _make_feature("Boston"),
                    _make_feature("Cambridge"),
                ],
            },
        })
        result = extract_search_index(tmp_path, cell_names)
        assert len(result) == 2
        names = [f["n"] for f in result]
        assert "Boston" in names
        assert "Cambridge" in names
        # All should be BUAARE type
        assert all(f["t"] == "BUAARE" for f in result)
        # Should have centroid
        assert all("c" in f for f in result)


def test_skips_unnamed_features():
    """Features without OBJNAM are skipped."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cell_names = _setup_cells(tmp_path, {
            "US5MA22M": {
                "BOYLAT": [
                    _make_feature(None, LABEL="6"),
                    _make_feature("Named Buoy 1"),
                ],
            },
        })
        result = extract_search_index(tmp_path, cell_names)
        assert len(result) == 1
        assert result[0]["n"] == "Named Buoy 1"


def test_skips_excluded_layers():
    """SOUNDG, DEPARE, etc. are skipped entirely."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cell_names = _setup_cells(tmp_path, {
            "US5MA22M": {
                "SOUNDG": [_make_feature("Deep Spot")],
                "DEPARE": [_make_feature("Some Area")],
                "SBDARE": [_make_feature("Sandy Bottom")],
                "MAGVAR": [_make_feature("MagVar Point")],
                "BUAARE": [_make_feature("Boston")],
            },
        })
        result = extract_search_index(tmp_path, cell_names)
        assert len(result) == 1
        assert result[0]["n"] == "Boston"


def test_deduplicates_across_cells():
    """Same feature in overlapping cells is deduplicated."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cell_names = _setup_cells(tmp_path, {
            "US5MA22M": {
                "LNDARE": [_make_feature("Spectacle Island")],
            },
            "US4MA22M": {
                "LNDARE": [_make_feature("Spectacle Island")],
            },
        })
        result = extract_search_index(tmp_path, cell_names)
        assert len(result) == 1
        assert result[0]["n"] == "Spectacle Island"


def test_polygon_gets_bbox():
    """Area features get a bounding box."""
    polygon_geom = {
        "type": "Polygon",
        "coordinates": [[
            [-71.1, 42.3],
            [-71.0, 42.3],
            [-71.0, 42.4],
            [-71.1, 42.4],
            [-71.1, 42.3],
        ]],
    }
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cell_names = _setup_cells(tmp_path, {
            "US5MA22M": {
                "RESARE": [_make_feature("No Anchoring Zone", polygon_geom)],
            },
        })
        result = extract_search_index(tmp_path, cell_names)
        assert len(result) == 1
        assert "b" in result[0]
        assert len(result[0]["b"]) == 4


def test_label_included_when_different():
    """LABEL is included when it differs from OBJNAM."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cell_names = _setup_cells(tmp_path, {
            "US5MA22M": {
                "BOYLAT": [
                    _make_feature("Channel Buoy 6", LABEL="6"),
                ],
            },
        })
        result = extract_search_index(tmp_path, cell_names)
        assert len(result) == 1
        assert result[0]["l"] == "6"


def test_sort_order():
    """Results are sorted by type priority then alphabetically."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cell_names = _setup_cells(tmp_path, {
            "US5MA22M": {
                "BOYLAT": [_make_feature("Zebra Buoy")],
                "BUAARE": [_make_feature("Boston")],
                "LNDMRK": [_make_feature("Alpha Lighthouse")],
            },
        })
        result = extract_search_index(tmp_path, cell_names)
        types = [f["t"] for f in result]
        # BUAARE (0) < LNDMRK (5) < BOYLAT (30)
        assert types == ["BUAARE", "LNDMRK", "BOYLAT"]


def test_write_search_index():
    """write_search_index produces valid compact JSON."""
    features = [
        {"n": "Test", "t": "BUAARE", "c": [-71.0, 42.35]},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / "test.search.json"
        write_search_index(features, output)
        assert output.exists()
        with open(output) as f:
            data = json.load(f)
        assert data["version"] == 1
        assert len(data["features"]) == 1
        # Compact: no spaces after separators
        raw = output.read_text()
        assert "  " not in raw  # no pretty-print indentation


def test_empty_cells():
    """No crash when cells have no GeoJSON directories."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        result = extract_search_index(tmp_path, ["NONEXISTENT"])
        assert result == []
