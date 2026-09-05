"""The weekly wrap that inverted a direction in its own headline.

WHAT WAS PUBLISHED
------------------
`electricity-prices-and-renewable-energy-share-rise-in-the-baltics-fa8c99`,
2026-08-30T15:00:19Z, the first scheduled weekly timer, `revision e8da9c3`::

    HEADLINE  "Electricity prices and renewable energy share rise in the Baltics"
    body[0]   "Industrial electricity prices in Latvia increased to 0.13 EUR per
               kWh, compared with 0.23 EUR per kWh in the previous semi-annual
               period."
    body[1]   "Lithuania's renewable energy share rose to 38.5%, compared with
               24.7% in the previous measurement period."

Measured 2026-08-31 against the live series:

    elec_price_industry LV    2025-S2 0.1335   <- "0.13"
                              2025-S1 0.1354   <- the ACTUAL previous period
                              2022-S2 0.2292   <- "0.23", the STREAK basis
                              move vs the previous period: -0.0019, a FALL

    renewables LT             2025    38.5     <- rose; this half is TRUE
                              2024    35.408   <- the ACTUAL previous period
                              2018    24.695   <- "24.7", again the streak basis

THE THIRD PARAGRAPH IS THE ONE THAT MAKES THIS SHARP
-----------------------------------------------------
The wrap carries three comparisons, not two, and the third is right: building
permits at 106.8 index points "compared with a nine-year average of 71.52 index
points for this period" — and the nine Q2 readings from 2017 to 2025 mean
exactly 71.52. It is the one whose basis comes from ``seasonal_deviation``.

So the fault is not "the wrap misdescribes its bases". It is that both
**streak** bases were restated as "the previous period", 2 of 2, while the one
seasonal basis was described correctly, 1 of 1. The correct sibling is what
made the file look handled.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.corrections import (
    PENDING,
    WEEKLY_WRAP_BASIS,
    already_recorded,
    annotate,
    issue,
)
from newsroom.tests.pipeline.test_editorial_corrections import FakeStore

SLUG = "electricity-prices-and-renewable-energy-share-rise-in-the-baltics-fa8c99"

#: Every quantity the note asserts, measured rather than recalled. Asserting
#: these appear is what stops the prose drifting away from the data while
#: continuing to read plausibly — the failure this whole task is about.
MEASURED = {
    "0.13": "the reading, 2025-S2, correct as published",
    "0.135": "2025-S1, the actual previous semi-annual period",
    "0.23": "2022-S2, the streak basis the wrap called 'the previous period'",
    "2022-S2": "where that basis really sits",
    "2025-S1": "where the previous period really sits",
    "24.7%": "2018, the streak basis in the renewables paragraph",
    "2018": "where that basis really sits",
    "35.4%": "2024, the actual previous measurement period",
    "106.8": "the permits reading, correct as published",
    "71.52": "the nine-year Q2 mean, correct as published",
}


class TestItSaysTheDirectionWasWrong:
    """The most serious of the three faults and the one a reader takes away."""

    def test_it_states_plainly_that_prices_did_not_rise(self):
        text = WEEKLY_WRAP_BASIS.description

        assert "did not rise" in text
        assert "sixth consecutive semi-annual fall" in text

    def test_it_names_the_headline_as_the_thing_that_was_wrong(self):
        """The headline travels alone — into the feed, the RSS and the JSON-LD —
        so a correction that only discussed a paragraph would leave the claim a
        reader most often meets unaddressed."""
        text = WEEKLY_WRAP_BASIS.description

        assert "headline" in text

    def test_it_does_not_offer_the_blanket_reassurance(self):
        """MUTATION THIS CATCHES: reusing the origin shape's closing sentence.

        Every figure here IS a correct reading, so "the figures are unchanged
        and correct" is *literally* true — and it is exactly the sentence a
        reader whose takeaway is "prices rose" would read as "so the story
        stands". A reader must not be told the figures are unchanged when the
        direction is inverted.
        """
        text = WEEKLY_WRAP_BASIS.description

        assert "figures are unchanged" not in text
        assert "figure itself is unchanged" not in text


class TestItPlacesBothMisdescribedBases:
    """A reader who meets 0.23 and 24.7% in the piece must be able to account
    for numbers in front of them, not merely be told they are misplaced."""

    @pytest.mark.parametrize("quantity", sorted(MEASURED))
    def test_the_note_carries_every_measured_quantity(self, quantity: str):
        assert quantity in WEEKLY_WRAP_BASIS.description, MEASURED[quantity]

    def test_it_says_what_the_previous_period_actually_was(self):
        text = WEEKLY_WRAP_BASIS.description

        assert "previous semi-annual period" in WEEKLY_WRAP_BASIS.previous_value
        assert "2025-S1" in text and "2024" in text


class TestItSaysWhatSurvives:
    """A correction that lists only errors reads as a retraction, and two of
    the wrap's three findings are sound."""

    def test_the_renewables_half_of_the_headline_stands(self):
        text = WEEKLY_WRAP_BASIS.description

        assert "renewable share did rise" in text
        assert "half of the headline stands" in text

    def test_the_building_permits_paragraph_is_vouched_for(self):
        text = WEEKLY_WRAP_BASIS.description

        assert "correct and correctly described" in text

    def test_it_is_not_a_retraction(self):
        """The published policy calls this "a misstated comparison", which is a
        correction; a retraction is for invalid data or a wrong premise."""
        text = WEEKLY_WRAP_BASIS.description

        assert "RETRACTED" not in text
        assert "should not have been published" not in text

    def test_the_prose_is_left_alone(self):
        assert "left exactly as published" in WEEKLY_WRAP_BASIS.description


