"""Tier B and C — material we did not write.

Neither tier touches the language model. There is no code path from this module
into :mod:`newsroom.pipeline.write`, which is the structural expression of
``rewrite_allowed: false``.

* **Tier B** (EC / EP press releases) carries an explicit licence to reproduce
  with attribution, so the syndicated text is stored verbatim in ``full_text``.
* **Tier C** (third-party journalism) gets headline + the outlet's *own* RSS
  ``<description>`` + a link back, and nothing else. That snippet is the largest
  unit defensible under DSM Art. 15 because the publisher themselves put it out
  for syndication.

Both land in ``pending_approval`` only long enough for the editor stage to judge
the exact card. Routine approval no longer goes to Telegram; escalation is the
only human interruption path.
"""

from __future__ import annotations

import logging
from typing import Iterable, Sequence

from newsroom.pipeline.collect.rss import feed_published_at, item_slug
from newsroom.pipeline.ids import new_ulid
from newsroom.pipeline.models import Article, FeedItem, isoformat, utcnow
from newsroom.pipeline.safety import Source, registry, validate

log = logging.getLogger(__name__)

#: Where a syndicated card is filed, because the schema requires a section.
#:
#: THIS IS A STORAGE DEFAULT, NOT A CLASSIFICATION, and the difference matters.
#: Our sections are our taxonomy for our own reporting. Applying one to somebody
#: else's article asserts a judgement about their work that we did not make and
#: are not entitled to make from a headline.
#:
#: It also had a visible cost. Because every card lands here, the live index held
#: 154 "government" cards and not one government article of our own, and the
#: front page built its tab strip from every article — so "Government" was
#: offered as a section and led to "Nothing to report yet today" beside a full
#: rail. NewsFeed.tsx now derives its tabs from our own work only.
#:
#: Do not read this value as meaning a card is about government, and do not add
#: keyword-matching here to make it look like a real one: guessing a section from
#: a headline is inventing a classification, which is worse than a default that
#: is honestly arbitrary.
SYNDICATED_SECTION = "government"

BALTIC_TERMS = (
    "latvia",
    "latvian",
    "estonia",
    "estonian",
    "lithuania",
    "lithuanian",
    "baltic",
    "riga",
    "tallinn",
    "vilnius",
)


def is_baltic_relevant(item: FeedItem) -> bool:
    """Applies the ``filter`` declared for EU sources in ``sources.yaml``."""
    haystack = f"{item.title} {item.description}".lower()
    return any(term in haystack for term in BALTIC_TERMS)


def build_card(item: FeedItem, source: Source, *, now: str | None = None) -> Article | None:
    """Build a syndicated card. Returns ``None`` if the tier forbids it."""
    if source.tier not in ("B", "C"):
        raise ValueError(f"{source.id} is tier {source.tier}; not syndicated material")
    created_at = now or isoformat(utcnow())

    syndicated: dict[str, object] = {
        "source_id": source.id,
        "original_url": item.link,
        "attribution": source.attribution,
        # ASSERTED FOR BOTH TIERS, because both reproduce the outlet's own bytes.
        #
        # This used to be set only on the tier C branch below, while
        # check_snippet_verbatim requires it of any syndicated block. The result
        # was a 100% rejection rate for tier B: in the live run of 2026-08-26
        # every European Commission press release was refused with "the ingester
        # did not assert verbatim copy", and the licensed-reproduction tier had
        # never published anything at all.
        #
        # The flag means "we copied, we did not rewrite". That is exactly as true
        # of the full_text we are licensed to reproduce as it is of a tier C
        # snippet, and the validator re-checks it against the archived bytes
        # either way, so asserting it here is a statement it can still falsify.
        "snippet_is_verbatim": True,
    }
    if source.tier == "B":
        # Licensed for verbatim reproduction. Stored exactly as served.
        syndicated["full_text"] = item.description
    else:
        syndicated["snippet"] = item.description

    headline = item.title.strip()
    if len(headline) < 12:
        log.info("%s: headline too short for the schema, dropping", source.id)
        return None

    return Article(
        id=new_ulid(),
        slug=item_slug(item),
        tier=source.tier,  # type: ignore[arg-type]
        status="pending_approval",
        # NOT TRUNCATED. The validator byte-compares this against the outlet's
        # feed title, so `headline[:140]` made every headline longer than 140
        # characters a guaranteed rejection: we cut their words and then
        # measured our cut against their original. EUobserver runs a numbered
        # daily series whose headlines are reliably longer than that, and two
        # were refused in the live run of 2026-08-26 for exactly this.
        #
        # Truncating somebody else's headline is also the rewrite that
        # `rewrite_allowed: false` exists to forbid, so the check was right and
        # the ingester was wrong. The schema's ceiling is ours to set and is now
        # wide enough to hold a real one.
        headline=headline,
        section=SYNDICATED_SECTION,
        created_at=created_at,
        # THE OUTLET'S DATE, NOT OURS.
        #
        # This was previously left unset and then filled in by the editor with
        # its own decision time, which produced a rail where 105 of 154 cards
        # claimed to have been published within the same two minutes -- the
        # moment our timer ran -- and a three-day-old ERR story was dated
        # tonight. For a card whose entire purpose is to point at somebody
        # else's article, the honest date is theirs.
        #
        # It also decided the index. Stamping syndication with the run time made
        # every link-out newer than every article we had ever written, which is
        # what let the rail evict the newsroom; see ArticleStore.INDEX_MAX_OURS.
        published_at=feed_published_at(item.published),
        syndicated=syndicated,
        countries=[source.country] if source.country in ("LV", "EE", "LT") else [],
        provenance={
            "sources": [
                {
                    "source_id": source.id,
                    "retrieved_at": created_at,
                    "url": item.link,
                    "dataset": item.raw_blob,
                }
            ],
            "model": None,
            "generated_at": created_at,
            "accountable_editor": "Andre Kõpu",
        },
    )


