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

When that round is used up — because the rewrite could not be produced, or came
back still drawing notes — the desk is asked one last, narrower question: run
this copy, or spike it. It is not a further revision and it cannot become one.
The loop used to answer that question itself, always with "spike", and it was
answering it about articles the validator had already certified and the editor
had only ever called fixable.

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

DESK_PROMPT_VERSION = "desk-v3"

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


#: What the detector found, in the editor's terms rather than the pipeline's.
#:
#: The desk is asked whether a finding is worth a reader's attention, and until
#: now it was shown only the prose. It could not tell the strongest finding in
#: thirty-six Baltic series from an arbitrary number, so it fell back on the one
#: verdict its brief encourages and called them trivial — four of six articles in
#: one run, three of them straight to "reject" without even asking for a rewrite,
#: while the ranking layer had scored those same findings above 0.9.
#:
#: Everything here is deliberately free of digits. These strings can reach the
#: writer as editor notes on a revision, and a numeral in a note is a numeral the
#: writer may put in the article, where it has no verified figure behind it and
#: the validator rejects the piece.
@dataclass(frozen=True, slots=True)
class Finding:
    """The detector's own account of why this story exists."""

    detector: str
    comparison_basis: str
    #: True when this was among the strongest findings the day produced.
    among_strongest: bool

    @property
    def strength(self) -> str:
        if self.among_strongest:
            return (
                "This was among the strongest findings in today's data, across every "
                "Baltic series the pipeline reads."
            )
        return (
            "This cleared the pipeline's quality floor, which is absolute: weaker "
            "candidates are never written up at all."
        )

    def to_review_record(self) -> dict[str, str]:
        return {
            "what_the_detector_found": self.detector,
            "measured_against": self.comparison_basis,
            "how_it_ranked": self.strength,
        }


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
    #: The article the desk last handled, when a rewrite happened — the copy it
    #: DECIDED ABOUT, not the copy it approved. ``action`` carries the verdict.
    #: Not part of ``to_dict``: it is the *subject* of the audit record, not a
    #: field in it. Without this the loop rewrote the piece and the caller
    #: published the draft the editor had just criticised.
    #:
    #: Returning ``None`` on a rejection looks tidy and is a fail-open. The
    #: caller swaps in whatever comes back here, and ``record_decision`` stamps
    #: ``status = "rejected"`` on THIS object — so ``None`` leaves the caller
    #: holding the pre-revision draft, which nothing marked, and it publishes.
    revised_article: Article | None = None

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

You edit. You do not commission, and you do not choose the day's stories: that
was decided before the piece reached you, by a detector reading every Baltic
series the wire follows and an absolute quality floor most candidates never
clear. Your question is whether THIS PIECE is fit to run, not whether the
subject deserved covering. You do not rewrite copy; you say what is wrong with
it in one or two specific sentences a writer can act on.

Judge only these things:

1. Does it explain, or only recite? A wire item that restates a number without
   saying what changed, against what, and why it might matter is not a story.
2. Is the comparison basis stated? "Fell to 6.6%" from what, over what period.
3. Is anything asserted that the data does not support? Vague causal claims
   ("may be attributed to various factors") are worse than saying nothing.
4. Does it read like a newspaper? Plain, active, specific. No essay scaffolding,
   no journalese, no hedging that survives being deleted.

ON "WHY IT MATTERS", WHICH IS WHERE YOU ARE HARSHEST AND MOST OFTEN WRONG:

Rules 1 and 3 pull against each other, and 3 wins. This wire reports from open
statistical data. It usually cannot establish WHY a series moved, and it is
forbidden from guessing. So do not send a piece back for failing to explain a
cause it has no source for. Asking for that is asking for the fabrication rule
3 exists to prevent, and it is the most common mistake you make.

"Why it matters" is answerable from the data alone, and that is enough:
- is this a record, or ordinary movement in a series that moves?
- how big is it against its own history?
- which country, which sector, which measure?
- what would the next release have to show to confirm or overturn it?

A piece that states its basis, is accurate, says plainly that the data does not
show what drove the change, and reads like a wire, RUNS. That is a complete
data-wire story. Withholding it does not protect the reader from anything.

CHOOSING BETWEEN THE THREE VERDICTS. This is the part you get wrong most often,
and getting it wrong is expensive in both directions.

  approve -- it is fit to run. Most pieces that reach you should end here. They
    have already passed a validator that proved every figure traceable to the
    source, so the question in front of you is quality of writing, not accuracy.
    Do not invent faults to look rigorous.

  revise -- there is a real fault and a writer could fix it. Thin explanation,
    a missing comparison basis, a vague assertion, flabby prose: all of these
    are revisions. If you can name what a rewrite should do differently, the
    verdict is "revise", not "reject".

  reject -- the piece should not exist in any form. This is rare. Use it when
    the article asserts something the data does not support and removing the
    assertion would leave nothing, or when it is so confused that notes cannot
    rescue it.

WHAT "REJECT" IS NOT FOR. You are shown the finding behind each piece: what the
detector found, what it is measured against, and how it ranked against every
other candidate in the day's data. That is context for reading the piece. It is
not an invitation to re-decide whether the story was worth commissioning.

