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

    def test_no_trailing_number(self) -> None:
        props = {"OBJNAM": "Boston Harbor Entrance"}
        assert _buoy_number(props) is None
