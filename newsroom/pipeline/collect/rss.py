"""RSS/Atom parsing with a hard field allowlist.

Why this file is written the way it is
--------------------------------------
``emerging-europe.com/feed`` — and it is not alone — ships ``<content:encoded>``
carrying the **complete article body**. Ingesting that would be republication of
a whole copyrighted work, which is the single fastest way to earn both an Art. 15
claim and a scaled-content-abuse penalty.

A comment saying "don't read content:encoded" is not protection. So the
prohibition is structural, and doubled:

1. :func:`_strip_forbidden` deletes every non-allowlisted element from the tree
   *before* any field is read. By the time extraction runs, the body text is not
   in memory as part of the item at all.
2. :func:`_text_of` refuses any tag outside :data:`ITEM_FIELD_ALLOWLIST`, so even
   a future edit that skips step 1 cannot pull a body out.

:class:`~newsroom.pipeline.models.FeedItem` has no field a body could be stored
in, which is the third barrier.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Iterable
from xml.etree import ElementTree as _stdlib_et

from newsroom.pipeline.models import FeedItem, isoformat

log = logging.getLogger(__name__)


def feed_published_at(value: str | None) -> str | None:
    """An outlet's own publication date, normalised, or ``None`` if unreadable.

    Feeds date items in RFC 2822 (``Tue, 25 Aug 2026 09:55:00 +0300``, which is
    what ERR and LSM send) or ISO 8601, so both are accepted and anything else
    is refused rather than guessed at. A date we cannot read is better absent
    than invented: the caller falls back to a timestamp it can defend.

    Returns the same ``...Z`` string shape the schema's ``date-time`` wants.
    """
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return isoformat(parsed)

try:  # defusedxml refuses entity-expansion and external-entity attacks
    from defusedxml import ElementTree as ET  # type: ignore
except ImportError:  # pragma: no cover - defusedxml is in requirements.txt
    ET = _stdlib_et  # type: ignore
    log.warning("defusedxml unavailable; parsing untrusted XML with the stdlib parser")

#: The only element names an item may contribute. Everything else is discarded
#: before extraction. Local names, namespace-insensitive.
ITEM_FIELD_ALLOWLIST: frozenset[str] = frozenset(
    {"title", "link", "description", "pubdate", "published", "updated", "guid", "id", "summary"}
)

#: Named purely so the reason is greppable. These never reach extraction because
#: the allowlist above excludes them, but stating them makes the intent explicit
#: to the next reader — and the unit tests assert each one is dropped.
KNOWN_FULL_TEXT_ELEMENTS: frozenset[str] = frozenset(
    {"encoded", "content", "fulltext", "body", "content_encoded", "encoded_content"}
)


def _local(tag: Any) -> str:
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1].lower()


def _strip_forbidden(item: Any) -> None:
    """Barrier 1 — delete non-allowlisted children from the parsed item."""
    for child in list(item):
        if _local(child.tag) not in ITEM_FIELD_ALLOWLIST:
            item.remove(child)


def _text_of(item: Any, tag: str) -> str:
    """Barrier 2 — read a single allowlisted field, or refuse."""
    if tag not in ITEM_FIELD_ALLOWLIST:
        raise ValueError(
            f"{tag!r} is not an allowlisted feed field. Full article bodies "
            f"(content:encoded and friends) are never ingested — see the module docstring."
        )
    for child in item:
        if _local(child.tag) == tag:
            if _local(child.tag) == "link" and not (child.text or "").strip():
                href = child.attrib.get("href")
                if href:
                    return href.strip()
            return (child.text or "").strip()
    return ""


def _first_text(item: Any, tags: Iterable[str]) -> str:
    for tag in tags:
        value = _text_of(item, tag)
        if value:
            return value
    return ""


def _iter_items(root: Any) -> Iterable[Any]:
    for element in root.iter():
        if _local(element.tag) in ("item", "entry"):
            yield element


def parse_feed(
    raw_body: bytes,
    *,
    source_id: str,
    raw_blob: str,
    retrieved_at: str | None = None,
) -> list[FeedItem]:
    """Parse a feed into items carrying headline, link and the outlet's own snippet.

    The returned items contain no article body, by construction.
    """
    try:
        root = ET.fromstring(raw_body)
    except Exception as exc:  # noqa: BLE001 - a malformed feed is a dropped feed
        log.error("%s: feed did not parse (%s)", source_id, exc)
        return []

    items: list[FeedItem] = []
    for raw_item in _iter_items(root):
        _strip_forbidden(raw_item)
        title = _text_of(raw_item, "title")
        link = _first_text(raw_item, ("link", "id"))
        description = _first_text(raw_item, ("description", "summary"))
        if not title or not link:
            continue
        published = _first_text(raw_item, ("pubdate", "published", "updated")) or None
        guid = _text_of(raw_item, "guid") or link
        items.append(
            FeedItem(
                source_id=source_id,
                title=title,
                link=link,
                description=description,
                published=published,
                guid=guid,
                raw_blob=raw_blob,
                retrieved_at=retrieved_at,
            )
        )
    log.info("%s: parsed %d items", source_id, len(items))
    return items


def extract_raw_description(raw_body: bytes, guid: str) -> str | None:
    """Re-read one item's ``<description>`` straight from the archived bytes.

    This is what the validator's ``snippet_verbatim`` check compares a published
    tier C snippet against, so the comparison is against what the publisher
    actually served rather than against anything the pipeline has held in memory.
    """
    try:
        root = ET.fromstring(raw_body)
    except Exception:  # noqa: BLE001
        return None
    for raw_item in _iter_items(root):
        _strip_forbidden(raw_item)
        item_guid = _text_of(raw_item, "guid") or _first_text(raw_item, ("link", "id"))
        if item_guid == guid:
            return _first_text(raw_item, ("description", "summary"))
    return None


def item_slug(item: FeedItem) -> str:
    digest = hashlib.sha256(item.guid.encode("utf-8")).hexdigest()[:8]
    words = [w for w in "".join(c.lower() if c.isalnum() else " " for c in item.title).split()][:8]
    return "-".join([*words, digest]) if words else digest
