"""The desk's "revise" verdict must actually cause a rewrite.

WHAT HAPPENED
-------------
``run_desk`` takes a revision callback and holds the article whenever one is
not supplied::

    if outcome.action is not DeskAction.REVISE or revise is None:
        record_decision(article, outcome)
        return outcome

The production run never supplied one. In a live run on 2026-08-25 the desk
returned six ``revise`` verdicts and two ``reject``; nothing was rewritten and
nothing published. The editorial loop was built, unit-tested and wired to
nothing — the same shape as the inert ``chart_ref`` before it.

The whole suite stayed green, because every existing desk test passes the
callback in explicitly. They proved the loop works when driven, which was never
in doubt; nothing asserted the pipeline drives it.

And a second fault sat behind the first: ``run_desk`` returned only a
``DeskOutcome``, so even once a rewrite happened the caller still held the
original draft and would have published the very text the editor sent back.

WHAT THIS ASSERTS
-----------------
The wiring, from the outside: give the desk a reason to send something back,
and the piece that publishes is the rewritten one.
"""

from __future__ import annotations

import inspect
from typing import Any

from newsroom.pipeline import run as run_module
from newsroom.pipeline.desk import DeskAction, run_desk
from newsroom.pipeline.models import Article, Block


class QueuedWriter:
    """Returns the desk decisions the test queued, in order."""

    model_name = "fake-model"

    def __init__(self, *responses: dict[str, Any]) -> None:
        self._responses = list(responses)

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, Any]:
        if not self._responses:
            raise AssertionError("the desk asked for more reviews than the test queued")
        return self._responses.pop(0)


def _article(headline: str = "Latvian unemployment reaches a monthly high") -> Article:
    return Article(
        id="01ARTICLE",
        slug="latvian-unemployment-high",
        tier="A",
        status="published",
        headline=headline,
        section="labour",
        created_at="2026-08-25T14:00:00Z",
        provenance={"validator": {"passed": True, "checks": []}},
        body=[Block(type="paragraph", text="The rate reached 6.8% in July.")],
    )


def _call_arguments(source: str, function: str) -> str:
    """The argument text of ``function(...)``, matching brackets properly.

    An earlier version cut at the first ``)``, which worked only while no
    argument contained a call of its own. Scoping the style notes introduced
    ``style_by_article.get(article.id, ())`` and the naive split reported that
    ``revise=`` had been removed — a false alarm on a correct change is worse
    than no test, because the next person deletes the test.
    """
    start = source.index(function + "(") + len(function) + 1
    depth = 1
    for index in range(start, len(source)):
        char = source[index]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
            if depth == 0:
                return source[start:index]
    raise AssertionError(f"unbalanced call to {function}(")


class TestTheRunWiresTheLoop:
    def test_run_once_passes_a_revision_callback_to_the_desk(self):
        """The exact omission, asserted directly.

        A behavioural test would be better, but this failure was invisible
        precisely because the behaviour is only reachable through a live model.
        Reading the call is the cheapest thing that goes red when the argument
        disappears again.
        """
        source = inspect.getsource(run_module.run_once)

        assert "run_desk(" in source, "the run no longer calls the desk at all"
        desk_call = _call_arguments(source, "run_desk")
        assert "revise=" in desk_call, (
            "run_once calls run_desk without a revision callback, so every "
            "'revise' verdict silently holds the article instead of rewriting it"
        )

    def test_the_desk_is_given_the_context_the_writer_had(self):
        """Or it cannot tell a piece with no context from one that ignored it."""
        desk_call = _call_arguments(inspect.getsource(run_module.run_once), "run_desk")

        assert "pack=" in desk_call
        assert "brief=" in desk_call

    def test_the_revision_helper_exists_and_returns_a_callable(self):
        assert callable(run_module._revision_for)


class TestTheRevisedArticleIsTheOneThatPublishes:
    def test_the_outcome_carries_the_rewrite_back_to_the_caller(self):
        original = _article()
        rewritten = _article(headline="Latvian unemployment climbs to a monthly high")
        rewritten.body = [Block(type="paragraph", text="The rate reached 6.8% in July, up from 6.5%.")]

        writer = QueuedWriter(
            {"decision": "revise", "reason": "needs a comparison basis",
             "notes": ["say what it is being compared with"]},
            {"decision": "approve", "reason": "fixed", "notes": []},
        )

        outcome = run_desk(original, writer, revise=lambda article, notes: rewritten)

        assert outcome.action is DeskAction.APPROVE
        assert outcome.revised_article is rewritten, (
            "the rewrite must reach the caller, or the run publishes the draft "
            "the editor just sent back"
        )

    def test_a_revision_that_cannot_be_written_runs_as_filed(self):
        """The desk asked for a revision, which asserts the story should run.

        The article already passed the validator, so it is correct. Holding it
        because the *rewrite* failed the gate trades a true story for nothing.
        """
        original = _article()
        writer = QueuedWriter(
            {"decision": "revise", "reason": "needs work", "notes": ["fix it"]},
        )

        outcome = run_desk(original, writer, revise=lambda article, notes: None)

        assert outcome.action is DeskAction.APPROVE
        assert outcome.notes_outstanding is True

    def test_a_rewrite_the_desk_still_dislikes_runs_with_notes_outstanding(self):
        original = _article()
        rewritten = _article(headline="Latvian unemployment climbs again in July")
        writer = QueuedWriter(
            {"decision": "revise", "reason": "needs work", "notes": ["fix it"]},
            {"decision": "revise", "reason": "still vague", "notes": ["still vague"]},
        )

        outcome = run_desk(original, writer, revise=lambda article, notes: rewritten)

        assert outcome.action is DeskAction.APPROVE
        assert outcome.notes_outstanding is True
        assert outcome.revised_article is rewritten

    def test_an_explicit_rejection_is_still_a_rejection(self):
        """The gate that was not loosened, asserted next to the ones that were."""
        original = _article()
        writer = QueuedWriter({"decision": "reject", "reason": "trivial finding"})

        outcome = run_desk(original, writer, revise=lambda article, notes: original)

        assert outcome.action is DeskAction.REJECT
        assert not outcome.publishable
        assert original.status == "rejected"


class TestStyleNotesAreScopedToOneArticle:
    """The editor must not be shown another story's copy-desk complaints.

    ``report.style_notes`` accumulates across the whole run. Passing it to
    every review meant each article's editor read every *other* article's style
    problems and demanded they be fixed here. A live piece was sent back to
    correct a Title Case headline that belonged to a different story and had
    already been corrected deterministically — and the rewrite it forced then
    failed the arithmetic gate, so the article was lost outright.
    """

    def test_the_desk_is_not_handed_the_whole_runs_notes(self) -> None:
        source = inspect.getsource(run_module.run_once)

        assert "style_notes=report.style_notes" not in source, (
            "every article's editor is being shown every other article's style "
            "notes; scope them per article"
        )
        assert "style_by_article" in source

    def test_notes_reach_the_review_for_the_article_they_belong_to(self) -> None:
        seen: list[str] = []

        class Recorder:
            model_name = "recorder"

            def complete_json(self, *, system: str, user: str, max_tokens: int) -> Any:
                seen.append(user)
                return {"decision": "approve", "reason": "fine", "notes": []}

        run_desk(_article(), Recorder(), style_notes=["body[0]: says nothing, 'notably'"])

        assert "says nothing" in seen[0]
