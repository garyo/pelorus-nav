"""Tests for S-57 layer configuration."""

from s57_pipeline.layers import (
    LAYER_CONFIGS,
    LAYER_MAP,
    LAYER_NAMES,
    get_layer_config,
    get_layers_by_group,
)


class TestLayerConfig:
    def test_all_configs_have_names(self) -> None:
        for config in LAYER_CONFIGS:
            assert config.name, "Layer config must have a name"

    def test_all_configs_have_groups(self) -> None:
        for config in LAYER_CONFIGS:
            assert config.group, "Layer config must have a group"

    def test_layer_names_are_unique(self) -> None:
        assert len(LAYER_NAMES) == len(set(LAYER_NAMES)), "Layer names must be unique"

    def test_map_matches_configs(self) -> None:
        assert len(LAYER_MAP) == len(LAYER_CONFIGS)
        for config in LAYER_CONFIGS:
            assert LAYER_MAP[config.name] is config

    def test_known_layers_present(self) -> None:
        expected = ["DEPARE", "LNDARE", "SOUNDG", "BOYLAT", "LIGHTS", "WRECKS"]
        for name in expected:
            assert name in LAYER_NAMES, f"Expected layer {name} not found"

    def test_get_layer_config_found(self) -> None:
        config = get_layer_config("DEPARE")
        assert config is not None
        assert config.name == "DEPARE"
        assert config.group == "terrain"

    def test_get_layer_config_not_found(self) -> None:
        assert get_layer_config("NONEXISTENT") is None

    def test_get_layers_by_group(self) -> None:
        terrain = get_layers_by_group("terrain")
        assert len(terrain) > 0
        assert all(lc.group == "terrain" for lc in terrain)
        terrain_names = {lc.name for lc in terrain}
        assert "DEPARE" in terrain_names
        assert "LNDARE" in terrain_names

    def test_navaids_have_keep_all_strategy(self) -> None:
        navaids = get_layers_by_group("navaids")
        for nav in navaids:
            assert "-r1" in nav.tippecanoe_args

    def test_hazards_have_keep_all_strategy(self) -> None:
        hazards = get_layers_by_group("hazards")
        for haz in hazards:
            assert "-r1" in haz.tippecanoe_args

    def test_soundg_has_drop_densest(self) -> None:
        config = get_layer_config("SOUNDG")
        assert config is not None
        assert "--drop-densest-as-needed" in config.tippecanoe_args
