"""Stable identifiers.

ULIDs are lexicographically sortable by creation time, which means a directory
listing of the article container is already in publication order. Implemented
here rather than pulled in as a dependency: it is twenty lines and the Function
App's cold start is charged by the megabyte.
"""

from __future__ import annotations

import os
import re
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def _encode(value: int, length: int) -> str:
    out = []
    for _ in range(length):
        value, remainder = divmod(value, 32)
        out.append(_CROCKFORD[remainder])
    return "".join(reversed(out))


def new_ulid(now_ms: int | None = None, randomness: bytes | None = None) -> str:
    timestamp = now_ms if now_ms is not None else int(time.time() * 1000)
    entropy = randomness if randomness is not None else os.urandom(10)
    return _encode(timestamp, 10) + _encode(int.from_bytes(entropy, "big"), 16)


def slugify(text: str, *, max_words: int = 10, suffix: str = "") -> str:
    """A schema-legal slug: lowercase words joined by single hyphens."""
    words = [w for w in _SLUG_STRIP.sub(" ", text.lower()).split() if w][:max_words]
    parts = [*words, *( [suffix.lower()] if suffix else [] )]
    slug = "-".join(parts)
    return slug or "untitled"
