"""Tests for composite.py MVT-level per-tile compositing."""

from __future__ import annotations

import gzip
from itertools import pairwise
from pathlib import Path

import mapbox_vector_tile
import pytest
from shapely.geometry import box, mapping, shape

from s57_pipeline import composite
from s57_pipeline.composite import (
    CellTileSource,
    _fill_passes,
    _clip_mvt_features,
    _encode_mvt,
    _tile_bbox_polygon,
    _tile_to_bbox,
    composite_tiles,
)


def _make_mvt_tile(
    layers: dict[str, list[dict]],
    bounds: tuple[float, float, float, float],
    gzipped: bool = True,
) -> bytes:
    """Create an MVT tile from GeoJSON-like feature dicts (geo coords)."""
    layer_list = []
    for name, features in layers.items():
        layer_list.append({
            "name": name,
            "features": [
                {"geometry": f["geometry"], "properties": f.get("properties", {})}
                for f in features
            ],
        })
    raw = mapbox_vector_tile.encode(
        layer_list,
        default_options={"quantize_bounds": bounds},
    )
    return gzip.compress(raw) if gzipped else raw


def _make_pmtiles(
    path: Path,
    tiles: dict[tuple[int, int, int], bytes],
) -> None:
    """Write a PMTiles file from a dict of (z,x,y) → MVT bytes."""
    from pmtiles.convert import write
    from pmtiles.reader import zxy_to_tileid
    from pmtiles.tile import Compression, TileType

    with write(str(path)) as writer:
        for (z, x, y), data in tiles.items():
            tile_id = zxy_to_tileid(z, x, y)
            writer.write_tile(tile_id, data)
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_zoom": 0,
                "max_zoom": 14,
                "min_lon_e7": -180_000_000,
                "min_lat_e7": -85_000_000,
                "max_lon_e7": 180_000_000,
                "max_lat_e7": 85_000_000,
                "center_zoom": 7,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {},
        )


class TestTileBbox:
    def test_z0_covers_world(self) -> None:
        bbox = _tile_to_bbox(0, 0, 0)
        assert bbox[0] == -180.0  # west
        assert bbox[2] == 180.0  # east

    def test_tile_bbox_polygon(self) -> None:
        poly = _tile_bbox_polygon(1, 0, 0)
        assert not poly.is_empty
        bounds = poly.bounds
        assert bounds[0] == -180.0  # west


class TestClipMvtFeatures:
    def test_features_inside_region_kept(self) -> None:
        bounds = (0.0, 0.0, 10.0, 10.0)
        tile_bbox = box(*bounds)
        features = [
            {"geometry": mapping(box(1, 1, 3, 3)), "properties": {"name": "a"}},
        ]
        tile_data = _make_mvt_tile({"test": features}, bounds)

        result, _dropped = _clip_mvt_features(tile_data, tile_bbox, tile_bbox)
        assert result is not None
        assert "test" in result
        assert len(result["test"]) == 1

    def test_features_outside_region_removed(self) -> None:
        bounds = (0.0, 0.0, 10.0, 10.0)
        tile_bbox = box(*bounds)
        # Feature in the east half
        features = [
            {"geometry": mapping(box(6, 1, 9, 9)), "properties": {"name": "east"}},
        ]
        tile_data = _make_mvt_tile({"test": features}, bounds)

        # Clip to west half only
        west_half = box(0, 0, 5, 10)
        result, _dropped = _clip_mvt_features(tile_data, west_half, tile_bbox)
        # Feature is entirely in east half, should be removed
        assert result is None

    def test_features_partially_clipped(self) -> None:
        bounds = (0.0, 0.0, 10.0, 10.0)
        tile_bbox = box(*bounds)
        # Feature spans the full tile
        features = [
            {"geometry": mapping(box(0, 0, 10, 10)), "properties": {"name": "full"}},
        ]
        tile_data = _make_mvt_tile({"test": features}, bounds)

        # Clip to west half
        west_half = box(0, 0, 5, 10)
        result, _dropped = _clip_mvt_features(tile_data, west_half, tile_bbox)
        assert result is not None
        assert len(result["test"]) == 1
        assert result["test"][0]["properties"]["name"] == "full"

    def test_uncompressed_tile(self) -> None:
        bounds = (0.0, 0.0, 10.0, 10.0)
        tile_bbox = box(*bounds)
        features = [
            {"geometry": mapping(box(1, 1, 3, 3)), "properties": {}},
        ]
        tile_data = _make_mvt_tile({"test": features}, bounds, gzipped=False)

        result, _dropped = _clip_mvt_features(tile_data, tile_bbox, tile_bbox)
        assert result is not None


