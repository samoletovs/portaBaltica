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
    FINAL_CALL_PROMPT,
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

    def test_a_second_refusal_goes_to_a_final_call_not_straight_to_the_spike(self) -> None:
        # One rewrite, then a decision. A desk that can ask forever is a loop
        # with a token budget attached — but the decision is the editor's, made
        # on the copy in hand, not the loop's made by default.
        article = make_article()
        writer = FakeWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain it"]},
            {"decision": "revise", "reason": "still thin", "notes": ["explain it"]},
            {"decision": "reject", "reason": "not fit to run in this state"},
        )

        outcome = run_desk(article, writer, revise=lambda a, n: make_article())

        assert outcome.action is DeskAction.REJECT
        assert outcome.revisions == MAX_REVISIONS
        assert "not approved" in outcome.reason
        assert "THIS IS THE REWRITE YOU ASKED FOR" in writer.prompts[2]

    def test_a_rewrite_the_desk_still_has_notes_on_may_still_run(self) -> None:
        """"Revise" is a fixable fault, not a fatal one.

        The loop spiked these as "still unsatisfactory after revision" — four of
        six articles in a live run — each of them a draft the validator had
        certified, against a note the editor itself had called fixable.
        """
        article = make_article()
        rewritten = make_article(headline="Estonian unemployment falls again in June")
        writer = FakeWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain it"]},
            {"decision": "revise", "reason": "still thin", "notes": ["explain it"]},
            {"decision": "approve", "reason": "worth running as it stands"},
        )

        outcome = run_desk(article, writer, revise=lambda a, n: rewritten)

        assert outcome.publishable
        assert outcome.revised_article is rewritten, (
            "an approval here must publish the rewrite, not the draft the "
            "editor sent back"
        )

    def test_a_failed_rewrite_goes_back_to_the_editor_for_a_final_call(self) -> None:
        """A failed improvement must not spike a piece that already passed.

        The rewrite is an attempt to make a correct article better. When it
        fails, the article in hand is still the one the validator certified and
        the editor's verdict on it was "revise" -- a fixable fault, not a fatal
        one. Discarding it silently converted every "revise" the writer could
        not satisfy into a "reject": four of seven articles in a live run, each
        accurate, none of them ever actually refused.
        """
        article = make_article()
        writer = FakeWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain the basis"]},
            {"decision": "approve", "reason": "worth running as filed"},
        )

        outcome = run_desk(article, writer, revise=lambda a, n: None)

        assert outcome.action is DeskAction.APPROVE
        assert outcome.revised_article is article, (
            "an approval on the final call must hand back the copy it approved, "
            "or the run has nothing to publish"
        )
        assert article.status == "published"
        assert "no further rewrite was possible" in outcome.reason

    def test_the_final_call_is_told_a_rewrite_is_not_available(self) -> None:
        article = make_article()
        writer = FakeWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain the basis"]},
            {"decision": "approve", "reason": "fine"},
        )

        run_desk(article, writer, revise=lambda a, n: None)

        assert len(writer.prompts) == 2
        assert "COULD NOT BE PRODUCED" in writer.prompts[1]
        assert "explain the basis" in writer.prompts[1]

    def test_the_editor_may_still_spike_it_on_the_final_call(self) -> None:
        article = make_article()
        writer = FakeWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain"]},
            {"decision": "reject", "reason": "not worth running in this state"},
        )

        outcome = run_desk(article, writer, revise=lambda a, n: None)

        assert outcome.action is DeskAction.REJECT
        assert article.status == "rejected"

    def test_a_third_revise_on_the_final_call_is_not_an_approval(self) -> None:
        """Fail closed. "revise" was withdrawn, so returning it approves nothing."""
        article = make_article()
        writer = FakeWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain"]},
            {"decision": "revise", "reason": "still thin", "notes": ["explain"]},
        )

        outcome = run_desk(article, writer, revise=lambda a, n: None)

        assert outcome.action is DeskAction.REJECT
        assert article.status == "rejected"

    def test_an_unreachable_editor_on_the_final_call_holds_the_article(self) -> None:
        article = make_article()
        # One queued response, so the final call finds the writer exhausted.
        writer = FakeWriter({"decision": "revise", "reason": "thin", "notes": ["explain"]})

        outcome = run_desk(article, writer, revise=lambda a, n: None)

        assert outcome.action is DeskAction.REJECT
        assert article.status == "rejected"

    def test_revise_without_a_rewriter_holds_rather_than_publishes(self) -> None:
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

    def test_triviality_is_no_longer_grounds_for_rejection(self):
        """The desk was re-litigating a decision made upstream, and losing it.

        Once the validator stopped rejecting everything, the desk became the
        binding constraint: it rejected four of six articles in a live run and
        three of those went straight to "reject" with no rewrite asked for. Its
        stated reasons were "the finding is trivial", "lacks news value",
        "lacks significance" -- about findings the ranking layer had scored
        between 0.90 and 0.96 out of eighteen candidates over thirty-six series.

        The desk sees one article. It cannot weigh a finding against a field it
        never saw, and the deterministic floor that already did is absolute. So
        the verdict was withdrawn: significance of the FINDING is upstream, and
        a finding that reads as unremarkable is a writing fault, which is a
        revision.
        """
        collapsed = " ".join(SYSTEM_PROMPT.split())

        assert "are not verdicts available to you" in collapsed
        assert "You do not have the evidence to re-decide it" in collapsed
        assert "the verdict for that is \"revise\"" in collapsed

    def test_the_brief_never_offers_triviality_back_as_a_reject_reason(self):
        """The rule and its contradiction lived eight lines apart.

        The closing paragraph still read: 'Use "reject" when the story should
        not exist -- the finding is trivial'. A brief that forbids something in
        one paragraph and licenses it in the next is not a brief.
        """
        collapsed = " ".join(SYSTEM_PROMPT.split())

        assert "the finding is trivial, or the data does not support" not in collapsed

    def test_the_brief_tells_the_desk_most_pieces_should_run(self):
        # Without a stated prior the model supplies its own, and its own is
        # "look rigorous". Everything reaching the desk has already passed a
        # validator that proved every figure traceable.
        collapsed = " ".join(SYSTEM_PROMPT.split())

        assert "Most pieces that reach you should end here" in collapsed

    def test_the_brief_forbids_spiking_a_piece_for_a_figure_it_may_not_have(self):
        """The same deadlock, a second time, on a different axis.

        The wire already fixed "the desk asks for a cause the writer may not
        invent". It then reappeared as "the desk asks for a comparison FIGURE
        the writer may not invent" -- four of seven rejections in a live
        production run:

            "lacks a clear comparison basis by not stating the previous
             month's figure"
            "lacks a comparison figure from the previous quarter"
            "lacks a clear comparison to the previous year's retail trade
             volume percentage"

        The writer gets a closed list of verified figures and the validator
        rejects anything outside it. A number that is not on that list cannot be
        added, so demanding one is a demand for a fabrication -- and it was
        being used to spike accurate work, not merely to ask for a rewrite.
        """
        collapsed = " ".join(SYSTEM_PROMPT.split())

        assert "you may not spike a piece for lacking one" in collapsed
        assert "requests for a fabrication" in collapsed
        assert "Judge whether it is clear, not whether it is numeric" in collapsed

    def test_the_final_call_repeats_it_where_the_rejections_happened(self):
        # The rule lived in the system prompt while every one of those
        # rejections was returned from the final call, where the editor is
        # already looking for a reason to say no.
        collapsed = " ".join(FINAL_CALL_PROMPT.split())

        assert "that is not a fault in the piece and not a reason to spike it" in collapsed

    def test_the_prompt_version_moved_with_the_brief(self):
        # Provenance records the desk prompt version. Changing what the editor
        # is asked without changing the version makes two different editorial
        # standards indistinguishable in the audit trail.
        assert DESK_PROMPT_VERSION != "desk-v1"
