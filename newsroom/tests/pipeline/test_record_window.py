"""A record is a record over a window, and the prose must name it.

WHY THIS FILE
-------------
This shipped, live, and false::

    "Latvia's food inflation drops to record low of -2% in July 2026"

Measured against Eurostat's full ``prc_hicp_manr`` series for LV/CP011 on
2026-08-29: 348 observations from 1997-01, and the true all-time low is
**-8.6% in 2010-01**. Eighteen observations outside the window we fetched sit
below -2%. It is not a record low. It is the lowest in the five years we asked
for.

EVERY STAGE BEHAVED CORRECTLY
-----------------------------
The collector requests a fixed window — ``periods=60`` for that series. The
detector reports honestly, and its comparison basis uses the construction this
repo already praises: *"across 60 observations since 2021-08"* counts
observations, calls them observations, claims no time unit. The writer drops
the qualifier and keeps the noun. And the gate that should have demanded the
missing basis is the one that blesses it — ``record high|low`` is a member of
the validator's ``_BASIS_PATTERNS``, so "drops to record low" *satisfies*
``comparison_basis_stated``. The phrase that needs bounding counts as
self-bounding.

THE STRUCTURAL TELL, WHICH NEEDS NO SECOND FETCH
------------------------------------------------
All three ``record_extreme`` articles published to 2026-08-29 sit on an
observation count exactly equal to a collector window — 60, 48, 48, against
windows of 20/40/48/60/104. A series that ends where we cut it did not begin
there; we began there.

WHAT EACH TEST DEFENDS
----------------------
Each names the mutation of ``house_style.py`` it catches. The negative tests
carry the weight: 7 of the 20 record sentences already published DO name their
window, and a rule that fired on those would be destroying correct work to
catch incorrect work.
"""

from __future__ import annotations

import re

from newsroom.pipeline.house_style import _SENTENCES, record_claim_problems
from newsroom.validator import _SENTENCE_SPLIT


class TestTheRealHeadlinesAreCaught:
    """Verbatim from the published corpus, all three ``record_extreme`` pieces."""

    def test_the_false_food_inflation_headline(self):
        """The one proved false against 348 observations of source data.

        MUTATION THIS CATCHES: ``return []`` unconditionally — a rule that
        cannot fire, which passes every negative test in this file.
        """
        problems = record_claim_problems(
            "Latvia's food inflation drops to record low of -2% in July 2026",
            where="headline",
        )

        assert problems
        assert "window" in problems[0]

    def test_a_record_set_in_a_headline(self):
        assert record_claim_problems(
            "Lithuania's ports set record for containerised cargo in Q1 2026",
            where="headline",
        )

    def test_a_record_in_the_body(self):
        assert record_claim_problems(
            "Latvia's ports handled a record 1,175 thousand tonnes of seaborne "
            "containerised cargo in Q4 2025.",
            where="body[0]",
        )

    def test_the_other_spellings_of_the_same_claim(self):
        for text in (
            "Energy prices hit an all-time high in March.",
            "This is the highest ever reading for the metric.",
            "Output has never been lower.",
            "It is the largest figure on record.",
        ):
            assert record_claim_problems(text, where="body[1]"), text


class TestABoundedRecordIsLeftAlone:
    """The half that matters more — these are already correct and published.

    Every test here pairs the bounded sentence with its UNBOUNDED twin, because
    an assertion that something is absent needs a companion proving it could
    have been present. Without that pairing these pass vacuously: "the highest
    in the 48 observations since 2014-Q1" never trips the record pattern at
    all, so asserting it is not flagged tests nothing about the bound. A
    planted fault found exactly that.
    """

    def test_the_construction_the_detector_supplies(self):
        """"a record high in the 48 observations since 2014-Q1" is what
        ``detect_record_extreme`` hands the writer. A rule that refused it
        would be refusing the fix.

        MUTATION THIS CATCHES: dropping the ``_BOUNDS_THE_RECORD`` early
        return, which flags every record claim including the honest ones.
        """
        bounded = "It is a record high in the 48 observations since 2014-Q1."
        unbounded = "It is a record high."

        assert record_claim_problems(bounded, where="body[1]") == []
        assert record_claim_problems(unbounded, where="body[1]"), (
            "control: the same claim without its window must be flagged, or the "
            "test above proves nothing"
        )

    def test_a_since_year_bounds_it(self):
        bounded = "Food inflation set a record low since 2021."
        unbounded = "Food inflation set a record low."

        assert record_claim_problems(bounded, where="body[1]") == []
        assert record_claim_problems(unbounded, where="body[1]")

    def test_a_counted_window_bounds_it(self):
        for bounded, unbounded in (
            (
                "a record low in the 60 readings the newsroom holds",
                "a record low for the metric",
            ),
            (
                "an all-time high in the 40-quarter history of this series",
                "an all-time high for the metric",
            ),
            (
                "the highest ever in the 48 observations since 2014-Q1",
                "the highest ever for this port",
            ),
        ):
            assert record_claim_problems(bounded, where="body[1]") == [], bounded
            assert record_claim_problems(unbounded, where="body[1]"), unbounded

    def test_prose_with_no_record_claim_is_untouched(self):
        """The writer's other honest escape: not claiming a record at all.

        "the lowest since 2021" is true, needs no window beyond the date it
        already carries, and must stay legal — the rule is about the word
        "record", not about superlatives in general.
        """
        for text in (
            "Latvia's food inflation fell to -2% in July 2026.",
            "Food inflation is at its lowest since 2021.",
            "The reading is 16.35 percentage points below the seasonal norm.",
            "",
        ):
            assert record_claim_problems(text, where="body[0]") == [], text

    def test_the_word_recorded_is_not_a_record_claim(self):
        """"recorded" is how a figure was captured, not a superlative.

        MUTATION THIS CATCHES: matching a bare ``record`` stem, which fires on
        "recorded", "recording" and "record-keeping" — ordinary reporting words
        this wire uses constantly.
        """
        for text in (
            "Estonia recorded 595 cars per thousand inhabitants.",
            "The figure was recorded in July.",
        ):
            assert record_claim_problems(text, where="body[2]") == [], text


