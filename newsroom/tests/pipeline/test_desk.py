"""The desk decides what runs, and can only ever narrow that set.

These tests are written as the properties the desk must have rather than as a
description of its implementation. The load-bearing ones are the negatives: an
editor that cannot be reached, that answers with nonsense, or that keeps asking
for changes must all end in *nothing being published*, because every one of
those is a state in which no human and no machine has actually approved the
article.
"""

from __future__ import annotations

from typing import Any, Sequence

import pytest

from newsroom.pipeline.desk import (
    DESK_PROMPT_VERSION,
    SYSTEM_PROMPT,
    DeskAction,
    MAX_REVISIONS,
    record_decision,
    review_original_article,
    run_desk,
)
from newsroom.pipeline.models import Article, Block


def make_article(**overrides: Any) -> Article:
    defaults: dict[str, Any] = dict(
        id="01TESTDESK000000000000000",
        slug="estonian-unemployment-falls-in-june",
        tier="A",
        status="published",
        section="labour",
        headline="Estonian unemployment falls to 6.6% in June",
        dek="The lowest June reading since 2019.",
        body=[Block(type="paragraph", text="Unemployment fell to 6.6% in June, from 7.1%.")],
        provenance={"validator": {"passed": True, "checks": []}},
        created_at="2026-08-25T06:00:00Z",
    )
    defaults.update(overrides)
    return Article(**defaults)


class FakeWriter:
    """Returns queued decisions. Records what it was asked."""

    model_name = "fake-model"

    def __init__(self, *responses: dict[str, Any]) -> None:
        self._responses = list(responses)
        self.prompts: list[str] = []

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, Any]:
        self.prompts.append(user)
        if not self._responses:
            raise AssertionError("the desk asked for more reviews than the test queued")
        return self._responses.pop(0)


class BrokenWriter:
    model_name = "fake-model"

    def complete_json(self, **_: Any) -> dict[str, Any]:
        raise RuntimeError("Azure is down")


class TestApproval:
    def test_approved_article_publishes(self) -> None:
        article = make_article()
        writer = FakeWriter({"decision": "approve", "reason": "clear and sourced"})

        outcome = run_desk(article, writer)

        assert outcome.action is DeskAction.APPROVE
        assert outcome.publishable
        assert article.status == "published"

    def test_approval_is_recorded_where_readers_see_it(self) -> None:
        article = make_article()
        writer = FakeWriter({"decision": "approve", "reason": "fit to run"})

        run_desk(article, writer)

        editor = article.provenance["editor"]
        assert editor["decision"] == "approve"
        assert editor["editor"] == "Dace Saulkrasti"
        assert editor["reason"] == "fit to run"
        assert article.provenance["approved_by"] == "Dace Saulkrasti"


class TestTheGate:
    """Everything that is not an approval must end in nothing being published."""

    def test_rejected_article_does_not_publish(self) -> None:
        article = make_article()
        writer = FakeWriter({"decision": "reject", "reason": "the finding is trivial"})

        outcome = run_desk(article, writer)

        assert not outcome.publishable
        assert article.status == "rejected"

    def test_an_unreachable_editor_is_not_an_approval(self) -> None:
        # The failure mode that matters most: if a dead editor defaulted to
        # approve, the desk would silently stop existing during an outage.
        article = make_article()

        outcome = run_desk(article, BrokenWriter())

        assert outcome.action is DeskAction.REJECT
        assert article.status == "rejected"
        assert "unavailable" in outcome.reason

    @pytest.mark.parametrize("decision", ["", "maybe", "APPROVE_WITH_CHANGES", None, 7])
    def test_an_unusable_decision_is_not_an_approval(self, decision: Any) -> None:
        article = make_article()
        writer = FakeWriter({"decision": decision, "reason": "x"})

        outcome = run_desk(article, writer)

        assert outcome.action is DeskAction.REJECT
        assert article.status == "rejected"

    def test_the_desk_cannot_rescue_a_failed_validator(self) -> None:
        # The desk narrows; it never widens. An article the validator failed is
        # already unpublishable and approval here must not change that.
        article = make_article(status="rejected", provenance={"validator": {"passed": False}})
        writer = FakeWriter({"decision": "approve", "reason": "reads well"})

        run_desk(article, writer)

        assert article.status == "rejected", "the desk overturned the validator"


