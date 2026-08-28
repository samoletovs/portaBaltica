"""The published policy and the pipeline must not drift apart.

``newsroom/policy/ai-use.md`` is rendered at /about/ai, so its sentences are
promises a reader can hold us to rather than internal documentation. Two of them
are new and are enforced by code in this package:

  "Before asking whether a movement is interesting, the pipeline asks whether it
   is measurable, and drops it if it is not."

  "Every run, the pipeline re-reads the series behind every figure it has
   published and compares them against the reading it published on."

A promise with nothing asserting it is how the desk's revise verdict came to
hold six articles and rewrite none. These tests fail if the promise is made and
not kept, and — equally — if the capability is removed while the promise stays
on the page.
"""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from newsroom.pipeline.config import NEWSROOM_DIR

POLICY = NEWSROOM_DIR / "policy" / "ai-use.md"


@pytest.fixture(scope="module")
def policy_text() -> str:
    """The policy with line wrapping normalised away.

    The file is hard-wrapped at 80 columns, so any sentence long enough to be
    worth asserting on is split by a newline. Matching against the raw text
    would make these tests fail whenever someone reflowed a paragraph, which
    trains people to weaken the assertion rather than fix the policy.
    """
    import re

    return re.sub(r"\s+", " ", POLICY.read_text(encoding="utf-8"))


class TestTheMeasurabilityPromise:
    def test_the_policy_makes_it(self, policy_text: str) -> None:
        assert "measurable" in policy_text, (
            "the measurement floor is a reader-visible editorial commitment and "
            "must be stated in the published policy, not only implemented"
        )

    def test_the_pipeline_keeps_it(self) -> None:
        from newsroom.pipeline import run as run_module

        source = inspect.getsource(run_module.run_once)
        detect_at = source.find("detect_all(")
        gate_at = source.find("gate(")
        rank_at = source.find("rank(")

        assert gate_at != -1, "run_once no longer applies the measurement floor"
        assert detect_at < gate_at < rank_at, (
            "the floor must be applied after detection and before ranking; "
            "ranking a sub-resolution finding lets a quiet day promote it"
        )

    def test_the_survey_series_named_in_the_policy_have_floors(self, policy_text: str) -> None:
        from newsroom.pipeline.significance import SURVEY_FLOORS

        assert "unemployment rate comes" in policy_text
        assert "unemployment_rate" in SURVEY_FLOORS, (
            "the policy tells readers the unemployment rate is sample-based and "
            "gated accordingly; no floor is registered for it"
        )
        assert "economic_sentiment" in SURVEY_FLOORS

    def test_every_declared_floor_names_a_series_we_actually_collect(self) -> None:
        from newsroom.pipeline.collect import opendata
        from newsroom.pipeline.significance import SURVEY_FLOORS

        collected = inspect.getsource(opendata)
        for metric in SURVEY_FLOORS:
            assert f'metric="{metric}"' in collected, (
                f"{metric} has a measurement floor but is never collected; a floor "
                f"for a series that does not exist reads like coverage that is in place"
            )


