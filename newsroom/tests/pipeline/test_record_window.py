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