class TestEncodeMvt:
    def test_roundtrip(self) -> None:
        bounds = (0.0, 0.0, 10.0, 10.0)
        tile_bbox = box(*bounds)
        layers = {
            "test": [
                {"geometry": mapping(box(1, 1, 3, 3)), "properties": {"val": 42}, "id": None},
            ],
        }
        encoded = _encode_mvt(layers, tile_bbox)
        assert len(encoded) > 0
        # Should be gzipped
        assert encoded[:2] == b"\x1f\x8b"
        # Decode back
        result, _dropped = _clip_mvt_features(encoded, tile_bbox, tile_bbox)
        assert result is not None
        assert "test" in result


class TestCompositeTiles:
    def test_single_source_passthrough(self, tmp_path: Path) -> None:
        """Single source → tiles pass through without decode."""
        bounds = (0.0, 0.0, 10.0, 10.0)
        features = [
            {"geometry": mapping(box(1, 1, 3, 3)), "properties": {"name": "a"}},
        ]
        tile_data = _make_mvt_tile({"test": features}, bounds)

        src_path = tmp_path / "cell1.pmtiles"
        _make_pmtiles(src_path, {(5, 0, 0): tile_data})

        output = tmp_path / "output.pmtiles"
        sources = [
            CellTileSource(
                pmtiles_path=src_path,
                band=1,
                coverage=box(-180, -90, 180, 90),
                cell_name="cell1",
            ),
        ]
        result = composite_tiles(sources, output)
        assert result is not None
        result_path, used_cells = result
        assert result_path == output
        assert "cell1" in used_cells
        assert output.exists()

        # Verify the tile is in the output
        from pmtiles.convert import all_tiles
        from pmtiles.reader import MmapSource

        with open(output, "rb") as f:
            source = MmapSource(f)
            tiles = list(all_tiles(source))
            assert len(tiles) == 1
            assert tiles[0][0] == (5, 0, 0)

    def test_two_bands_higher_wins(self, tmp_path: Path) -> None:
        """Higher band replaces lower band for the same tile."""
        # Use tile (5,16,15) which covers ~(0,0)-(11.25,11.18)
        from s57_pipeline.composite import _tile_to_bbox
        tile_bounds = _tile_to_bbox(5, 16, 15)
        tb = box(*tile_bounds)

        low_features = [
            {"geometry": mapping(tb), "properties": {"src": "low"}},
        ]
        high_features = [
            {"geometry": mapping(tb), "properties": {"src": "high"}},
        ]

        low_tile = _make_mvt_tile({"test": low_features}, tile_bounds)
        high_tile = _make_mvt_tile({"test": high_features}, tile_bounds)

        low_path = tmp_path / "low.pmtiles"
        high_path = tmp_path / "high.pmtiles"
        _make_pmtiles(low_path, {(5, 16, 15): low_tile})
        _make_pmtiles(high_path, {(5, 16, 15): high_tile})

        output = tmp_path / "output.pmtiles"
        # Both cells cover the full tile area
        sources = [
            CellTileSource(pmtiles_path=low_path, band=1, coverage=tb, cell_name="low"),
            CellTileSource(pmtiles_path=high_path, band=3, coverage=tb, cell_name="high"),
        ]
        result = composite_tiles(sources, output)
        assert result is not None
        _, used_cells = result
        assert "high" in used_cells

        # Decode the output tile — should have only "high" features
        from pmtiles.convert import all_tiles
        from pmtiles.reader import MmapSource

        with open(output, "rb") as f:
            source = MmapSource(f)
            tiles = list(all_tiles(source))
            assert len(tiles) == 1
            features, _dropped = _clip_mvt_features(tiles[0][1], tb, tb)
            assert features is not None
            assert len(features["test"]) == 1
            assert features["test"][0]["properties"]["src"] == "high"

    def test_partial_coverage_composites(self, tmp_path: Path) -> None:
        """Higher band with partial coverage composites with lower band."""
        # Use tile (5,16,15) which covers ~(0,0)-(11.25,11.18)
        from s57_pipeline.composite import _tile_to_bbox
        tile_bounds = _tile_to_bbox(5, 16, 15)
        w, s, e, n = tile_bounds
        tb = box(*tile_bounds)
        mid_x = (w + e) / 2

        low_features = [
            {"geometry": mapping(tb), "properties": {"src": "low"}},
        ]
        # High features cover the east half
        east_box = box(mid_x, s, e, n)
        high_features = [
            {"geometry": mapping(east_box), "properties": {"src": "high"}},
        ]

        low_tile = _make_mvt_tile({"test": low_features}, tile_bounds)
        high_tile = _make_mvt_tile({"test": high_features}, tile_bounds)

        low_path = tmp_path / "low.pmtiles"
        high_path = tmp_path / "high.pmtiles"
        _make_pmtiles(low_path, {(5, 16, 15): low_tile})
        _make_pmtiles(high_path, {(5, 16, 15): high_tile})

        output = tmp_path / "output.pmtiles"
        # High band only covers east half
        sources = [
            CellTileSource(
                pmtiles_path=low_path, band=1,
                coverage=tb, cell_name="low",  # full coverage
            ),
            CellTileSource(
                pmtiles_path=high_path, band=3,
                coverage=east_box, cell_name="high",  # east half only
            ),
        ]
        result = composite_tiles(sources, output)
        assert result is not None
        _, used_cells = result
        assert used_cells == {"low", "high"}

        # Output should have features from both bands
        from pmtiles.convert import all_tiles
        from pmtiles.reader import MmapSource

        with open(output, "rb") as f:
            source = MmapSource(f)
            tiles = list(all_tiles(source))
            assert len(tiles) == 1
            features, _dropped = _clip_mvt_features(tiles[0][1], tb, tb)
            assert features is not None
            srcs = {f["properties"]["src"] for f in features["test"]}
            assert srcs == {"low", "high"}

    def test_no_overlap_passthrough(self, tmp_path: Path) -> None:
        """Non-overlapping tiles from different bands pass through."""
        bounds_a = (0.0, 0.0, 10.0, 10.0)
        bounds_b = (10.0, 0.0, 20.0, 10.0)

        tile_a = _make_mvt_tile(
            {"test": [{"geometry": mapping(box(1, 1, 3, 3)), "properties": {}}]},
            bounds_a,
        )
        tile_b = _make_mvt_tile(
            {"test": [{"geometry": mapping(box(11, 1, 13, 3)), "properties": {}}]},
            bounds_b,
        )

        path_a = tmp_path / "a.pmtiles"
        path_b = tmp_path / "b.pmtiles"
        _make_pmtiles(path_a, {(5, 0, 0): tile_a})
        _make_pmtiles(path_b, {(5, 1, 0): tile_b})

        output = tmp_path / "output.pmtiles"
        sources = [
            CellTileSource(pmtiles_path=path_a, band=1, coverage=box(0, 0, 10, 10), cell_name="a"),
            CellTileSource(pmtiles_path=path_b, band=3, coverage=box(10, 0, 20, 10), cell_name="b"),
        ]
        result = composite_tiles(sources, output)
        assert result is not None
        _, used_cells = result
        assert used_cells == {"a", "b"}

        from pmtiles.convert import all_tiles
        from pmtiles.reader import MmapSource

        with open(output, "rb") as f:
            source = MmapSource(f)
            tiles = list(all_tiles(source))
            assert len(tiles) == 2

    def test_empty_sources(self, tmp_path: Path) -> None:
        output = tmp_path / "output.pmtiles"
        result = composite_tiles([], output)
        assert result is None

    def test_unused_cell_reported(self, tmp_path: Path) -> None:
        """A cell whose tiles are fully clipped away is reported as unused."""
        from s57_pipeline.composite import _tile_to_bbox
        tile_bounds = _tile_to_bbox(5, 16, 15)
        tb = box(*tile_bounds)

        # "winner" covers the full tile at higher band
        winner_features = [
            {"geometry": mapping(tb), "properties": {"src": "winner"}},
        ]
        # "loser" also covers the full tile but at lower band
        loser_features = [
            {"geometry": mapping(tb), "properties": {"src": "loser"}},
        ]

        winner_tile = _make_mvt_tile({"test": winner_features}, tile_bounds)
        loser_tile = _make_mvt_tile({"test": loser_features}, tile_bounds)

        winner_path = tmp_path / "winner.pmtiles"
        loser_path = tmp_path / "loser.pmtiles"
        _make_pmtiles(winner_path, {(5, 16, 15): winner_tile})
        _make_pmtiles(loser_path, {(5, 16, 15): loser_tile})

        output = tmp_path / "output.pmtiles"
        sources = [
            CellTileSource(pmtiles_path=winner_path, band=5, coverage=tb, cell_name="winner"),
            CellTileSource(pmtiles_path=loser_path, band=1, coverage=tb, cell_name="loser"),
        ]
        result = composite_tiles(sources, output)
        assert result is not None
        _, used_cells = result
        assert "winner" in used_cells
        # loser is fully clipped away by winner's coverage
        assert "loser" not in used_cells


