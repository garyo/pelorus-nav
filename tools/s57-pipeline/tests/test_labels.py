"""Tests for nautical label generation."""

from s57_pipeline.labels import _buoy_number, _light_label


class TestLightLabel:
    # NOAA ENC viewer format: character+group+colour concatenated (no space),
    # then space-separated period and optional "HEIGHTmRANGEM" suffix.

    def test_flashing_green(self) -> None:
        props = {"LITCHR": 2, "COLOUR": ["4"], "SIGPER": 4.0, "SIGGRP": "(1)"}
        assert _light_label(props) == "Fl(1)G 4s"

    def test_quick_red(self) -> None:
        props = {"LITCHR": 4, "COLOUR": ["3"], "SIGPER": 1.0, "SIGGRP": "(1)"}
        assert _light_label(props) == "Q(1)R 1s"

    def test_group_flashing(self) -> None:
        # White light omits the colour letter even when group is explicit.
        props = {"LITCHR": 2, "COLOUR": ["1"], "SIGPER": 6.0, "SIGGRP": "(2)"}
        assert _light_label(props) == "Fl(2) 6s"

    def test_white_light_omits_color(self) -> None:
        props = {"LITCHR": 7, "COLOUR": ["1"], "SIGPER": 4.0, "SIGGRP": "(1)"}
        assert _light_label(props) == "Iso(1) 4s"

    def test_no_period(self) -> None:
        props = {"LITCHR": 1, "COLOUR": ["3"], "SIGGRP": "(1)"}
        assert _light_label(props) == "F(1)R"

    def test_no_litchr_returns_none(self) -> None:
        assert _light_label({}) is None

    def test_fractional_period(self) -> None:
        props = {"LITCHR": 2, "COLOUR": ["4"], "SIGPER": 2.5, "SIGGRP": "(1)"}
        assert _light_label(props) == "Fl(1)G 2.5s"

    def test_empty_siggrp_is_ignored(self) -> None:
        # SIGGRP="()" (empty parens) must not leak into the label.
        # Cleveland Ledge PEL sectors have this form.
        props = {"LITCHR": 28, "COLOUR": ["1", "3"], "SIGGRP": "()"}
        assert _light_label(props) == "Al WR"

    def test_alternating_white_red(self) -> None:
        # Al WR (LITCHR=28) must show both colours, not drop White.
        props = {"LITCHR": 28, "COLOUR": ["1", "3"]}
        assert _light_label(props) == "Al WR"

    def test_alternating_green_white(self) -> None:
        # Colour order should follow the source list.
        props = {"LITCHR": 28, "COLOUR": ["4", "1"]}
        assert _light_label(props) == "Al GW"

    def test_alternating_flash_with_colours(self) -> None:
        # Al.Fl (LITCHR=19) behaves like other alternating characters.
        props = {"LITCHR": 19, "COLOUR": ["1", "3"], "SIGPER": 6}
        assert _light_label(props) == "Al.Fl WR 6s"

    def test_alternating_comma_string_colours(self) -> None:
        # COLOUR can arrive as a comma-separated string before list flatten.
        props = {"LITCHR": 28, "COLOUR": "1,3"}
        assert _light_label(props) == "Al WR"

    def test_non_alternating_white_still_omitted(self) -> None:
        # Regression: white still dropped for non-alternating rhythms.
        props = {"LITCHR": 2, "COLOUR": ["1"], "SIGPER": 4}
        assert _light_label(props) == "Fl 4s"

    def test_height_and_range_not_baked(self) -> None:
        # HEIGHT and VALNMR are composed at render time so the frontend
        # can format height in metres or feet per the user's depthUnit.
        # The stem never includes them.
        props = {
            "LITCHR": 2,
            "COLOUR": ["4"],
            "SIGGRP": "(1)",
            "HEIGHT": 8.2,
            "VALNMR": 3.0,
        }
        assert _light_label(props) == "Fl(1)G"

    def test_height_range_with_period(self) -> None:
        # Period stays in the stem — it's unit-agnostic.
        props = {
            "LITCHR": 2,
            "COLOUR": ["4"],
            "SIGPER": 6,
            "SIGGRP": "(1)",
            "HEIGHT": 9.8,
            "VALNMR": 5,
        }
        assert _light_label(props) == "Fl(1)G 6s"

    def test_height_only_not_baked(self) -> None:
        props = {"LITCHR": 1, "COLOUR": ["3"], "HEIGHT": 10}
        assert _light_label(props) == "F R"

    def test_range_only_not_baked(self) -> None:
        props = {"LITCHR": 1, "COLOUR": ["3"], "VALNMR": 5}
        assert _light_label(props) == "F R"

    def test_aero_prefix(self) -> None:
        props = {"LITCHR": 2, "CATLIT": ["5"], "COLOUR": ["1"], "SIGPER": 5}
        assert _light_label(props) == "Aero Fl 5s"

    def test_cleveland_ledge_al_wr(self) -> None:
        # The PEL case the user asked about: Cleveland Ledge RCID 31.
        # HEIGHT/VALNMR are composed at render time.
        props = {
            "LITCHR": 28,
            "COLOUR": ["1", "3"],
            "SIGGRP": "()",
            "HEIGHT": 8.2,
            "VALNMR": 3,
        }
        assert _light_label(props) == "Al WR"


class TestBuoyNumber:
    def test_numbered_buoy(self) -> None:
        props = {"OBJNAM": "Boston Main Channel Lighted Buoy 6"}
        assert _buoy_number(props) == "6"

    def test_letter_buoy(self) -> None:
        props = {"OBJNAM": "Spectacle Island Channel Daybeacon A"}
        assert _buoy_number(props) == "A"

    def test_number_letter_combo(self) -> None:
        props = {"OBJNAM": "Some Channel Buoy 12A"}
        assert _buoy_number(props) == "12A"

    def test_no_objnam(self) -> None:
        assert _buoy_number({}) is None

    def test_no_match_returns_none(self) -> None:
        props = {"OBJNAM": "Boston Harbor Entrance"}
        assert _buoy_number(props) is None

    def test_danger_buoy_fallback(self) -> None:
        props = {"OBJNAM": "Whale Rock Danger Buoy"}
        assert _buoy_number(props) == "Whale Rock"

    def test_hazard_buoy_fallback(self) -> None:
        props = {"OBJNAM": "Spectacle Island Lighted Hazard Buoy"}
        assert _buoy_number(props) == "Spectacle Island"

    def test_plain_buoy_no_abbreviation_when_short(self) -> None:
        """Short names are not abbreviated."""
        props = {"OBJNAM": "Cedar Point Buoy"}
        assert _buoy_number(props) == "Cedar Point"

    def test_long_name_abbreviated_to_fit(self) -> None:
        """Long names get progressively abbreviated to fit 20 chars."""
        props = {"OBJNAM": "Long Island Channel Entrance Buoy"}
        result = _buoy_number(props)
        assert result is not None
        assert len(result) <= 20
        # "Chan" used only because full name doesn't fit
        assert result == "Long Is Chan"

    def test_nantucket_shoal_no_abbreviation(self) -> None:
        """15-char result needs no abbreviation."""
        props = {"OBJNAM": "Nantucket Shoal Lighted Whistle Buoy"}
        assert _buoy_number(props) == "Nantucket Shoal"
