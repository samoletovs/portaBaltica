"""The brief names the fields a mechanism rests on; it did not say to declare them.

`no_unsupported_mechanism` asks one question of an explanatory sentence: is the
thing it attributes to present in **that paragraph's** declared figures? Its
own docstring is explicit about where presence is measured:

    A paragraph's declared figures are exactly that presence, made machine
    readable. So the rule is: a paragraph that carries evidence may explain
    what it carries; a paragraph that carries none may not explain anything on
    its own authority.

The analyst brief hands the writer a mechanism, the fields it is grounded in,
and how strongly to report it. The two confidence branches did not agree about
figures:

    established   "state it plainly, naming both figures"      <- says to declare
    consistent    "write it as an observed relationship        <- does not
                   ('X rose while Y fell'), never as a cause"

`consistent` is the common branch -- `established` needs two verified fields
and one is the minimum for a mechanism to survive at all. So the usual
instruction was to write a co-movement sentence with no mention of declaring
the figures it rests on.

A writer that follows it exactly produces a figure-free explanatory paragraph
and is rejected. Worse, the rejection reads as a complaint about wording, so
the writer rewords and fails again -- which is the loop observed in the 15:10
run, where one signal cycled suggests -> reflects -> reflecting across three
attempts.

This is the guard and the guidance measuring different objects: the analyst
grounds a mechanism in the *signal's* fields, the validator checks the
*paragraph's*, and nothing told the writer to carry one into the other.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.analyst import AnalystBrief, Mechanism


def brief(confidence: str, fields: tuple[str, ...] = ("value", "peer_ee")) -> str:
    return AnalystBrief(
        expert="Marek Akmeņrags",
        discipline="power market analyst",
        angle="An angle.",
        significance="Why it matters.",
        mechanisms=(
            Mechanism(
                claim="labour costs rose while unemployment fell",
                grounded_in=fields,
                confidence=confidence,
            ),
        ),
    ).prompt_section()


class TestTheBriefSaysToDeclareWhatItGrounds:
    @pytest.mark.parametrize("confidence", ["consistent", "established"])
    def test_both_confidences_require_declaration(self, confidence: str) -> None:
        """The asymmetry was the defect, so neither branch may omit it."""
        assert "declare" in brief(confidence).lower()

    def test_it_names_the_fields_to_declare(self) -> None:
        rendered = brief("consistent")

        assert "value, peer_ee" in rendered

    def test_it_says_where_they_must_go(self) -> None:
        """Declaring them in a different block does not satisfy the check."""
        assert "same paragraph" in brief("consistent")

    def test_it_says_wording_cannot_save_a_figureless_paragraph(self) -> None:
        """The observed loop was rewording, so the brief must close that door."""
        rendered = brief("consistent").lower()

        assert "however carefully it is worded" in rendered


class TestTheRestOfTheBriefIsUnchanged:
    """The companion: this adds a line, it does not replace the guidance."""

    def test_the_consistent_branch_still_forbids_causal_phrasing(self) -> None:
        assert "never as a cause" in brief("consistent")

    def test_the_established_branch_still_says_state_it_plainly(self) -> None:
        assert "state it plainly" in brief("established")

    def test_a_brief_with_no_mechanism_says_nothing_about_declaring(self) -> None:
        """No mechanism, no instruction -- the note must not become furniture."""
        rendered = AnalystBrief(
            expert="Marek Akmeņrags",
            discipline="power market analyst",
            angle="An angle.",
        ).prompt_section()

        assert "same paragraph" not in rendered