class TestHazardLayerClipping:
    def test_hazard_features_do_not_leak_into_higher_band_coverage(
        self, tmp_path: Path
    ) -> None:
        """The anti-sliver buffer must not pull a lower band's hazards into
        a detailed cell's coverage (the CATOBS leak): non-hazard layers may
        overlap via the buffer, hazard layers clip to exact coverage."""
        tile_bounds = _tile_to_bbox(5, 16, 15)
        w, s, e, n = tile_bounds
        tb = box(*tile_bounds)
        mid_x = (w + e) / 2
        mid_y = (s + n) / 2

        # A low-band point just INSIDE the high band's coverage, within the
        # 0.01-degree buffer of the low band's usable (west) region.
        leak_point = {"type": "Point", "coordinates": [mid_x + 0.005, mid_y]}
        low_tile = _make_mvt_tile(
            {
                "OBSTRN": [{"geometry": leak_point, "properties": {"src": "low"}}],
                "SLCONS": [{"geometry": leak_point, "properties": {"src": "low"}}],
            },
            tile_bounds,
        )
        east_box = box(mid_x, s, e, n)
        high_tile = _make_mvt_tile(
            {"test": [{"geometry": mapping(east_box), "properties": {"src": "high"}}]},
            tile_bounds,
        )

        low_path = tmp_path / "low.pmtiles"
        high_path = tmp_path / "high.pmtiles"
        _make_pmtiles(low_path, {(5, 16, 15): low_tile})
        _make_pmtiles(high_path, {(5, 16, 15): high_tile})

        output = tmp_path / "output.pmtiles"
        sources = [
            CellTileSource(pmtiles_path=low_path, band=1, coverage=tb, cell_name="low"),
            CellTileSource(
                pmtiles_path=high_path, band=3, coverage=east_box, cell_name="high"
            ),
        ]
        result = composite_tiles(sources, output)
        assert result is not None

        from pmtiles.convert import all_tiles
        from pmtiles.reader import MmapSource

        with open(output, "rb") as f:
            source = MmapSource(f)
            tiles = list(all_tiles(source))
            assert len(tiles) == 1
            features, _dropped = _clip_mvt_features(tiles[0][1], tb, tb)
            assert features is not None
            # The buffered clip keeps the non-hazard leak (anti-sliver)...
            assert "SLCONS" in features
            # ...but the hazard layer clips to exact coverage: no leak.
            assert "OBSTRN" not in features

    def test_hazard_features_kept_inside_own_coverage(self, tmp_path: Path) -> None:
        """Hazards squarely inside their own band's unfilled coverage survive."""
        tile_bounds = _tile_to_bbox(5, 16, 15)
        w, s, e, n = tile_bounds
        tb = box(*tile_bounds)
        mid_x = (w + e) / 2
        mid_y = (s + n) / 2

        west_point = {"type": "Point", "coordinates": [mid_x - 1.0, mid_y]}
        low_tile = _make_mvt_tile(
            {"OBSTRN": [{"geometry": west_point, "properties": {"src": "low"}}]},
            tile_bounds,
        )
        east_box = box(mid_x, s, e, n)
        high_tile = _make_mvt_tile(
            {"test": [{"geometry": mapping(east_box), "properties": {"src": "high"}}]},
            tile_bounds,
        )

        low_path = tmp_path / "low.pmtiles"
        high_path = tmp_path / "high.pmtiles"
        _make_pmtiles(low_path, {(5, 16, 15): low_tile})
        _make_pmtiles(high_path, {(5, 16, 15): high_tile})

        output = tmp_path / "output.pmtiles"
        sources = [
            CellTileSource(pmtiles_path=low_path, band=1, coverage=tb, cell_name="low"),
            CellTileSource(
                pmtiles_path=high_path, band=3, coverage=east_box, cell_name="high"
            ),
        ]
        result = composite_tiles(sources, output)
        assert result is not None

        from pmtiles.convert import all_tiles
        from pmtiles.reader import MmapSource

        with open(output, "rb") as f:
            source = MmapSource(f)
            tiles = list(all_tiles(source))
            features, _dropped = _clip_mvt_features(tiles[0][1], tb, tb)
            assert features is not None
            assert "OBSTRN" in features
            assert len(features["OBSTRN"]) == 1


