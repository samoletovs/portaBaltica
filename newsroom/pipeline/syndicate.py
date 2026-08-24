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

Both land in ``pending_approval`` and wait for a human on Telegram. Approval is
a sibling workstream; the handoff contract is documented in
:func:`pending_approval_queue`.
"""

from __future__ import annotations

import logging
from typing import Iterable, Sequence

from newsroom.pipeline.collect.rss import item_slug
from newsroom.pipeline.ids import new_ulid
from newsroom.pipeline.models import Article, FeedItem, isoformat, utcnow
from newsroom.pipeline.safety import Source, registry, validate

log = logging.getLogger(__name__)

#: Section assignments for syndicated cards. Syndicated material carries no
#: byline, so this only decides where the card is filed on the site.
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
    }
    if source.tier == "B":
        # Licensed for verbatim reproduction. Stored exactly as served.
        syndicated["full_text"] = item.description
    else:
        syndicated["snippet"] = item.description
        syndicated["snippet_is_verbatim"] = True

    headline = item.title.strip()
    if len(headline) < 12:
        log.info("%s: headline too short for the schema, dropping", source.id)
        return None

    return Article(
        id=new_ulid(),
        slug=item_slug(item),
        tier=source.tier,  # type: ignore[arg-type]
        status="pending_approval",
        headline=headline[:140],
        section=SYNDICATED_SECTION,
        created_at=created_at,
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
            "accountable_editor": "Sam Samoletovs",
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
    """The handoff to the Telegram approval workstream.

    One dict per card, carrying only what an approver needs to make a decision:
    what it is, who published it, the exact text we would reproduce, and the
    link. The approver's job is to say yes or no — never to edit the text, since
    editing is precisely the rewriting the licence forbids.
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
