"""Tests for nautical symbol computation."""

from s57_pipeline.symbols import compute_symbol


class TestBoylatSymbol:
    def test_port_can(self) -> None:
        props = {"CATLAM": 1, "BOYSHP": 2}
        assert compute_symbol(props, "BOYLAT") == "lateral-port-can"

    def test_stbd_conical(self) -> None:
        props = {"CATLAM": 2, "BOYSHP": 1}
        assert compute_symbol(props, "BOYLAT") == "lateral-stbd-conical"

    def test_port_default_shape(self) -> None:
        """Port buoy with no BOYSHP defaults to can (IALA-B)."""
        props = {"CATLAM": 1}
        assert compute_symbol(props, "BOYLAT") == "lateral-port-can"

    def test_stbd_default_shape(self) -> None:
        """Starboard buoy with no BOYSHP defaults to conical (IALA-B)."""
        props = {"CATLAM": 2}
        assert compute_symbol(props, "BOYLAT") == "lateral-stbd-conical"

    def test_port_pillar(self) -> None:
        props = {"CATLAM": 1, "BOYSHP": 4}
        assert compute_symbol(props, "BOYLAT") == "lateral-port-pillar"

    def test_stbd_spar(self) -> None:
        props = {"CATLAM": 2, "BOYSHP": 5}
        assert compute_symbol(props, "BOYLAT") == "lateral-stbd-spar"

    def test_no_catlam_fallback(self) -> None:
        props = {"BOYSHP": 1}
        assert compute_symbol(props, "BOYLAT") == "lateral-port-can"

    def test_preferred_port_rgr(self) -> None:
        props = {"CATLAM": 1, "COLOUR": ["3", "4", "3"]}
        assert compute_symbol(props, "BOYLAT") == "preferred-port"

    def test_preferred_stbd_grg(self) -> None:
        props = {"CATLAM": 2, "COLOUR": ["4", "3", "4"]}
        assert compute_symbol(props, "BOYLAT") == "preferred-stbd"


class TestBoycarSymbol:
    def test_north(self) -> None:
        assert compute_symbol({"CATCAM": 1}, "BOYCAR") == "cardinal-n"

    def test_south(self) -> None:
        assert compute_symbol({"CATCAM": 2}, "BOYCAR") == "cardinal-s"

    def test_east(self) -> None:
        assert compute_symbol({"CATCAM": 3}, "BOYCAR") == "cardinal-e"

    def test_west(self) -> None:
        assert compute_symbol({"CATCAM": 4}, "BOYCAR") == "cardinal-w"

    def test_unknown_catcam(self) -> None:
        assert compute_symbol({}, "BOYCAR") == "cardinal-n"


class TestSpecialBuoys:
    def test_safewater(self) -> None:
        assert compute_symbol({}, "BOYSAW") == "safewater"

    def test_special(self) -> None:
        assert compute_symbol({}, "BOYSPP") == "special"

    def test_special_white_orange(self) -> None:
        props = {"COLOUR": ["1", "11"]}
        assert compute_symbol(props, "BOYSPP") == "special-wo"

    def test_special_yellow_only(self) -> None:
        props = {"COLOUR": ["6"]}
        assert compute_symbol(props, "BOYSPP") == "special"

    def test_isolated_danger(self) -> None:
        assert compute_symbol({}, "BOYISD") == "isolated-danger"

    def test_boyspp_preferred_port_rgr(self) -> None:
        """Red-green-red BOYSPP = preferred channel (same as BOYLAT convention)."""
        props = {"COLOUR": [3, 4, 3]}
        assert compute_symbol(props, "BOYSPP") == "preferred-port"

    def test_boyspp_preferred_stbd_grg(self) -> None:
        """Green-red-green BOYSPP = preferred channel (same as BOYLAT convention)."""
        props = {"COLOUR": [4, 3, 4]}
        assert compute_symbol(props, "BOYSPP") == "preferred-stbd"

    def test_boyspp_preferred_csv_string(self) -> None:
        """GDAL comma-separated string COLOUR for preferred channel."""
        props = {"COLOUR": "3,4,3"}
        assert compute_symbol(props, "BOYSPP") == "preferred-port"


