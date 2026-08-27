"""What the editor has already decided about a syndicated card.

WHY THIS EXISTS
---------------
A tier B/C slug is a SHA-256 of the feed item's own guid, so the same card is
rebuilt on every run for as long as the outlet keeps the item in its feed.
Publishing one is remembered — it lands in the index and ``published_slugs``
skips it. **Refusing one is not.** A rejected card never reaches the index, so
the editor reads it again, and again, at one model call each.

Of 111 tier C rejections in a three-day window, **103 were Azure content-filter
refusals** — Ukraine and Russia military coverage, political opinion — across
**59 unique headlines** re-attempted every single run. Those cannot pass. The
filter is not going to change its mind about an article on a missile strike,
and asking it three times a day is the largest remaining line of wasted spend
in the run.

WHY NOT JUST FILTER THE TOPIC
-----------------------------
Because a Baltic news wire that quietly drops military coverage has an
editorial problem, not a cost problem. Keyword-filtering Ukraine before the
editor sees it would make the wire cheaper and worse, and it would do it
silently. Remembering that *this specific card* was refused costs nothing
editorially: the next story from the same outlet is still read on its merits.

WHAT IS REMEMBERED, AND WHAT IS NOT
-----------------------------------
Only decisions that cannot change:

* ``reject`` — the editor read this exact card and refused it. The card is
  immutable, so a second reading is a resample, not a review. That matters
  beyond cost: the editor is a model, and asking repeatedly until the answer
  changes is the shape this pipeline refuses everywhere else.
* ``escalate`` — waiting on a human. Re-asking does not make them answer
  faster, and it would re-notify them.

``approve`` is deliberately absent: an approved card is in the index and
``ArticleStore.published_slugs`` already covers it, so recording it here would
be a second source of truth for the same fact.

The ledger is bounded and self-healing. It is a cache of refusals, not an
archive: losing it costs one run's worth of re-decisions, never an article.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Iterable, Mapping

from newsroom.pipeline import config
from newsroom.pipeline.models import isoformat, utcnow

log = logging.getLogger(__name__)

#: Where the ledger lives, relative to the articles container root.
DECISIONS_BLOB = "decisions/editor.json"

#: Decisions that will not change on a second reading.
TERMINAL_ACTIONS = frozenset({"reject", "escalate"})

#: How many refusals to keep. Feeds roll their items off within days, so a
#: refusal older than the oldest live item can never be consulted again. Ten
#: thousand is far beyond that and keeps the blob small enough to fetch on
#: every run.
MAX_ENTRIES = 10_000


class DecisionLedger:
    """Remembers refusals so the editor is not asked the same question twice."""

    def __init__(self, store: Any) -> None:
        self._store = store

    async def load(self) -> dict[str, dict[str, str]]:
        """Every remembered refusal, keyed by slug. Never raises."""
        try:
            payload = await self._store.read_json(DECISIONS_BLOB)
        except Exception as exc:  # noqa: BLE001 — no memory is not a failure
            log.warning("decision ledger unreadable (%s); deciding everything", exc)
            return {}
        if not isinstance(payload, Mapping):
            return {}
        entries = payload.get("decisions")
        if not isinstance(entries, Mapping):
            return {}
        return {
            slug: dict(record)
            for slug, record in entries.items()
            if isinstance(slug, str) and isinstance(record, Mapping)
        }

    async def refused_slugs(self) -> set[str]:
        """Slugs whose decision was terminal."""
        return {
            slug
            for slug, record in (await self.load()).items()
            if record.get("decision") in TERMINAL_ACTIONS
        }

    async def remember(self, decisions: Iterable[tuple[str, Any]]) -> int:
        """Record this run's terminal decisions. Returns how many are held.

        ``decisions`` is ``(slug, outcome)`` pairs. Anything non-terminal is
        ignored rather than stored, so the ledger cannot grow into a general
        log of everything the editor has ever thought.
        """
        held = await self.load()
        now = isoformat(utcnow())
        added = 0
        for slug, outcome in decisions:
            action = getattr(getattr(outcome, "action", None), "value", None)
            if action not in TERMINAL_ACTIONS or not slug:
                continue
            if slug in held:
                continue
            held[slug] = {
                "decision": action,
                "reason": str(getattr(outcome, "reason", ""))[:300],
                "decided_at": str(getattr(outcome, "decided_at", "") or now),
            }
            added += 1

        if not added:
            return len(held)

        if len(held) > MAX_ENTRIES:
            # Oldest first, so a long-running deployment sheds refusals whose
            # feed items rolled off years ago rather than growing without
            # bound. Shedding one costs a single re-decision if it ever
            # reappears.
            ordered = sorted(held.items(), key=lambda kv: kv[1].get("decided_at", ""))
            held = dict(ordered[-MAX_ENTRIES:])

        try:
            await self._store.put_json(
                DECISIONS_BLOB,
                {"updated_at": now, "count": len(held), "decisions": held},
            )
        except Exception as exc:  # noqa: BLE001 — losing the cache is not fatal
            log.warning("could not write the decision ledger (%s)", exc)
        log.info("decision ledger: %d refusal(s) remembered, %d added", len(held), added)
        return len(held)


def container_hint() -> str:
    """Where a reader should look for this. Used in operator messages only."""
    return f"{config.ARTICLES_CONTAINER}/{DECISIONS_BLOB}"


__all__ = [
    "DECISIONS_BLOB",
    "MAX_ENTRIES",
    "TERMINAL_ACTIONS",
    "DecisionLedger",
    "container_hint",
]
