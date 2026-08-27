"""With no mechanism, the brief said nothing — and the writer filled the silence.

Four runs, same eight signals, measured by the manager:

    run  change                         mechanism rate   mechanisms admitted
    1    baseline                       5/7  71%              18
    2    revision note only (#153)      7/8  88%               —
    3    + brief declares fields (#154) 3/7  43%              18
    4    + must relate two series (#160) 6/7  86%               3

Run 4 is the controlled result. `#160` discarded fifteen of eighteen
mechanisms — working exactly as designed — and the rejection rate went
straight back up. **The writer produces the explanatory paragraph whether or
not it has anything to ground it.** Two runs holding eighteen mechanisms gave
71% and 43%; the run holding three gave 86%. The paragraph was unconditional
and only its groundedness varied.

`#154` did not stop it writing that paragraph; it gave it a correct way to
write one. `#160` removed the material and the paragraph stayed, now with
nothing behind it.

WHY THE SILENCE WAS THE PROBLEM
-------------------------------
With no admissible mechanism the brief simply omitted the section. Nothing
said a cause had been looked for and not found — and the system prompt listed
"a mechanism from the brief" among the ways to advance a paragraph, without
qualifying it on there being one.

So the writer was told mechanisms were a legitimate move, handed a brief with
none, and given no statement that none existed. **An absence is not a
statement**, and this is the same lesson as the unwritten half of
`_CROSS_SERIES_KINDS` and the `NOT_COMPARED` note: a reader — or a model —
cannot tell "decided against" from "never considered".

The brief is also the last place that knows the difference. Downstream, "no
mechanism survived grounding" and "nobody looked" are the same silence.
"""

from __future__ import annotations

from newsroom.pipeline.analyst import AnalystBrief, Mechanism
from newsroom.pipeline.write import prompts


def brief(*, mechanisms=(), discarded=()) -> str:
    return AnalystBrief(
        expert="Marek Akmeņrags",
        discipline="power market analyst",
        angle="An angle.",
        significance="Why it matters.",
        mechanisms=mechanisms,
        discarded=discarded,
    ).prompt_section()


GROUNDED = (
    Mechanism(
        claim="costs rose while unemployment fell",
        grounded_in=("companion_unemployment_rate",),
        confidence="consistent",
    ),
)


class TestAnAbsentMechanismIsStated:
    def test_the_brief_says_there_is_none(self) -> None:
        assert "MECHANISMS: none" in brief()

    def test_it_says_not_to_write_the_paragraph(self) -> None:
        """The instruction, not the permission. The prompt already allowed
        ending early; with no mechanism available that becomes the ask."""
        assert "Do NOT write a paragraph explaining why this happened" in brief()

    def test_it_says_wording_cannot_rescue_it(self) -> None:
        """Four runs of rewording say this has to be closed explicitly."""
        assert "no wording that makes an ungrounded cause publishable" in brief()

    def test_it_names_what_to_write_instead(self) -> None:
        """Refusing a paragraph without offering a replacement is how the
        writer ends up padding somewhere else."""
        rendered = brief()

        assert "what it DOES show" in rendered
        assert "END THE PIECE EARLIER" in rendered

    def test_it_reports_that_mechanisms_were_tried_and_dropped(self) -> None:
        """"Proposed and rejected" is a stronger signal than "none"."""
        rendered = brief(discarded=("a — grounded in nothing", "b — same"))

        assert "2 were proposed" in rendered

    def test_it_says_nothing_about_a_count_when_none_were_tried(self) -> None:
        assert "were proposed" not in brief()


class TestAPresentMechanismIsUnaffected:
    """The companion. Every assertion above is satisfied by a brief that has
    lost the ability to carry a mechanism at all."""

    def test_a_grounded_mechanism_still_reaches_the_writer(self) -> None:
        rendered = brief(mechanisms=GROUNDED)

        assert "MECHANISMS you may report" in rendered
        assert "costs rose while unemployment fell" in rendered

    def test_the_refusal_is_not_shown_when_one_survives(self) -> None:
        """Otherwise the brief tells the writer both to use it and not to."""
        rendered = brief(mechanisms=GROUNDED)

        assert "MECHANISMS: none" not in rendered
        assert "Do NOT write a paragraph" not in rendered

    def test_the_declaration_requirement_survives(self) -> None:
        """#154, which is what made a grounded mechanism usable at all."""
        assert "same paragraph" in brief(mechanisms=GROUNDED)


class TestThePromptDoesNotOfferWhatMayNotExist:
    def test_it_qualifies_the_mechanism_option(self) -> None:
        """The system prompt listed "a mechanism from the brief" among the
        ways to advance a paragraph, unconditionally."""
        system = prompts._SYSTEM_TEMPLATE

        assert "mechanism the brief actually lists" in system

    def test_it_says_what_to_do_when_there_is_none(self) -> None:
        system = prompts._SYSTEM_TEMPLATE

        assert "If the brief lists no mechanism there is none to use" in system