class TestDroppedFeatureCounting:
    def test_no_drops_on_clean_clip(self) -> None:
        bounds = (0.0, 0.0, 10.0, 10.0)
        tile_bbox = box(*bounds)
        features = [
            {"geometry": mapping(box(1, 1, 3, 3)), "properties": {}},
        ]
        tile_data = _make_mvt_tile({"test": features}, bounds)
        _result, dropped = _clip_mvt_features(tile_data, tile_bbox, tile_bbox)
        assert dropped == {}

    def test_topology_error_is_counted_not_silent(self, monkeypatch) -> None:
        import s57_pipeline.composite as comp

        bounds = (0.0, 0.0, 10.0, 10.0)
        tile_bbox = box(*bounds)
        features = [
            {"geometry": mapping(box(1, 1, 3, 3)), "properties": {}},
        ]
        tile_data = _make_mvt_tile({"test": features}, bounds)

        def boom(_geom):
            raise ValueError("synthetic topology error")

        monkeypatch.setattr(comp, "make_valid", boom)
        result, dropped = comp._clip_mvt_features(tile_data, tile_bbox, tile_bbox)
        assert result is None
        assert dropped == {"test": 1}


CELLS = [(2, "coastal"), (4, "harbour"), (3, "approach"), (0, "overview")]
NAVAIDS = frozenset({"BOYLAT", "LIGHTS", "TOPMAR"})


