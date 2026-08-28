"""Correcting an article the newsroom got wrong, without withdrawing it.

WHY THIS IS NEITHER ``revisions.py`` NOR ``retract.py``
-------------------------------------------------------
The published corrections policy names two remedies, and the pipeline
implemented one and a half of them:

    Correction — a factual error: a wrong figure, a misstated comparison.
    Retraction — the story should not have been published: the underlying data
                 was invalid, or the premise was wrong.

``retract.py`` is the second. ``revisions.py`` looks like the first and is not:
it handles the case where **the source** restated a figure after we published
it, and its public sentence ends

    "Statistical agencies revise routinely — this is a restatement by the
     source, not a reporting error."

which is true there and a lie about anything we got wrong ourselves. So a
factual error of our own — the category the policy leads with — had nowhere to
go. The only tool that fitted was retraction, which withdraws the article, and
using it on a piece whose figures and premise are sound would destroy correct
journalism to fix a label.

That gap was found by needing it. On 2026-08-28 an article published:

    "Dr. Ineta Zvirbule suggests this is a likely explanation, but the data
     cannot confirm it."

No such economist exists — she is a role on the causal panel, not a person, and
was given an invented name by a defect since fixed. Everything else in the piece
is right: the figures, the comparison basis, the finding, and the substance of
the hypothesis itself. There is nothing to retract and one sentence to correct.

WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
--------------------------------------------------
* Appends a note to the article's ``corrections``, which ``ArticleView`` renders
  in a warning panel **above the body** — so a reader meets the correction
  before the sentence it is about.
* Appends the same note to the public corrections log at ``/corrections``.
* Leaves ``status`` as ``published``. See :func:`newsroom.pipeline.revisions.annotate`
  for why touching it would delete the article from the site at the moment it
  was corrected.
* **Does not touch the prose.** ``retract.py`` states the rule for the whole
  apparatus — *"Nothing here rewrites the article's prose. The record is
  append-only"* — and it is the rule that makes a correction worth anything.

That last point was argued rather than assumed, because the obvious alternative
is to repair the sentence at render time, the way ``analystLabel`` repairs the
provenance block. Three reasons it is wrong here:

1. The provenance block is the site's own chrome *describing* its data; the
   body is the article. Relabelling the first explains a record, relabelling
   the second edits one.
2. **A correction and a silent rewrite are incompatible, not complementary.** A
   note saying "we credited Dr Zvirbule" beside a paragraph that no longer says
   it describes a state the reader cannot check. A correction that cannot be
   verified against the page is worse than no correction, because it asks for
   trust while removing the evidence.
3. It is what this newsroom already promises. The retraction notice says "The
   page remains here, unchanged, so the record of what we published is public",
   and a site whose argument is disclosure does not quietly edit an
   embarrassment out of its own archive.

WHY THE LIST LIVES IN CODE
--------------------------
An editorial correction cannot be detected — that is what distinguishes it from
the revision watch, which computes its own subject every run. Somebody has to
decide that a published sentence was wrong. Declaring that decision here, applied
idempotently on each run, means it is reviewed like any other change and leaves a
diff; the alternative is an operator editing a blob by hand, which is
unreviewable and unrepeatable.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from newsroom.pipeline.models import isoformat, utcnow
from newsroom.pipeline.publish import ArticleStore

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class EditorialCorrection:
    """A factual error of ours, on an article that otherwise stands."""

    slug: str
    #: What was wrong and what is true, in plain terms. "An error occurred"
    #: asks for trust rather than earning it, which is ``retract.py``'s rule for
    #: the same reason.
    description: str
    #: The wording as published, when quoting it helps a reader find the
    #: sentence. Optional in the schema, and worth setting: a correction about
    #: a phrase is much easier to check against the page than one about a topic.
    previous_value: str | None = None

    def to_correction(self) -> dict[str, str]:
        """Shaped by ``corrections`` in ``schemas/article.schema.json``."""
        note: dict[str, str] = {
            "corrected_at": isoformat(utcnow()),
            "description": self.description,
        }
        if self.previous_value:
            note["previous_value"] = self.previous_value
        return note

    def to_log_entry(self, note: Mapping[str, str], headline: str) -> dict[str, str]:
        """Shaped by ``CorrectionLogEntry`` in ``src/news-api.ts``.

        Takes the note already written onto the article rather than building a
        second one, so the log and the article can never disagree about the
        wording or the timestamp — the same rule
        :meth:`newsroom.pipeline.revisions.Revision.to_log_entry` follows.
        """
        entry = {
            "slug": self.slug,
            "headline": headline,
            "corrected_at": note["corrected_at"],
            "description": note["description"],
        }
        if note.get("previous_value"):
            entry["previous_value"] = note["previous_value"]
        return entry


def already_recorded(
    article_corrections: Sequence[Mapping[str, Any]], correction: EditorialCorrection
) -> bool:
    """Has this correction already been noted on the article?

    Matched on the description text rather than on a stored identifier, for the
    same reason ``revisions.already_recorded`` is: there is no id on a note
    written before this module existed, and a correction that re-appends itself
    every run turns the warning panel into a wall of the same sentence.
    """
    return any(
        str(existing.get("description") or "").strip() == correction.description.strip()
        for existing in article_corrections
    )


def annotate(
    document: Mapping[str, Any], correction: EditorialCorrection
) -> dict[str, Any] | None:
    """Append the note, or ``None`` if it is already there.

    Returns a new document rather than mutating, so a caller that decides not to
    write cannot have already changed the record.
    """
    corrections = list(document.get("corrections") or [])
    if already_recorded(corrections, correction):
        return None
    corrections.append(correction.to_correction())
    updated = dict(document)
    updated["corrections"] = corrections
    return updated


async def issue(
    store: ArticleStore, corrections: Sequence[EditorialCorrection]
) -> list[str]:
    """Apply each correction to its article. Returns the slugs actually changed.

    Idempotent and independent: a correction whose article is missing, already
    corrected, or unreadable is skipped without touching the others. Never
    raises — a correction that cannot be filed must not take an edition down,
    and the next run will try again.
    """
    changed: list[str] = []
    log_entries: list[dict[str, str]] = []

    for correction in corrections:
        try:
            document = await store.read_published(correction.slug)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not read %s to correct it: %s", correction.slug, exc)
            continue
        if document is None:
            log.info("nothing to correct: %s is not published", correction.slug)
            continue
        # A retracted article already carries a louder notice, and appending a
        # correction to a withdrawn story tells a reader we amended something
        # we had disowned.
        if document.get("status") != "published":
            log.info(
                "skipping %s: status is %r, not published",
                correction.slug,
                document.get("status"),
            )
            continue

        annotated = annotate(document, correction)
        if annotated is None:
            continue

        try:
            await store.write_published(correction.slug, annotated)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not write the correction to %s: %s", correction.slug, exc)
            continue

        changed.append(correction.slug)
        log_entries.append(
            correction.to_log_entry(
                annotated["corrections"][-1], str(annotated.get("headline") or "")
            )
        )
        log.warning("corrected %s: %s", correction.slug, correction.description)

    if log_entries:
        try:
            await store.append_corrections(log_entries)
        except Exception as exc:  # noqa: BLE001
            # The article carries the note either way, which is the copy a
            # reader of that page sees. The log is the index of them.
            log.warning("corrections log append failed: %s", exc)

    return changed


#: The invented analyst. One article, named rather than searched for, because
#: the population is closed: ``hypothesis.Lens`` now carries a role title, the
#: validator refuses any honorific-led name, and no later run can produce
#: another. A detector for a fault that cannot recur is a detector that will
#: only ever be wrong.
#:
#: Only this article is listed. The same invented name is in the *provenance* of
#: a second one, and that needs no correction: ``analystLabel`` repairs the
#: passport at render time, so nothing false reaches the reader there. The line
#: between the two mechanisms is the same one this module's docstring draws —
#: **render-time repair for the chrome, a correction for the prose.**
PENDING: tuple[EditorialCorrection, ...] = (
    EditorialCorrection(
        slug=(
            "consumer-confidence-in-the-baltic-states-shows-significant-"
            "divergence-in-1ee73e"
        ),
        description=(
            "This article credited an explanation to “Dr. Ineta Zvirbule”. There "
            "is no such person. The suggestion came from one of the newsroom's "
            "own AI analysts — a software role, now named “the newsroom's AI "
            "household economist” — which a defect in our pipeline had given an "
            "invented personal name. The analysis itself is unchanged and was "
            "always marked as unconfirmed; what was wrong was presenting it as "
            "the view of a human economist we had consulted. We have consulted "
            "nobody. The paragraph is left exactly as published, so the record "
            "of what we printed stands, and no analyst is given a personal name "
            "again."
        ),
        previous_value=(
            "Dr. Ineta Zvirbule suggests this is a likely explanation, but the "
            "data cannot confirm it."
        ),
    ),
)


__all__ = [
    "PENDING",
    "EditorialCorrection",
    "already_recorded",
    "annotate",
    "issue",
]