class TestColourParsing:
    """Test _parse_colours handles various GDAL output formats."""

    def test_csv_string(self) -> None:
        """GDAL comma-separated string format."""
        props = {"COLOUR": "3,4,3"}
        assert compute_symbol(props, "BOYLAT") == "preferred-port"

    def test_csv_string_with_spaces(self) -> None:
        props = {"COLOUR": "3, 4, 3"}
        assert compute_symbol(props, "BOYLAT") == "preferred-port"

    def test_single_string(self) -> None:
        props = {"COLOUR": "4", "CATLAM": 1}
        assert compute_symbol(props, "BOYLAT") == "lateral-port-can"


class TestBeaconSymbol:
    def test_port(self) -> None:
        assert compute_symbol({"CATLAM": 1}, "BCNLAT") == "beacon-port"

    def test_stbd(self) -> None:
        assert compute_symbol({"CATLAM": 2}, "BCNLAT") == "beacon-stbd"

    def test_default(self) -> None:
        assert compute_symbol({}, "BCNLAT") == "beacon-default"

    def test_cardinal(self) -> None:
        assert compute_symbol({}, "BCNCAR") == "beacon-cardinal"


class TestLightSymbol:
    def test_major_white(self) -> None:
        assert compute_symbol({"VALNMR": 15}, "LIGHTS") == "light-major-white"

    def test_minor_white(self) -> None:
        assert compute_symbol({"VALNMR": 5}, "LIGHTS") == "light-minor-white"

    def test_no_valnmr(self) -> None:
        assert compute_symbol({}, "LIGHTS") == "light-minor-white"

    def test_boundary(self) -> None:
        assert compute_symbol({"VALNMR": 10}, "LIGHTS") == "light-major-white"

    def test_red_light(self) -> None:
        assert compute_symbol({"VALNMR": 5, "COLOUR": ["3"]}, "LIGHTS") == "light-minor-red"

    def test_green_light(self) -> None:
        assert compute_symbol({"VALNMR": 5, "COLOUR": ["4"]}, "LIGHTS") == "light-minor-green"

    def test_major_green(self) -> None:
        assert compute_symbol({"VALNMR": 15, "COLOUR": ["4"]}, "LIGHTS") == "light-major-green"


class TestWreckSymbol:
    def test_dangerous(self) -> None:
        assert compute_symbol({"CATWRK": 2}, "WRECKS") == "wreck-dangerous"

    def test_nondangerous(self) -> None:
        assert compute_symbol({"CATWRK": 1}, "WRECKS") == "wreck-nondangerous"

    def test_mast(self) -> None:
        assert compute_symbol({"CATWRK": 4}, "WRECKS") == "wreck-mast"

    def test_submerged(self) -> None:
        assert compute_symbol({"WATLEV": 3}, "WRECKS") == "wreck-dangerous"

    def test_default(self) -> None:
        assert compute_symbol({}, "WRECKS") == "wreck-nondangerous"


class TestObstructionSymbol:
    def test_normal(self) -> None:
        assert compute_symbol({}, "OBSTRN") == "obstruction"

    def test_foul_area(self) -> None:
        assert compute_symbol({"CATOBS": 6}, "OBSTRN") == "obstruction-foul"

    def test_foul_ground(self) -> None:
        assert compute_symbol({"CATOBS": 7}, "OBSTRN") == "obstruction-foul"


class TestRockSymbol:
    def test_underwater(self) -> None:
        assert compute_symbol({}, "UWTROC") == "rock-underwater"

    def test_awash(self) -> None:
        assert compute_symbol({"WATLEV": 5}, "UWTROC") == "rock-awash"

    def test_above(self) -> None:
        assert compute_symbol({"WATLEV": 2}, "UWTROC") == "rock-above"


class TestOtherSymbols:
    def test_fogsig(self) -> None:
        assert compute_symbol({}, "FOGSIG") == "fogsig"

    def test_mooring(self) -> None:
        assert compute_symbol({}, "MORFAC") == "mooring"

    def test_piling(self) -> None:
        assert compute_symbol({}, "PILPNT") == "piling"

    def test_unknown_layer(self) -> None:
        assert compute_symbol({}, "UNKNOWNLAYER") is None
