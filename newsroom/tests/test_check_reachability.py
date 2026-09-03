"""Every check is reached on the production path, and the quiet ones say why.

THE QUESTION
------------
Six checks had never fired in production, and "never fired" is two states
wearing one artefact: a check that cannot be reached, and a check that is
reached and has had nothing to catch. The first is a defect; the second is a
gate doing its job on a quiet wire.

Measured over the recorded window — 22 dated run reports, of which 5 carry a
``rejections`` breakdown, deduped on each report's own ``finished_at`` — the
answer is that **none of the eleven is unreachable**:

* ``validate_article`` iterates all of ``CHECK_NAMES`` with no short-circuit,
  appending a result for every one and turning an exception into a failed
  check rather than a lost one;
* both production paths validate — ``write/generator.py`` for tier A and
  ``pipeline/syndicate.py`` for tier B/C — so every check is executed against
  every article of both kinds.

WHAT THIS FILE ASSERTS, AND WHY IT IS NOT JUST PROSE
-----------------------------------------------------
Three of the quiet checks are quiet **by construction**: they guard fields our
own code assembles, so no model output can trip them. That is correct, and it
is indistinguishable from a broken check until the reason is written down —
which is what the docstrings on those checks now do.

A docstring is a claim about behaviour, so each claim is executed here rather
than asserted. If ``render_byline`` starts consulting the model, or the writer
prompt grows a byline slot, or ``build_card`` stops copying the registry's
attribution, the claim becomes false and this fails — instead of sitting in a
docstring being quietly wrong, which is the failure this repository keeps
finding in its own prose.
"""

from __future__ import annotations

import inspect

from newsroom import validator
from newsroom.pipeline import safety, syndicate
from newsroom.pipeline.write import generator, prompts
from newsroom.persona_rules import PersonaRegistry


class TestEveryCheckIsReached:
    """Reachability, asserted structurally rather than by reading the loop."""

    def test_validate_article_runs_every_registered_check(self) -> None:
        """No short-circuit: a verdict carries one result per check, always.

        Asserted on a deliberately BROKEN article, because a clean one would
        pass every check and could not distinguish "all ran" from "all
        trivially satisfied".
        """
        article = {
            "tier": "A",
            "slug": "s",
            "status": "published",
            "headline": "A headline that is long enough to be a headline",
            "dek": "A dek.",
            "body": [{"type": "paragraph", "text": "Prose.", "figures": []}],
        }
        verdict = validator.validate_article(
            article,
            signal={},
            registry=safety.registry(),
            personas=safety.personas(),
        )

        assert [c.name for c in verdict.checks] == list(validator.CHECK_NAMES)
        assert not verdict.passed, "the fixture must be able to fail, or this proves nothing"

    def test_both_production_paths_validate(self) -> None:
        """Tier A and tier B/C each reach the validator.

        A check unreachable on one path is unreachable for that whole tier, and
        three of these checks only ever apply to syndicated material.
        """
        assert "validate(" in inspect.getsource(generator.generate_article)
        assert "validate(" in inspect.getsource(syndicate.syndicate)


class TestTheQuietChecksGuardOurCodeNotTheModel:
    """The bucket that pays off: reachable, and untrippable by model output.

    Each assertion is the executable form of a claim made in the check's own
    docstring.
    """

    def test_the_model_is_never_asked_for_a_byline(self) -> None:
        """`byline_discloses_ai` cannot be tripped by anything the writer says.

        The prompt offers no byline slot, so there is nothing for a model to
        get wrong. Controlled with a word the prompt certainly does contain.
        """
        prompt = (prompts._SYSTEM_TEMPLATE + prompts._USER_TEMPLATE).lower()

        assert "figures" in prompt, "control: the probe can find a word that is there"
        assert "byline" not in prompt

    def test_the_byline_comes_from_the_persona_registry(self) -> None:
        """And every registered persona discloses, so the field is safe at rest."""
        source = inspect.getsource(safety.render_byline)

        assert "persona.byline" in source

        registry = PersonaRegistry.load()

        assert registry.ids(), "an empty registry would satisfy the loop vacuously"
        for persona_id in registry.ids():
            assert "AI correspondent" in registry.get(persona_id).byline

    def test_the_card_copies_attribution_from_the_registry(self) -> None:
        """`attribution_present` guards `build_card`, not a model."""
        source = inspect.getsource(syndicate.build_card)

        assert '"attribution": source.attribution' in source

    def test_the_card_copies_the_snippet_rather_than_writing_one(self) -> None:
        """`snippet_verbatim` guards the collect -> archive -> syndicate copy."""
        source = inspect.getsource(syndicate.build_card)

        assert 'syndicated["snippet"] = item.description' in source


class TestTheRunReportSeesOnlyTierA:
    """Why one quiet check's record is UNMEASURED rather than clean.

    This is the one finding in the sweep, and it is deliberately asserted as
    the current behaviour rather than fixed here: changing what the run report
    carries changes a publicly readable artefact, which is a publication
    decision rather than an engineering one.

    The point of pinning it is that ``snippet_verbatim``'s zero must not be
    read as evidence about the wire while this holds.
    """

    def test_rejected_walks_tier_a_only(self) -> None:
        from newsroom.pipeline import run

        source = inspect.getsource(run.RunReport.rejected.fget)

        assert "self.generated" in source
        assert "self.syndicated" not in source

    def test_published_walks_both_which_is_the_contrast(self) -> None:
        """The correct sibling, two lines above, fixed in #39 for this reason.

        Without this the assertion above reads as a description of the file
        rather than as an asymmetry anybody chose.
        """
        from newsroom.pipeline import run

        source = inspect.getsource(run.RunReport.published.fget)

        assert "self.generated" in source
        assert "self.syndicated" in source

    def test_a_failed_card_is_marked_and_logged_but_not_reported(self) -> None:
        source = inspect.getsource(syndicate.syndicate)

        assert 'card.status = "rejected"' in source
        assert "log.warning" in source
