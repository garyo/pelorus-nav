"""Tests for composite.py MVT-level per-tile compositing."""

from __future__ import annotations

import gzip
from pathlib import Path

import mapbox_vector_tile
from shapely.geometry import box, mapping

from s57_pipeline.composite import (
    CellTileSource,
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

        result = _clip_mvt_features(tile_data, tile_bbox, tile_bbox)
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
        result = _clip_mvt_features(tile_data, west_half, tile_bbox)
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
        result = _clip_mvt_features(tile_data, west_half, tile_bbox)
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

        result = _clip_mvt_features(tile_data, tile_bbox, tile_bbox)
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
        result = _clip_mvt_features(encoded, tile_bbox, tile_bbox)
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
            features = _clip_mvt_features(tiles[0][1], tb, tb)
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
            features = _clip_mvt_features(tiles[0][1], tb, tb)
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
