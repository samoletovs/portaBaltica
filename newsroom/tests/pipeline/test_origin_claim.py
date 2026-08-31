"""A prose origin claim, checked against the origin that was collected.

WHAT `#280` MADE POSSIBLE
------------------------
The collector now records the true series origin before the window is applied,
so ``series_start_value`` carries the real first period. A sentence saying
"since the series began in 2016-Q3" can be compared with the article's own
recorded fact — deterministically, offline, at publish time.

It is the only number in an article nothing else could check. ``numeric_scan``
ignores a bare four-digit year by design, so a wrong origin year binds to no
figure, traces to no signal field, and passes every numeric gate.

THE TRAP, WHICH IS WHY THIS CANNOT SWEEP THE ARCHIVE
----------------------------------------------------
Before ``c5afdd0`` the field recorded the collector's *window* boundary, which
is the number the writer copied into the prose. An older article therefore
agrees with the fact that produced it. Measured over the published corpus on
2026-08-31: **7 of 7 prose origin claims agree with their own recorded fact**,
including one whose series demonstrably begins twelve years earlier than the
article says. A self-consistent artefact is not evidence, and that 7-of-7 is
the trap rather than a clean bill of health.

What makes it safe is the producer, not a version check: ``series_context``
emits no ``series_start_value`` when ``series.origin`` is absent, so on current
code presence implies a real origin.
"""

from __future__ import annotations

import copy
import logging

import pytest

from newsroom.pipeline.context import build_context
from newsroom.pipeline.house_style import apply_house_style, origin_claim_problems
from newsroom.pipeline.write import StubWriter, generate_article
from newsroom.tests.pipeline.conftest import make_signal, series_from
from newsroom.tests.pipeline.test_generation import GOOD_PAYLOAD

logging.disable(logging.CRITICAL)

VALUES = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]


def _article(*, origin=...):
    """A real generated article, so the fact travels the path it really takes.

    Built through ``build_context`` and ``generate_article`` rather than by
    hand: the whole question is whether the collected origin reaches the
    artefact, and a hand-made provenance dict would assume the answer.
    """
    series = series_from(VALUES) if origin is ... else series_from(VALUES, origin=origin)
    pack = build_context(make_signal(), [series])
    result = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD), pack=pack)
    return result.article


def _with(text: str, *, origin=...):
    article = _article(origin=origin)
    article.body[0].text = text
    return article


class TestTheCollectedOriginReachesTheArtefact:
    """Without this the rest of the file passes vacuously."""

    def test_the_fact_is_recorded_with_its_period(self):
        facts = _article().provenance["context"]["facts"]
        start = [f for f in facts if f["field"] == "series_start_value"]

        assert start, "no series_start_value fact — the check below has nothing to read"
        assert start[0]["period"] == "2020-01"

    def test_no_fact_is_recorded_when_the_series_has_no_origin(self):
        """The companion. Absence must be absence, not a window in disguise.

        With no origin there are no series-scoped facts at all, so ``context``
        is not written to provenance — which is a stronger absence than an
        empty list and is why the check below has nothing to read.
        """
        context = _article(origin=None).provenance.get("context") or {}
        facts = context.get("facts") or []

        assert [f for f in facts if f["field"] == "series_start_value"] == []


class TestAWrongOriginIsCaught:
    def test_a_different_year_is_flagged(self):
        problems = origin_claim_problems(
            _with("The rate rose since the series began in 2016-Q3.")
        )

        assert problems
        assert "2016-Q3" in problems[0] and "2020-01" in problems[0]

    def test_a_bare_wrong_year_is_flagged(self):
        assert origin_claim_problems(_with("The rate rose since the series began in 2016."))

    def test_the_other_phrasings_of_the_same_claim(self):
        """Including the one this repo writes itself.

        ``revisions.py`` phrases its own correction notice "the series, which
        runs back to 2004" — so that shape is not hypothetical, it is the
        wording we publish when we retract one of these.
        """
        for text in (
            "The series began in 2016 and has risen since.",
            "The series, which began in 2016, has risen.",
            "The rate has risen since the series started in 2016.",
            "The rate rose across the series, which runs back to 2016.",
        ):
            assert origin_claim_problems(_with(text)), text


