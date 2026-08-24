"""Stage 4 — bounded web research around a verified signal.

Research changes the questions the writer can answer, not the numbers it may
publish. Feed text is untrusted, every candidate must resolve through the source
registry, and third-party reporting contributes only a headline and link as an
orientation lead. Its article text never enters the writer prompt.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any, Iterable, Literal, Sequence

from newsroom.pipeline import config
from newsroom.pipeline.models import FeedItem, Signal
from newsroom.pipeline.safety import registry

ResearchRole = Literal["official_statement", "prior_coverage"]

_WORD = re.compile(r"[^\W\d_]{3,}", re.UNICODE)
_SPACE = re.compile(r"\s+")
_COUNTRY_TERMS = {
    "LV": {"latvia", "latvian", "riga"},
    "EE": {"estonia", "estonian", "tallinn"},
    "LT": {"lithuania", "lithuanian", "vilnius"},
    "Baltic": {"baltic", "latvia", "estonia", "lithuania"},
}
_SECTION_TERMS = {
    "business": {"business", "company", "firms"},
    "economy": {"economy", "economic", "gdp", "inflation"},
    "energy": {"electricity", "energy", "grid", "power"},
    "environment": {"climate", "environment", "weather"},
    "government": {"government", "ministry", "policy"},
    "labour": {"employment", "jobs", "labour", "unemployment"},
    "maritime": {"cargo", "ferry", "port", "shipping"},
    "property": {"construction", "housing", "property"},
    "trade": {"exports", "imports", "trade"},
}
_STOP_WORDS = {
    "and",
    "data",
    "for",
    "from",
    "high",
    "latest",
    "low",
    "rate",
    "the",
    "this",
    "with",
}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _plain_text(value: str) -> str:
    parser = _TextExtractor()
    parser.feed(html.unescape(value))
    parser.close()
    return _SPACE.sub(" ", " ".join(parser.parts)).strip()


@dataclass(frozen=True, slots=True)
class ResearchItem:
    source_id: str
    source_name: str
    role: ResearchRole
    title: str
    url: str
    retrieved_at: str
    summary: str | None = None
    published: str | None = None

    def prompt_record(self) -> dict[str, str]:
        record = {
            "source": self.source_name,
            "role": self.role,
            "title": self.title,
            "url": self.url,
        }
        if self.summary is not None:
            record["official_summary"] = self.summary
        if self.published:
            record["published"] = self.published
        return record

    def provenance_record(self) -> dict[str, str]:
        record = {
            "source_id": self.source_id,
            "source_name": self.source_name,
            "role": self.role,
            "title": self.title,
            "url": self.url,
            "retrieved_at": self.retrieved_at,
        }
        if self.published:
            record["published"] = self.published
        return record


@dataclass(frozen=True, slots=True)
class ResearchContext:
    items: tuple[ResearchItem, ...] = ()
    candidates_considered: int = 0

    def to_provenance(self) -> dict[str, Any]:
        return {
            "method": "registered_feeds",
            "candidates_considered": self.candidates_considered,
            "consulted": [item.provenance_record() for item in self.items],
        }


def _topic_terms(signal: Signal) -> set[str]:
    return set(_SECTION_TERMS.get(signal.section, {signal.section})) - _STOP_WORDS


def _score(signal: Signal, item: FeedItem) -> int:
    source = registry().get(item.source_id)
    topic_terms = _topic_terms(signal)
    geography_terms = _COUNTRY_TERMS.get(signal.geography, set())
    title_words = {word.lower() for word in _WORD.findall(_plain_text(item.title))}
    summary = _plain_text(item.description)[: config.RESEARCH_MAX_SUMMARY_CHARS]
    summary_words = {word.lower() for word in _WORD.findall(summary)}
    topic_title = topic_terms & title_words
    topic_summary = topic_terms & summary_words
    if topic_title == {"power"} and not title_words.intersection(
        {"cut", "cuts", "electricity", "energy", "generation", "grid", "price", "prices"}
    ):
        topic_title = set()
    if source.research_role == "prior_coverage" and not topic_title:
        return 0
    if source.research_role == "official_statement" and not topic_title and len(topic_summary) < 2:
        return 0
    score = 4 * len(topic_title) + 2 * len(topic_summary)
    score += 2 * len(geography_terms & title_words)
    score += len(geography_terms & summary_words)
    if source.country and source.country == signal.geography:
        score += 1
    return score


def _period_start(period: str) -> datetime | None:
    candidate = period[:10]
    if len(candidate) == 7:
        candidate += "-01"
    try:
        return datetime.fromisoformat(candidate).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _published_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _is_timely(signal: Signal, item: FeedItem) -> bool:
    period = _period_start(signal.period)
    published = _published_at(item.published)
    if period is None or published is None:
        return True
    return published >= period - timedelta(days=config.RESEARCH_MAX_AGE_DAYS)


def research_signal(
    signal: Signal,
    feed_items: Iterable[FeedItem],
    *,
    retrieved_at: str | None = None,
    max_items: int = config.RESEARCH_MAX_ITEMS,
) -> ResearchContext:
    """Select relevant registered feed items without making another web request."""
    candidates: list[tuple[int, FeedItem]] = []
    considered = 0
    for item in feed_items:
        source = registry().get(item.source_id)
        if source.research_role not in ("official_statement", "prior_coverage"):
            continue
        considered += 1
        if not _is_timely(signal, item):
            continue
        relevance = _score(signal, item)
        if relevance >= config.RESEARCH_MIN_RELEVANCE:
            candidates.append((relevance, item))

    candidates.sort(key=lambda pair: (-pair[0], pair[1].source_id, pair[1].guid))
    selected: list[ResearchItem] = []
    per_source: dict[str, int] = {}
    for _, item in candidates:
        source = registry().get(item.source_id)
        if per_source.get(source.id, 0) >= config.RESEARCH_MAX_PER_SOURCE:
            continue
        per_source[source.id] = per_source.get(source.id, 0) + 1
        summary = None
        if source.research_summary_allowed:
            summary = _plain_text(item.description)[: config.RESEARCH_MAX_SUMMARY_CHARS]
        selected.append(
            ResearchItem(
                source_id=source.id,
                source_name=source.name,
                role=source.research_role,  # type: ignore[arg-type]
                title=_plain_text(item.title)[:300],
                url=item.link,
                retrieved_at=retrieved_at or item.retrieved_at or signal.sources[0].retrieved_at,
                summary=summary or None,
                published=item.published,
            )
        )
        if len(selected) >= max_items:
            break

    return ResearchContext(items=tuple(selected), candidates_considered=considered)


def research_selected(
    signals: Sequence[Signal], feed_items: Iterable[FeedItem]
) -> dict[str, ResearchContext]:
    items = tuple(feed_items)
    return {signal.id: research_signal(signal, items) for signal in signals}


__all__ = [
    "ResearchContext",
    "ResearchItem",
    "ResearchRole",
    "research_selected",
    "research_signal",
]
