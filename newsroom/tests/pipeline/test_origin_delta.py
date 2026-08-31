"""A change measured from somewhere else, attributed to where the series begins.

WHY THIS IS A SEPARATE FILE FROM ``test_origin_claim.py``
---------------------------------------------------------
``origin_claim_problems`` compares the period the prose NAMES with the period
that was collected. It is exact about *when* and says nothing about *what*, so
a sentence naming the right origin and hanging the wrong quantity on it passes
every check the pipeline has. Published 2026-08-30::

    "a cumulative change of -0.1 EUR per kWh, or 41.75%, since the series
     began in 2016-S1, where the starting value was 0.09 EUR per kWh"

Measured on the article's own cube, 37 observations from 2007-S2:

    since 2016-S1, the span it NAMES      +0.0438 EUR    +48.83%
    since 2022-S2, the streak's basis     -0.0957 EUR    -41.75%   exact

So the magnitude is genuine, belongs to a later span, and over the period the
sentence names the price ROSE by half again. All ten validator checks passed
and both figures trace — to two different facts.

WHAT MADE A CHECK POSSIBLE
--------------------------
``context._placement`` emits a count, a level at the origin and a previous
record. **It computes no change from the origin at all**, so there is no true
"change since the series began" for a writer to declare: stated truthfully the
number is not a signal field and ``no_invented_numbers`` already refuses it.
The rule is therefore not a guess about wording — it is the observation that
the fact does not exist.

AND WHY A CONTROL HERE PASSED FOR THE WRONG REASON
---------------------------------------------------
The first version of this check asked only whether the figure sat somewhere
before the origin phrase, and a control written as *"clearing the record by
0.3, the highest since the series began"* came back clean — which looked like
proof it did not fire on true prose. It was luck: ``_NAMES_THE_ORIGIN`` matched
at the word **record**, not at **series**, which put the figure outside the
span. Rewritten as *"clearing the previous high by 0.3"* the same sentence
fired. Both spellings are pinned below, so the accident cannot come back as
evidence.
"""

from __future__ import annotations

import copy
import logging

import pytest

from newsroom.pipeline.context import build_context
from newsroom.pipeline.detect.detectors import detect_streak
from newsroom.pipeline.field_meanings import FIELD_MEANINGS
from newsroom.pipeline.house_style import (
    _CLAIMS_A_RECORD,
    _SPAN_CHANGE_FIELDS,
    _SUPERLATIVE,
    _SUPERLATIVE_WORDS,
    apply_house_style,
    origin_claim_problems,
    origin_delta_problems,
)
from newsroom.pipeline.write import StubWriter, generate_article
from newsroom.tests.pipeline.conftest import make_signal, series_from
from newsroom.tests.pipeline.test_generation import GOOD_PAYLOAD

logging.disable(logging.CRITICAL)

#: Origin 2020-01 at 1.0, latest 2020-08 at 8.0 — so the true change since the
#: origin is +7.0, and every figure used below is something else.
VALUES = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]

MARGIN = {"value": 0.3, "signal_field": "margin", "unit": "pp", "rendered_as": "0.3"}
LATEST = {"value": 6.8, "signal_field": "latest_value", "unit": "%", "rendered_as": "6.8%"}
PREVIOUS = {
    "value": 6.5,
    "signal_field": "previous_record_value",
    "unit": "%",
    "rendered_as": "6.5%",
}


def _article(text: str, figures: list[dict], *, origin=...):
    """A real generated article, so the fact travels the path it really takes.

    Built through ``build_context`` and ``generate_article`` rather than by
    hand, for the reason ``test_origin_claim.py`` gives: the question is whether
    the collected origin reaches the artefact, and a hand-made provenance would
    assume the answer.
    """
    series = series_from(VALUES) if origin is ... else series_from(VALUES, origin=origin)
    pack = build_context(make_signal(), [series])
    payload = copy.deepcopy(GOOD_PAYLOAD)
    payload["blocks"][0]["text"] = text
    payload["blocks"][0]["figures"] = figures
    return generate_article(make_signal(), StubWriter(payload), pack=pack).article


