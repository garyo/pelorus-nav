"""Tests for S-52 display category and priority metadata."""

from s57_pipeline.s52_metadata import (
    DISPLAY_CATEGORY,
    DISPLAY_PRIORITY,
)


class TestDisplayCategoryTable:
    def test_displaybase_layers(self) -> None:
        displaybase = [k for k, v in DISPLAY_CATEGORY.items() if v == "DISPLAYBASE"]
        assert "COALNE" in displaybase
        assert "DEPARE" in displaybase
        assert "SOUNDG" in displaybase
        assert "WRECKS" in displaybase

    def test_standard_layers(self) -> None:
        standard = [k for k, v in DISPLAY_CATEGORY.items() if v == "STANDARD"]
        assert "BOYLAT" in standard
        assert "LIGHTS" in standard
        assert "RESARE" in standard
        assert "BRIDGE" in standard

    def test_other_layers(self) -> None:
        other = [k for k, v in DISPLAY_CATEGORY.items() if v == "OTHER"]
        assert "BUISGL" in other
        assert "BERTHS" in other
        assert "PILPNT" in other

    def test_all_categories_valid(self) -> None:
        valid = {"DISPLAYBASE", "STANDARD", "OTHER"}
        for layer, cat in DISPLAY_CATEGORY.items():
            assert cat in valid, f"{layer} has invalid category {cat}"


class TestDisplayPriorityTable:
    def test_area_fills_lowest_priority(self) -> None:
        assert DISPLAY_PRIORITY["DEPARE"] == 1
        assert DISPLAY_PRIORITY["LNDARE"] == 1

    def test_lights_high_priority(self) -> None:
        assert DISPLAY_PRIORITY["LIGHTS"] == 8

    def test_all_priorities_in_range(self) -> None:
        for layer, pri in DISPLAY_PRIORITY.items():
            assert 0 <= pri <= 9, f"{layer} has priority {pri} out of range"
