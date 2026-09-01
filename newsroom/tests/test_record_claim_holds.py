"""A superlative over the series must hold over the series.

WHY THIS FILE
-------------
Published 2026-08-31T14:04Z, revision ``56554c8``, in
``estonia-s-core-inflation-drops-to-1-4-in-july-eb6a02``::

    "This reading is the lowest in the 296 observations since the series
     began."

71 of those 296 readings are lower; the lowest is -1.7% in 2020-10. The
detector had claimed no record at all — the signal was a seasonal deviation.
296 is genuinely the length of the series and traces to a verified figure, so
``figures_traceable`` and ``no_invented_numbers`` passed and were right to. The
falsehood is the word "lowest", and a superlative carries no digits.

WHAT WAS ALREADY IN PLACE, AND WHY IT DID NOT REACH THIS
--------------------------------------------------------
``house_style.record_claim_problems`` demands that a record claim name its
window, and that rule works — the writer learned it. These sentences name their
window *correctly*. Measured across the 93 articles published to
2026-08-31T14:08Z: seven series-scoped superlatives satisfy the bounding rule,
and six of the seven are false, each proven by the correction that followed.
Bounding was checked; truth was not.

HOW THESE TESTS ARE BUILT
-------------------------
Every rejection is paired with the SAME SENTENCE under data that licenses it.
Without that pairing a test proves only that the check fires, not that it fires
on the claim rather than on the phrasing — and a gate that rejects a true
superlative is a worse defect than the one it was built to catch.

The rejected sentences are verbatim from the published corpus. The licensing
counts in each pair come from the correction that article carries, so the
fixtures are the wire's own record rather than my invention.
"""

from __future__ import annotations

import re
from typing import Any, Mapping

import pytest

from newsroom import validator
from newsroom.validator import ValidationContext, check_record_claim_holds

# ── the corpus, verbatim ────────────────────────────────────────────────
#
# slug, sentence, and the counts its correction states. Each correction is
# quoted in the comment above it so the fixture can be checked against the
# artefact rather than against my reading of it.

#: "It was not the lowest of those 296 readings: 71 are lower"
CORE_INFLATION = (
    "This reading is the lowest in the 296 observations since the series began.",
    {"readings_in_series": 296, "higher": 224, "lower": 71},
)
#: "It was not the highest of those 270 readings: 12 are higher"
FOREIGN_VISITORS = (
    "This reading is the highest recorded in the 270 observations since the "
    "series began in January 2004, reflecting a notable increase compared to "
    "the previous year's figure of 359 thousand nights.",
    {"readings_in_series": 270, "higher": 12, "lower": 257},
)
#: "Fifteen of the 39 observations since 2016-Q3 ... are higher"
RAIL_PASSENGERS = (
    "This figure represents the highest number of rail passengers recorded in "
    "the 39 observations since the series began in 2016-Q3.",
    {"readings_in_series": 39, "higher": 15, "lower": 23},
)
#: "Six of the 60 observations since 2021-08 ... are higher"
RETAIL_TRADE = (
    "This reading is the highest recorded since the series began, which "
    "started with a value of -2.2% in August 2021.",
    {"readings_in_series": 60, "higher": 6, "lower": 53},
)
#: "33 of the 56 observations since 2021-09 ... are lower"
ECONOMIC_SENTIMENT = (
    "This latest figure is the lowest recorded in the series, which began in "
    "August 2021 when the index stood at 108.5.",
    {"readings_in_series": 56, "higher": 22, "lower": 33},
)
#: Never corrected, and found by this measurement rather than by a reader. The
#: deterministic note the pack emitted was a PEER claim — "Lithuania has the
#: highest of the three Baltic states for day-ahead wholesale electricity
#: price" — and the writer grafted ", since the series began" onto it, turning
#: a true statement about three countries into a false one about all of time.
DAY_AHEAD_POWER = (
    "This price is the highest recorded among the Baltic states, since the "
    "series began.",
    {"readings_in_series": 120, "higher": 9, "lower": 110},
)

