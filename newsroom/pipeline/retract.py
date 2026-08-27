"""Withdrawing an article the newsroom got wrong.

WHY THIS IS NOT ``revisions.py``
--------------------------------
``revisions.py`` handles the other kind of correction: the source restated a
figure after we published it. Its public sentence ends

    "Statistical agencies revise routinely — this is a restatement by the
     source, not a reporting error."

which is true there and a lie here. Using that machinery for our own fault
would tell readers Eurostat changed its mind when in fact the newsroom attached
a real number to the wrong series. That is a second error wearing a
correction's clothes, and on a site whose whole premise is that the numbers are
real it is worse than the first.

WHY RETRACTION RATHER THAN A CORRECTION NOTE
--------------------------------------------
The published corrections policy distinguishes them:

    Correction — a factual error: a wrong figure, a misstated comparison.
    Retraction — the story should not have been published: the underlying data
                 was invalid, or the premise was wrong.

An article headlined "Baltic telecommunications services balance widens" that
is built from the aggregate trade balance has no corrected number that would
make it true. Its subject is wrong, not its arithmetic. Every sentence, the
headline, the comparison basis and the chart are all about a metric the piece
never measured. There is nothing to amend, so it is retracted.

WHAT RETRACTION DOES, AND DOES NOT
----------------------------------
* The article's status becomes ``retracted``, so ``is_servable`` refuses it and
  it leaves the index, the RSS feed and the sitemap.
* **The page stays at its URL**, carrying the notice. The policy promises "the
  page stays up, showing why. We do not delete the evidence", and a reader
  following a link from the corrections log has to arrive somewhere.
* The notice says what went wrong in plain terms, because "an error occurred"
  asks for trust rather than earning it.
* The entry is appended to the public corrections log.
* The article is removed from the index, which also lifts the dedup
  suppression: ranking reads ``signal_finding`` out of the index, so leaving a
  retracted entry there would block the CORRECTED article from ever being
  written.

Nothing here rewrites the article's prose. The record is append-only.

WHAT THE FIX ITSELF BROKE, AND WHY IT WILL HAPPEN AGAIN
-------------------------------------------------------
Correcting the collector had a second-order consequence that is worth stating
in general terms, because it is not specific to caching:

    Any system that remembers what it previously believed and compares that to
    what it now sees will report a correctness fix as a change in the world.

The vintage ledger remembers every figure we have published. Each run compares
those against freshly collected series and reports differences as restatements
by the source. So the moment the collector started reading the right cube, the
ledger's collided ``business_bankruptcies|LT|2026-Q2 = 130.9`` disagreed with
the true 120.3, and the revision watch published a note saying Eurostat had
revised a figure it never published — our fault, attributed to a third party,
in the one artefact whose purpose is being trustworthy.

Two guards follow, and neither is about caching:

* retraction makes the ledger ``forget`` the article's figures, because an
  article we have disowned must not keep generating claims from remembered
  state;
* the revision watch skips any article that is not ``published``, because a
  withdrawn story has no claim left to restate.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from newsroom.pipeline.models import isoformat, utcnow
from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.vintage import VintageStore
from newsroom.pipeline.weekly import cited_slugs

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RetractionOutcome:
    """What a retraction did, and what it obliges someone to look at.

    ``wraps_to_review`` is not decoration. A weekly wrap quotes work other than
    its own, so it is the only format a retraction elsewhere can invalidate,
    and no other mechanism here would ever find it. It is returned rather than
    acted on because whether the withdrawn figure was load-bearing in the
    wrap's argument is a judgement, and a wrap citing eight stories should not
    vanish because one was withdrawn.
    """

    retracted: list[str]
    wraps_to_review: list[str]

    def __iter__(self):
        """Iterating gives the retracted slugs, which is what callers mean."""
        return iter(self.retracted)

    def __len__(self) -> int:
        return len(self.retracted)


def retraction_note(
    reason: str,
    *,
    corrected_at: str | None = None,
    withdraws: str | None = None,
) -> dict[str, str]:
    """The public notice. Written for a reader, not a maintainer.

    ``withdraws`` names an earlier correction on the same article that this
    retraction supersedes, for the case where the newsroom's *correction* was
    also wrong. It is appended rather than replacing anything, because the
    corrections log is append-only by policy — a log we can rewrite is not
    evidence of anything — so the remedy for a bad note is another note.
    """
    description = (
        f"RETRACTED. {reason.strip().rstrip('.')}. This article should not "
        "have been published and has been withdrawn from the front page and "
        "the feeds. The page remains here, unchanged, so the record of what "
        "we published is public. No figure in it should be relied on."
    )
    if withdraws:
        description += (
            f" This also withdraws an earlier note on this article, which said "
            f"{withdraws.strip().rstrip('.')}. That note was wrong and we are "
            "sorry for it: it attributed our own fault to the statistical "
            "office, which had published no such revision."
        )
    return {
        "corrected_at": corrected_at or isoformat(utcnow()),
        "description": description,
    }


async def retract(
    store: ArticleStore,
    slug: str,
    *,
    reason: str,
    corrected_at: str | None = None,
    withdraws: str | None = None,
) -> dict[str, Any] | None:
    """Withdraw one published article. Returns the stored document, or ``None``.

    Idempotent: retracting an already-retracted article appends nothing and
    changes nothing, so an operator can re-run a batch without multiplying the
    notices on the page.
    """
    document = await store.read_published(slug)
    if document is None:
        log.warning("cannot retract %s: no published document", slug)
        return None
    if document.get("status") == "retracted":
        log.info("%s is already retracted", slug)
        return document

    note = retraction_note(reason, corrected_at=corrected_at, withdraws=withdraws)
    corrections = list(document.get("corrections") or [])
    corrections.append(note)
    document["corrections"] = corrections
    document["status"] = "retracted"

    await store.write_published(slug, document)
    await store.append_corrections(
        [
            {
                "slug": slug,
                "headline": str(document.get("headline") or ""),
                "corrected_at": note["corrected_at"],
                "description": note["description"],
            }
        ]
    )
    log.warning("retracted %s: %s", slug, reason)
    return document


async def retract_all(
    store: ArticleStore,
    slugs: Sequence[str],
    *,
    reason: str,
    vintages: VintageStore | None = None,
    withdraws: Mapping[str, str] | None = None,
) -> RetractionOutcome:
    """Retract several articles that share one cause, then clean up after them.

    Three steps, and the last two are the ones that are easy to forget.

    ``write_index`` merges the existing entries with the current run's, keyed on
    slug, so a retracted article's OLD entry survives unless it is removed —
    which would leave it on the front page, in the feed, and still suppressing
    the corrected article through ``signal_finding``.

    The vintage ledger must also forget the article's figures. The ledger is
    what drives the revision watch, and it compares its stored values against
    each run's freshly collected series. A figure we have publicly disowned that
    stays in the ledger keeps producing a difference, and the watch keeps
    reporting that difference as a restatement by the source — publishing, on
    our own corrections page, a false claim that a statistical office revised
    something. That is not a hypothetical: it happened once already, which is
    why ``forget`` exists.
    """
    retracted: list[str] = []
    corrected_at = isoformat(utcnow())
    for slug in slugs:
        document = await retract(
            store,
            slug,
            reason=reason,
            corrected_at=corrected_at,
            withdraws=(withdraws or {}).get(slug),
        )
        if document is not None and document.get("status") == "retracted":
            retracted.append(slug)

    # A wrap that quoted one of these may now be wrong, and nothing else would
    # ever find it: every other correction mechanism assumes the faulty thing
    # is the article itself.
    #
    # REPORTED, NOT WITHDRAWN. The first draft of this retracted the wrap
    # automatically, on the reasoning that a flag nobody reads is a guard that
    # cannot fire — which is a real hazard in an unattended pipeline. But
    # proportionality wins: a wrap citing eight stories should not vanish
    # because one of them was withdrawn, and whether the withdrawn figure was
    # load-bearing in the wrap's argument is a judgement no machine here can
    # make. The hazard is answered by making the report impossible to miss
    # rather than by acting on it — it is returned to the caller and logged at
    # warning level, and retraction is never automatic, so there is always an
    # operator present to receive it.
    citing: list[str] = []
    if retracted:
        citing = await wraps_citing(store, retracted)
        for wrap in citing:
            log.warning(
                "weekly wrap %s cites a retracted article; review it: %s",
                wrap,
                ", ".join(sorted(set(retracted))),
            )

    if retracted:
        await store.drop_from_index(retracted)
        ledger_store = vintages or VintageStore()
        ledger = await ledger_store.load()
        forgotten = ledger.forget(retracted)
        if forgotten:
            await ledger_store.save(ledger)
            log.warning("vintage ledger forgot %d figure(s) from retracted articles", forgotten)
    return RetractionOutcome(retracted=retracted, wraps_to_review=citing)


def suppression_keys(documents: Sequence[Mapping[str, Any]]) -> list[str]:
    """The ``signal_finding`` values that must stop suppressing.

    Ranking suppresses a finding it has already published. If a retracted
    article's key stays in force, the corrected article is treated as a repeat
    and never written — the newsroom would withdraw a wrong story and then
    refuse to replace it.
    """
    keys: list[str] = []
    for document in documents:
        provenance = document.get("provenance") or {}
        finding = provenance.get("signal_finding")
        if isinstance(finding, str) and finding:
            keys.append(finding)
    return keys


async def wraps_citing(store: ArticleStore, slugs: Sequence[str]) -> list[str]:
    """Published wraps that quoted any of these articles.

    A weekly wrap is the only format that quotes work other than its own, so it
    is the only one that can be made wrong by a retraction elsewhere. It reads
    the index rather than scanning storage because the index is the set of
    things a reader can currently reach, and a wrap that is already gone needs
    no further withdrawing.
    """
    withdrawn = set(slugs)
    entries = await store.read_json(ArticleStore.INDEX_BLOB)
    rows = entries if isinstance(entries, list) else (entries or {}).get("articles") or []

    affected: list[str] = []
    for row in rows:
        slug = row.get("slug") if isinstance(row, Mapping) else None
        if not isinstance(slug, str) or not slug or slug in withdrawn:
            continue
        document = await store.read_published(slug)
        if document is None or document.get("status") != "published":
            continue
        if withdrawn.intersection(cited_slugs(document)):
            affected.append(slug)
    return affected




__all__ = [
    "RetractionOutcome",
    "retract",
    "retract_all",
    "retraction_note",
    "suppression_keys",
    "wraps_citing",
]
