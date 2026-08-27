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

    **This asserts the instruction exists, not that the dek obeys it**, and the
    distinction is the whole reason the label now says so. It passes for any
    output whatever, so it can never report that the rule stopped working --
    a documented decision that nothing enforces decays into an assumption, and
    a test that reads the prompt rather than the artefact is the most
    convincing possible substitute for one.

    What is enforced, and where:

    * an *untraceable* numeral in the dek is rejected by `no_invented_numbers`
      -- ``test_validator_rejects.py`` covers it directly, and did not before
    * a *traceable* one is deliberately allowed, because the dek is checked
      against the union of every block's figures; two accepting fixtures in
      ``test_validator_accepts.py`` depend on that
    * a period label is allowed and scans to nothing, by design

    So the prompt is stricter than the contract on purpose, as prophylaxis
    against a common rejection rather than because a digit in a dek is untrue.

    Measured before assuming it was being ignored: across 18 drafts on
    2026-08-27, **17 deks carried no digits, 1 did, and 0 carried an
    untraceable one.** The instruction is obeyed. Enforcing it deterministically
    would have cut a correct, fully traceable standfirst in the only case it
    ever fired on -- a coaching note that tells a writer to do what it is
    already doing makes it worse.
    """
    assert "MUST CONTAIN NO DIGITS" in prompts._SYSTEM_TEMPLATE


def _flat(text: str) -> str:
    """Prompt text with line wrapping removed.

    These assertions are about what the prompt *says*, not where it happens to
    wrap. Matching raw text made every reflow of a paragraph a test failure,
    which trains people to edit the assertion rather than read it.
    """
    return " ".join(text.split())


def test_the_prompt_requires_a_basis_in_every_paragraph_that_carries_a_digit() -> None:
    """The digits-in-the-lead-only rule is gone, and what replaced it.

    ``comparison_basis_stated`` fired on body[1] in run after run, and the
    response was to forbid digits outside the lead. That worked, and it cost
    the article everything below the lead: paragraphs two to four could carry
    no evidence, so they restated paragraph one and closed with "future data
    releases will provide further insights". A rule that guarantees the body is
    empty is too expensive a way to pass a check.

    The check itself is unchanged and still absolute. What the prompt now does
    is state it accurately — a paragraph with a digit AND a change word needs
    its basis, in that paragraph — and leave the bookkeeping to
    ``reconcile_figures``, which does it deterministically and does not forget.
    """
    system = _flat(prompts._SYSTEM_TEMPLATE)

    assert "ONLY THE FIRST PARAGRAPH MAY CONTAIN DIGITS" not in system, (
        "the digits-in-the-lead crutch is back; it makes every paragraph after "
        "the first content-free, which is the shallowness this pipeline was "
        "changed to fix"
    )
    assert "A CHANGE WITHOUT ITS BASIS IN THE SAME PARAGRAPH" in system, (
        "the prompt no longer states the rule the validator actually enforces"
    )
    # The escape hatch must survive: a writer that cannot name a basis has to be
    # told it may drop the digits instead, or it will guess at a phrase and be
    # rejected for guessing.
    assert "remove every digit from that paragraph" in system


def test_the_prompt_bans_the_empty_closing_that_kept_publishing() -> None:
    """"Future data releases will provide further insights" reached readers.

    It is what a writer produces when it has run out of things to say and still
    owes a paragraph. Naming it is cheap; the alternative is asking the editor
    to catch the same sentence every day.
    """
    system = _flat(prompts._SYSTEM_TEMPLATE)

    assert "BANNED CLOSINGS" in system
    assert "future data releases will provide further insights" in system
    assert "it remains to be seen" in system


def test_the_revision_prompt_says_the_check_already_failed() -> None:
    """Repeating the same paragraph verbatim was the observed failure mode."""
    assert "ALREADY FAILED THIS CHECK" in prompts._REVISION_TEMPLATE