FALSE_SUPERLATIVES = [
    pytest.param(*CORE_INFLATION, id="core-inflation"),
    pytest.param(*FOREIGN_VISITORS, id="foreign-visitors"),
    pytest.param(*RAIL_PASSENGERS, id="rail-passengers"),
    pytest.param(*RETAIL_TRADE, id="retail-trade"),
    pytest.param(*ECONOMIC_SENTIMENT, id="economic-sentiment"),
    pytest.param(*DAY_AHEAD_POWER, id="day-ahead-power"),
]


def _article(
    text: str,
    *,
    placement: Mapping[str, Any] | None,
    tier: str = "A",
) -> dict[str, Any]:
    """The smallest article this check looks at: one paragraph and a placement."""
    context: dict[str, Any] = {
        "method": "collected_series",
        "series_considered": 1,
        "facts": [],
        "observations": [],
    }
    if placement is not None:
        context["placement"] = {
            "first_period": "2001-12",
            "latest_period": "2026-07",
            **placement,
        }
    return {
        "tier": tier,
        "headline": "A headline that claims nothing",
        "dek": "A dek that claims nothing.",
        "body": [{"type": "paragraph", "text": text, "figures": []}],
        "provenance": {"context": context},
    }


def _judge(text: str, placement: Mapping[str, Any] | None, tier: str = "A"):
    return check_record_claim_holds(
        ValidationContext(
            article=_article(text, placement=placement, tier=tier),
            registry=None,  # type: ignore[arg-type]
            personas=None,  # type: ignore[arg-type]
        )
    )


def _licensing(placement: Mapping[str, Any], text: str) -> dict[str, Any]:
    """The same series, with the reading actually at the end the text claims.

    This is what makes each rejection below a test of the CLAIM rather than of
    the wording: the identical sentence must pass once the data agrees.
    """
    licensed = dict(placement)
    if validator._LOW_CLAIM.search(text) and not validator._HIGH_CLAIM.search(text):
        licensed["lower"] = 0
    else:
        licensed["higher"] = 0
    return licensed


class TestThePublishedFalsehoodsAreCaught:
    @pytest.mark.parametrize("text,placement", FALSE_SUPERLATIVES)
    def test_the_sentence_is_rejected(self, text: str, placement: dict) -> None:
        result = _judge(text, placement)

        assert not result.passed, text
        assert "beaten_in_series" in result.detail, (
            "the rejection must name the count it judged on, in the vocabulary "
            "revisions.record_correction_note already uses for it"
        )

    @pytest.mark.parametrize("text,placement", FALSE_SUPERLATIVES)
    def test_the_same_sentence_passes_when_the_data_agrees(
        self, text: str, placement: dict
    ) -> None:
        """The control. Word for word identical, and legal.

        The true and false cases of this sentence are indistinguishable as
        prose — that is the whole reason a prose rule could never settle it —
        so a rejection test without this pair would be consistent with a check
        that simply bans superlatives.
        """
        result = _judge(text, _licensing(placement, text))

        assert result.passed, f"{text!r} rejected when it is true: {result.detail}"


class TestTheDetailIsDiagnosable:
    """A rejection nobody can act on becomes a rejection somebody disables."""

    def test_it_states_the_rank_claimed_and_the_rank_held(self) -> None:
        text, placement = CORE_INFLATION

        detail = _judge(text, placement).detail

        assert "rank 1" in detail
        assert "beaten_in_series is 71" in detail
        assert "72nd" in detail, "the reader wants the true placing, not just the count"
        assert "296" in detail


