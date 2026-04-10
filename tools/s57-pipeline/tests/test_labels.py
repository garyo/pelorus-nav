"""Tests for nautical label generation."""

from s57_pipeline.labels import _buoy_number, _light_label


class TestLightLabel:
    def test_flashing_green(self) -> None:
        props = {"LITCHR": 2, "COLOUR": ["4"], "SIGPER": 4.0, "SIGGRP": "(1)"}
        assert _light_label(props) == "Fl G 4s"

    def test_quick_red(self) -> None:
        props = {"LITCHR": 4, "COLOUR": ["3"], "SIGPER": 1.0, "SIGGRP": "(1)"}
        assert _light_label(props) == "Q R 1s"

    def test_group_flashing(self) -> None:
        props = {"LITCHR": 2, "COLOUR": ["1"], "SIGPER": 6.0, "SIGGRP": "(2)"}
        assert _light_label(props) == "Fl(2) 6s"

    def test_white_light_omits_color(self) -> None:
        props = {"LITCHR": 7, "COLOUR": ["1"], "SIGPER": 4.0, "SIGGRP": "(1)"}
        assert _light_label(props) == "Iso 4s"

    def test_no_period(self) -> None:
        props = {"LITCHR": 1, "COLOUR": ["3"], "SIGGRP": "(1)"}
        assert _light_label(props) == "F R"

    def test_no_litchr_returns_none(self) -> None:
        assert _light_label({}) is None

    def test_fractional_period(self) -> None:
        props = {"LITCHR": 2, "COLOUR": ["4"], "SIGPER": 2.5, "SIGGRP": "(1)"}
        assert _light_label(props) == "Fl G 2.5s"


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