class TestTheRevisionPromise:
    def test_the_policy_makes_it(self, policy_text: str) -> None:
        assert "re-reads the series" in policy_text
        assert "restatement by the source from an error by us" in policy_text, (
            "the policy must distinguish a source revision from our own mistake; "
            "conflating them trains readers to discount both"
        )

    def test_the_policy_promises_the_text_is_left_alone(self, policy_text: str) -> None:
        assert "text is left alone" in policy_text

    def test_the_correction_wording_honours_that_distinction(self) -> None:
        from newsroom.pipeline.detect.series import Observation, TimeSeries
        from newsroom.pipeline.models import SourceRef
        from newsroom.pipeline.revisions import find_revisions
        from newsroom.pipeline.vintage import PublishedFigure, VintageLedger

        ledger = VintageLedger(
            [
                PublishedFigure(
                    metric="unemployment_rate",
                    metric_label="unemployment rate",
                    geography="EE",
                    period="2026-06",
                    value=6.6,
                    unit="%",
                    slug="s",
                    article_id="1",
                    headline="h",
                    observed_at="2026-08-24T10:00:00Z",
                    published_at="2026-08-24T12:00:00Z",
                )
            ]
        )
        series = TimeSeries(
            metric="unemployment_rate",
            metric_label="unemployment rate",
            geography="EE",
            unit="%",
            section="labour",
            observations=(Observation(period="2026-06", value=7.4),),
            source=SourceRef(source_id="eurostat", retrieved_at="2026-09-24T10:00:00Z"),
        )

        description = find_revisions(ledger, [series])[0].description()

        assert "not a reporting error" in description
        assert "text is unchanged" in description

    def test_the_policy_refuses_deletion_on_request(self, policy_text: str) -> None:
        # The failure this guards against is documented: an AI-run outlet
        # deleting accurate stories when their subjects asked. A published
        # refusal is the cheapest thing that makes the next such request awkward.
        assert "never deleted to resolve a complaint" in policy_text

    def test_correcting_an_article_cannot_unpublish_it(self) -> None:
        from newsroom.pipeline.revisions import annotate

        source = inspect.getsource(annotate)

        assert '"status"' not in source.split('"""')[-1], (
            "annotate() touches status; both is_servable and the frontend require "
            '"published", so setting "corrected" would delete the article from the '
            "site at the moment it was corrected"
        )


class TestTheHypothesisPromise:
    """The newest promise, and the one with the most to lose if it drifts.

    The policy now tells readers that a suggested cause is always attributed,
    always marked unconfirmed, and never carries a figure. That is the whole
    licence for a model to use knowledge of its own on this site, and it is
    worth exactly as much as the code behind it.
    """

    def test_the_policy_discloses_that_a_model_uses_its_own_knowledge(
        self, policy_text: str
    ) -> None:
        assert "knowledge of its own" in policy_text, (
            "the causal panel is the single point where anything here draws on "
            "something other than a retrieved figure; a site whose proposition "
            "is precise disclosure has to say so"
        )

    def test_the_policy_promises_attribution_and_a_hedge(self, policy_text: str) -> None:
        assert "It is attributed." in policy_text
        assert "It is marked unconfirmed." in policy_text
        assert "It carries no figure." in policy_text

    def test_the_validator_keeps_the_attribution_and_hedge_promise(self) -> None:
        from newsroom.validator import check_no_unsupported_mechanism

        source = inspect.getsource(check_no_unsupported_mechanism)
        speaks_at = source.find("_speaks_for_the_newsroom(")
        general_at = source.find("_ATTRIBUTED_TO_A_SOURCE.search(")

        assert speaks_at != -1, "the desk-hypothesis branch is gone from the gate"
        assert general_at != -1
        assert speaks_at < general_at, (
            "the policy promises our own analysts are held to a STRICTER rule than "
            "an outside institution. _ATTRIBUTED_TO_A_SOURCE matches any sentence "
            "containing 'says', so if it is tested first the hedge requirement is "
            "a branch nothing reaches and the promise is unkept"
        )

    def test_the_panel_keeps_the_no_figure_promise(self) -> None:
        from newsroom.pipeline.hypothesis import LENSES, _admissible

        kept, discarded = _admissible(
            [{"claim": "Housing costs rose 12% and deterred families",
              "basis": "domain_knowledge"}],
            LENSES["demography"],
            None,
        )

        assert kept == [] and discarded, (
            "the policy tells readers a hypothesis carrying a number is deleted "
            "before the correspondent sees it"
        )

    def test_the_panel_is_separately_consulted_as_the_policy_says(
        self, policy_text: str
    ) -> None:
        """The claim that a convergence means something rests on this.

        "consulted separately rather than together, so where two of them
        independently land on the same explanation, that is worth something" is
        only true if they are separate model calls. One call asking for several
        views produces one view wearing several hats, and the corroboration we
        would then print to a reader would be an artefact of ordering.
        """
        from newsroom.pipeline.hypothesis import consult_panel

        assert "consulted separately" in policy_text
        source = inspect.getsource(consult_panel)
        assert "for lens in lenses:" in source
        assert source.count("writer.complete_json(") == 1, (
            "one call site inside the per-lens loop is what makes the calls "
            "independent; a single call outside it would make the policy false"
        )
