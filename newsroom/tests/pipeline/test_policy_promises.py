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
        assert "raw source observations" in policy_text
        assert "2,000-row ledger" in policy_text
        assert "without a raw-observation marker" in policy_text
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

        # The damage is worse than "it disappears", and the three gates do not
        # agree, so state what each actually does rather than summarising them
        # as one. Measured on master 2026-08-31:
        #
        #   publish.is_servable        status == "published"          REFUSES
        #   news-types.ts isServable   status === 'published'         REFUSES
        #   news-api.ts SHOWABLE_...   ['published', 'corrected']     ADMITS
        #
        # So a "corrected" article stays linked from the front page and is then
        # refused by the renderer with "It has not passed the checks we run
        # before publishing" -- a false accusation against a piece whose only
        # sin was being corrected. Silence would be kinder than that, and both
        # are worse than showing it.
        assert '"status"' not in source.split('"""')[-1], (
            "annotate() touches status; is_servable and the frontend renderer "
            'both require "published", while the frontend feed admits '
            '"corrected" -- so setting it would leave the article linked on the '
            "front page and tell readers it failed our checks, which is false"
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

    def test_the_policy_promises_attribution_a_hedge_and_no_figure(
        self, policy_text: str
    ) -> None:
        assert "It is attributed." in policy_text
        assert "It is disclosed as AI." in policy_text
        assert "It is marked unconfirmed." in policy_text
        assert "It carries no figure." in policy_text

    def test_the_policy_promises_no_invented_person(self, policy_text: str) -> None:
        assert "no invented person appears anywhere on this site" in policy_text
        assert "never a person with a surname or a doctorate" in policy_text

    def test_the_policy_admits_the_one_article_that_breaks_the_rule(
        self, policy_text: str
    ) -> None:
        """A rule stated as though it had never been broken is a second untruth.

        The sentence above is written in the present tense and tells a reader
        that a personal name in an article "belongs to a real person". For one
        published article that is false, and the reader most likely to check is
        the one it misleads.
        """
        assert "carries a correction saying so" in policy_text
        assert "Dr. Ineta Zvirbule" in policy_text
        assert "we do not quietly edit our archive" in policy_text

    def test_the_admission_is_backed_by_an_actual_correction(self) -> None:
        """The two must not drift apart in either direction.

        A policy admitting a fault with no correction filed is an apology with
        no artefact; a correction with no admission leaves the rule above
        reading as absolute. Both are checked from ``PENDING`` rather than from
        the prose, so the correction is the thing that has to exist.
        """
        from newsroom.pipeline.corrections import PENDING

        assert PENDING, (
            "the policy admits an article breaks the no-invented-person rule "
            "and no correction is declared for it"
        )
        assert any("Dr. Ineta Zvirbule" in c.description for c in PENDING)

    def test_the_correction_says_the_prose_was_left_alone(
        self, policy_text: str
    ) -> None:
        """The policy and the note must agree about what was done to the page.

        The policy says the paragraph is still there unedited. If the note ever
        said otherwise — or a later change started rewriting prose — a reader
        comparing the two would catch us before any test did.
        """
        from newsroom.pipeline.corrections import PENDING

        assert "still there, unedited" in policy_text
        assert any("left exactly as published" in c.description for c in PENDING)

    def test_the_panel_keeps_the_no_invented_person_promise(self) -> None:
        """The promise is kept by there being nobody to invent, not by a rule.

        Enumerated from ``LENSES`` rather than from a list written here, so a
        sixth analyst added tomorrow is covered on the day it is added.
        """
        from newsroom.pipeline.hypothesis import AI_DISCLOSURE, LENSES

        for lens in LENSES.values():
            assert AI_DISCLOSURE in lens.title, f"{lens.id} does not disclose itself"
            assert lens.title.startswith("the newsroom's "), (
                f"{lens.id} is titled {lens.title!r} — a name with no owner reads "
                f"as an outside expert"
            )

    def test_the_validator_keeps_the_no_invented_expert_promise(self) -> None:
        """The published sentence, refused by the gate the policy points at."""
        from newsroom.pipeline.safety import personas, registry
        from newsroom.validator import (
            ValidationContext,
            check_no_unsupported_mechanism,
        )

        article = {
            "body": [
                {
                    "type": "paragraph",
                    "text": (
                        "Dr. Ineta Zvirbule suggests this is a likely explanation, "
                        "but the data cannot confirm it."
                    ),
                }
            ],
            "provenance": {},
        }
        verdict = check_no_unsupported_mechanism(
            ValidationContext(
                article=article, registry=registry(), personas=personas()
            )
        )

        assert not verdict.passed
        assert "Dr. Ineta" in verdict.detail

    def test_the_validator_keeps_the_attribution_and_hedge_promise(self) -> None:
        from newsroom.pipeline.safety import personas, registry
        from newsroom.validator import ValidationContext, check_no_unsupported_mechanism

        for disclosure, hedge, expected in (
            ("AI ", "", False), ("", "may be ", False), ("AI ", "may be ", True),
        ):
            candidate = {
                "body": [{"type": "paragraph", "text":
                    f"The newsroom's {disclosure}economist says the rise {hedge}driven by demand."
                }],
                "provenance": {},
            }
            verdict = check_no_unsupported_mechanism(ValidationContext(
                article=candidate, registry=registry(), personas=personas(),
            ))
            assert verdict.passed is expected

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

    def test_the_policy_states_the_panel_size_the_code_uses(
        self, policy_text: str
    ) -> None:
        """The policy says "three AI analysts", which is a fact about a constant.

        A number in published prose is exactly the kind of claim that goes stale
        silently: change ``PANEL_SIZE`` and the page keeps telling readers the
        old figure, on a site whose whole argument is that its numbers are
        checkable.
        """
        from newsroom.pipeline.hypothesis import PANEL_SIZE

        words = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five"}
        assert f"{words[PANEL_SIZE]} AI analysts are consulted separately" in policy_text, (
            f"PANEL_SIZE is {PANEL_SIZE}; the published policy names a different number"
        )

    def test_every_analyst_a_reader_can_see_is_named_on_the_policy_page(
        self, policy_text: str
    ) -> None:
        """The policy enumerates the analysts, so the two lists must agree.

        Checked against ``title``, not ``discipline``: the title is the string
        that reaches an article, and ``discipline`` is internal to the prompt.
        Comparing the wrong one asserts a relationship between the policy and a
        string no reader ever sees.

        Enumerated from ``LENSES`` rather than from the sentence, which is the
        direction that catches an analyst added to the code and never disclosed
        — the failure that matters. The reverse would only catch a stale page.
        """
        from newsroom.pipeline.hypothesis import LENSES

        prefix = "the newsroom's AI "
        undisclosed = [
            lens.title
            for lens in LENSES.values()
            if lens.title.removeprefix(prefix) not in policy_text
        ]
        assert not undisclosed, (
            f"these analysts can reach an article and are not named on the "
            f"published policy page: {undisclosed}"
        )
