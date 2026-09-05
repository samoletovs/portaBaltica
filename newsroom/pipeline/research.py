"""Stage 4 — bounded web research around a verified signal.

Research changes the questions the writer can answer, not the numbers it may
publish. Feed text is untrusted, every candidate must resolve through the source
registry, and third-party reporting contributes only a headline and link as an
orientation lead. Its article text never enters the writer prompt.

The same rule applies to the two things a summary can smuggle past the gates:
**quantities and directions**. Every string handed to a model is stripped of
both first, in ``ResearchItem.prompt_record``. A number the pipeline did not
verify is not publishable, so showing one to the writer only invites a
rejection; and a direction — "rose", "fell", "improved" — is a claim about the
data that no validator check can catch, because ``no_invented_numbers`` finds
no token in it and ``comparison_basis_stated`` only fires beside a digit.
Provenance keeps the originals: it is the prompt, not the record, that is
redacted.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any, Iterable, Literal, Sequence

from newsroom import numeric_scan
from newsroom.pipeline import config
from newsroom.pipeline.models import FeedItem, Signal
from newsroom.pipeline.safety import registry

ResearchRole = Literal["official_statement", "prior_coverage"]

_WORD = re.compile(r"[^\W\d_]{3,}", re.UNICODE)
_SPACE = re.compile(r"\s+")

#: What replaces a quantity we did not verify. It carries no digits of its own,
#: and it says out loud that something was removed — a silent deletion would
#: leave a sentence that reads as complete and is not.
NUMBER_PLACEHOLDER = "[unverified figure omitted]"

#: What replaces a claim about which way something moved.
DIRECTION_PLACEHOLDER = "[direction omitted]"

#: Words that assert a direction of travel. A direction is a claim about the
#: data exactly as much as a number is, and unlike a number the validator
#: cannot catch it: ``no_invented_numbers`` sees no token in "unemployment
#: rose", and ``comparison_basis_stated`` only fires when a movement word sits
#: beside a digit. So a direction absorbed from a third-party summary and
#: written without a figure passes every gate we have.
#:
#: Direction is not something research is allowed to contribute. The pipeline
#: computes it — ``signal.context["direction"]`` — from the verified series, and
#: that is the only direction an article may state.
_CHANGE_TOKEN = re.compile(
    r"\b(?:rose|rise[sn]?|rising|fell|fall(?:s|en|ing)?|climb(?:ed|s|ing)?|"
    r"drop(?:ped|s|ping)?|increase[sd]?|increasing|decrease[sd]?|decreasing|"
    r"grew|grow(?:s|ing|th)?|decline[sd]?|declining|improve[ds]?|worsen(?:ed|s|ing)?|"
    r"surge[sd]?|surging|plunge[sd]?|plunging|jump(?:ed|s|ing)?|"
    r"higher|lower|stronger|weaker|cheaper|dearer)\b",
    re.IGNORECASE,
)
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


def redact_unverified_numbers(value: str) -> str:
    """Strip every quantity out of text the pipeline did not verify.

    A number the newsroom did not retrieve and check is not publishable, so
    there is no reason to show one to the writer. Left in, it is an invitation:
    the model is handed "unemployment at 9.1%" as context and writes it, and the
    article dies at ``figures_traceable`` — or, worse, the figure survives
    because some verified field happens to sit within rounding distance of it.

    **What counts as a number is decided by** :mod:`newsroom.numeric_scan`,
    not by a second regex written here. That module already answers the
    question "is this token a quantitative claim?" for the validator, and its
    answer is deliberately narrow: calendar dates, clock times, URLs and
    alphanumeric identifiers are masked out, because those are not claims about
    the data. Asking it means the redactor cannot disagree with the gate about
    what a number is — and it means a published date stays readable instead of
    being shredded into three placeholders, which is what a naive digit regex
    does to ``2026-08-24``.
    """
    if not value:
        return value
    tokens = numeric_scan.scan(value)
    if not tokens:
        return value
    out = value
    # Right to left, so an earlier token's offsets are still valid after a
    # later one has been replaced with a placeholder of a different length.
    # The span a token reports can open on the whitespace before it — the
    # currency and sign groups both allow one — so that leading space is put
    # back, or "at 9.1%" redacts to "at[...]" and two words fuse into one.
    for token in sorted(tokens, key=lambda t: t.start, reverse=True):
        span = value[token.start : token.end]
        lead = span[: len(span) - len(span.lstrip())]
        out = out[: token.start] + lead + NUMBER_PLACEHOLDER + out[token.end :]
    return _SPACE.sub(" ", out).strip()


def neutralise_unverified_changes(value: str) -> str:
    """Remove third-party claims about which way something moved.

    See :data:`_CHANGE_TOKEN` for why this is not covered by any validator
    check. The replacement is a bracketed marker rather than a substitute word:
    an earlier version of this substituted "changed", which reads as prose and
    is therefore something a model may copy, and which produces "prices were
    changed than a year earlier" the moment the word it replaced was a
    comparative rather than a verb. A marker is honest about being a hole.
    """
    if not value:
        return value
    return _CHANGE_TOKEN.sub(DIRECTION_PLACEHOLDER, value)


def _sanitise_for_prompt(value: str) -> str:
    return neutralise_unverified_changes(redact_unverified_numbers(value))


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
    #: Readable text of the page behind ``url``, when the registry permits
    #: fetching it. Only ever populated for ``official_statement`` sources with
    #: ``document_fetch_allowed``; see :mod:`newsroom.pipeline.webresearch` for
    #: why that gate is at the registry rather than here.
    document: str | None = None
    #: Which search provider surfaced this item, when it was not already in a
    #: subscribed feed. Recorded in provenance so a reader can tell a link the
    #: newsroom was handed from one it went looking for.
    discovered_by: str | None = None

    def prompt_record(self) -> dict[str, str]:
        """What the model is shown. Never third-party article text.

        Both text fields are gated on ``role`` HERE, not only where they are
        populated. ``research_signal`` already refuses to attach a summary to a
        source without ``research_summary_allowed``, and the registry already
        refuses that flag on tier C — but those are guards in the producer, and
        an item reaching this method by any other route would have carried the
        text straight into a prompt. Tier C is link-out only under DSM Art. 15;
        the rule is worth enforcing at the boundary the text actually crosses.

        Every string that leaves here is stripped of quantities and of
        directional claims first. Research changes the questions the writer can
        answer, not the numbers or the directions it may publish — those come
        from the verified signal or they do not appear. Redacting at this one
        method covers both consumers, the writer prompt and the analyst brief,
        which is why the sanitising lives here rather than at either call site.

        The URL is deliberately absent. It is in ``provenance_record``, where
        the reader gets the link; in a prompt it is a string of slug text and
        digits that the model has no legitimate use for and did put into prose.
        """
        record = {
            "source": self.source_name,
            "role": self.role,
            "title": _sanitise_for_prompt(self.title),
        }
        if self.role == "official_statement":
            if self.summary is not None:
                record["official_summary"] = _sanitise_for_prompt(self.summary)
            if self.document is not None:
                record["official_document_text"] = _sanitise_for_prompt(self.document)
        if self.published:
            # A calendar reference, not a claim — ``numeric_scan`` masks dates
            # for exactly that reason, and the writer needs to know whether an
            # official statement predates the reading it is being used to
            # explain.
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
        if self.document is not None:
            # The text itself is not repeated into provenance — it is the
            # publisher's, and the article links to it. That it was read, and
            # how much of it, is what a reader auditing the piece needs.
            record["document_chars"] = str(len(self.document))
        if self.discovered_by:
            record["discovered_by"] = self.discovered_by
        return record


@dataclass(frozen=True, slots=True)
class ResearchContext:
    items: tuple[ResearchItem, ...] = ()
    candidates_considered: int = 0
    #: How many official documents were actually retrieved and read this run.
    #: Zero here alongside a non-empty ``items`` means the newsroom saw
    #: headlines and nothing more, which is the state that produced the shallow
    #: articles this stage exists to fix.
    documents_fetched: int = 0
    #: Which discovery provider ran this article, or why none did.
    #:
    #: ``documents_fetched: 0`` was ambiguous in a way that mattered: it is the
    #: reading produced by discovery finding nothing, by every hit belonging to
    #: an unregistered publisher, and by discovery never having been configured
    #: at all. Those are three different facts about the newsroom and one of
    #: them is an outage. Measured on the published corpus, two of the five
    #: articles with a causal panel recorded zero documents, and nothing in the
    #: record said which of the three had happened.
    discovery: str = "not_configured"

    def validation_evidence(self) -> tuple[dict[str, str], ...]:
        """In-memory source text for validation; never copied into public provenance."""
        return tuple(
            {"source_id": item.source_id, "url": item.url, "document": item.document}
            for item in self.items
            if item.role == "official_statement" and item.document
        )

    def to_provenance(self) -> dict[str, Any]:
        return {
            "method": "registered_feeds",
            "candidates_considered": self.candidates_considered,
            "documents_fetched": self.documents_fetched,
            "discovery": self.discovery,
            "consulted": [item.provenance_record() for item in self.items],
        }


def _topic_terms(signal: Signal) -> set[str]:
    """What this finding is *about*, asked of the finding rather than its shelf.

    This used to be the section vocabulary alone, and a section is a shelf in
    the newsroom, not a subject. Lithuania's crude birth rate is filed under
    ``environment`` because that is the beat its correspondent covers, so the
    only terms available to match against were ``climate``, ``environment`` and
    ``weather``. Measured on the published article, the five items retrieved for
    it were Estonian farm subsidies, a crane migration count, Greece's Social
    Climate Plan, Latvijas Banka's climate disclosures and a Commission daily
    digest. Nothing about demographics, and the piece went out saying the data
    did not show what drove the change.

    The section list was not wrong, it was *narrow*, and widening it is the
    trap: adding "birth" and "fertility" to ``environment`` fixes this one
    finding and leaves the next one — a section vocabulary can only ever
    enumerate the subjects somebody already thought of.

    So the metric's own label is asked as well. ``metric_label`` is the one
    field that always describes the subject, it is set per indicator rather
    than per shelf, and a metric added tomorrow brings its own vocabulary with
    it. The section terms stay because they carry synonyms a label does not:
    ``energy`` reaches "electricity" and "grid", which "Day-ahead wholesale
    electricity price" would only half supply.
    """
    section_terms = set(_SECTION_TERMS.get(signal.section, {signal.section}))
    metric_terms = {word.lower() for word in _WORD.findall(signal.metric_label or "")}
    return (section_terms | metric_terms) - _STOP_WORDS


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


def _published_sort_value(value: str | None) -> float:
    """Newest first among equals; an undated item sorts last."""
    published = _published_at(value)
    return published.timestamp() if published is not None else 0.0


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

    candidates.sort(
        key=lambda pair: (
            -pair[0],
            # Two releases can score identically — the same agency saying the
            # same thing in June and in August. Without this, the tie broke on
            # source id and then guid, which is stable but arbitrary, and the
            # newsroom explained a fresh reading with the older statement.
            -_published_sort_value(pair[1].published),
            pair[1].source_id,
            pair[1].guid,
        )
    )
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
    "DIRECTION_PLACEHOLDER",
    "NUMBER_PLACEHOLDER",
    "ResearchContext",
    "ResearchItem",
    "ResearchRole",
    "neutralise_unverified_changes",
    "redact_unverified_numbers",
    "research_selected",
    "research_signal",
]
