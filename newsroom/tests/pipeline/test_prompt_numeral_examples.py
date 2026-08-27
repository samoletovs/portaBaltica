"""What the prompt claims about numerals must be true of the validator.

The prompt teaches by example: it names constructions and says they are
rejected. A false example is worse than a missing one, because it is guidance
*against* correct writing -- the writer avoids a phrasing that would have
published, and nothing anywhere reports the loss.

One shipped. The prompt said:

    "fell from 2025 levels" contains the numeral 2025 and is rejected.

It is not. `numeric_scan` ignores a bare four-digit year by design -- a period
label says *when* and claims nothing about magnitude -- so that sentence passes
every check. The claim also contradicted the prompt's own next line, which
already said "the supplied period labels may appear as digits", three lines
below.

The cost is not hypothetical. Naming when a series last did something is the
construction this repo holds up as the model: `detect_record_extreme` says
*"across 14 observations since 1999"*, true at any cadence and more informative
than the alternatives. The prompt was telling the writer that was fatal.

So the tests below assert the *property* -- that each example resolves the way
the prompt says it does -- rather than the spelling. Each example is also
asserted to appear in the prompt verbatim, which is what stops this file
drifting into a second, disagreeing copy of the guidance: a guard must assert
on the same object the behaviour reads.
"""

from __future__ import annotations

import pytest

from newsroom import numeric_scan
from newsroom.pipeline.write import prompts


def _flat(text: str) -> str:
    """Prompt text with line wrapping removed, so a reflow is not a failure."""
    return " ".join(text.split())


SYSTEM = _flat(prompts._SYSTEM_TEMPLATE)


#: Constructions the prompt presents as rejected. Each must scan to at least one
#: numeral, or the prompt is teaching a rule the validator does not apply.
CLAIMED_REJECTED = ("9 of the 10 categories",)

#: Constructions the prompt presents as acceptable. Each must scan to nothing,
#: or the prompt is inviting a rejection.
CLAIMED_ACCEPTED = ("the highest reading since 2019",)


class TestEveryNumeralExampleIsTrue:
    @pytest.mark.parametrize("example", CLAIMED_REJECTED + CLAIMED_ACCEPTED)
    def test_the_prompt_still_contains_it(self, example: str) -> None:
        """Ties the table to the prompt.

        Without this the table becomes a second copy of the guidance, free to
        agree with an older version of it -- which is how a collision guard
        rebuilt the parameters it was meant to check and reported success while
        checking nothing.
        """
        assert example in SYSTEM, f"the prompt no longer contains {example!r}"

    @pytest.mark.parametrize("example", CLAIMED_REJECTED)
    def test_what_it_calls_rejected_really_is(self, example: str) -> None:
        assert numeric_scan.scan(example), (
            f"the prompt says {example!r} is rejected and it is not; the writer "
            f"is being taught to avoid a phrasing that would have published"
        )

    @pytest.mark.parametrize("example", CLAIMED_ACCEPTED)
    def test_what_it_calls_acceptable_really_is(self, example: str) -> None:
        assert not numeric_scan.scan(example), (
            f"the prompt offers {example!r} as safe and it is not; the writer "
            f"is being invited into a rejection"
        )


class TestTheYearRuleIsStatedTheWayItBehaves:
    """The specific correction, and the thing that must not come back."""

    def test_it_does_not_claim_a_bare_year_is_rejected(self) -> None:
        assert "contains the numeral 2025 and is rejected" not in SYSTEM, (
            "the false example is back: a bare year passes every check, and "
            "saying otherwise suppresses the most informative thing a piece "
            "about a record can say"
        )

    def test_it_says_a_year_is_not_a_bare_numeral(self) -> None:
        assert "A YEAR IS NOT A BARE NUMERAL" in SYSTEM

    @pytest.mark.parametrize(
        "text",
        [
            "fell from 2025 levels",
            "Prices have not been this high since 2019.",
            "the second quarter of 2026",
        ],
    )
    def test_a_period_label_scans_to_nothing(self, text: str) -> None:
        """The behaviour the prompt now describes, asserted directly.

        If `numeric_scan` ever starts treating years as figures this fails here
        rather than in production, and the prompt becomes true again by
        accident -- which is the outcome to notice, not to rely on.
        """
        assert not numeric_scan.scan(text), text

    def test_a_magnitude_beside_a_year_is_still_caught(self) -> None:
        """The companion. Exempting years must not exempt the sentence.

        Without this, "the reading hit 402.6 in 2019" could pass on the
        strength of the year and the invented figure would travel with it.
        """
        assert numeric_scan.scan("The reading hit 402.6 in 2019.")