class TestItIsASentenceRule:
    def test_a_window_in_the_next_sentence_does_not_excuse_the_claim(self):
        """A reader's SENTENCE has to be true, not their paragraph.

        Reading the paragraph whole would accept a record claim bounded three
        sentences later — and the headline, where this actually shipped, has no
        later sentence at all.
        """
        para = (
            "Latvia's ports set a record in Q4 2025. "
            "The series holds 48 observations since 2014-Q1."
        )

        assert record_claim_problems(para, where="body[0]") == [], (
            "the paragraph as a whole contains a bound"
        )
        first = _SENTENCES.split(para)[0]
        assert record_claim_problems(first, where="body[0]"), (
            "but the sentence a reader meets first does not"
        )

    def test_the_sentence_splitter_matches_the_validators(self):
        """Two copies, in modules that do not import each other.

        Stated as an equality so the day they diverge is a failing test rather
        than a silent disagreement about where a sentence ends.
        """
        assert _SENTENCES.pattern == _SENTENCE_SPLIT.pattern

    def test_a_decimal_point_is_not_a_sentence_boundary(self):
        """The trap this repo has already been bitten by: a figure-carrying
        sentence is exactly the one a numeric rule cannot afford to split."""
        assert _SENTENCES.split("Prices rose 2.4% in July. Then they fell.") == [
            "Prices rose 2.4% in July.",
            "Then they fell.",
        ]


class TestItIsWiredIn:
    """A rule nothing calls is a rule that does not exist."""

    @staticmethod
    def _article(headline: str) -> "object":
        from newsroom.pipeline.models import Article, Block

        return Article(
            id="a1",
            slug="latvia-food-inflation-x",
            tier="A",
            status="published",
            headline=headline,
            section="economy",
            created_at="2026-08-29T00:00:00Z",
            provenance={},
            body=[Block(type="paragraph", text="Food inflation fell to -2% in July 2026.")],
        )

    def test_apply_house_style_reports_it_for_the_headline(self):
        from newsroom.pipeline.house_style import apply_house_style

        article = self._article(
            "Latvia's food inflation drops to record low of -2% in July 2026"
        )

        report = apply_house_style(article)

        assert any("record" in v for v in report.violations), report.violations
        assert any(v.startswith("headline") for v in report.violations)

    def test_a_bounded_headline_raises_no_record_violation(self):
        from newsroom.pipeline.house_style import apply_house_style

        article = self._article(
            "Latvia's food inflation lowest since 2021 at -2% in July 2026"
        )

        report = apply_house_style(article)

        assert not [v for v in report.violations if "over what window" in v], report.violations


class TestThePromptTeachesTheSameRule:
    """An example in guidance is a claim about behaviour — execute it."""

    def test_the_prompts_good_examples_pass_and_its_bad_ones_fail(self):
        from newsroom.pipeline.write import prompts

        flat = re.sub(r"\s+", " ", prompts._SYSTEM_TEMPLATE)

        assert "the lowest in the 60 observations since 2021-08" in flat
        assert record_claim_problems(
            "the lowest in the 60 observations since 2021-08", where="x"
        ) == []
        assert record_claim_problems("the highest since the series began in 2014", where="x") == []
        assert record_claim_problems("a record low", where="x")
        assert record_claim_problems("an all-time high", where="x")

    def test_the_prompt_no_longer_requires_the_unbounded_phrase(self):
        """It used to say: REQUIRED PHRASE: "record high" or "record low" or
        "since" — so the writer was instructed to produce the false form, and
        picked the shortest option."""
        from newsroom.pipeline.write import prompts

        flat = re.sub(r"\s+", " ", prompts._SYSTEM_TEMPLATE)

        assert 'REQUIRED PHRASE: "record high" or "record low"' not in flat

