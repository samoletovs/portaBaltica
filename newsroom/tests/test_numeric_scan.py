"""Numeric scanning: what counts as a claim, and what is merely a date.

The date-exclusion rule is the subtlest part of ``no_invented_numbers`` and the
easiest to get quietly wrong in the dangerous direction, so it is tested from
both sides: dates must be excluded, and everything that is not a date must
survive to be checked.
"""

from __future__ import annotations

import pytest

from newsroom.numeric_scan import (
    NumericToken,
    is_justified,
    scan,
    unjustified_tokens,
    value_justifies,
)


def values(text: str) -> list[float]:
    return [token.value for token in scan(text)]


# ── dates and clock times are excluded ──────────────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "The dataset was retrieved on 2026-08-24.",
        "The dataset was retrieved at 2026-08-24T13:00:00Z.",
        "Published on 24 August 2026.",
        "Published on August 24, 2026.",
        "The August 2026 release confirmed it.",
        "Filed 24.08.2026 with the registry.",
        "Filed 24/08/2026 with the registry.",
        "The Q1 2026 figures are provisional.",
        "The H2 outlook is unchanged.",
        "Comparable with the 2025-26 marketing year.",
        "A pattern first seen in the 1990s.",
        "The auction closes at 13:00 CET.",
        "The auction closes at 1:45 pm.",
        "Unchanged since 2019.",
        "The rule has applied in 2021.",
        "Reporting for the year 2026.",
    ],
)
def test_should_exclude_calendar_and_clock_references(text: str) -> None:
    assert scan(text) == (), f"date-like text produced numeric tokens: {values(text)}"


@pytest.mark.parametrize(
    "text",
    [
        "The COVID-19 shock is still in the series.",
        "Written by gpt-4o-mini under supervision.",
        "See https://data.gov.lv/dati/api/3/action/datastore_search for the payload.",
    ],
)
def test_should_exclude_identifiers_and_urls(text: str) -> None:
    assert scan(text) == ()


def test_should_still_scan_a_bare_year_outside_a_calendar_context() -> None:
    # Fail closed: "reached 2019 points" is a claim about data, not a date.
    assert values("The index reached 2019 points.") == [2019.0]


def test_should_still_scan_a_duration_because_it_states_the_analysis_window() -> None:
    # Durations are deliberately NOT excluded. The pipeline knows the window it
    # analysed, so it can declare it; a reader cannot check "the past 12 months"
    # against anything otherwise.
    assert values("Prices fell over the past 12 months.") == [12.0]


# ── number shapes that must be caught ───────────────────────────────────


def test_should_scan_a_percentage() -> None:
    tokens = scan("Inflation ran at 4.2% in the quarter.")

    assert [token.value for token in tokens] == [4.2]
    assert tokens[0].is_percentage is True
    assert tokens[0].decimals == 1


def test_should_scan_a_percentage_written_as_words() -> None:
    assert values("Inflation ran at 4 percent.") == [4.0]


def test_should_scan_a_spelled_out_numeral_attached_to_a_unit() -> None:
    assert values("Prices rose by three percent.") == [3.0]


def test_should_ignore_a_spelled_out_numeral_that_is_not_a_quantity() -> None:
    # "three ports" is prose, not a figure; flagging it would make the check noise.
    assert scan("Cargo moved through three ports.") == ()


def test_should_scan_currency_with_a_symbol_and_a_scale_word() -> None:
    tokens = scan("The instrument commits €500m to the region.")

    assert [token.value for token in tokens] == [500.0]
    assert tokens[0].scaled_value == 500_000_000.0
    assert tokens[0].is_currency is True


def test_should_scan_currency_written_with_an_iso_code() -> None:
    tokens = scan("The instrument commits EUR500m to the region.")

    assert [token.value for token in tokens] == [500.0]
    assert tokens[0].scaled_value == 500_000_000.0


def test_should_scan_thousands_separated_by_commas() -> None:
    assert values("Total volume reached 1,234,567 megawatt-hours.") == [1234567.0]


def test_should_scan_thousands_separated_by_spaces() -> None:
    token = scan("Total volume reached 1 234 567 megawatt-hours.")[0]

    assert token.value == 1234567.0
    assert token.components == (1.0, 234.0, 567.0)


