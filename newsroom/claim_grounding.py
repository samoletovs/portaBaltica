"""Conservative excerpt matching; not a semantic truth or entailment classifier."""

from __future__ import annotations

import re
from typing import Any, Mapping, Sequence

from .source_registry import SourceRegistry

_QUOTES = re.compile(r'''"([^"]+)"|“([^”]+)”|‘(.+?)’(?!\w)|(?<!\w)'(.+?)'(?!\w)''')
_SENTENCES = re.compile(
    r"""[.!?]["”’']?\s+|;\s*|(?:,\s*|\s+)(?=(?:but|however|yet|nevertheless)\b)""", re.I,
)
_REPORTING = re.compile(
    r"\b(?:according\s+to|said|says|stated|explained|attributes|attributed)\b", re.I,
)
_COORDINATORS = re.compile(r"\s*,?\s+\b(and|or|while|whereas)\b\s+|,\s+", re.I)


def sentences(text: str) -> list[str]:
    protected = re.sub(r"\b(Dr|Prof|Mr|Mrs|Ms)\.", lambda m: m[1] + "\u2024", text)
    quoted = [match.span() for match in _QUOTES.finditer(protected)]
    parts: list[str] = []
    start = 0
    for match in _SENTENCES.finditer(protected):
        if any(left < match.start() and match.end() <= right for left, right in quoted):
            continue
        parts.append(protected[start:match.end()])
        start = match.end()
    parts.append(protected[start:])
    return [part.replace("\u2024", ".").strip() for part in parts if part.strip()]


def words(text: str) -> str:
    # Numeric signs and decimal punctuation carry meaning, unlike quote marks.
    normal = text.casefold().replace("\u2212", "-")
    return " ".join(re.findall(r"[+-]?\d+(?:[.,]\d+)*%?|\w+", normal))


def clauses(text: str, attribution: re.Pattern[str]) -> list[tuple[str, str]]:
    """Keep connectors so callers can distinguish coordination from a new assertion."""
    quoted = [match.span() for match in _QUOTES.finditer(text)]
    parts: list[tuple[str, str]] = []
    start = 0
    connector = ""
    for match in _COORDINATORS.finditer(text):
        if any(left <= match.start() and match.end() <= right for left, right in quoted):
            continue
        if match[1] is None and not (
            attribution.search(text[start:match.start()])
            or attribution.match(text[match.end():])
        ):
            continue
        parts.append((connector, text[start:match.start()].strip()))
        connector = (match[1] or ",").lower()
        start = match.end()
    parts.append((connector, text[start:].strip()))
    return [(connector, part) for connector, part in parts if part]


def quotes(text: str) -> list[str]:
    return [next(value for value in match.groups() if value) for match in _QUOTES.finditer(text)]


def supported_excerpt(
    text: str,
    *,
    evidence: Sequence[Mapping[str, Any]],
    consulted: Sequence[Mapping[str, Any]],
    registry: SourceRegistry,
) -> bool:
    """Match a named, cited official source and its fetched text, ignoring punctuation."""
    citations = {(item.get("source_id"), item.get("url")) for item in consulted}
    normal = words(text)
    for item in evidence:
        source_id, url = item.get("source_id"), item.get("url")
        if (source_id, url) not in citations or source_id not in registry:
            continue
        source = registry.get(source_id)
        document = item.get("document")
        if not source.document_fetch_allowed or not isinstance(document, str) or not document.strip():
            continue
        aliases = sorted({source.name, source.publisher}, key=len, reverse=True)
        alias = next((words(name) for name in aliases if f" {words(name)} " in f" {normal} "), None)
        if alias is None:
            continue
        excerpts = quotes(text)
        if excerpts:
            rest = words(_QUOTES.sub("", text)).replace(alias, "")
            rest = re.sub(
                r"\b(?:according|to|said|says|stated|reported|explained|that|and|the"
                r"|but|however|yet|nevertheless)\b", "", rest,
            )
            if rest.strip():
                continue
        if not excerpts:
            # Non-quoted attributed prose must still be an excerpt, not a guessed paraphrase.
            start = normal.find(alias)
            prefix = re.sub(r"^(?:but|however|yet|nevertheless)\s+", "", normal[:start].strip())
            if prefix not in {"", "according to"}:
                continue
            position = start + len(alias)
            claim = normal[position:].strip()
            claim = re.sub(r"^(?:has )?(?:said|says|stated|reported|explained)(?: that)?\s+", "", claim)
            excerpts = [claim]
        haystack = f" {words(document)} "
        if all(words(excerpt) and f" {words(excerpt)} " in haystack for excerpt in excerpts):
            return True
    return False


def reports_source(text: str) -> bool:
    if _REPORTING.search(text):
        return True
    reported = re.search(r"\breported\b", text, re.I)
    if reported is None:
        return False
    prefix = words(text[:reported.start()])
    return prefix not in {"", "the", "a", "an", "as", "as previously"}
