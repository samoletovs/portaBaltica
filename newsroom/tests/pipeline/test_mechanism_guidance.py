"""Drafting and copy-editing guidance must agree with the assertion-level gate.

The September 7 edition rejected all eight originals. The older prompt taught
paragraph-level grounding even after the validator began checking each sentence
and clause. Execute the shared examples rather than preserving that old wording.

This is `a word list encodes your examples` arriving from the writer's side
rather than the checker's, and the fix is the same: describe the property.
"""

from __future__ import annotations

import re

import pytest

from newsroom.pipeline.safety import persona_for_section, personas, registry
from newsroom.pipeline.write import prompts
from newsroom.tests.pipeline.conftest import make_signal
from newsroom.validator import ValidationContext, check_no_unsupported_mechanism


def revision_note() -> str:
    return prompts.build_revision_prompt(
        "ORIGINAL BRIEF",
        "no_unsupported_mechanism: body[3]: unsupported explanation ('reflects')",
    )


class TestTheBriefDescribesThePropertyNotTheVocabulary:
    def test_first_draft_and_revision_receive_the_same_claim_rules(self) -> None:
        system = prompts.build_system_prompt(make_signal(), persona_for_section("labour"))

        assert prompts._CLAIM_GUIDANCE in system
        assert prompts._CLAIM_GUIDANCE in revision_note()
        assert prompts._CLAIM_GUIDANCE in prompts.build_revision_system_prompt()

    def test_it_names_the_question_the_check_actually_asks(self) -> None:
        guidance = prompts._CLAIM_GUIDANCE

        assert "EACH SENTENCE AND CLAUSE" in guidance
        assert "including the headline and dek" in guidance

    def test_it_gives_a_grounded_example_that_is_allowed(self) -> None:
        assert {verdict for verdict, _ in _EXAMPLES} == {"ALLOWED", "REJECTED"}

    def test_it_says_swapping_the_verb_does_not_help(self) -> None:
        system = prompts._CLAIM_GUIDANCE.lower()

        assert "swapping the verb does not help" in system


class TestTheRevisionNoteExplainsThisFailure:
    def test_the_failure_kind_is_explained_at_all(self) -> None:
        """It was the only common rejection with no HOW TO READ THAT entry.

        Asserts the explanatory bullet, not the check's own message: the
        failure summary is interpolated into the note verbatim, so looking
        for the message alone passes on a template that explains nothing.
        """
        assert '"unsupported explanation" or "attributed statement is not an excerpt" means' in revision_note()

    def test_it_tells_the_writer_the_verb_is_not_the_fault(self) -> None:
        note = revision_note()

        assert "An unrelated figure in the SAME sentence does not support the extra claim." in note

    def test_it_names_the_observed_synonyms_as_equivalent_not_as_a_blacklist(
        self,
    ) -> None:
        """Listing them is fine here because the sentence around them says
        they are the same sentence to the check, and that the list is not
        exhaustive. That is the opposite of a word list."""
        note = " ".join(revision_note().split())

        assert "every synonym you have not thought of" in note

    def test_it_says_moving_the_sentence_does_not_help_either(self) -> None:
        """The observed loop moved the claim from body[3] to body[4]."""
        note = revision_note()

        assert "different paragraph" in note

    def test_it_offers_deletion_as_a_first_class_fix(self) -> None:
        """Six of eight rejections had a claim that simply had to go."""
        note = revision_note()

        assert "DELETE THE CLAIM" in note

    def test_it_states_the_asymmetry_between_denying_and_attributing(self) -> None:
        note = revision_note()

        assert "Denying a mechanism is always safe" in note


_EXAMPLES = re.findall(
    r'^\s+(ALLOWED|REJECTED)\s+"([^"]+)"', prompts._CLAIM_GUIDANCE, re.M,
)


@pytest.mark.parametrize("expected,text", _EXAMPLES)
def test_every_claim_guidance_example_behaves_as_advertised(expected: str, text: str) -> None:
    context = ValidationContext(
        article={
            "tier": "A",
            "body": [{
                "type": "paragraph", "text": text,
                "figures": [{"value": 373, "signal_field": "spread"}],
            }],
        },
        signal={"payload": {"spread": 373}},
        registry=registry(),
        personas=personas(),
    )
    result = check_no_unsupported_mechanism(context)
    assert result.passed == (expected == "ALLOWED"), result.detail


class TestTheOtherFailureKindsStillExplained:
    """The companion: this must add an entry, not replace the others."""

    def test_the_undeclared_numeral_note_survives(self) -> None:
        assert "not in figures" in revision_note()

    def test_the_comparison_basis_note_survives(self) -> None:
        assert "describes a change without naming the comparison basis" in (
            revision_note()
        )


def figure_note() -> str:
    """A revision note for the figure check rather than the mechanism one.

    Whitespace is collapsed. The prompt is hard-wrapped, so a phrase that
    happens to straddle a line break would fail an assertion about wording
    that is present and correct -- and rewrapping a paragraph would break a
    test that has nothing to do with wrapping.
    """
    return " ".join(
        prompts.build_revision_prompt(
            "ORIGINAL BRIEF",
            "figures_traceable: body[2]: figure 16.35 does not match "
            "deviation=-16.35",
        ).split()
    )


class TestTheFigureNoteSaysWhatExactlyMeans:
    """`figures_traceable` compares signed values and the writer kept losing
    the sign -- two of three failures in one run were 16.35 against -16.35 and
    4.2 against -4.2, the magnitude of a negative quantity with the direction
    carried in the prose instead.

    The tempting repair was to compare magnitudes when the sentence already
    says "fell". That needs a list of direction words, and it fails in the one
    direction that matters: it would accept "rose by 16.35" against -16.35,
    because "rose" is only another word in the list until somebody writes
    "climbed". A check that lets a sign error through is worse than one that
    rejects a well-phrased sentence -- the first publishes something false and
    the second costs a revision.

    So the gate stays strict and the instance is coached, which is "reject what
    is wrong, coach what is weak" applied one level up: the fault *class* is
    dangerous enough to gate, and the *instance* is a writer who was never told
    what "exactly" covers.
    """

    def test_it_says_the_sign_is_part_of_the_figure(self) -> None:
        assert "EXACTLY MEANS THE SIGN" in figure_note()

    def test_it_says_the_prose_direction_does_not_substitute(self) -> None:
        """The specific reasoning error: "fell" in the sentence is not the
        minus sign in the figure."""
        note = figure_note()

        assert "does not read your sentence" in note

    def test_it_says_why_this_is_not_a_formality(self) -> None:
        note = figure_note()

        assert "the sign is" in note and "whole story" in note

    def test_it_covers_rounding_in_the_same_place(self) -> None:
        """629 -> 600 survived three runs and is the same check firing."""
        note = figure_note()

        assert "EXACTLY ALSO MEANS UNROUNDED" in note
        assert "629 is not 600" in note

    def test_it_offers_a_way_out_that_is_not_adjusting_the_number(self) -> None:
        assert "describe it in words afterwards" in figure_note()
