"""The desk: an AI editor reads original reporting before a reader does.

Until now tier A went straight from the writer to the wire once the validator
passed. That gap is the difference between a checked article and an edited one.
The validator answers "is every figure traceable and is the disclosure intact",
which is a question about correctness. It has nothing to say about whether the
piece is worth a reader's time, whether it explains what it reports, or whether
it reads like it was written by someone who cared.

So Dace Saulkrasti now reads every original article and returns one of three
decisions:

    APPROVE   run it
    REVISE    send it back with notes, once
    REJECT    it should not run

A revision is bounded to one round, deliberately. An editor who can send a piece
back indefinitely is a loop with a token budget attached, and the second draft is
where almost all of the improvement lives anyway.

WHAT THIS IS NOT
----------------
It is not a second validator. The validator has already run and its verdict is
absolute: an article that fails it never reaches the desk, and no editorial
opinion can overturn that. The desk only ever *narrows* what publishes. There is
no path here by which a rejected article becomes publishable, which is the same
fail-closed property the rest of the pipeline has.

It is also not a human. Every decision it makes is recorded in the article's
provenance under the editor's name, so a reader can see that a machine reviewed
a machine, and Andre Kopu remains accountable for the arrangement.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol, Sequence

from newsroom.pipeline.editor import EDITOR_PROMPT_VERSION
from newsroom.pipeline.house_style import check_prose, review_headline
from newsroom.pipeline.models import Article
from newsroom.pipeline.write.llm import LlmWriter

log = logging.getLogger(__name__)

DESK_PROMPT_VERSION = "desk-v1"

#: One revision. See the module docstring for why it is not more.
MAX_REVISIONS = 1


class RevisionCallback(Protocol):
    """Rewrites an article from the editor's notes, or returns ``None``.

    Injected rather than imported so this module has no opinion about how
    writing happens, and so the tests can drive the loop without an LLM.
    """

    def __call__(self, article: Article, notes: Sequence[str]) -> Article | None:
        ...


class DeskAction(str, Enum):
    APPROVE = "approve"
    REVISE = "revise"
    REJECT = "reject"


@dataclass(frozen=True, slots=True)
class DeskOutcome:
    """The audit record for one editorial decision on an original article."""

    article_id: str
    action: DeskAction
    reason: str
    editor: str
    decided_at: str
    revisions: int = 0
    notes: tuple[str, ...] = ()
    model: str | None = None

    @property
    def publishable(self) -> bool:
        return self.action is DeskAction.APPROVE

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "prompt_version": DESK_PROMPT_VERSION,
            "decision": self.action.value,
            "reason": self.reason,
            "editor": self.editor,
            "decided_at": self.decided_at,
            "revisions": self.revisions,
        }
        if self.notes:
            payload["notes"] = list(self.notes)
        if self.model:
            payload["model"] = self.model
        return payload


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _editor_name() -> str:
    return "Dace Saulkrasti"


SYSTEM_PROMPT = """You are Dace Saulkrasti, the editor of portaBaltica, a Baltic
data-journalism wire. You read original articles written by AI correspondents
from open statistical data, and you decide whether each one runs.

You are sparse and gatekeeping. You are more interested in what should not
publish than in polishing what might. You do not rewrite copy; you say what is
wrong with it in one or two specific sentences a writer can act on.

Judge only these things:

1. Does it explain, or only recite? A wire item that restates a number without
   saying what changed, against what, and why it might matter is not a story.
2. Is the comparison basis stated? "Fell to 6.6%" from what, over what period.
3. Is anything asserted that the data does not support? Vague causal claims
   ("may be attributed to various factors") are worse than saying nothing.
4. Does it read like a newspaper? Plain, active, specific. No essay scaffolding,
   no journalese, no hedging that survives being deleted.

You may NOT ask for a figure that is not already in the article. The writer is
forbidden from supplying numbers from memory, so a note asking for one is a note
asking for a fabrication.

Reply as JSON only:
{"decision": "approve" | "revise" | "reject", "reason": "<one sentence>",
 "notes": ["<specific, actionable>", ...]}

