"""A desk rejection must actually stop the article.

WHAT HAPPENED
-------------
``run_desk`` reassigns its local ``article`` to the rewrite, then calls
``record_decision(article, outcome)`` — so ``status = "rejected"`` lands on the
REWRITE. The caller does the mirror-image thing::

    if outcome.revised_article is not None:
        generated.article = outcome.revised_article

Between them, ``revised_article`` is the only channel by which the caller learns
which object the verdict was stamped on. Setting it to ``None`` on a rejection —
which reads as a harmless tidy-up, "there is no approved article to hand back" —
leaves the caller holding the pre-revision draft. Nothing ever marked that one,
its status is still ``published``, and it publishes.

A live run made this concrete: the desk approved three articles and rejected
three, and six reached the wire. Every refusal was silently discarded.

WHAT THIS ASSERTS
-----------------
The property, at the seam where it broke: after the desk refuses a piece, the
article the *caller* is holding is not servable. Both refusal paths are covered,
because they build their outcome separately and only one of them was wrong.
"""

from __future__ import annotations

from typing import Any

from newsroom.pipeline.desk import DeskAction, run_desk
from newsroom.pipeline.models import Article, Block
from newsroom.pipeline.publish import is_servable


class QueuedWriter:
    model_name = "fake-model"

    def __init__(self, *responses: dict[str, Any]) -> None:
        self._responses = list(responses)

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, Any]:
        if not self._responses:
            raise AssertionError("the desk asked for more reviews than the test queued")
        return self._responses.pop(0)


def _article(headline: str = "Latvian retail volume rises in June") -> Article:
    return Article(
        id="01ARTICLE",
        slug="latvian-retail-volume-rises",
        tier="A",
        status="published",
        headline=headline,
        section="economy",
        created_at="2026-08-25T14:00:00Z",
        provenance={"validator": {"passed": True, "checks": []}},
        body=[Block(type="paragraph", text="Volume rose 4.8% in June.")],
    )


def _what_the_caller_would_publish(original: Article, outcome) -> Article:
    """Exactly what ``run_once`` does with the outcome."""
    if outcome.revised_article is not None:
        return outcome.revised_article
    return original


class TestARefusalIsNotSilentlyDiscarded:
    def test_a_rejection_after_a_rewrite_leaves_nothing_servable(self):
        original = _article()
        rewritten = _article(headline="Latvian retail volume climbs in June")
        writer = QueuedWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain it"]},
            {"decision": "revise", "reason": "still thin", "notes": ["explain it"]},
            {"decision": "reject", "reason": "unsupported assertion"},
        )

        outcome = run_desk(original, writer, revise=lambda a, n: rewritten)

        assert outcome.action is DeskAction.REJECT
        assert not is_servable(_what_the_caller_would_publish(original, outcome)), (
            "the desk refused this piece and the caller is still holding a "
            "servable article"
        )

    def test_a_rejection_when_no_rewrite_could_be_produced_leaves_nothing_servable(self):
        original = _article()
        writer = QueuedWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain it"]},
            {"decision": "reject", "reason": "not fit as filed"},
        )

        outcome = run_desk(original, writer, revise=lambda a, n: None)

        assert outcome.action is DeskAction.REJECT
        assert not is_servable(_what_the_caller_would_publish(original, outcome))

    def test_a_first_read_rejection_leaves_nothing_servable(self):
        original = _article()
        writer = QueuedWriter({"decision": "reject", "reason": "unsupported"})

        outcome = run_desk(original, writer, revise=lambda a, n: _article())

        assert not is_servable(_what_the_caller_would_publish(original, outcome))

    def test_an_approval_after_a_rewrite_publishes_the_rewrite(self):
        """The other half of the same property: approvals must not be lost either."""
        original = _article()
        rewritten = _article(headline="Latvian retail volume climbs in June")
        writer = QueuedWriter(
            {"decision": "revise", "reason": "thin", "notes": ["explain it"]},
            {"decision": "approve", "reason": "fixed"},
        )

        outcome = run_desk(original, writer, revise=lambda a, n: rewritten)

        published = _what_the_caller_would_publish(original, outcome)
        assert is_servable(published)
        assert published is rewritten
