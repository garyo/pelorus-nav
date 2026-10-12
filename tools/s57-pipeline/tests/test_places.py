"""Tests for assigning states and countries to search-index features."""

from __future__ import annotations

from shapely.geometry import box

from s57_pipeline.places import (
    Place,
    PlaceLocator,
    assign_places,
    place_from_admin0,
    place_from_admin1,
)

MASSACHUSETTS = Place("MA", ("MA", "USA", "US"), ("Massachusetts", "United States"))
MAINE = Place("ME", ("ME", "USA", "US"), ("Maine", "United States"))


def _locator() -> PlaceLocator:
    return PlaceLocator([
        (MASSACHUSETTS, box(-73.0, 41.5, -70.5, 42.8)),
        (MAINE, box(-71.0, 43.0, -67.0, 47.0)),
    ])


def test_us_state_is_labelled_by_postal_code() -> None:
    place = place_from_admin1({
        "name": "California", "postal": "CA",
        "admin": "United States of America", "adm0_a3": "USA",
    })
    assert place.label == "CA"
    assert place.codes == ("CA", "USA", "US")
    assert place.names == ("California", "United States", "United States of America")


def test_canadian_province_does_not_claim_the_code_ca() -> None:
    """"CA" means California; Canada answers to "CAN" and its name."""
    place = place_from_admin1({
        "name": "Ontario", "postal": "ON", "admin": "Canada", "adm0_a3": "CAN",
    })
    assert place.label == "ON"
    assert place.codes == ("ON", "CAN")
    assert place.names == ("Ontario", "Canada")


def test_us_territory_is_labelled_like_a_state() -> None:
    place = place_from_admin0({
        "NAME": "U.S. Virgin Is.", "NAME_LONG": "United States Virgin Islands",
        "ISO_A2_EH": "VI", "ADM0_A3": "VIR", "SOV_A3": "US1",
    })
    assert place.label == "VI"
    assert place.codes == ("VI", "VIR", "US", "USA")
    assert "United States" in place.names


def test_foreign_country_is_labelled_by_name() -> None:
    place = place_from_admin0({
        "NAME": "British Virgin Is.", "NAME_LONG": "British Virgin Islands",
        "ISO_A2_EH": "VG", "ADM0_A3": "VGB", "SOV_A3": "GB1",
    })
    assert place.label == "British Virgin Is."
    assert place.codes == ("VG", "VGB")


def test_locates_inside_then_nearest_then_nothing() -> None:
    found = _locator().locate([
        (-71.0, 42.35),  # Boston: inside Massachusetts
        (-70.3, 42.3),  # 0.2° off the coast: nearest is Massachusetts
        (-69.0, 41.0),  # far offshore
    ])
    assert found == [MASSACHUSETTS, MASSACHUSETTS, None]


def test_assign_places_indexes_a_table_of_the_places_used() -> None:
    features = [
        {"n": "Portland", "c": [-70.25, 43.66]},
        {"n": "Boston", "c": [-71.0, 42.35], "p": 7},
        {"n": "Georges Bank", "c": [-67.5, 41.0]},
        {"n": "Bath", "c": [-69.8, 43.9]},
    ]
    table = assign_places(features, _locator())
    assert table == [MAINE.to_json(), MASSACHUSETTS.to_json()]
    assert [f.get("p") for f in features] == [0, 1, None, 0]