def test_fill_passes_prefer_band_for_listed_layers(monkeypatch):
    monkeypatch.setattr(composite, "COMPOSITE_PREFERRED_BAND", {11: 3})
    monkeypatch.setattr(composite, "COMPOSITE_PREFERRED_LAYERS", NAVAIDS)
    passes = _fill_passes(11)
    assert len(passes) == 2
    base_key, base_layers = passes[0]
    navaid_key, navaid_layers = passes[1]
    assert sorted(CELLS, key=base_key, reverse=True)[0] == (4, "harbour")
    assert sorted(CELLS, key=navaid_key, reverse=True) == [
        (3, "approach"), (4, "harbour"), (2, "coastal"), (0, "overview"),
    ]
    assert base_layers is not None and navaid_layers is not None
    for name in ("DEPARE", "SOUNDG", "UWTROC"):
        assert base_layers(name) and not navaid_layers(name)
    for name in NAVAIDS:
        assert navaid_layers(name) and not base_layers(name)
    assert len(_fill_passes(12)) == 1


def test_fill_passes_prefer_band_for_whole_tile(monkeypatch):
    monkeypatch.setattr(composite, "COMPOSITE_PREFERRED_BAND", {11: 3})
    monkeypatch.setattr(composite, "COMPOSITE_PREFERRED_LAYERS", None)
    (key, layers), = _fill_passes(11)
    assert layers is None
    assert sorted(CELLS, key=key, reverse=True)[0] == (3, "approach")


def test_fill_passes_default_is_highest_band_first():
    for z in (10, 11, 12, 13):
        (key, layers), = _fill_passes(z)
        assert layers is None
        assert sorted(CELLS, key=key, reverse=True) == [
            (4, "harbour"), (3, "approach"), (2, "coastal"), (0, "overview"),
        ]


# ── Area edges and scale boundaries ───────────────────────────────────

BOUNDS = (0.0, 0.0, 10.0, 10.0)
TILE = box(*BOUNDS)
UNIT = 10.0 / 4096  # one MVT unit in these test coordinates
EDGES = "RESARE" + composite.EDGE_LAYER_SUFFIX


def _group(coverage, cscl: int | None, layers: dict[str, list[dict]]):
    return composite._CellGroup(coverage, cscl, [_make_mvt_tile(layers, BOUNDS)])


def _area(geom, **props) -> dict:
    return {"geometry": mapping(geom), "properties": props}