You do not have the evidence to re-decide it. You see one article; the detector
saw every series the wire reads and ranked this one above the rest. So "the
finding is trivial", "it lacks news value", "it lacks significance" are not
verdicts available to you. If a record, a multi-year streak or a departure from
a seasonal norm reads as unremarkable on the page, that is a failure of the
WRITING to convey what the finding is -- and the verdict for that is "revise".

You may NOT ask for a figure that is not already in the article, and you may not
spike a piece for lacking one. The writer is given a closed list of verified
figures and is forbidden from supplying any number outside it, so "it does not
state the previous month's figure", "there is no comparison figure from the
previous quarter", "the earlier percentage is missing" are all requests for a
fabrication wearing the clothes of rigour. The number is not absent because the
writer was lazy; it is absent because the pipeline did not verify it.

What the piece must carry is the comparison BASIS in words -- what the movement
is measured against -- and the pipeline has already checked that it does. A
basis stated in words with no second number beside it is complete. Judge whether
it is clear, not whether it is numeric.

Reply as JSON only:
{"decision": "approve" | "revise" | "reject", "reason": "<one sentence>",
 "notes": ["<specific, actionable>", ...]}"""


def _article_for_review(article: Article, finding: Finding | None = None) -> str:
    body = "\n\n".join(block.text or "" for block in (article.body or []) if block.text)
    payload: dict[str, Any] = {
        "headline": article.headline,
        "dek": article.dek,
        "body": body,
        "section": article.section,
    }
    if finding is not None:
        payload["the_finding_behind_this_piece"] = finding.to_review_record()
    return json.dumps(payload, ensure_ascii=False, indent=2)


def review_original_article(
    article: Article,
    writer: LlmWriter,
    *,
    style_notes: Sequence[str] = (),
    finding: Finding | None = None,
) -> DeskOutcome:
    """One editorial pass. Never raises — a broken desk holds, it does not publish."""
    deterministic: list[str] = list(style_notes)
    _, violations, _ = review_headline(article.headline)
    deterministic.extend(violations)
    for index, block in enumerate(article.body or []):
        if block.text:
            deterministic.extend(check_prose(block.text, where=f"body[{index}]"))

    user = _article_for_review(article, finding)
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


FINAL_CALL_PROMPT = """{situation}

Your notes were:

{notes}

This is now a straight choice on the copy above -- which has passed the
accuracy checks, and whose figures are all traceable to the source. Either it
runs in this form or it does not run at all. "revise" is not available to you;
asking again produces nothing and spikes the piece.

Before you answer, check what your remaining objection actually is. If it is
that some figure is missing -- the previous month's level, last year's
percentage, the earlier quarter -- that is not a fault in the piece and not a
reason to spike it. The writer may only use figures the pipeline verified, and
a number it was never given cannot be added without inventing it. The
comparison basis it does state has already been checked.