class TestARankClaimIsCheckedAgainstItsRank:
    """"second-highest" asserts exactly one reading is higher, and no more.

    The same invariant ``revisions.record_correction_note`` refuses to violate
    when it writes the correction afterwards: ``rank > 1 and beaten_in_window
    != rank - 1`` is rejected there because fourth-highest means exactly three
    are higher.
    """

    @pytest.mark.parametrize(
        "text,higher",
        [
            ("This is the second-highest reading in the series.", 1),
            ("This is the third-highest reading in the series.", 2),
            ("This is the fourth-highest on record.", 3),
            ("This is the 3rd highest reading in the series.", 2),
        ],
    )
    def test_a_rank_that_matches_the_data_passes(self, text: str, higher: int) -> None:
        assert _judge(
            text, {"readings_in_series": 40, "higher": higher, "lower": 39 - higher}
        ).passed, text

    @pytest.mark.parametrize(
        "text,higher",
        [
            ("This is the second-highest reading in the series.", 4),
            ("This is the third-highest reading in the series.", 0),
            ("This is the fourth-highest on record.", 9),
        ],
    )
    def test_a_rank_the_data_contradicts_is_rejected(self, text: str, higher: int) -> None:
        assert not _judge(
            text, {"readings_in_series": 40, "higher": higher, "lower": 39 - higher}
        ).passed, text

    def test_a_third_highest_claim_is_not_excused_by_being_near_the_top(self) -> None:
        """Rank 3 with two above it passes; rank 3 with five above it does not.

        The pair matters: a check that only asked "is it near the top" would
        accept both, and the corpus contains real rank claims — R&D spending,
        residential building permits — that must keep publishing.
        """
        near_the_top = {"readings_in_series": 25, "higher": 5, "lower": 19}
        exactly_third = {"readings_in_series": 25, "higher": 2, "lower": 22}
        text = (
            "This latest figure is the third-highest on record, with only a "
            "handful of readings in the series ever being higher."
        )

        assert _judge(text, exactly_third).passed
        assert not _judge(text, near_the_top).passed


class TestASuperlativeOverSomethingElseIsLeftAlone:
    """The half that keeps this off correct work.

    "How the other Baltic states stand" is item 3 of the writer's own plan, so
    the wire produces peer superlatives constantly and every one of them is
    true. A gate that rejected them would be destroying correct work to catch
    incorrect work, and would be turned off within a week.
    """

    @pytest.mark.parametrize(
        "text",
        [
            "Latvia has the highest energy inflation among the Baltic states.",
            "Riga handled the largest share of containerised cargo of the three ports.",
            "Estonia reported the lowest rate of the Baltic three in the same quarter.",
            "Energy costs are the biggest single line in a household budget.",
            "The spread between the cheapest and most expensive hour widened to 303.5 euros.",
            "Lithuania's price is the highest of the three at 146.03 EUR/MWh.",
        ],
    )
    def test_a_peer_superlative_needs_no_window(self, text: str) -> None:
        placement = {"readings_in_series": 120, "higher": 9, "lower": 110}

        assert _judge(text, placement).passed, text

    def test_the_control_that_makes_that_meaningful(self) -> None:
        """The same claim, scoped to the series instead of to the neighbours.

        Without this the tests above pass on a check that fires on nothing.
        """
        placement = {"readings_in_series": 120, "higher": 9, "lower": 110}

        assert not _judge(
            "Latvia has the highest energy inflation in the series.", placement
        ).passed


class TestANarrowerWindowIsTheWriterBeingHonest:
    """A count smaller than the series is a window, and naming one is correct.

    This is decided by comparing the number in the sentence to the number of
    readings the series holds — the data, not the wording. "the highest in the
    296 observations" claims all 296; "the lowest in the 60 readings the
    newsroom holds" claims sixty of them and says so.
    """

    def test_a_count_below_the_population_is_not_a_series_claim(self) -> None:
        placement = {"readings_in_series": 296, "higher": 71, "lower": 224}

        assert _judge(
            "This is the lowest in the 60 readings the newsroom holds.", placement
        ).passed

    def test_a_count_equal_to_the_population_is_one(self) -> None:
        """The control, and the sentence that actually shipped."""
        placement = {"readings_in_series": 296, "higher": 71, "lower": 224}

        assert not _judge(
            "This is the lowest in the 296 observations.", placement
        ).passed

    def test_a_date_bounded_superlative_is_left_alone(self) -> None:
        """"the lowest since 2007" is a claim about 2007 onwards.

        It is routinely true while the whole-series claim is false, so judging
        it against whole-series counts would reject correct copy. The corpus
        carries one — Lithuania's crude birth rate — and it is true.
        """
        placement = {"readings_in_series": 66, "higher": 3, "lower": 62}

        assert _judge(
            "This decline marks the lowest birth rate recorded in Lithuania since 2007.",
            placement,
        ).passed