class TestTheResidualCaseIsCaught:
    """The whole reason this exists: the period is RIGHT and the number is not."""

    def test_a_foreign_delta_hung_on_the_correct_origin_is_flagged(self):
        problems = origin_delta_problems(
            _article("The rate has moved 0.3 since the series began in 2020-01.", [MARGIN])
        )

        assert problems
        assert "margin" in problems[0]
        assert "previous_record_value" in problems[0]

    def test_the_published_sentence_transposed_onto_this_fixture(self):
        problems = origin_delta_problems(
            _article(
                "This decline represents a cumulative change of 0.3, since the "
                "series began in 2020-01, where the starting value was 6.5%.",
                [MARGIN, PREVIOUS],
            )
        )

        assert problems

    def test_the_period_check_does_not_see_it(self):
        """The companion that makes this file non-redundant.

        If ``origin_claim_problems`` caught this, the right change would have
        been to delete this module rather than to add it.
        """
        article = _article(
            "The rate has moved 0.3 since the series began in 2020-01.", [MARGIN]
        )

        assert origin_claim_problems(article) == []
        assert origin_delta_problems(article)

    def test_nor_does_the_validator(self):
        """Ten checks, all green, on the sentence this file is about.

        Recorded rather than asserted as a defect: the figure IS traceable and
        IS declared, so the numeric contract is behaving exactly as designed.
        What it cannot see is the basis, and that is why the remedy is here.
        """
        payload = copy.deepcopy(GOOD_PAYLOAD)
        payload["blocks"][0]["text"] = (
            "The rate has moved 0.3 since the series began in 2020-01."
        )
        payload["blocks"][0]["figures"] = [MARGIN]
        pack = build_context(make_signal(), [series_from(VALUES)])

        result = generate_article(make_signal(), StubWriter(payload), pack=pack)

        assert result.verdict.passed
        assert [c.name for c in result.verdict.checks if not c.passed] == []


