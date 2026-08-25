"""Proper nouns that end in a numeral are names, not quantities.

The production failure this comes from:

    body[3]: '1' not in figures
    text: "...especially with upcoming maintenance on the Estlink 1 undersea
           electricity cable."

Estlink 1 is an interconnector. The scanner read the 1 as a claim, the article
was rejected for inventing a number that was part of a proper noun, and since
the interconnectors are the *subject* of Baltic power-market reporting this
blocked that whole beat.

The dangerous fix would have been a general rule: capitalised word, then a
small integer. That also masks "Latvia 500" and hands back a way to launder a
real quantity, so it is deliberately not what was done. A curated list fails
closed on anything it does not know.
"""

from __future__ import annotations

import pytest

from newsroom import numeric_scan


def scanned(text: str) -> list[str]:
    return [token.text for token in numeric_scan.scan(text)]


class TestNamesAreNotQuantities:
    @pytest.mark.parametrize(
        "text",
        [
            "maintenance on the Estlink 1 undersea electricity cable",
            "Estlink 2 returns to service",
            "flows through Nord Stream 2 stopped",
            "the Estlink1 link",
        ],
    )
    def test_a_named_link_contributes_no_figure(self, text):
        assert scanned(text) == []

    def test_a_real_figure_in_the_same_sentence_still_registers(self):
        tokens = scanned("Estlink 1 carried 42.5 EUR/MWh of spread")

        assert tokens == ["42.5"]


class TestWhatItMustStillCatch:
    """The list must not become a way to smuggle a quantity past the gate."""

    @pytest.mark.parametrize(
        "text,expected",
        [
            # A country is not on the list, and must never be.
            ("Latvia 500 jobs were lost", ["500"]),
            ("In Latvia, 500 jobs were lost", ["500"]),
            # Bounded to two digits: a name cannot absorb a large number.
            ("Estlink 119 earlier periods", ["119"]),
            # A unit after the numeral means it is a measurement either way,
            # and a name must not be able to hide one.
            ("Estlink 2 GW of capacity", ["2"]),
            ("Estlink 2 TWh flowed north", ["2"]),
            ("Estlink 2 percent of demand", ["2 percent"]),
        ],
    )
    def test_still_reports_the_number(self, text, expected):
        assert scanned(text) == expected

    def test_an_unknown_link_name_fails_closed(self):
        # Not on the list, so the number is still a claim and the article is
        # rejected. That is the safe direction and the current behaviour.
        assert scanned("the Fictional Link 3 cable") == ["3"]
