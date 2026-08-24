"""The orchestrator: collect -> detect -> rank -> research -> write -> validate -> publish.

One run of this function is one edition of the wire. It is deliberately boring:
every interesting decision has already been made in a stage module, and the
failure policy is uniform — a stage that breaks costs coverage, never accuracy.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Sequence

from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp
from newsroom.pipeline.collect.opendata import collect_open_data
from newsroom.pipeline.collect.rss import extract_raw_description, parse_feed
from newsroom.pipeline.detect import Threshold, detect_all
from newsroom.pipeline.detect.series import TimeSeries
from newsroom.pipeline.models import Article, FeedItem, Signal
from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.rank import RankingReport, rank
from newsroom.pipeline.research import ResearchContext, research_selected
from newsroom.pipeline.safety import registry
from newsroom.pipeline.syndicate import pending_approval_queue, syndicate
from newsroom.pipeline.write import AzureOpenAIWriter, LlmWriter, generate_article
from newsroom.pipeline.write.generator import GenerationRefused, GenerationResult

log = logging.getLogger(__name__)

#: Levels whose crossing is editorially meaningful. Negative wholesale power
#: prices — the market paying consumers to take electricity — are the strongest
#: single-number story this pipeline can find, hence the weight.
THRESHOLDS: dict[str, tuple[Threshold, ...]] = {
    "day_ahead_power_price": (
        Threshold(name="zero-price", value=0.0, weight=0.95, unit_label="EUR/MWh"),
        Threshold(name="€200/MWh", value=200.0, weight=0.75, unit_label="EUR/MWh"),
        Threshold(name="€100/MWh", value=100.0, weight=0.45, unit_label="EUR/MWh"),
    ),
    "unemployment_rate": (
        Threshold(name="7%", value=7.0, weight=0.6, unit_label="%"),
        Threshold(name="6%", value=6.0, weight=0.5, unit_label="%"),
    ),
    "hicp_annual_rate": (
        Threshold(name="the ECB's 2% target", value=2.0, weight=0.8, unit_label="%"),
        Threshold(name="4%", value=4.0, weight=0.6, unit_label="%"),
    ),
}


@dataclass
class RunReport:
    series: list[TimeSeries] = field(default_factory=list)
    signals: list[Signal] = field(default_factory=list)
    ranking: RankingReport | None = None
    generated: list[GenerationResult] = field(default_factory=list)
    syndicated: list[Article] = field(default_factory=list)
    research: dict[str, ResearchContext] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    @property
    def published(self) -> list[Article]:
        return [g.article for g in self.generated if g.publishable]

    @property
    def rejected(self) -> list[Article]:
        return [g.article for g in self.generated if not g.publishable]

    def summary(self) -> str:
        return (
            f"{len(self.series)} series, {len(self.signals)} signals, "
            f"{len(self.ranking.selected) if self.ranking else 0} selected, "
            f"{len(self.published)} published, {len(self.rejected)} rejected, "
            f"{len(self.syndicated)} syndicated cards, {len(self.errors)} error(s)"
        )


async def collect_feeds(
    http: CollectorHttp,
    archive: RawArchive,
) -> tuple[list[FeedItem], dict[str, str]]:
    """Fetch every enabled tier B/C feed and read back the archived descriptions.

    The descriptions used for the verbatim check are re-read from the archived
    bytes rather than kept from the parse, so the check compares a published
    snippet against what the publisher actually served.
    """
    items: list[FeedItem] = []
    raw_descriptions: dict[str, str] = {}
    # by_tier() returns every registered source of that tier; enabled_sources()
    # filters out the ones marked `enabled: false` (delfi_global is disabled
    # until its channel is confirmed to serve English). Intersecting the two
    # keeps a disabled source out of the wire without removing it from the
    # registry, which is where its licence and attribution are recorded.
    enabled_ids = {source.id for source in registry().enabled_sources()}
    syndicated = [
        source
        for tier in ("B", "C")
        for source in registry().by_tier(tier)
        if source.id in enabled_ids
    ]
    for source in syndicated:
        result = await http.fetch(
            source_id=source.id,
            url=source.endpoint,
            cache_ttl_minutes=source.cache_ttl_minutes,
        )
        if not result.ok or result.item is None:
            log.info("%s: %s", source.id, result.skipped_reason)
            continue
        raw_blob = result.item.archive_name
        parsed = parse_feed(
            result.item.body,
            source_id=source.id,
            raw_blob=raw_blob,
            retrieved_at=result.item.retrieved_at,
        )
        items.extend(parsed)
        stored = archive.read(raw_blob)
        for item in parsed:
            description = extract_raw_description(stored, item.guid)
            if description is not None:
                raw_descriptions[item.guid] = description
    return items, raw_descriptions


async def run_once(
    *,
    writer: LlmWriter | None = None,
    store: ArticleStore | None = None,
    archive: RawArchive | None = None,
    http: CollectorHttp | None = None,
    include_syndication: bool = True,
    max_articles: int | None = None,
) -> RunReport:
    report = RunReport()
    archive = archive or RawArchive()
    store = store or ArticleStore()
    writer = writer or AzureOpenAIWriter()

    owns_http = http is None
    client = http or CollectorHttp(archive)
    if owns_http:
        await client.__aenter__()
    try:
        # --- 1. collect --------------------------------------------------
        try:
            report.series = await collect_open_data(client)
        except Exception as exc:  # noqa: BLE001
            log.exception("open-data collection failed")
            report.errors.append(f"collect_open_data: {exc}")

        feed_items: list[FeedItem] = []
        raw_descriptions: dict[str, str] = {}
        if include_syndication:
            try:
                feed_items, raw_descriptions = await collect_feeds(client, archive)
            except Exception as exc:  # noqa: BLE001
                log.exception("feed collection failed")
                report.errors.append(f"collect_feeds: {exc}")

        # --- 2. detect ---------------------------------------------------
        report.signals = detect_all(report.series, thresholds=THRESHOLDS)

        # --- 3. rank -----------------------------------------------------
        policy = None
        if max_articles is not None:
            from newsroom.pipeline.config import DEFAULT_RANKING, RankingPolicy

            policy = RankingPolicy(
                max_articles=max_articles,
                min_score=DEFAULT_RANKING.min_score,
                max_per_metric=DEFAULT_RANKING.max_per_metric,
            )
        report.ranking = rank(report.signals, policy)

        # --- 4. research -------------------------------------------------
        report.research = research_selected(report.ranking.selected, feed_items)

        # --- 5/6. write and validate -------------------------------------
        for signal in report.ranking.selected:
            try:
                report.generated.append(
                    generate_article(signal, writer, research=report.research[signal.id])
                )
            except GenerationRefused as exc:
                log.warning("generation refused for %s: %s", signal.id, exc)
                report.errors.append(f"refused {signal.id}: {exc}")
            except Exception as exc:  # noqa: BLE001
                log.exception("generation failed for signal %s", signal.id)
                report.errors.append(f"generate {signal.id}: {exc}")

        # --- tier B/C ----------------------------------------------------
        if include_syndication and feed_items:
            report.syndicated = syndicate(feed_items, raw_descriptions=raw_descriptions)

        # --- 7. publish ---------------------------------------------------
        await _store_all(store, report)
    finally:
        if owns_http:
            await client.__aexit__(None, None, None)

    log.info("run complete: %s", report.summary())
    return report


async def _store_all(store: ArticleStore, report: RunReport) -> None:
    for result in report.generated:
        try:
            await store.put(result.article)
        except Exception as exc:  # noqa: BLE001
            log.exception("failed to store article %s", result.article.id)
            report.errors.append(f"store {result.article.id}: {exc}")
    for card in report.syndicated:
        try:
            await store.put(card)
        except Exception as exc:  # noqa: BLE001
            log.exception("failed to store card %s", card.id)
            report.errors.append(f"store {card.id}: {exc}")
    await store.write_index(report.published)


def approval_queue(report: RunReport) -> list[dict[str, object]]:
    """Tier B/C handoff for the Telegram approval workstream."""
    return pending_approval_queue(report.syndicated)


def _sync_run(**kwargs: object) -> RunReport:  # pragma: no cover - convenience
    return asyncio.run(run_once(**kwargs))  # type: ignore[arg-type]


__all__ = ["RunReport", "THRESHOLDS", "approval_queue", "collect_feeds", "run_once"]