def _segments(features: list[dict]) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    segs = []
    for f in features:
        coords = shape(f["geometry"]).coords
        segs.extend(pairwise(coords))
    return segs


def _along(segs, *, x: float | None = None, y: float | None = None) -> list:
    """Segments running along the line x=… or y=… (within two MVT units)."""
    def on(p):
        return abs(p[0] - x) <= 2 * UNIT if x is not None else abs(p[1] - y) <= 2 * UNIT
    return [s for s in segs if on(s[0]) and on(s[1])]


class TestAreaEdges:
    def test_seam_and_tile_edges_are_not_edges(self) -> None:
        """Two same-band cells split at x=5; each holds half of one area that
        also runs off the tile's south edge. Only the area's true sides are
        edges, and the polygons are flagged as having them split out."""
        west = _group(box(0, 0, 5, 10), 12000, {"RESARE": [_area(box(2, 0, 5, 8), RESTRN="16")]})
        east = _group(box(5, 0, 10, 10), 12000, {"RESARE": [_area(box(5, 0, 8, 8), RESTRN="16")]})
        layers, _used, _drops = composite._merge_same_band(
            TILE, {(4, "WEST"): west, (4, "EAST"): east}
        )
        segs = _segments(layers[EDGES])
        assert _along(segs, x=5) == []  # the cell seam
        assert _along(segs, y=0) == []  # the tile edge
        assert _along(segs, x=2) and _along(segs, x=8) and _along(segs, y=8)
        assert all(f["properties"]["RESTRN"] == "16" for f in layers[EDGES])
        assert all(f["properties"][composite.SPLIT_EDGES_FLAG] == 1 for f in layers["RESARE"])
        assert "SCLBDY" not in layers  # same scale on both sides

    def test_owned_region_with_stray_line_parts(self) -> None:
        """make_valid can hand back a region with stray line parts; only its
        area counts as owned."""
        from shapely.geometry import GeometryCollection, LineString

        region = GeometryCollection([box(0, 0, 5, 10), LineString([(5, 0), (9, 0)])])
        tile = _make_mvt_tile({"RESARE": [_area(box(2, 2, 8, 8))]}, BOUNDS)
        result, _dropped = _clip_mvt_features(
            tile, TILE, TILE, owned_region=composite._owned_region(region, TILE)
        )
        assert result is not None
        segs = _segments(result[EDGES])
        assert _along(segs, x=2) and not _along(segs, x=8)

    def test_rings_outside_the_owned_region_are_not_edges(self) -> None:
        """A multi-part area with one part in the cell's region and one
        beyond it, neither near a cut: only the part inside has edges."""
        from shapely.geometry import MultiPolygon

        area = MultiPolygon([box(1, 1, 3, 3), box(6, 6, 9, 9)])
        tile = _make_mvt_tile({"RESARE": [_area(area)]}, BOUNDS)
        owned = composite._owned_region(box(0, 0, 5, 5), TILE)
        result, _dropped = _clip_mvt_features(tile, TILE, TILE, owned_region=owned)
        assert result is not None
        segs = _segments(result[EDGES])
        assert _along(segs, x=1) and _along(segs, x=3)
        assert not _along(segs, x=6) and not _along(segs, x=9)

    def test_cell_that_only_touches_the_unfilled_area_owns_nothing(self) -> None:
        """A lower-band cell whose coverage meets the unfilled part of the
        tile only along a border owns no area there, so its areas have no
        edges in this tile — not even along that border."""
        harbour = _group(box(0, 0, 5, 10), 12000, {"RESARE": [_area(box(1, 1, 4, 9))]})
        other = _group(box(6, 0, 10, 10), 12000, {"RESARE": [_area(box(7, 1, 9, 9))]})
        approach = _group(box(0, 0, 5, 10), 45000, {"RESARE": [_area(box(2, 2, 5, 8))]})
        layers, _used, _filled, _drops = composite._fill_multi_band(
            14, TILE,
            {(5, "HARBOUR"): harbour, (5, "OTHER"): other, (3, "APPROACH"): approach},
        )
        segs = _segments(layers[EDGES])
        assert not _along(segs, x=2) and not _along(segs, x=5)
        assert all(line["properties"]["CSCL_COARSE"] != 45000 for line in layers.get("SCLBDY", []))

    def test_other_classes_are_untouched(self) -> None:
        cell = _group(box(0, 0, 5, 10), 12000, {"DEPARE": [_area(box(2, 2, 5, 8))]})
        other = _group(box(5, 0, 10, 10), 12000, {"DEPARE": [_area(box(5, 2, 8, 8))]})
        layers, _used, _drops = composite._merge_same_band(
            TILE, {(4, "A"): cell, (4, "B"): other}
        )
        assert "DEPARE" + composite.EDGE_LAYER_SUFFIX not in layers
        assert all(composite.SPLIT_EDGES_FLAG not in f["properties"] for f in layers["DEPARE"])

    def test_area_clipped_along_a_cut_leaves_no_line_sliver(self) -> None:
        """An area that only touches the clip region shares just a line with
        it; that line is a cut, not part of the area."""
        tile = _make_mvt_tile({"RESARE": [_area(box(5, 2, 8, 8))]}, BOUNDS)
        result, _dropped = _clip_mvt_features(tile, box(0, 0, 5, 10), TILE)
        assert result is None

    def test_lower_band_edges_stop_at_the_detailed_cell(self) -> None:
        """A harbour cell covers the west half; the overview cell's area spans
        the tile. The overview's polygon still reaches into the harbour cell
        (the anti-sliver overlap), but its edges stay in the area it shows."""
        harbour = _group(box(0, 0, 5, 10), 12000, {"RESARE": [_area(box(1, 1, 5, 9))]})
        overview = _group(TILE, 80000, {"RESARE": [_area(box(1, 1, 9, 9))]})
        layers, _used, _filled, _drops = composite._fill_multi_band(
            14, TILE, {(5, "HARBOUR"): harbour, (3, "OVERVIEW"): overview}
        )
        segs = _segments(layers[EDGES])
        assert _along(segs, x=5) == []
        assert len(_along(segs, x=1)) >= 1  # harbour's own west side
        assert len(_along(segs, x=9)) >= 1  # overview's east side
        top = _along(segs, y=9)
        assert any(a[0] + b[0] < 10 for a, b in top)  # harbour's top side
        assert any(a[0] + b[0] > 10 for a, b in top)  # overview's top side
        # Drawn once: no overlap where the two cells' sides meet.
        assert sum(abs(b[0] - a[0]) for a, b in top) == pytest.approx(8, abs=10 * UNIT)