Use "revise" when the faults are fixable in a rewrite. Use "reject" when the
story should not exist — the finding is trivial, or the data does not support a
story at all. Use "approve" when it is fit to run; do not invent faults to look
rigorous."""


def _article_for_review(article: Article) -> str:
    body = "\n\n".join(block.text or "" for block in (article.body or []) if block.text)
    return json.dumps(
        {
            "headline": article.headline,
            "dek": article.dek,
            "body": body,
            "section": article.section,
        },
        ensure_ascii=False,
        indent=2,
    )


def review_original_article(
    article: Article,
    writer: LlmWriter,
    *,
    style_notes: Sequence[str] = (),
) -> DeskOutcome:
    """One editorial pass. Never raises — a broken desk holds, it does not publish."""
    deterministic: list[str] = list(style_notes)
    _, violations, _ = review_headline(article.headline)
    deterministic.extend(violations)
    for index, block in enumerate(article.body or []):
        if block.text:
            deterministic.extend(check_prose(block.text, where=f"body[{index}]"))

    user = _article_for_review(article)
    if deterministic:
        user += "\n\nThe copy desk already flagged:\n" + "\n".join(
            f"- {note}" for note in deterministic
        )

    try:
        payload = writer.complete_json(system=SYSTEM_PROMPT, user=user, max_tokens=400)
    except Exception as exc:  # noqa: BLE001
        # Fail closed. An editor that cannot be reached is not an approval.
        log.exception("desk review failed for %s", article.id)
        return DeskOutcome(
            article_id=article.id,
            action=DeskAction.REJECT,
            reason=f"editorial review unavailable: {exc}",
            editor=_editor_name(),
            decided_at=_now(),
        )

    raw = str(payload.get("decision", "")).strip().lower()
    try:
        action = DeskAction(raw)
    except ValueError:
        log.warning("desk returned an unusable decision %r for %s", raw, article.id)
        return DeskOutcome(
            article_id=article.id,
            action=DeskAction.REJECT,
            reason=f"editorial decision not understood: {raw!r}",
            editor=_editor_name(),
            decided_at=_now(),
        )

    notes = tuple(str(n).strip() for n in (payload.get("notes") or []) if str(n).strip())
    reason = str(payload.get("reason", "")).strip() or "no reason given"

    return DeskOutcome(
        article_id=article.id,
        action=action,
        reason=reason,
        editor=_editor_name(),
        decided_at=_now(),
        notes=notes,
        model=getattr(writer, "model_name", None),
    )


def run_desk(
    article: Article,
    writer: LlmWriter,
    *,
    style_notes: Sequence[str] = (),
    revise: RevisionCallback | None = None,
) -> DeskOutcome:
    """Review, optionally send back once, review again, then decide.

    ``revise`` regenerates the article from the editor's notes and returns the
    revised one, or ``None`` if it could not. It is injected rather than
    imported so this module has no opinion about how writing happens — and so
    the tests can drive the loop without an LLM.

    The second review is final. If the desk still wants changes after one
    revision the article is held, because a desk that can ask forever is a loop
    with a token budget attached.
    """
    outcome = review_original_article(article, writer, style_notes=style_notes)

    if outcome.action is not DeskAction.REVISE or revise is None:
        record_decision(article, outcome)
        return outcome

    for attempt in range(1, MAX_REVISIONS + 1):
        log.info("desk sent %s back with %d note(s)", article.id, len(outcome.notes))
        revised = revise(article, outcome.notes)
        if revised is None:
            held = DeskOutcome(
                article_id=article.id,
                action=DeskAction.REJECT,
                reason="revision requested but the article could not be rewritten",
                editor=_editor_name(),
                decided_at=_now(),
                revisions=attempt,
                notes=outcome.notes,
                model=outcome.model,
            )
            record_decision(article, held)
            return held

        article = revised
        outcome = review_original_article(article, writer, style_notes=())
        outcome = DeskOutcome(
            article_id=outcome.article_id,
            action=outcome.action,
            reason=outcome.reason,
            editor=outcome.editor,
            decided_at=outcome.decided_at,
            revisions=attempt,
            notes=outcome.notes,
            model=outcome.model,
        )
        if outcome.action is not DeskAction.REVISE:
            break

    if outcome.action is DeskAction.REVISE:
        # Still not right after its one rewrite. Hold it.
        outcome = DeskOutcome(
            article_id=outcome.article_id,
            action=DeskAction.REJECT,
            reason=f"still unsatisfactory after revision: {outcome.reason}",
            editor=outcome.editor,
            decided_at=outcome.decided_at,
            revisions=MAX_REVISIONS,
            notes=outcome.notes,
            model=outcome.model,
        )

    record_decision(article, outcome)
    return outcome


def record_decision(article: Article, outcome: DeskOutcome) -> None:
    """Writes the decision into the article's provenance, where readers see it."""
    provenance = dict(article.provenance or {})
    provenance["editor"] = outcome.to_dict()
    if outcome.publishable:
        provenance["approved_by"] = outcome.editor
        provenance["approved_at"] = outcome.decided_at
    article.provenance = provenance

    if not outcome.publishable:
        # The gate. A held article keeps its passing validator verdict — it was
        # correct — but it does not publish, and isServable() refuses it on the
        # reader side for exactly that reason.
        article.status = "rejected"