class TestADenialIsNotAClaim:
    """"not the highest" says the opposite of "the highest".

    The pack's own note for an ordinary reading — "This is neither the highest
    nor the lowest reading in the series" — is a denial, and the prompt hands
    it to the writer as the correct thing to say. A check that read a denial as
    a rank-1 claim would reject the sentence it exists to encourage, which is
    how this was found: the prompt's own GOOD example failed the gate the same
    prompt was written to serve.
    """

    MID_SERIES = {"readings_in_series": 40, "higher": 6, "lower": 33}

    @pytest.mark.parametrize(
        "text",
        [
            "This is not the highest reading in the series.",
            "This is neither the highest nor the lowest reading in the series.",
            "This reading is far from the lowest in the series.",
            "It is no longer the highest reading in the series.",
        ],
    )
    def test_a_denial_passes(self, text: str) -> None:
        assert _judge(text, self.MID_SERIES).passed, text

    @pytest.mark.parametrize(
        "text",
        [
            "This is the highest reading in the series.",
            "This reading is the lowest in the series.",
            "It is the highest reading in the series.",
        ],
    )
    def test_the_control_the_same_sentence_asserted(self, text: str) -> None:
        """Without this the tests above pass on a check that fires on nothing."""
        assert not _judge(text, self.MID_SERIES).passed, text

    def test_never_been_higher_is_an_assertion_not_a_denial(self) -> None:
        """The word that looks like a negator and is not.

        "Output has never been lower" claims the record; reading its "never" as
        a denial would exempt the strongest form of the claim.
        """
        assert not _judge(
            "Output has never been lower in the series.", self.MID_SERIES
        ).passed

    def test_a_sentence_naming_both_ends_claims_neither(self) -> None:
        """"the gap between the highest and lowest reading in the series"
        names two ends and asserts a position at neither. Judging it would mean
        guessing a direction, and the guess is wrong half the time."""
        assert _judge(
            "The gap between the highest and lowest reading in the series widened.",
            self.MID_SERIES,
        ).passed

    def test_the_control_one_end_named_with_a_record_word(self) -> None:
        assert not _judge(
            "The highest and lowest readings aside, this set a record in the series.",
            self.MID_SERIES,
        ).passed


class TestAHedgeIsNotARankClaim:
    def test_one_of_the_highest_asserts_membership_not_position(self) -> None:
        placement = {"readings_in_series": 40, "higher": 6, "lower": 33}

        assert _judge("This is one of the highest readings in the series.", placement).passed
        assert not _judge("This is the highest reading in the series.", placement).passed, (
            "control: the unhedged form must still be caught, or the test above "
            "proves nothing about hedging"
        )

    def test_the_hedge_scan_survives_a_decimal_point(self) -> None:
        """A full stop inside a figure is not a sentence boundary.

        The sentences carrying figures are the ones a numeric rule can least
        afford to mis-scan, and `[^.]` stops dead at the point in "2.4".
        """
        placement = {"readings_in_series": 40, "higher": 6, "lower": 33}

        assert _judge(
            "This is one of the 2.4% highest readings in the series.", placement
        ).passed


class TestAnUndirectedRecordClaimIsStillRefutable:
    """"set a record", "unprecedented" — rank 1 at an end it does not name.

    A reading with something above it AND something below it is the extreme of
    neither, so the claim is refutable without knowing which end was meant.
    This is what reaches superlatives the vocabulary does not list: "the
    fastest growth on record" carries no listed word and is caught anyway.
    """

    @pytest.mark.parametrize(
        "text",
        [
            "Latvia's ports set a record in the series.",
            "The spread was unprecedented in the series.",
            "This was the fastest growth on record.",
        ],
    )
    def test_it_is_rejected_when_the_reading_is_mid_series(self, text: str) -> None:
        assert not _judge(
            text, {"readings_in_series": 40, "higher": 6, "lower": 33}
        ).passed, text

    @pytest.mark.parametrize(
        "text",
        [
            "Latvia's ports set a record in the series.",
            "The spread was unprecedented in the series.",
            "This was the fastest growth on record.",
        ],
    )
    def test_it_passes_at_an_end_of_the_series(self, text: str) -> None:
        assert _judge(text, {"readings_in_series": 40, "higher": 0, "lower": 39}).passed, text

    def test_recorded_is_not_a_record_claim(self) -> None:
        """"recorded" is how a figure was captured, not a superlative.

        The wire uses it constantly — "Estonia recorded 595 cars per thousand
        inhabitants" — and a bare ``record`` stem would fire on every one.
        """
        placement = {"readings_in_series": 40, "higher": 6, "lower": 33}

        assert _judge(
            "Estonia recorded 595 cars per thousand inhabitants in the series.", placement
        ).passed