class TestRevision:
    def test_notes_go_back_and_the_revision_runs(self) -> None:
        article = make_article()
        revised = make_article(headline="Estonian unemployment falls to its lowest June since 2019")
        writer = FakeWriter(
            {"decision": "revise", "reason": "recites without explaining",
             "notes": ["say what changed against what"]},
            {"decision": "approve", "reason": "now explains the move"},
        )
        seen: list[Sequence[str]] = []

        def revise(_: Article, notes: Sequence[str]) -> Article:
            seen.append(notes)
            return revised

        outcome = run_desk(article, writer, revise=revise)

        assert seen == [("say what changed against what",)]
        assert outcome.action is DeskAction.APPROVE
        assert outcome.revisions == 1
        assert revised.status == "published"

    def test_a_second_refusal_runs_the_piece_with_notes_outstanding(self) -> None:
        """Still-has-notes is not the same as should-not-exist.

        This used to hold the article, and it emptied the wire: a live run put
        eight correct, validator-passed pieces in front of the desk and
        published none, every one held on a second "revise". A model asked to
        critique will always find something, so "approve on the second read or
        die" is a gate almost nothing passes.
        """
        article = make_article()
        writer = FakeWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain it"]},
            {"decision": "revise", "reason": "still thin", "notes": ["explain it"]},
        )

        outcome = run_desk(article, writer, revise=lambda a, n: make_article())

        assert outcome.action is DeskAction.APPROVE
        assert outcome.notes_outstanding is True
        assert outcome.revisions == MAX_REVISIONS
        assert "notes outstanding" in outcome.reason
        # The decision is recorded on the piece that actually publishes — the
        # rewrite — and the reader is told, rather than the reservation hidden.
        published = outcome.revised_article
        assert published is not None
        assert published.provenance["editor"]["notes_outstanding"] is True
        assert published.status == "published"

    def test_an_explicit_rejection_after_a_revision_still_spikes_it(self) -> None:
        """The gate that was NOT loosened. "Reject" means reject."""
        article = make_article()
        writer = FakeWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain it"]},
            {"decision": "reject", "reason": "the finding is trivial"},
        )

        outcome = run_desk(article, writer, revise=lambda a, n: make_article())

        assert outcome.action is DeskAction.REJECT
        assert not outcome.publishable

    def test_a_failed_rewrite_runs_the_article_as_filed(self) -> None:
        """The desk asked for a revision, not a spike.

        The article in hand already passed the validator, so it is correct. The
        rewrite failing the arithmetic gate is a fact about the rewrite, not a
        judgement that the story should not run.
        """
        article = make_article()
        writer = FakeWriter({"decision": "revise", "reason": "thin", "notes": ["explain"]})

        outcome = run_desk(article, writer, revise=lambda a, n: None)

        assert outcome.action is DeskAction.APPROVE
        assert outcome.notes_outstanding is True
        assert article.status == "published"
        assert "could not be made" in outcome.reason

    def test_revise_without_a_rewriter_holds_rather_than_publishes(self) -> None:
        """A desk with no revision machinery is a broken pipeline, not an
        editorial judgement, and broken components still fail closed."""
        article = make_article()
        writer = FakeWriter({"decision": "revise", "reason": "thin"})

        outcome = run_desk(article, writer)

        assert not outcome.publishable
        assert article.status == "rejected"


class TestWhatTheDeskIsToldn:
    def test_the_copy_desk_findings_reach_the_editor(self) -> None:
        # Deterministic style faults are handed over rather than left for the
        # model to notice, so the editor spends its judgement on the reporting.
        article = make_article(
            body=[Block(type="paragraph", text="This may be attributed to various factors.")]
        )
        writer = FakeWriter({"decision": "reject", "reason": "vague"})

        review_original_article(article, writer)

        assert "says nothing" in writer.prompts[0] or "unedited" in writer.prompts[0]

    def test_the_article_itself_is_sent(self) -> None:
        article = make_article()
        writer = FakeWriter({"decision": "approve", "reason": "ok"})

        review_original_article(article, writer)

        assert "Estonian unemployment falls" in writer.prompts[0]
        assert "6.6%" in writer.prompts[0]


class TestRecordDecision:
    def test_records_the_notes_for_the_audit_trail(self) -> None:
        article = make_article()
        writer = FakeWriter(
            {"decision": "reject", "reason": "no story here", "notes": ["trivial move"]}
        )

        outcome = run_desk(article, writer)
        record_decision(article, outcome)

        assert article.provenance["editor"]["notes"] == ["trivial move"]
        assert article.provenance["editor"]["prompt_version"]


class TestTheDeskDoesNotDemandFabrication:
    """The desk rejected 8 of 8 articles on five consecutive live runs.

    Its notes were consistent: "does not explain why the rise matters",
    "implications for consumers", "vague assertions about causation". Rules 1
    and 3 of its brief pull against each other -- one asks why it matters, the
    other forbids asserting what the data does not support -- and this wire
    reports from statistical series that usually cannot establish a cause.

    Enforcing both is a deadlock by construction, and the way out is not to
    lower the accuracy bar but to stop asking for the one thing the writer is
    forbidden to supply.
    """

    def test_the_brief_forbids_asking_for_an_unsourced_cause(self):
        collapsed = " ".join(SYSTEM_PROMPT.split())
        assert "do not send a piece back for failing to explain a cause it has no source for" in collapsed

    def test_the_brief_says_a_piece_without_a_known_cause_can_run(self):
        assert "RUNS" in SYSTEM_PROMPT
        collapsed = " ".join(SYSTEM_PROMPT.split())
        assert "does not show what drove the change" in collapsed
    def test_the_brief_still_forbids_unsupported_assertions(self):
        # The point is not to relax accuracy. Rule 3 must survive intact.
        assert "Is anything asserted that the data does not support?" in SYSTEM_PROMPT

    def test_triviality_is_still_grounds_for_rejection(self):
        assert "Reject for triviality" in SYSTEM_PROMPT

    def test_the_prompt_version_moved_with_the_brief(self):
        # Provenance records the desk prompt version. Changing what the editor
        # is asked without changing the version makes two different editorial
        # standards indistinguishable in the audit trail.
        assert DESK_PROMPT_VERSION != "desk-v1"