def test_should_scan_a_negative_number() -> None:
    assert values("One hour cleared at -4.8 euros.") == [-4.8]


def test_should_scan_a_unicode_minus_as_negative() -> None:
    assert values("One hour cleared at \u22124.8 euros.") == [-4.8]


def test_should_read_a_dash_between_digits_as_a_range_not_a_minus() -> None:
    # "4-6%" is two positive endpoints, not four and minus six.
    assert values("Prices ran 4-6% above the baseline.") == [4.0, 6.0]


def test_should_scan_both_endpoints_of_an_en_dash_range() -> None:
    assert values("Prices ran 4\u20136% above the baseline.") == [4.0, 6.0]


def test_should_scan_both_endpoints_of_a_worded_range() -> None:
    assert values("Prices ran between 8.4 and 311.9 euros.") == [8.4, 311.9]


def test_should_scan_a_number_and_a_percentage_in_the_same_sentence() -> None:
    assert values("It settled at 142.5 euros, 12.0% higher.") == [142.5, 12.0]


# ── justification ───────────────────────────────────────────────────────


def figure(value: float, *, rendered_as: str | None = None) -> dict[str, object]:
    payload: dict[str, object] = {"value": value, "signal_field": "x"}
    if rendered_as is not None:
        payload["rendered_as"] = rendered_as
    return payload


def test_should_justify_an_exact_match() -> None:
    token = scan("It settled at 142.5 euros.")[0]

    assert is_justified(token, [figure(142.5)]) is True


def test_should_justify_a_correct_rounding_at_the_stated_precision() -> None:
    token = scan("Inflation ran at 4.2%.")[0]

    assert is_justified(token, [figure(4.23)]) is True


def test_should_reject_a_rounding_that_is_wrong_at_the_stated_precision() -> None:
    token = scan("Inflation ran at 4.3%.")[0]

    assert is_justified(token, [figure(4.23)]) is False


def test_should_reject_a_number_no_figure_supports() -> None:
    token = scan("Inflation ran at 9.9%.")[0]

    assert is_justified(token, [figure(4.23), figure(12.0)]) is False


def test_should_justify_a_scaled_rendering_of_a_large_figure() -> None:
    token = scan("The instrument commits €1.2 billion.")[0]

    assert is_justified(token, [figure(1_200_000_000.0)]) is True


def test_should_reject_a_scaled_rendering_that_does_not_match() -> None:
    token = scan("The instrument commits €1.9 billion.")[0]

    assert is_justified(token, [figure(1_200_000_000.0)]) is False


def test_should_justify_a_magnitude_when_the_figure_is_the_negative_delta() -> None:
    # Prose writes "fell 3.2%" for a delta of -3.2. The magnitude must still be
    # a declared figure, so nothing is invented.
    token = scan("Cargo fell 3.2%.")[0]

    assert is_justified(token, [figure(-3.2)]) is True


def test_should_reject_a_magnitude_that_is_not_a_declared_figure_either_way() -> None:
    token = scan("Cargo fell 3.3%.")[0]

    assert is_justified(token, [figure(-3.2)]) is False


def test_should_justify_a_number_matching_the_rendered_as_string() -> None:
    token = scan("Inflation ran at 4.2%.")[0]

    assert is_justified(token, [figure(0.042, rendered_as="4.2%")]) is True


def test_should_report_every_unjustified_token() -> None:
    text = "It settled at 142.5 euros, against 118.3 in Estonia and 99.1 in Lithuania."

    unjustified = unjustified_tokens(text, [figure(142.5)])

    assert [token.value for token in unjustified] == [118.3, 99.1]


def test_should_not_be_justified_by_a_boolean_masquerading_as_a_figure() -> None:
    token = NumericToken(text="1", value=1.0, start=0, end=1, decimals=0)

    assert is_justified(token, [{"value": True, "signal_field": "x"}]) is False


def test_should_compare_magnitudes_without_sign_only_within_tolerance() -> None:
    token = NumericToken(text="4", value=4.0, start=0, end=1, decimals=0)

    assert value_justifies(token, 4.4) is True
    assert value_justifies(token, 4.6) is False