class TestTrueProseIsLeftAlone:
    """The half that matters more. A gate firing on a true sentence is worse
    than the fault it was built to catch, because the next person turns it off.
    """

    def test_a_superlative_bounded_by_the_origin_is_not_a_change_claim(self):
        """"an all-time high since the series began" — the ``since`` governs the
        record claim, and ``record_claim_problems`` already owns that sentence.

        Phrased with *all-time high* rather than *the highest*, deliberately.
        With a superlative noun in it the sentence is already refused by the
        span rule below, so it could not tell whether ``_CLAIMS_A_RECORD`` was
        doing anything — a plant removing that abstention stayed green until
        this fixture was rewritten.
        """
        assert (
            origin_delta_problems(
                _article(
                    "The rate moved 0.3 to an all-time high since the series "
                    "began in 2020-01.",
                    [MARGIN],
                )
            )
            == []
        )

    @pytest.mark.parametrize(
        "text",
        [
            "The rate reached 6.8%, clearing the previous high by 0.3, the "
            "highest since the series began in 2020-01.",
            "The rate cleared its old peak by 0.3 and is the highest since the "
            "series began in 2020-01.",
        ],
    )
    def test_a_superlative_standing_between_the_figure_and_the_origin(self, text: str):
        """MUTATION THIS CATCHES: asking only whether the figure sits somewhere
        before the origin phrase. Both of these fired under that version, and
        both are true sentences."""
        assert origin_delta_problems(_article(text, [MARGIN, LATEST])) == []

    def test_the_spelling_that_made_the_first_control_pass_by_accident(self):
        """Kept beside its sibling deliberately.

        Written with *record* rather than *previous high*,
        ``_NAMES_THE_ORIGIN`` matches at "record" instead of "series", so the
        figure falls outside the span and the sentence is clean for a reason
        that has nothing to do with the rule. It must stay clean — but on its
        own it proves nothing, which is why the two above exist.
        """
        assert (
            origin_delta_problems(
                _article(
                    "The rate reached 6.8%, clearing the record by 0.3, the "
                    "highest since the series began in 2020-01.",
                    [MARGIN, LATEST],
                )
            )
            == []
        )

    def test_a_change_stated_after_the_origin_clause(self):
        """A separate assertion, not an attribution.

        Worded without the noun *record*, deliberately. That word is itself in
        the superlative vocabulary, so "moved 0.3 from its previous record"
        was refused by the span rule whatever the position logic did — a plant
        widening the span to the whole sentence stayed green until this fixture
        stopped supplying a second reason to abstain.
        """
        assert (
            origin_delta_problems(
                _article(
                    "The series began in 2020-01, and the rate has since moved 0.3.",
                    [MARGIN],
                )
            )
            == []
        )

    def test_a_level_at_the_origin_is_exactly_what_the_pipeline_supplies(self):
        """``series_start_value`` IS a fact about the origin. The corpus carries
        this shape twice — "which began in August 2021, when food inflation was
        at 2.1%" — and both are sound."""
        assert (
            origin_delta_problems(
                _article(
                    "This is the lowest reading anywhere in the series, which "
                    "began in 2020-01, when the rate was 6.5%.",
                    [PREVIOUS],
                )
            )
            == []
        )

    def test_a_change_with_no_origin_claim_at_all(self):
        assert (
            origin_delta_problems(
                _article("The rate moved 0.3 from the previous record of 6.5%.", [MARGIN])
            )
            == []
        )

    def test_a_run_as_long_as_the_series_abstains_without_any_guard(self):
        """The one true "change since the series began" that can exist — and it
        needs no code, which was measured rather than assumed.

        An explicit guard comparing ``streak_length`` with
        ``readings_in_series`` was written first and turned out to target an
        unreachable state: ``_without_collisions`` drops a context fact whose
        value a signal field already justifies, and a run spanning the series
        means ``streak_start_value == series_start_value``. So the origin fact
        is dropped, ``_recorded_origin`` answers ``None``, and the check
        abstains before it reads a word of prose.

        Detected rather than posited: a rising series really does produce a
        streak whose start is the series' own first reading.
        """
        rising = series_from([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 9.5])
        signal = detect_streak(rising)

        assert signal is not None
        assert signal.fields["streak_start_value"] == rising.origin.first_value
        assert [f.field for f in build_context(signal, [rising]).facts] == []

    def test_the_control_a_shorter_run_keeps_series_facts(self):
        """The companion. Without it, "the pack is empty" is a claim about the
        fixture rather than about the run — an empty reading from an instrument
        never shown to report anything.
        """
        mixed = series_from([1.0, 0.5, 3.0, 4.0, 5.0, 6.0, 7.0, 9.5])
        signal = detect_streak(mixed)

        assert signal is not None
        assert signal.fields["streak_start_value"] != mixed.origin.first_value
        assert [f.field for f in build_context(signal, [mixed]).facts] != []


class TestItAbstainsRatherThanGuessing:
    def test_no_recorded_origin_means_no_verdict(self):
        """Elering is a rolling 120 days with no cheap full history."""
        assert (
            origin_delta_problems(
                _article(
                    "The rate has moved 0.3 since the series began in 2020-01.",
                    [MARGIN],
                    origin=None,
                )
            )
            == []
        )

    def test_and_the_same_sentence_is_caught_when_a_fact_exists(self):
        """The companion required by the absence rule: an assertion that
        something is absent needs a proof it could have been present."""
        assert origin_delta_problems(
            _article("The rate has moved 0.3 since the series began in 2020-01.", [MARGIN])
        )


class TestItIsWiredIn:
    """A check nothing calls is a comment."""

    def test_apply_house_style_reports_it(self):
        report = apply_house_style(
            _article("The rate has moved 0.3 since the series began in 2020-01.", [MARGIN])
        )

        assert [v for v in report.violations if "where the series begins" in v]

    def test_correct_copy_raises_no_delta_violation(self):
        report = apply_house_style(
            _article("The rate moved 0.3 from the previous record of 6.5%.", [MARGIN])
        )

        assert [v for v in report.violations if "where the series begins" in v] == []