class TestOrdinaryEnglishThatLooksLikeAClaim:
    """Two phrases that would have been read as rank-1 claims.

    Neither appears in the published corpus, so no measurement would have found
    them; they are excluded by construction instead. Both would have rejected a
    true article, which is the worse of the two defects available here.
    """

    @pytest.mark.parametrize(
        "text",
        [
            "At least 5 readings in the series are lower than this one.",
            "Most of the series was flat.",
        ],
    )
    def test_it_is_not_a_claim(self, text: str) -> None:
        assert _judge(text, {"readings_in_series": 40, "higher": 6, "lower": 33}).passed, text

    def test_the_control_the_article_makes_the_difference(self) -> None:
        """"the most expensive" IS a superlative; "most of" is not.

        Stated as a pair because the rule is the definite article, and without
        the positive half this would pass on a check that ignores "most"
        altogether.
        """
        placement = {"readings_in_series": 40, "higher": 6, "lower": 33}

        assert not _judge(
            "This was the most expensive quarter in the series.", placement
        ).passed


class TestAClaimAboutASeriesWeNeverMeasured:
    """Fail closed. This is the published failure, not caution.

    "Latvia's food inflation drops to record low of -2% in July 2026" was a
    record over the sixty periods the collector had been asked for, out of 348,
    and the true all-time low is -8.6% in 2010-01. ``_placement`` says nothing
    at all when the series' extent is unknown, so there is nothing to check the
    claim against and it may not be made.
    """

    def test_a_series_claim_with_no_placement_block_is_rejected(self) -> None:
        result = _judge("This is the lowest reading anywhere in the series.", None)

        assert not result.passed
        assert "never recorded" in result.detail

    def test_the_control_the_same_sentence_with_a_placement_block(self) -> None:
        assert _judge(
            "This is the lowest reading anywhere in the series.",
            {"readings_in_series": 40, "higher": 39, "lower": 0},
        ).passed

    def test_a_bounded_window_claim_is_still_allowed_without_one(self) -> None:
        """The construction ``detect_record_extreme`` supplies.

        "a record high in the 48 observations since 2014-Q1" claims 48 readings
        and names them. Refusing it would refuse the fix that stopped the last
        instance of this fault, on a series where the fix is all we have.
        """
        assert _judge(
            "It is a record high in the 48 observations since 2014-Q1.", None
        ).passed

    def test_a_partial_placement_block_does_not_license_anything(self) -> None:
        """Absence must not resolve to success through a missing key."""
        article = _article(
            "This is the lowest reading anywhere in the series.", placement=None
        )
        article["provenance"]["context"]["placement"] = {"readings_in_series": 40}

        result = check_record_claim_holds(
            ValidationContext(
                article=article,
                registry=None,  # type: ignore[arg-type]
                personas=None,  # type: ignore[arg-type]
            )
        )

        assert not result.passed


