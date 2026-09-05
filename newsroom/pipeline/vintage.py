"""The vintage ledger — which figures we published, and what they read at the time.

WHY A NEWS SITE NEEDS A LEDGER
------------------------------
portaBaltica had published 161 articles and issued **zero** corrections. That is
not a record of accuracy. It is a record of never having looked: nothing in the
pipeline could compare a figure it published last week against what the same
source says this week, so there was no mechanism by which the wire could ever
discover it was wrong.

Statistical agencies revise. Eurostat's GDP flash estimate lands about thirty
days after the quarter on partial data and is superseded weeks later; national
accounts, trade and employment series are all restated as late returns arrive.
This is normal and it is published policy, not error. What is an error is
asserting "the lowest since 2019" against a vintage that has since been revised
away, and leaving the assertion up.

The unit of memory is therefore not the article but the *figure*: one metric,
one geography, one period, and the value the source showed us at the moment we
went to press. That last part is the vintage. Without it a later disagreement is
unattributable — we would know the numbers differ but not whether the source
moved or we mis-transcribed.

WHY NOT JUST RE-READ THE ARTICLE
--------------------------------
The published article carries its figures, so in principle they could be parsed
back out. That would couple correction to prose formatting, and it would lose
the retrieval time, which lives in provenance and is the only thing that makes
the comparison meaningful. A ledger keyed on the series coordinates is both
cheaper to query and honest about what it is: a record of claims, held
separately from the telling of them.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

from newsroom.pipeline.detect.series import TimeSeries
from newsroom.pipeline.models import Article, Signal, isoformat, utcnow
from newsroom.pipeline.publish import ArticleStore

log = logging.getLogger(__name__)

LEDGER_BLOB = "vintages.json"

#: The ledger is bounded. A figure whose series has moved on is not going to be
#: revised in a way anyone will act on, and an unbounded ledger is a blob that
#: grows until a run times out reading it.
MAX_ENTRIES = 2000


@dataclass(frozen=True, slots=True)
class PublishedFigure:
    """One claim, and the reading that justified it."""

    metric: str
    metric_label: str
    geography: str
    period: str
    value: float
    unit: str
    slug: str
    article_id: str
    headline: str
    #: When the source showed us this value — the vintage.
    observed_at: str
    published_at: str
    signal_id: str | None = None
    #: What the figure was measured against, in the words the article used.
    #:
    #: Carried because a value without its basis is not a fact — "rose 12%" is
    #: not reportable until a reader knows twelve per cent against what, and
    #: ``check_comparison_basis_stated`` enforces exactly that on any prose
    #: quantifying a change. Anything reading this ledger to write about a
    #: figure therefore needs the basis or it cannot describe a movement at all.
    #: Optional so ledger rows written before this field are still readable.
    comparison_basis: str = ""
    raw_source: bool = True
    summary: bool = True
    source_id: str = ""
    dataset: str | None = None

    @property
    def key(self) -> str:
        """One entry per figure per article.

        Keyed with the slug rather than only the series coordinates, because two
        articles may legitimately cite the same period of the same series and
        both need correcting when it moves.
        """
        return f"{self.metric}|{self.geography}|{self.period}|{self.slug}"

    @property
    def series_key(self) -> tuple[str, str]:
        return (self.metric, self.geography)

    def to_json(self) -> dict[str, Any]:
        out = {
            "metric": self.metric,
            "metric_label": self.metric_label,
            "geography": self.geography,
            "period": self.period,
            "value": self.value,
            "unit": self.unit,
            "slug": self.slug,
            "article_id": self.article_id,
            "headline": self.headline,
            "observed_at": self.observed_at,
            "published_at": self.published_at,
            "raw_source": self.raw_source,
            "summary": self.summary,
            "source_id": self.source_id,
            "dataset": self.dataset,
        }
        if self.signal_id:
            out["signal_id"] = self.signal_id
        if self.comparison_basis:
            out["comparison_basis"] = self.comparison_basis
        return out

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> PublishedFigure | None:
        """Tolerant by design: one malformed row must not blind the whole watch."""
        try:
            return cls(
                metric=str(payload["metric"]),
                metric_label=str(payload.get("metric_label") or payload["metric"]),
                geography=str(payload["geography"]),
                period=str(payload["period"]),
                value=float(payload["value"]),
                unit=str(payload.get("unit") or ""),
                slug=str(payload["slug"]),
                article_id=str(payload.get("article_id") or ""),
                headline=str(payload.get("headline") or ""),
                observed_at=str(payload.get("observed_at") or ""),
                published_at=str(payload.get("published_at") or ""),
                signal_id=payload.get("signal_id") or None,
                comparison_basis=str(payload.get("comparison_basis") or ""),
                raw_source=payload.get("raw_source") is True,
                summary=payload.get("summary", True) is True,
                source_id=str(payload.get("source_id") or ""),
                dataset=payload.get("dataset") or None,
            )
        except (KeyError, TypeError, ValueError) as exc:
            log.warning("skipping unreadable ledger entry (%s)", exc)
            return None


def figures_from(
    article: Article, signal: Signal, series_list: Sequence[TimeSeries] = ()
) -> list[PublishedFigure]:
    """Record raw observations, never rounded signal fields, for future comparisons."""
    if article.status != "published":
        return []
    common = {
        "slug": article.slug, "article_id": article.id, "headline": article.headline,
        "published_at": article.published_at or article.created_at,
        "signal_id": (article.provenance or {}).get("signal_id"),
        "comparison_basis": signal.comparison_basis,
    }
    tracked: dict[tuple[str, str, str], bool] = {}
    geographies = (
        [g.strip() for g in signal.context.get("geographies", "EE, LV, LT").split(",")]
        if signal.geography == "Baltic" else [signal.geography]
    )
    for geo in geographies:
        tracked[(signal.metric, geo, signal.period)] = signal.geography != "Baltic"
    for key, value in signal.context.items():
        if key.endswith(("_period", "_periods")):
            for period in value.split(","):
                for geo in geographies:
                    tracked.setdefault((signal.metric, geo, period.strip()), False)

    cited = {f.signal_field for block in article.body for f in block.figures}
    context = (article.provenance or {}).get("context") or {}
    for fact in context.get("facts", []):
        if fact.get("field") in cited and fact.get("metric") and fact.get("geography"):
            tracked.setdefault((fact["metric"], fact["geography"], fact["period"]), False)
    raw_series = {(s.metric, s.geography): s for s in series_list}
    result: list[PublishedFigure] = []
    for (metric, geo, period), summary in tracked.items():
        series = raw_series.get((metric, geo))
        observation = series.at(period) if series is not None else None
        if series is None or observation is None:
            continue
        result.append(PublishedFigure(
            metric=metric, metric_label=series.metric_label, geography=geo,
            period=period, value=observation.value, unit=series.unit,
            observed_at=series.source.retrieved_at, source_id=series.source.source_id,
            dataset=series.source.dataset, raw_source=True, summary=summary, **common,
        ))
    if signal.geography == "Baltic" and result:
        # Weekly synthesis needs the finding, not an arbitrary constituent.
        result.insert(0, PublishedFigure(
            metric=signal.metric, metric_label=signal.metric_label, geography="Baltic",
            period=signal.period, value=signal.value, unit=signal.unit,
            observed_at=result[0].observed_at, raw_source=False, summary=True, **common,
        ))
    return result


class VintageLedger:
    """An append-and-replace collection of published figures."""

    def __init__(self, entries: Iterable[PublishedFigure] = ()) -> None:
        self._entries: dict[str, PublishedFigure] = {e.key: e for e in entries}

    def __len__(self) -> int:
        return len(self._entries)

    def __iter__(self) -> Iterator[PublishedFigure]:
        return iter(self._entries.values())

    def record(self, figures: Iterable[PublishedFigure]) -> None:
        for figure in figures:
            self._entries[figure.key] = figure

    def forget(self, slugs: Iterable[str]) -> int:
        """Drop every figure belonging to these articles. Returns how many went.

        Retraction needs this, and needs it more than it needs anything done to
        the article itself. The ledger is what drives the revision watch: it
        holds ``(metric, geography, period) -> value`` for everything we have
        published, and each run compares those against the freshly collected
        series. A figure the newsroom has publicly disowned must leave, because
        otherwise the comparison keeps finding a difference and keeps reporting
        it as a restatement by the source.

        That is not hypothetical. Fixing the collector's cache collision made
        the collector read the correct series for the first time, so the ledger's
        collided ``business_bankruptcies|LT|2026-Q2 = 130.9`` no longer matched
        the true 120.3 — and the revision watch filed a public note saying
        Eurostat had revised a figure it never published. Withdrawing the
        article does not stop that; only forgetting the figure does.
        """
        doomed = {key for key, figure in self._entries.items() if figure.slug in set(slugs)}
        for key in doomed:
            del self._entries[key]
        return len(doomed)

    def for_series(self, metric: str, geography: str) -> list[PublishedFigure]:
        return [e for e in self if e.series_key == (metric, geography)]

    def to_json(self) -> dict[str, Any]:
        entries = sorted(self._entries.values(), key=lambda e: e.published_at, reverse=True)
        return {
            "generated_at": isoformat(utcnow()),
            "count": min(len(entries), MAX_ENTRIES),
            "figures": [e.to_json() for e in entries[:MAX_ENTRIES]],
        }

    @classmethod
    def from_json(cls, payload: Any) -> VintageLedger:
        if not isinstance(payload, dict):
            return cls()
        rows = payload.get("figures")
        if not isinstance(rows, list):
            return cls()
        parsed = (PublishedFigure.from_json(r) for r in rows if isinstance(r, dict))
        return cls(e for e in parsed if e is not None)


class VintageStore(ArticleStore):
    """The same durable-write and authoritative-read contract as article storage."""

    def __init__(
        self,
        *,
        local_dir: Path | None = None,
        account_url: str | None = None,
        container: str | None = None,
    ) -> None:
        super().__init__(local_dir=local_dir, account_url=account_url, container=container)

    def _read(self) -> VintageLedger:
        payload = self._read_authoritative(LEDGER_BLOB)
        if payload is not None and (
            not isinstance(payload, dict) or not isinstance(payload.get("figures"), list)
        ):
            raise ValueError("invalid vintage ledger")
        return VintageLedger.from_json(payload)

    def _write(self, ledger: VintageLedger) -> None:
        self._put_json(LEDGER_BLOB, ledger.to_json(), "no-cache")

    async def load(self) -> VintageLedger:
        return await asyncio.to_thread(self._read)

    async def save(self, ledger: VintageLedger) -> None:
        await asyncio.to_thread(self._write, ledger)

    async def record(self, figures: Sequence[PublishedFigure]) -> VintageLedger:
        ledger = await self.load()
        ledger.record(figures)
        await self.save(ledger)
        return ledger


__all__ = [
    "LEDGER_BLOB",
    "MAX_ENTRIES",
    "PublishedFigure",
    "VintageLedger",
    "VintageStore",
    "figures_from",
]