class TestTheClaimMayNotBoundItself:
    """The phrase that makes the claim is not the phrase that qualifies it.

    ``_BOUNDS_THE_RECORD`` carried a paragraph explaining that an early version
    admitted ``\breadings?\b``, so "the highest ever READING for the metric"
    bounded itself with the word for the thing being counted. That member was
    removed; ``in the series``, ``series began`` and ``since the series`` were
    not, and they say the same thing. **The correct sibling concealed the
    broken one**: a reader who checks whether self-bounding is understood finds
    the paragraph, sees that it is, and stops three lines above the defect.

    Measured on the published corpus: this and the sibling below newly flag 12
    sentences across 11 of 34 generated articles, and un-flag none. All 12 were
    read; every one is an unbounded record claim.
    """

    def test_in_the_series_no_longer_bounds_a_record(self):
        """OBSERVED, live: "This is an all-time high in the series." passed."""
        unbounded = "This is an all-time high in the series."
        bounded = "This is an all-time high in the 48 observations since 2014-Q1."

        assert record_claim_problems(unbounded, where="body[1]"), (
            "'in the series' is the claim, not the window"
        )
        assert record_claim_problems(bounded, where="body[1]") == [], (
            "control: naming the window must still pass, or the rule is a ban "
            "on record claims rather than a rule about bounding them"
        )

    def test_the_other_self_bounding_spellings(self):
        for unbounded in (
            "It is a record high in the series.",
            "It is a record high of the series.",
            "It is a record high since the series began.",
            "It is a record high, the largest in the record.",
        ):
            assert record_claim_problems(unbounded, where="body[1]"), unbounded

    def test_a_named_window_still_bounds_it_however_it_is_phrased(self):
        """The companion that keeps the rule from becoming a ban.

        A first version of this change asked for the literal token ``since``
        followed by a year, and rejected three corpus sentences that DO name
        their window — the wording simply differs. Naming the window is the
        rule; "since" is one way of saying it.
        """
        for bounded in (
            "The lowest reading anywhere in the series, which began in August 2021.",
            "This reading is the highest in the series since it began in 2014-Q1.",
            "The highest in the 39 observations since the series began in 2016-Q3.",
            "It is a record high in the 48 observations since 2014-Q1.",
        ):
            assert record_claim_problems(bounded, where="body[1]") == [], bounded


class TestABareSuperlativeIsARecordClaim:
    """"The highest in the series" makes the claim without the word.

    OBSERVED, live, 2026-08-29 — matched by NEITHER half, so it was not a claim
    to be bounded and not a bound to be checked::

        "This reading is the highest in the series, surpassing the previous
         record of 614..."

    A word list encodes your examples; this encodes the rule, which is that a
    superlative scoped to the series is a claim about all of history and the
    series is only the slice we fetched.
    """

    def test_the_published_sentence_is_caught(self):
        unbounded = (
            "This reading is the highest in the series, surpassing the previous "
            "record of 614 cars per thousand inhabitants."
        )
        bounded = (
            "This reading is the highest in the 48 observations since 2014-Q1, "
            "surpassing the previous record of 614 cars per thousand inhabitants."
        )

        assert record_claim_problems(unbounded, where="body[1]")
        assert record_claim_problems(bounded, where="body[1]") == []

    def test_every_superlative_that_scopes_itself_to_the_series(self):
        for word in ("highest", "lowest", "largest", "smallest", "biggest", "peak"):
            text = f"This is the {word} anywhere in the series."
            assert record_claim_problems(text, where="body[1]"), text

    def test_an_adjective_does_not_hide_the_scope(self):
        """This repo's own clean-draft fixture was headlined "the highest level
        in the MONTHLY series" — the same claim with a word in the way — and it
        slipped a version of this rule that wanted ``the series`` adjacent.

        The fixture is the evidence that the shape occurs: no one wrote it to
        make a point, a writer produced it and it was kept as an example of
        copy that passes. Measured on the published corpus, admitting one
        adjective flags zero further sentences.
        """
        unbounded = "Latvian unemployment reaches the highest level in the monthly series."
        bounded = "Latvian unemployment reaches the highest level in the monthly series since 2021."

        assert record_claim_problems(unbounded, where="headline")
        assert record_claim_problems(bounded, where="headline") == []

    def test_a_superlative_across_the_neighbours_is_not_a_record_claim(self):
        """The false positive this must not have, and the reason the pattern
        names the SCOPE rather than the superlative.

        A comparison across peers at one moment needs no time window — it is
        bounded by the peer group it names. Catching these would fire on
        ordinary correct reporting, and the wire produces them constantly:
        "how the other Baltic states stand" is item 3 of the writer's plan.
        """
        for ok in (
            "Latvia has the highest energy inflation among the Baltic states.",
            "Riga handled the largest share of containerised cargo of the three ports.",
            "Estonia reported the lowest rate of the Baltic three in the same quarter.",
            "Energy costs are the biggest single line in a household budget.",
        ):
            assert record_claim_problems(ok, where="body[1]") == [], ok

    def test_the_scope_clause_survives_a_decimal_point(self):
        """`[^.]` stops at the "." in "2.4 percent", so the sentences carrying
        figures — the ones this can least afford to skip — would be exactly the
        ones it missed. `_NEAR` exists for this and nothing else."""
        text = "This is the highest 2.4 percent reading in the series."

        assert record_claim_problems(text, where="body[1]"), text