class TestSyndicatedProseIsNotOurs:
    """Tier B and C are the outlet's own words, reproduced verbatim.

    Scanning them for our editorial rules would reject correct behaviour and
    teach everyone to ignore the gate. The corpus carries one: "Record number
    of students start studying at security sciences academy" is LSM's
    headline, under LSM's byline.

    The pair below uses OUR published falsehood rather than that headline,
    deliberately. A first version used the syndicated headline for both halves
    and passed — because that sentence makes no series-scoped claim at all, so
    the tier A control was vacuous and the test was consistent with a check
    that ignores tier entirely.
    """

    def test_a_syndicated_snippet_is_left_alone(self) -> None:
        text, placement = CORE_INFLATION

        assert _judge(text, placement, tier="C").passed
        assert _judge(text, placement, tier="B").passed

    def test_the_control_the_same_sentence_as_our_own_prose(self) -> None:
        text, placement = CORE_INFLATION

        assert not _judge(text, placement, tier="A").passed


class TestEachGuardIsLoadBearing:
    """Plant a fault in each constant and prove a named assertion stops holding.

    In process rather than by rewriting the file: a harness that edits source
    and is interrupted leaves the mutation behind, and this repo has already
    paid for that once. ``monkeypatch`` restores on teardown whatever happens,
    and the check reads these through module globals, so the substitution
    reaches the code under test.

    Each case asserts BOTH directions. A mutation that changes nothing is
    indistinguishable from one that never applied, which is the same two-states
    -one-artefact failure the check itself exists to remove.
    """

    NEVER = re.compile(r"(?!x)x")

    @pytest.mark.parametrize(
        "constant,text,placement",
        [
            ("_LOW_CLAIM", *CORE_INFLATION),
            ("_HIGH_CLAIM", *FOREIGN_VISITORS),
            (
                "_SERIES_SCOPE",
                "This latest figure is the lowest recorded in the series.",
                {"readings_in_series": 56, "higher": 22, "lower": 33},
            ),
            (
                "_UNDIRECTED_CLAIM",
                "The spread was unprecedented in the series.",
                {"readings_in_series": 40, "higher": 6, "lower": 33},
            ),
        ],
    )
    def test_blinding_a_pattern_lets_the_falsehood_through(
        self, monkeypatch: pytest.MonkeyPatch, constant: str, text: str, placement: dict
    ) -> None:
        assert not _judge(text, placement).passed, (
            "baseline: this must be caught before the mutation, or the mutation "
            "proves nothing"
        )

        monkeypatch.setattr(validator, constant, self.NEVER)
        assert getattr(validator, constant) is self.NEVER, "the mutation did not apply"

        assert _judge(text, placement).passed, (
            f"{constant} is not load-bearing: blinding it changed no verdict, so "
            "nothing here would notice if it stopped matching"
        )

    def test_blinding_the_hedge_starts_rejecting_a_true_sentence(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The one guard whose removal costs a FALSE POSITIVE rather than a
        false negative, so its mutation runs the other way."""
        text = "This is one of the highest readings in the series."
        placement = {"readings_in_series": 40, "higher": 6, "lower": 33}

        assert _judge(text, placement).passed, "baseline"

        monkeypatch.setattr(validator, "_HEDGED", self.NEVER)
        assert getattr(validator, "_HEDGED") is self.NEVER

        assert not _judge(text, placement).passed

    def test_dropping_the_population_comparison_rejects_a_narrower_window(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``_scopes_the_series`` compares the count in the prose to the count
        in the data. Treat any count as the series and an honest narrower
        window becomes a rejection."""
        text = "This is the lowest in the 60 readings the newsroom holds."
        placement = {"readings_in_series": 296, "higher": 71, "lower": 224}

        assert _judge(text, placement).passed, "baseline"

        monkeypatch.setattr(
            validator, "_scopes_the_series", lambda sentence, total: True
        )

        assert not _judge(text, placement).passed


class TestItIsWiredIn:
    """A check nothing runs is a check that does not exist."""

    def test_it_is_in_the_contract_and_in_the_registry(self) -> None:
        from newsroom.validator import _CHECKS, CHECK_NAMES

        assert "record_claim_holds" in CHECK_NAMES
        assert _CHECKS["record_claim_holds"] is check_record_claim_holds

    def test_the_typescript_mirror_carries_it(self) -> None:
        """The reader's own gate names the same checks the writer's does."""
        import pathlib

        source = pathlib.Path(__file__).resolve().parents[2] / "src" / "news-types.ts"

        assert "'record_claim_holds'" in source.read_text(encoding="utf-8")
