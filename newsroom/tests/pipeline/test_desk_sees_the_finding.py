"""The desk must be shown the finding it is being asked to judge.

WHAT HAPPENED
-------------
``run_desk`` was given the prose and nothing else: headline, dek, body, section.
Its brief asks whether the piece is worth a reader's time, and tells it to reject
for triviality when "the finding itself is not worth a reader's attention" — a
judgement about the FINDING, made with no access to the finding.

So it guessed, and its guesses went one way. A live run on 2026-08-25, after the
validator stopped rejecting everything, produced six articles the desk could
read. It rejected four:

    "The finding is trivial and lacks significant context or relevance"
    "The findings are trivial and lack meaningful context or significance"
    "does not provide a clear basis for the 4.8% increase ... making it trivial"

Three of those went straight to ``reject`` without asking for a rewrite. The
ranking layer had scored the same findings between 0.90 and 0.96 — an eight-year
streak in Lithuanian labour costs, a Baltic power spread several times its own
typical width — out of eighteen candidates over thirty-six series. They were the
strongest data the day contained, and the editor was told none of that.

WHAT THIS ASSERTS
-----------------
That the evidence reaches the desk, at both reads, and that it carries no digits
into notes the writer will later be handed.
"""

from __future__ import annotations

import inspect
from typing import Any

from newsroom.pipeline import run as run_module
from newsroom.pipeline.desk import Finding, run_desk
from newsroom.pipeline.models import Article, Block


class RecordingWriter:
    """Answers every review the same way, and keeps what it was shown."""

    model_name = "fake-model"

    def __init__(self, *responses: dict[str, Any]) -> None:
        self._responses = list(responses)
        self.prompts: list[str] = []

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, Any]:
        self.prompts.append(user)
        if not self._responses:
            raise AssertionError("the desk asked for more reviews than the test queued")
        return self._responses.pop(0)


def _article() -> Article:
    return Article(
        id="01ARTICLE",
        slug="lithuanian-labour-costs-rise",
        tier="A",
        status="published",
        headline="Lithuanian hourly labour costs rise for an eighth year",
        section="labour",
        created_at="2026-08-25T14:00:00Z",
        provenance={"validator": {"passed": True, "checks": []}},
        body=[Block(type="paragraph", text="Costs reached 17.8 euros an hour.")],
    )


def _finding(among_strongest: bool = True) -> Finding:
    return Finding(
        detector="streak",
        comparison_basis="eight consecutive annual moves in the same direction",
        among_strongest=among_strongest,
    )


class TestTheRunSuppliesTheFinding:
    def test_run_once_passes_a_finding_to_the_desk(self):
        """The omission, asserted where it happened.

        Behavioural coverage lives below; this is the line that goes red when
        the argument is dropped again, which is how the revision callback was
        lost before it.
        """
        source = inspect.getsource(run_module.run_once)

        assert "run_desk(" in source, "the run no longer calls the desk at all"
        desk_call = source.split("run_desk(", 1)[1]
        assert "finding=" in desk_call, (
            "run_once calls run_desk without the detector's finding, so the "
            "editor judges significance with no evidence of significance"
        )


class TestTheDeskSeesIt:
    def test_the_finding_reaches_the_first_read(self):
        writer = RecordingWriter({"decision": "approve", "reason": "runs", "notes": []})

        run_desk(_article(), writer, finding=_finding())

        assert "streak" in writer.prompts[0]
        assert "eight consecutive annual moves" in writer.prompts[0]
        assert "among the strongest" in writer.prompts[0]

    def test_the_finding_reaches_the_second_read_too(self):
        """The read that decides must see what the first one saw."""
        rewritten = _article()
        writer = RecordingWriter(
            {"decision": "revise", "reason": "thin", "notes": ["say what it means"]},
            {"decision": "approve", "reason": "fixed", "notes": []},
        )

        run_desk(_article(), writer, revise=lambda a, n: rewritten, finding=_finding())

        assert len(writer.prompts) == 2
        assert "eight consecutive annual moves" in writer.prompts[1]

    def test_a_weaker_finding_is_described_honestly(self):
        writer = RecordingWriter({"decision": "approve", "reason": "runs", "notes": []})

        run_desk(_article(), writer, finding=_finding(among_strongest=False))

        assert "among the strongest" not in writer.prompts[0]
        assert "quality floor" in writer.prompts[0]

    def test_the_desk_still_works_without_a_finding(self):
        """Absent evidence must not be a crash. It is simply absent."""
        writer = RecordingWriter({"decision": "approve", "reason": "runs", "notes": []})

        outcome = run_desk(_article(), writer)

        assert outcome.publishable
        assert "the_finding_behind_this_piece" not in writer.prompts[0]


class TestItCarriesNoDigits:
    def test_the_strength_description_contains_no_numerals(self):
        """These strings can reach the writer as editor notes on a revision.

        A numeral in a note is a numeral the writer may put into the article,
        where no verified figure backs it and the validator rejects the piece.
        """
        for among_strongest in (True, False):
            strength = _finding(among_strongest).strength
            assert not any(char.isdigit() for char in strength), strength
