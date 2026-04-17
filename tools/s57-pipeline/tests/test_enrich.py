"""Tests for GeoJSON enrichment, especially list attribute flattening."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from s57_pipeline.enrich import annotate_masters, enrich_geojson


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


def _write_geojson(path: Path, features: list[dict]) -> None:
    """Write a minimal FeatureCollection to ``path``."""
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": dict(props),
                "geometry": {"type": "Point", "coordinates": [0, 0]},
            }
            for props in features
        ],
    }
    path.write_text(json.dumps(fc))


def _read_props(path: Path) -> list[dict]:
    return [f["properties"] for f in json.loads(path.read_text())["features"]]


class TestAnnotateMasters:
    """MASTER_LNAM / MASTER_OBJNAM / MASTER_LAYER propagation from masters."""

    def test_cleveland_ledge_style_cluster(self, tmp_path: Path) -> None:
        """A BCNSPP master with 7 LIGHTS slaves — all slaves get annotated."""
        slaves_lnams = [f"SLAVE{i:02X}" for i in range(7)]
        master_lnam = "MASTER01"
        _write_geojson(
            tmp_path / "bcnspp.geojson",
            [{
                "LNAM": master_lnam,
                "OBJNAM": "Cleveland Ledge Channel Precision Directional Light",
                "LNAM_REFS": ",".join(slaves_lnams),
                "FFPT_RIND": ",".join(["2"] * len(slaves_lnams)),
            }],
        )
        _write_geojson(
            tmp_path / "lights.geojson",
            [{"LNAM": lnam, "LITCHR": 2} for lnam in slaves_lnams],
        )

        annotate_masters(tmp_path)

        for props in _read_props(tmp_path / "lights.geojson"):
            assert props["MASTER_LNAM"] == master_lnam
            assert props["MASTER_LAYER"] == "BCNSPP"
            assert props["MASTER_OBJNAM"] == (
                "Cleveland Ledge Channel Precision Directional Light"
            )
        # Master file unchanged structurally
        master_props = _read_props(tmp_path / "bcnspp.geojson")[0]
        assert "MASTER_LNAM" not in master_props

    def test_mixed_rind_only_slaves_annotated(self, tmp_path: Path) -> None:
        """FFPT_RIND="2,3,2" — only the index 0 and 2 slaves get annotated."""
        _write_geojson(
            tmp_path / "bcnspp.geojson",
            [{
                "LNAM": "M1",
                "OBJNAM": "Test",
                "LNAM_REFS": "S1,S2,S3",
                "FFPT_RIND": "2,3,2",
            }],
        )
        _write_geojson(
            tmp_path / "lights.geojson",
            [{"LNAM": "S1"}, {"LNAM": "S2"}, {"LNAM": "S3"}],
        )

        annotate_masters(tmp_path)

        props_list = _read_props(tmp_path / "lights.geojson")
        by_lnam = {p["LNAM"]: p for p in props_list}
        assert by_lnam["S1"]["MASTER_LNAM"] == "M1"
        assert "MASTER_LNAM" not in by_lnam["S2"]  # RIND=3 (peer), skipped
        assert by_lnam["S3"]["MASTER_LNAM"] == "M1"

    def test_missing_rind_treated_as_slave(self, tmp_path: Path) -> None:
        """No FFPT_RIND at all — every ref is treated as a slave."""
        _write_geojson(
            tmp_path / "bcnspp.geojson",
            [{"LNAM": "M1", "OBJNAM": "X", "LNAM_REFS": "S1,S2"}],
        )
        _write_geojson(
            tmp_path / "lights.geojson",
            [{"LNAM": "S1"}, {"LNAM": "S2"}],
        )

        annotate_masters(tmp_path)

        by_lnam = {p["LNAM"]: p for p in _read_props(tmp_path / "lights.geojson")}
        assert by_lnam["S1"]["MASTER_LNAM"] == "M1"
        assert by_lnam["S2"]["MASTER_LNAM"] == "M1"

    def test_unresolvable_ref_silently_skipped(self, tmp_path: Path) -> None:
        """Cross-cell LNAM ref (not in index) must not crash or add anything."""
        _write_geojson(
            tmp_path / "bcnspp.geojson",
            [{
                "LNAM": "M1",
                "OBJNAM": "X",
                "LNAM_REFS": "S1,UNKNOWN_CROSSCELL_LNAM",
                "FFPT_RIND": "2,2",
            }],
        )
        _write_geojson(tmp_path / "lights.geojson", [{"LNAM": "S1"}])

        annotate_masters(tmp_path)

        props = _read_props(tmp_path / "lights.geojson")[0]
        assert props["MASTER_LNAM"] == "M1"

    def test_master_without_objnam(self, tmp_path: Path) -> None:
        """MASTER_LNAM/MASTER_LAYER always, MASTER_OBJNAM only when present."""
        _write_geojson(
            tmp_path / "bcnspp.geojson",
            [{"LNAM": "M1", "LNAM_REFS": "S1", "FFPT_RIND": "2"}],
        )
        _write_geojson(tmp_path / "lights.geojson", [{"LNAM": "S1"}])

        annotate_masters(tmp_path)

        props = _read_props(tmp_path / "lights.geojson")[0]
        assert props["MASTER_LNAM"] == "M1"
        assert props["MASTER_LAYER"] == "BCNSPP"
        assert "MASTER_OBJNAM" not in props

    def test_list_valued_lnam_refs_supported(self, tmp_path: Path) -> None:
        """If annotate_masters runs before list-flatten, LNAM_REFS is a list."""
        _write_geojson(
            tmp_path / "bcnspp.geojson",
            [{
                "LNAM": "M1",
                "OBJNAM": "X",
                "LNAM_REFS": ["S1", "S2"],
                "FFPT_RIND": ["2", "2"],
            }],
        )
        _write_geojson(
            tmp_path / "lights.geojson",
            [{"LNAM": "S1"}, {"LNAM": "S2"}],
        )

        annotate_masters(tmp_path)

        by_lnam = {p["LNAM"]: p for p in _read_props(tmp_path / "lights.geojson")}
        assert by_lnam["S1"]["MASTER_LNAM"] == "M1"
        assert by_lnam["S2"]["MASTER_LNAM"] == "M1"

    def test_no_lnam_refs_noop(self, tmp_path: Path) -> None:
        """Features with no LNAM_REFS don't touch anything."""
        _write_geojson(tmp_path / "lights.geojson", [{"LNAM": "L1", "LITCHR": 2}])
        original = _read_props(tmp_path / "lights.geojson")

        annotate_masters(tmp_path)

        assert _read_props(tmp_path / "lights.geojson") == original