def syndicate(
    items: Iterable[FeedItem],
    *,
    raw_descriptions: dict[str, str] | None = None,
    now: str | None = None,
) -> list[Article]:
    """Build and validate syndicated cards for registered tier B/C items.

    ``raw_descriptions`` maps a feed item's guid to the ``<description>`` read
    back out of the *archived bytes*. Supplying it makes the ``snippet_verbatim``
    check meaningful; without it, tier C cards fail closed, which is correct —
    an unverifiable snippet is not publishable.
    """
    raw_descriptions = raw_descriptions or {}
    cards: list[Article] = []
    for item in items:
        source = registry().get(item.source_id)
        if source.tier == "A" or source.research_only:
            continue
        if source.publisher.startswith("European") and not is_baltic_relevant(item):
            continue

        card = build_card(item, source, now=now)
        if card is None:
            continue

        # The validator wants the archived raw item as a mapping so it can
        # byte-compare both the snippet against <description> AND the headline
        # against <title> — a rewritten headline is still a rewrite. It reads
        # rewrite_allowed and attribution from the registry itself, so they are
        # not passed separately; one source of truth, not two.
        raw_description = raw_descriptions.get(item.guid)
        raw_feed_item = (
            {"title": item.title, "description": raw_description}
            if raw_description is not None
            else None
        )

        verdict = validate(card.to_json(), raw_feed_item=raw_feed_item)
        card.provenance["validator"] = verdict.to_dict()
        if not verdict.passed:
            card.status = "rejected"
            log.warning(
                "%s card rejected: %s",
                source.id,
                verdict.failure_summary(),
            )
        cards.append(card)
    return cards


def pending_approval_queue(cards: Sequence[Article]) -> list[dict[str, object]]:
    """Legacy handoff shape for tests and manual inspection.

    One dict per card, carrying only what an approver needs to make a decision:
    what it is, who published it, the exact text we would reproduce, and the
    link. The approver's job is to say yes or no — never to edit the text, since
    editing is precisely the rewriting the licence forbids. In the normal timer
    run, :mod:`newsroom.pipeline.editor` consumes these cards before publication
    instead of handing routine approvals to Andre.
    """
    queue = []
    for card in cards:
        if card.status != "pending_approval":
            continue
        syndicated = card.syndicated or {}
        queue.append(
            {
                "article_id": card.id,
                "slug": card.slug,
                "tier": card.tier,
                "source_id": syndicated.get("source_id"),
                "attribution": syndicated.get("attribution"),
                "headline": card.headline,
                "text_to_reproduce": syndicated.get("full_text") or syndicated.get("snippet"),
                "original_url": syndicated.get("original_url"),
                "actions": ["approve", "reject"],
                "editing_permitted": False,
            }
        )
    return queue


__all__ = ["build_card", "is_baltic_relevant", "pending_approval_queue", "syndicate"]