class TestScaleBoundaries:
    def test_boundary_where_scale_changes(self) -> None:
        fine = _group(box(0, 0, 5, 10), 12000, {"DEPARE": [_area(box(0, 0, 5, 10))]})
        coarse = _group(box(5, 0, 10, 10), 22000, {"DEPARE": [_area(box(5, 0, 10, 10))]})
        layers, _used, _drops = composite._merge_same_band(
            TILE, {(4, "FINE"): fine, (4, "COARSE"): coarse}
        )
        (line,) = layers["SCLBDY"]
        assert line["properties"] == {"CSCL_DETAILED": 12000, "CSCL_COARSE": 22000}
        geom = shape(line["geometry"])
        assert geom.bounds[0] == pytest.approx(5) and geom.bounds[2] == pytest.approx(5)
        assert geom.length == pytest.approx(10, abs=10 * UNIT)  # less the tile-edge margins

    def test_boundary_at_detailed_cell_in_multi_band_tile(self) -> None:
        harbour = _group(box(0, 0, 5, 10), 12000, {"DEPARE": [_area(box(0, 0, 5, 10))]})
        overview = _group(TILE, 80000, {"DEPARE": [_area(TILE)]})
        layers, _used, _filled, _drops = composite._fill_multi_band(
            14, TILE, {(5, "HARBOUR"): harbour, (3, "OVERVIEW"): overview}
        )
        (line,) = layers["SCLBDY"]
        assert line["properties"]["CSCL_COARSE"] == 80000
        assert shape(line["geometry"]).bounds[0] == pytest.approx(5)

    def test_unknown_scale_draws_no_boundary(self) -> None:
        a = _group(box(0, 0, 5, 10), None, {"DEPARE": [_area(box(0, 0, 5, 10))]})
        b = _group(box(5, 0, 10, 10), 22000, {"DEPARE": [_area(box(5, 0, 10, 10))]})
        layers, _used, _drops = composite._merge_same_band(TILE, {(4, "A"): a, (4, "B"): b})
        assert "SCLBDY" not in layers