class TestCorrectProseIsLeftAlone:
    """The half that matters more: a gate firing on true prose is worse than
    the fault it was built to catch, because the next person turns it off."""

    def test_the_exact_period_passes(self):
        assert origin_claim_problems(
            _with("The rate rose, in the 8 observations since the series began in 2020-01.")
        ) == []

    def test_the_writers_spelling_of_the_same_period_passes(self):
        """"August 2021" and "2021-08" are one period written by a writer and
        by a collector. Rejecting the difference would fire on correct prose —
        and the corpus contains exactly this: "which began in August 2021"."""
        assert origin_claim_problems(
            _with("The rate rose since the series began in January 2020.")
        ) == []

    def test_a_coarser_but_true_period_passes(self):
        """"2020" for a series starting 2020-01 is less precise, not wrong."""
        assert origin_claim_problems(_with("The rate rose since the series began in 2020.")) == []

    def test_an_ordinary_comparison_basis_is_not_an_origin_claim(self):
        """"since 2016" says what a figure is measured against and asserts
        nothing about where the data starts. The validator governs it; this
        must not."""
        for text in (
            "Prices rose 12% since 2016.",
            "Prices are higher than in 2016.",
            "The reading is the highest since 2016.",
        ):
            assert origin_claim_problems(_with(text)) == [], text


class TestItAbstainsRatherThanGuessing:
    def test_no_recorded_origin_means_no_verdict(self):
        """Elering is a rolling 120 days with no cheap full history, so no
        origin is recorded. Measuring prose against a window wearing the
        series' name is the fault this whole change exists to remove."""
        assert origin_claim_problems(
            _with("The rate rose since the series began in 1066.", origin=None)
        ) == []

    def test_and_the_same_sentence_is_caught_when_a_fact_exists(self):
        """The companion required by the absence rule: an assertion that
        something is absent needs a proof it could have been present."""
        assert origin_claim_problems(_with("The rate rose since the series began in 1066."))


class TestItIsWiredIn:
    """A check nothing calls is a comment. `#151`'s legend and `#166`'s query
    strings were both live defects behind a rule that was never invoked."""

    def test_apply_house_style_reports_it(self):
        article = _with("The rate rose since the series began in 2016-Q3.")

        report = apply_house_style(article)

        assert [v for v in report.violations if "says the series begins" in v]

    def test_it_reaches_the_headline_and_the_dek(self):
        for field in ("headline", "dek"):
            article = _article()
            setattr(article, field, "Rates rise since the series began in 2016")

            report = apply_house_style(article)

            assert [v for v in report.violations if v.startswith(field)], field

    def test_correct_copy_raises_no_origin_violation(self):
        report = apply_house_style(_with("The rate rose since the series began in 2020-01."))

        assert [v for v in report.violations if "says the series begins" in v] == []


class TestThePromptTeachesWhatTheCheckEnforces:
    """An example in guidance is a claim about behaviour — execute it.

    And record which examples are *prophylactic*. Guidance may be stricter than
    the contract; what it may not do is be wrong about the contract. Two of the
    BAD examples below are not rejected by anything, deliberately, and saying
    so here is what stops a later reader "fixing" the check to match the prose.
    """

    @staticmethod
    def _flat():
        import re

        from newsroom.pipeline.write import prompts

        return re.sub(r"\s+", " ", prompts._SYSTEM_TEMPLATE)

    @pytest.mark.parametrize(
        "example",
        [
            "the lowest in the 60 observations since 2021-08",
            "the highest since the series began in 2014",
            "seven consecutive annual increases, the longest run since 2018",
        ],
    )
    def test_its_good_examples_are_not_flagged(self, example: str):
        from newsroom.pipeline.house_style import record_claim_problems

        assert example in self._flat(), f"the prompt no longer offers {example!r}"
        assert record_claim_problems(example, where="x") == [], example

    def test_the_run_rule_is_stated(self):
        flat = self._flat()

        assert "A RUN IS NOT THE SERIES" in flat
        assert "streak_length" in flat and "readings_in_series" in flat

    def test_it_does_not_claim_the_origin_is_unknown(self):
        """`#280` made that false. The pipeline knows where the series begins
        and tells the writer, so guidance saying otherwise would steer it away
        from the one construction that is both true and informative."""
        flat = self._flat().lower()

        assert "we do not know when the series began" not in flat
        assert "series_start_value" in flat

    def test_the_two_prophylactic_examples_are_not_enforced(self):
        """Recorded, not asserted as a defect.

        "the highest since the series began" is TRUE now that the origin is
        real — merely uninformative — so no check rejects it and none should:
        a validator firing on a true sentence is worse than the fault it was
        built to catch. The run example is the hole measured in this task:
        the run length is present in the artefact in 1 of 11 streak articles,
        so a check would abstain on the very shape it targets.
        """
        from newsroom.pipeline.house_style import record_claim_problems

        for prophylactic in (
            "the highest since the series began",
            "seven consecutive annual increases since the series began",
        ):
            assert prophylactic in self._flat()
            assert record_claim_problems(prophylactic, where="x") == [], (
                f"{prophylactic!r} is now enforced by a check. That may be an "
                f"improvement, but this test records that it was NOT, so the "
                f"reasoning above needs revisiting rather than the assertion."
            )