#: Every ``(detector, field)`` in ``FIELD_MEANINGS`` that is deliberately NOT a
#: span change, with why. Written out rather than defaulted, so a field added to
#: the registry fails the test below until somebody judges it — the enumeration
#: is the check.
NOT_A_SPAN_CHANGE: dict[str, str] = {
    # readings, not distances
    "latest_value": "a level",
    "previous_record_value": "a level",
    "streak_start_value": "a level",
    "previous_value": "a level",
    "threshold_value": "a level we chose",
    "seasonal_mean": "an average level",
    "highest_value": "one country's level",
    "lowest_value": "one country's level",
    "typical_move": "a yardstick, not a move that happened",
    "typical_spread": "a historical norm",
    # counts
    "observation_count": "a count",
    "streak_length": "a count",
    "periods_compared": "a count",
    "baseline_years": "a count",
    "window_periods": "a count",
    "sustained_periods": "a count",
    # ratios, which name no span
    "move_vs_typical": "a ratio",
    "spread_vs_typical": "a ratio",
    "widening_ratio": "a ratio",
    # distances measured from something other than an earlier period, so none
    # of them can be read as "the change since X"
    "distance_from_threshold": "measured from a line we chose, not from a period",
    "deviation": "measured from a multi-year average, not from a period",
    "deviation_pct": "measured from a multi-year average, not from a period",
    "spread": "measured between two countries, not across time",
    "spread_pct": "measured between two countries, not across time",
    "latest_gap": "measured between two countries, not across time",
    "early_gap": "measured between two countries, not across time",
    "recent_gap": "measured between two countries, not across time",
    "gap_pct": "measured between two countries, not across time",
}


class TestTheFieldRegistryIsFullyJudged:
    """``AGENTS.md``: write down the set the guard walks and the set the
    behaviour walks, and require them to match. Two enumerations always drift;
    an equality cannot."""

    def test_every_declared_field_is_classified_one_way_or_the_other(self):
        declared = {field for fields in FIELD_MEANINGS.values() for field in fields}
        judged = set(_SPAN_CHANGE_FIELDS) | set(NOT_A_SPAN_CHANGE)

        assert declared - judged == set(), (
            "a field was added to FIELD_MEANINGS without deciding whether a "
            "sentence could attribute it to the series origin"
        )

    def test_nothing_is_classified_twice(self):
        assert set(_SPAN_CHANGE_FIELDS) & set(NOT_A_SPAN_CHANGE) == set()

    def test_the_lists_name_nothing_the_registry_does_not(self):
        """The other direction. A name here that no detector emits is a rule
        guarding a field that does not exist."""
        declared = {field for fields in FIELD_MEANINGS.values() for field in fields}

        assert set(_SPAN_CHANGE_FIELDS) - declared == set()
        assert set(NOT_A_SPAN_CHANGE) - declared == set()

    def test_each_span_change_names_where_its_span_starts(self):
        """The message tells a writer where the number really came from, and it
        can only do that if the basis field is itself real."""
        declared = {field for fields in FIELD_MEANINGS.values() for field in fields}

        for field, measured_from in _SPAN_CHANGE_FIELDS.items():
            assert measured_from in declared, f"{field} points at {measured_from}"


class TestThereIsOneSuperlativeVocabulary:
    """Two checks need to agree about what a superlative is.

    ``record_claim_problems`` uses ``_CLAIMS_A_RECORD`` to find a record claim;
    ``origin_delta_problems`` uses ``_SUPERLATIVE`` to notice that an origin
    phrase is bounding one rather than a figure. A second hand-written list
    would be a second implementation that can disagree — the failure this repo
    keeps finding — so both are built from ``_SUPERLATIVE_WORDS``.
    """

    def test_both_patterns_are_built_from_the_same_words(self):
        assert _SUPERLATIVE_WORDS in _CLAIMS_A_RECORD.pattern
        assert _SUPERLATIVE_WORDS in _SUPERLATIVE.pattern

    def test_every_word_in_the_vocabulary_is_matched_by_the_span_pattern(self):
        for word in _SUPERLATIVE_WORDS.split("|"):
            assert _SUPERLATIVE.search(f"the {word} reading"), word

    def test_it_does_not_match_an_ordinary_word(self):
        """The companion. A pattern that matches everything would abstain on
        every sentence and report a clean corpus."""
        for word in ("moved", "rate", "since", "series"):
            assert _SUPERLATIVE.search(f"the {word} reading") is None, word
