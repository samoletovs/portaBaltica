"""What `comparison_basis_stated` rejects, and what it must not.

The check pairs a movement-word list with a basis-phrase list: a text unit
carrying a movement word and a digit but no recognised basis phrase fails. It
was the pipeline's largest single cause of rejection -- 5 of 6 rejected drafts
in the production run of 2026-08-27 -- so eighteen drafts were generated across
three signals and every rejection read.

**Nine of nine were false positives.** Not one was the writer omitting a basis.
They fell in two groups:

  seven   the closing paragraph house style asks for, which names what the next
          release would have to show:
            "The next release would need to show a decrease below 141.6% to
             indicate a potential easing of energy inflation."
          A threshold is a reference point. Nothing here can mislead a reader
          about what a movement is measured against.

  two     a basis stated in wording the list did not contain:
            "...has grown from 52.8% one year earlier in 2025-Q2."
          The pattern required the article -- "a year earlier" -- and the writer
          wrote the numeral. The block's own declared figure was named
          `value_one_year_earlier`.

A gate that fires on honest data is worse than no gate, because the next person
turns it off. But widening one is how a gate stops protecting anything, so the
tests below come in pairs: what must now pass, and beside it the thing it must
not have made passable.

The prose is verbatim from the probe, not written for the test. A fixture the
author invents encodes what the author imagined; this encodes what the writer
actually produced.
"""

from __future__ import annotations

from typing import Any

import pytest

from newsroom.validator import ValidationContext, check_comparison_basis_stated


def run(*paragraphs: str, headline: str = "A heading", dek: str = "") -> Any:
    """Run only this check over a body of paragraphs."""
    article = {
        "id": "01J0000000000000000000TEST",
        "tier": "A",
        "headline": headline,
        "dek": dek,
        "body": [{"type": "paragraph", "text": text, "figures": []} for text in paragraphs],
    }
    return check_comparison_basis_stated(
        ValidationContext(article=article, registry=None, personas=None)  # type: ignore[arg-type]
    )


# ── the closing that house style asks for ───────────────────────────────

#: Verbatim, from three signals. Seven of the nine sampled rejections.
CLOSINGS = (
    "The next release would need to show a decrease below 141.6% to indicate a "
    "potential easing of energy inflation.",
    "The next release would need to show a continued increase to confirm this "
    "trend, with a second quarter holding above 8420 thousand tonnes to solidify "
    "the pattern.",
    "The next release will need to show continued growth to confirm this trend, "
    "with a second quarter holding above 8,420 thousand tonnes necessary for the "
    "pattern to be validated.",
    "The next release would need to show a sustained increase above 63.4% to "
    "confirm this trend.",
)


class TestTheClosingHouseStyleAsksFor:
    @pytest.mark.parametrize("text", CLOSINGS)
    def test_a_threshold_is_a_reference_point(self, text: str) -> None:
        assert run(text).passed, text

    def test_the_same_sentence_without_the_threshold_needs_a_basis_elsewhere(self) -> None:
        """The allowance is the threshold, not the sentence.

        Strip the figure and this is an unquantified change, which the check
        holds to the weaker article-wide rule. Strip only the *threshold* and
        leave a bare figure, and it must fail: `above 8,420` is what makes the
        first version honest, and nothing else in it does.
        """
        assert not run(
            "The next release would need to show continued growth, with a second "
            "quarter reading of 8,420 thousand tonnes."
        ).passed


# ── a basis the list did not know ───────────────────────────────────────


class TestAStatedBasisTheListDidNotKnow:
    def test_one_year_earlier_reads_as_a_year_earlier(self) -> None:
        assert run(
            "The data does not show what drove this increase, but Latvia's renewable "
            "share has grown from 52.8% one year earlier in 2025-Q2."
        ).passed

    @pytest.mark.parametrize(
        "phrase",
        [
            "a year earlier",
            "one year earlier",
            "two years earlier",
            "three months ago",
            "12 months earlier",
        ],
    )
    def test_the_construction_holds_however_the_count_is_written(self, phrase: str) -> None:
        assert run(f"Energy inflation rose to 141.6%, from 124.0% {phrase}.").passed


# ── the companion: what none of this may have made passable ─────────────


class TestAChangeWithNoReferencePointStillFails:
    """The reason the check exists, and the reason widening it is dangerous.

    Every one of these is a quantified movement with nothing in the paragraph
    saying what it moved against. If any starts passing, the widening above went
    too far and the gate has stopped protecting the thing it was built for.
    """

    @pytest.mark.parametrize(
        "text",
        [
            "Latvian day-ahead electricity settled at 142.5 euros per megawatt-hour, "
            "12.0% higher.",
            "Latvian day-ahead electricity is up 12.0%, at 142.5 euros per megawatt-hour.",
            "The spread widened to 303.5 euros.",
            "Energy inflation rose 12%.",
            "Road freight grew to 8,420 thousand tonnes.",
        ],
    )
    def test_it_is_rejected(self, text: str) -> None:
        assert not run(text).passed, text

    def test_a_duration_is_not_a_reference_point(self) -> None:
        """Why only `above` and `below`.

        `over 3 months` and `under 2 years` are time spans, and admitting the
        whole family of comparative prepositions would let one pass as a
        reference point. These say when the change happened, not what it is
        measured against.
        """
        assert not run("Energy inflation rose 12% over 3 months.").passed
        assert not run("Road freight grew 5% in under 2 years.").passed

    def test_the_basis_must_still_sit_beside_the_number(self) -> None:
        """A quantified change may not lean on a basis in another paragraph."""
        verdict = run(
            "Energy inflation reached 141.6%, compared with a year earlier.",
            "The reading climbed to 8,420 thousand tonnes.",
        )
        assert not verdict.passed
        assert "body[1]" in (verdict.detail or "")