Approve it if it is worth a reader's time despite the fault you named. Reject it
if the fault is bad enough that publishing would be worse than staying silent.
Answer with "approve" or "reject" only."""

#: Why the editor is being asked to decide now. Both paths end in the same
#: place -- there is no further rewrite - and the editor should know which one
#: it is, because "the writer could not produce a draft" and "this is the draft
#: it produced" are different pieces of information about the copy in hand.
NO_REWRITE_PRODUCED = (
    "THE REWRITE YOU ASKED FOR COULD NOT BE PRODUCED. The writer tried and "
    "every draft it returned failed the accuracy checks, so there is nothing "
    "better than the copy above and there will not be."
)
OUT_OF_REWRITES = (
    "THIS IS THE REWRITE YOU ASKED FOR, AND IT IS THE LAST ONE. You have "
    "already sent the piece back once. A desk that can send it back forever is "
    "a loop with a token budget attached, so there are no further rewrites."
)


def _final_call(
    article: Article,
    writer: LlmWriter,
    *,
    finding: Finding | None,
    notes: Sequence[str],
    situation: str,
) -> DeskOutcome:
    """Run the copy in hand, or spike it. The editor decides, not the loop.

    Both ways out of the revision loop used to discard the article on their own
    authority, and both were discarding correct work:

    * a rewrite that could not be produced turned every "revise" the writer
      failed to satisfy into a rejection -- four of seven articles in one live
      run, each accurate, each already certified by the validator, none of them
      ever actually refused by the editor;
    * a rewrite the desk still had notes on was spiked as "still unsatisfactory"
      even though the note was "revise" -- a fixable fault -- and the draft in
      hand had passed the validator.

    Publishing regardless would be the opposite error: it would let the writer's
    limits override the desk. So the desk is asked once more, plainly, on the
    copy that exists, and remains accountable for what runs.
    """
    listed = "\n".join(f"- {note}" for note in notes if str(note).strip())
    user = _article_for_review(article, finding) + "\n\n" + FINAL_CALL_PROMPT.format(
        situation=situation,
        notes=listed or "- the editor did not record a specific note",
    )

    try:
        payload = writer.complete_json(system=SYSTEM_PROMPT, user=user, max_tokens=400)
    except Exception as exc:  # noqa: BLE001
        log.exception("final call failed for %s", article.id)
        return DeskOutcome(
            article_id=article.id,
            action=DeskAction.REJECT,
            reason=f"editorial review unavailable for the final call: {exc}",
            editor=_editor_name(),
            decided_at=_now(),
            revisions=MAX_REVISIONS,
            notes=tuple(notes),
        )

    raw = str(payload.get("decision", "")).strip().lower()
    reason = str(payload.get("reason", "")).strip() or "no reason given"
    # Anything that is not an explicit approval is a refusal. "revise" was taken
    # off the table, so returning it is not a third answer -- it is the editor
    # declining to approve, and this fails closed like everything else here.
    approved = raw == DeskAction.APPROVE.value

    return DeskOutcome(
        article_id=article.id,
        action=DeskAction.APPROVE if approved else DeskAction.REJECT,
        reason=(
            f"no further rewrite was possible; ran as filed: {reason}"
            if approved
            else f"no further rewrite was possible and it was not approved: {reason}"
        ),
        editor=_editor_name(),
        decided_at=_now(),
        revisions=MAX_REVISIONS,
        notes=tuple(notes),
        model=getattr(writer, "model_name", None),
    )


def run_desk(
    article: Article,
    writer: LlmWriter,
    *,
    style_notes: Sequence[str] = (),
    revise: RevisionCallback | None = None,
    finding: Finding | None = None,
) -> DeskOutcome:
    """Review, optionally send back once, review again, then decide.

    ``revise`` regenerates the article from the editor's notes and returns the
    revised one, or ``None`` if it could not. It is injected rather than
    imported so this module has no opinion about how writing happens — and so
    the tests can drive the loop without an LLM.

    ``finding`` is the detector's account of why the story exists. It is passed
    to both reads, because the second read is the one that decides and an editor
    who was shown the evidence once and not again is not the same editor.

    The second review is final. If the desk still wants changes after one
    revision the article is held, because a desk that can ask forever is a loop
    with a token budget attached.
    """
    outcome = review_original_article(
        article, writer, style_notes=style_notes, finding=finding
    )

    if outcome.action is not DeskAction.REVISE or revise is None:
        record_decision(article, outcome)
        return outcome

    for attempt in range(1, MAX_REVISIONS + 1):
        log.info("desk sent %s back with %d note(s)", article.id, len(outcome.notes))
        revised = revise(article, outcome.notes)
        if revised is None:
            # The rewrite could not be produced. The copy in hand still passed
            # the validator and the editor's verdict was "revise", not "reject",
            # so the piece is not condemned -- the improvement simply failed.
            # Put it back in front of the editor for a straight run-or-spike.
            final = _final_call(
                article,
                writer,
                finding=finding,
                notes=outcome.notes,
                situation=NO_REWRITE_PRODUCED,
            )
            final = DeskOutcome(
                article_id=final.article_id,
                action=final.action,
                reason=final.reason,
                editor=final.editor,
                decided_at=final.decided_at,
                revisions=attempt,
                notes=final.notes,
                model=final.model,
                # The copy the desk ruled on, whichever way it ruled. See the
                # note on the other final-call site: handing back None on a
                # rejection is a fail-open, not a tidy-up.
                revised_article=article,
            )
            record_decision(article, final)
            return final

        article = revised
        outcome = review_original_article(article, writer, style_notes=(), finding=finding)
        outcome = DeskOutcome(
            article_id=outcome.article_id,
            action=outcome.action,
            reason=outcome.reason,
            editor=outcome.editor,
            decided_at=outcome.decided_at,
            revisions=attempt,
            notes=outcome.notes,
            model=outcome.model,
            revised_article=article,
        )
        if outcome.action is not DeskAction.REVISE:
            break

    if outcome.action is DeskAction.REVISE:
        # Out of rewrites, with a draft in hand that passed the validator and an
        # editor who called the remaining fault fixable rather than fatal. The
        # loop used to spike it here on its own authority — "still
        # unsatisfactory after revision" — which is the same mistake as spiking
        # a rewrite that could not be produced, and cost four of six articles in
        # a live run. Same rule, applied uniformly: the editor decides.
        final = _final_call(
            article,
            writer,
            finding=finding,
            notes=outcome.notes,
            situation=OUT_OF_REWRITES,
        )
        outcome = DeskOutcome(
            article_id=final.article_id,
            action=final.action,
            reason=final.reason,
            editor=final.editor,
            decided_at=final.decided_at,
            revisions=MAX_REVISIONS,
            notes=final.notes,
            model=final.model,
            # ALWAYS the copy the desk ruled on, including when it ruled
            # against it. `record_decision` below stamps `status = "rejected"`
            # on THIS object, and the caller republishes whatever comes back
            # here — so returning None on a rejection leaves the caller holding
            # the pre-revision draft, which nothing ever marked rejected, and
            # it publishes. Six articles reached the wire that way against
            # three approvals, the desk's refusals having no effect at all.
            #
            # This field is "what the desk decided about", not "what it
            # approved". The action carries the verdict.
            revised_article=article,
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
