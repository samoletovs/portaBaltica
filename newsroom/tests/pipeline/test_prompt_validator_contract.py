"""The prompt and the validator must agree about what a comparison basis is.

The writer is told to insert a specific phrase. The validator decides whether a
paragraph names its basis by matching a fixed set of patterns. Those are two
lists in two files, and nothing made them agree — so the prompt could
confidently instruct the model to write a phrase the gate does not accept, and
the article would be rejected for doing exactly what it was told.

That is not hypothetical. The instruction used to be the abstract "name the
comparison basis in that same sentence", and the production run of
2026-08-25 shows the model failing that check three times on the same paragraph
before the article was discarded: it was trying, and guessing wrong.

These tests pin the two ends together.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.write import prompts
from newsroom.validator import _BASIS_PATTERNS

#: Every phrase the prompt offers the writer as a way to satisfy the check.
#: Kept here rather than parsed out of the prompt so that the assertion is
#: about meaning: if someone edits the prompt, this list must be edited too and
#: the test below proves the new wording is actually accepted.
OFFERED_PHRASES = (
    "compared with",
    "against the previous month",
    "than",
    "year on year",
    "a year earlier",
    "the same month",
    "the previous month",
    "since",
    "relative to",
    "the long-run average",
)


def satisfies_validator(text: str) -> bool:
    return any(pattern.search(text) for pattern in _BASIS_PATTERNS)


@pytest.mark.parametrize("phrase", OFFERED_PHRASES)
def test_every_offered_phrase_is_accepted(phrase: str) -> None:
    """A phrase the prompt recommends must satisfy the gate that reads it."""
    sentence = f"Producer prices fell 3.2% {phrase}."

    assert satisfies_validator(sentence), (
        f"the prompt tells the writer to use {phrase!r}, but the validator does "
        f"not accept it as a comparison basis; an article that follows the "
        f"instruction would be rejected for doing so"
    )


@pytest.mark.parametrize("phrase", OFFERED_PHRASES)
def test_every_offered_phrase_appears_in_the_prompt(phrase: str) -> None:
    """And the prompt must actually offer them, or this file guards nothing."""
    system = prompts._SYSTEM_TEMPLATE
    revision = prompts._REVISION_TEMPLATE

    # "against the previous month" is offered as the pattern "against the ..."
    needle = "against the" if phrase.startswith("against") else phrase

    assert needle in system, f"{needle!r} is not offered in the writing prompt"
    assert needle in revision, f"{needle!r} is not offered in the revision prompt"


def test_a_vague_substitute_is_not_accepted() -> None:
    """The reason the list is explicit rather than left to the model's judgement."""
    assert not satisfies_validator("Producer prices fell 3.2% in a marked shift.")
    assert not satisfies_validator("Producer prices fell 3.2% notably.")


def test_the_prompt_forbids_digits_in_the_standfirst() -> None:
    """The largest single class of rejection was a numeral in the dek.

    The dek carries no figures array of its own, so every digit in it has to be
    declared somewhere in the body, and the model kept not doing that. Removing
    digits from the standfirst removes the failure rather than managing it.
    """
    assert "MUST CONTAIN NO DIGITS" in prompts._SYSTEM_TEMPLATE


def test_the_prompt_confines_digits_to_the_opening_paragraphs() -> None:
    assert "ONLY THE FIRST TWO PARAGRAPHS MAY CONTAIN DIGITS" in prompts._SYSTEM_TEMPLATE


def test_the_revision_prompt_says_the_check_already_failed() -> None:
    """Repeating the same paragraph verbatim was the observed failure mode."""
    assert "ALREADY FAILED THIS CHECK" in prompts._REVISION_TEMPLATE