class TestItIsWiredIn:
    """A correction nobody files is a note in a source file."""

    def test_it_is_in_pending_so_a_run_files_it(self):
        assert WEEKLY_WRAP_BASIS in PENDING

    def test_it_names_the_article_that_carries_the_error(self):
        assert WEEKLY_WRAP_BASIS.slug == SLUG

    def test_it_quotes_the_published_sentence(self):
        """Optional in the schema and worth setting: a correction about a phrase
        is far easier to check against the page than one about a topic."""
        assert WEEKLY_WRAP_BASIS.previous_value
        assert "increased to 0.13 EUR per kWh" in WEEKLY_WRAP_BASIS.previous_value

    def test_every_pending_correction_is_distinct(self):
        """Two notes sharing a description would de-duplicate against each other
        and one would silently never file."""
        descriptions = [c.description for c in PENDING]

        assert len(set(descriptions)) == len(descriptions)


def _wrap(corrections=...):
    """The stored wrap. ``corrections`` is ABSENT on the live article — not
    ``[]`` and not ``None`` — which is the state the writer path has to handle,
    and the state a naive count reports as one existing note."""
    document = {"status": "published", "headline": "Electricity prices and renewable energy share rise in the Baltics"}
    if corrections is not ...:
        document["corrections"] = corrections
    return document


class TestItAppliesToTheArticleAsItActuallyIs:
    def test_it_files_on_a_document_with_no_corrections_key_at_all(self):
        corrected = annotate(_wrap(), WEEKLY_WRAP_BASIS)

        assert corrected is not None
        assert len(corrected["corrections"]) == 1
        assert corrected["corrections"][0]["previous_value"]

    def test_it_files_on_an_explicit_null(self):
        corrected = annotate(_wrap(corrections=None), WEEKLY_WRAP_BASIS)

        assert corrected is not None
        assert len(corrected["corrections"]) == 1

    def test_running_it_twice_appends_nothing(self):
        """It runs every edition."""
        once = annotate(_wrap(), WEEKLY_WRAP_BASIS)
        assert once is not None

        assert annotate(once, WEEKLY_WRAP_BASIS) is None
        assert already_recorded(once["corrections"], WEEKLY_WRAP_BASIS)

    @pytest.mark.asyncio
    async def test_issue_writes_the_article_and_the_public_log(self):
        store = FakeStore({SLUG: _wrap()})

        changed = await issue(store, [WEEKLY_WRAP_BASIS])

        assert changed == [SLUG]
        assert len(store.written[SLUG]["corrections"]) == 1
        assert store.logged[0]["slug"] == SLUG
        assert store.logged[0]["description"] == WEEKLY_WRAP_BASIS.description

    @pytest.mark.asyncio
    async def test_a_second_run_is_a_no_op(self, tmp_path):
        from newsroom.pipeline.publish import ArticleStore

        store = ArticleStore(account_url="", local_dir=tmp_path)
        await store.write_published(SLUG, _wrap())
        await issue(store, [WEEKLY_WRAP_BASIS])

        assert await issue(store, [WEEKLY_WRAP_BASIS]) == []
        assert len(store._read_corrections_log()) == 1
