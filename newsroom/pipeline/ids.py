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
import unicodedata

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")

#: The ``slug`` pattern from ``newsroom/schemas/article.schema.json``, which is
#: ASCII-only. ``test_slugs.py`` asserts the two are the same string, so this
#: copy cannot quietly drift from the contract it is meant to enforce.
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

#: Letters Unicode's own decomposition leaves alone. Latvian, Lithuanian and
#: Estonian headlines are the ordinary case for this newsroom, and nearly all
#: of their diacritics do decompose — ā ē ī ū č ģ ķ ļ ņ š ž õ ä ö ü each become
#: a base letter plus a combining mark, and dropping the mark leaves the letter.
#: These carry the diacritic inside the letterform instead, so there is nothing
#: to drop and they have to be named.
_UNDECOMPOSABLE = str.maketrans(
    {
        "ß": "ss",
        "æ": "ae",
        "œ": "oe",
        "ø": "o",
        "đ": "d",
        "ð": "d",
        "þ": "th",
        "ł": "l",
        "ħ": "h",
        "ı": "i",
    }
)


def _fold_to_ascii(text: str) -> str:
    """Drop the diacritics and keep the letters.

    The alternative — deleting anything outside ``a-z`` — keeps the slug legal
    while destroying the word: ``Rīga`` becomes ``r-ga`` and ``Braže`` becomes
    ``bra-e``.
    """
    decomposed = unicodedata.normalize("NFKD", text.translate(_UNDECOMPOSABLE))
    return "".join(c for c in decomposed if not unicodedata.combining(c))


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
    """A schema-legal slug: lowercase ASCII words joined by single hyphens.

    Diacritics are transliterated rather than stripped, so a Baltic headline
    keeps its words. The result is checked against :data:`SLUG_PATTERN` by
    :func:`slug_problem` at the point an article is stored.
    """
    folded = _fold_to_ascii(text).lower()
    words = [w for w in _SLUG_STRIP.sub(" ", folded).split() if w][:max_words]
    parts = [*words, *([_fold_to_ascii(suffix).lower()] if suffix else [])]
    slug = "-".join(parts)
    return slug or "untitled"


def slug_problem(slug: object) -> str | None:
    """Why ``slug`` cannot be served, or ``None`` when it can.

    The schema has always declared this pattern and nothing has ever checked
    it, so eight live articles carry slugs the frontend's own gate refuses —
    published, advertised in RSS and the sitemap, and answering "Article not
    found" to anyone who follows the link.
    """
    if not isinstance(slug, str) or not slug:
        return "slug is missing"
    if not SLUG_PATTERN.match(slug):
        offending = sorted({c for c in slug if not re.match(r"[a-z0-9-]", c)})
        detail = f" (offending: {''.join(offending)})" if offending else ""
        return f"slug {slug!r} does not match the schema pattern{detail}"
    return None
