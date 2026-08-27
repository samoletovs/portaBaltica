"""The writer was told to avoid words. The check reads structure.

Across one run's seven rejections, `no_unsupported_mechanism` fired five
times, and the offending verbs were: reflects, reflecting, suggests, suggest,
indicate, indicating, highlights, highlighting, is significant for, is crucial
for. One signal cycled through three of them across three attempts, moving the
sentence to a different paragraph each time:

    attempt 1   'suggests'   body[3]
    attempt 2   'reflects'   body[3]
    final       'reflecting' body[4]

The writer was reading the rejection as being about the word, and no revision
could converge, because each attempt only had to avoid the specific verb it
had just been shown.

Two causes, both in our own text rather than in the model:

1. The brief said *Never write that a movement "reflects", "indicates",
   "highlights", "underscores" or "points to"* — a word list, which teaches
   the writer that the fault is vocabulary. The closing rule two sections
   above already knew better: *"This is checked structurally, not against a
   list of banned phrases ... rephrasing 'crucial to assess' as 'essential to
   determine' changes nothing, because the check is not looking at those
   words."*

2. The revision template's HOW TO READ THAT explained three failure kinds and
   not this one, so a writer rejected for it received the raw check message
   and had to guess.

This is `a word list encodes your examples` arriving from the writer's side
rather than the checker's, and the fix is the same: describe the property.
"""

from __future__ import annotations

from newsroom.pipeline.write import prompts


def revision_note() -> str:
    return prompts.build_revision_prompt(
        "ORIGINAL BRIEF",
        "no_unsupported_mechanism: body[3] attributes the change to something "
        "the figures do not establish",
    )


class TestTheBriefDescribesThePropertyNotTheVocabulary:
    def test_it_says_the_check_does_not_read_the_verb(self) -> None:
        system = prompts._SYSTEM_TEMPLATE

        assert "not reading your verb" in system.lower()

    def test_it_names_the_question_the_check_actually_asks(self) -> None:
        """Whether the thing attributed to is in this article's own figures."""
        system = prompts._SYSTEM_TEMPLATE.lower()

        assert "present in this article's own figures" in system

    def test_it_gives_a_grounded_example_that_is_allowed(self) -> None:
        """The trap: a permitted sentence using a verb a word list would ban.

        "the rise extends a streak of eight consecutive increases" is grounded
        because the streak is a declared figure. A writer shown only a list of
        forbidden verbs cannot tell it from the rejected case.
        """
        system = prompts._SYSTEM_TEMPLATE

        assert "ALLOWED" in system and "REJECTED" in system

    def test_it_says_swapping_the_verb_does_not_help(self) -> None:
        system = prompts._SYSTEM_TEMPLATE.lower()

        assert "swapping the verb does not help" in system


class TestTheRevisionNoteExplainsThisFailure:
    def test_the_failure_kind_is_explained_at_all(self) -> None:
        """It was the only common rejection with no HOW TO READ THAT entry.

        Asserts the explanatory bullet, not the check's own message: the
        failure summary is interpolated into the note verbatim, so looking
        for the message alone passes on a template that explains nothing.
        """
        assert 'do not establish" means a' in revision_note()

    def test_it_tells_the_writer_the_verb_is_not_the_fault(self) -> None:
        note = revision_note()

        assert "THE CHECK IS NOT READING YOUR VERB" in note

    def test_it_names_the_observed_synonyms_as_equivalent_not_as_a_blacklist(
        self,
    ) -> None:
        """Listing them is fine here because the sentence around them says
        they are the same sentence to the check, and that the list is not
        exhaustive. That is the opposite of a word list."""
        note = revision_note()

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


class TestTheOtherFailureKindsStillExplained:
    """The companion: this must add an entry, not replace the others."""

    def test_the_undeclared_numeral_note_survives(self) -> None:
        assert "not in figures" in revision_note()

    def test_the_comparison_basis_note_survives(self) -> None:
        assert "describes a change without naming the comparison basis" in (
            revision_note()
        )
