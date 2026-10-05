"""Evaluate and publish at most two explicitly commissioned annual comparisons."""

from __future__ import annotations

import argparse
import asyncio
import csv
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from azure.core.exceptions import AzureError
from openai import OpenAIError

from newsroom.pipeline import config
from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp, ConditionalState
from newsroom.pipeline.collect.international import (
    COUNTRIES, OWID_METRIC, WORLD_BANK_METRIC, ContextData, collect_owid, collect_worldbank,
)
from newsroom.pipeline.context import ContextFact, ContextPack
from newsroom.pipeline.desk import Finding, run_desk
from newsroom.pipeline.evidence.codec import json_bytes
from newsroom.pipeline.international_context import SOURCE_TIMEOUT_SECONDS, build_card
from newsroom.pipeline.models import Article, Signal, SourceRef, isoformat, utcnow
from newsroom.pipeline.publish import ArticleStore, is_servable
from newsroom.pipeline.rank import finding_key
from newsroom.pipeline.vintage import VintageStore, figures_from
from newsroom.pipeline.write.accounting import WriterAttempt, summarize_attempts
from newsroom.pipeline.write.generator import generate_article
from newsroom.pipeline.write.llm import AzureOpenAIWriter, LlmWriter

log = logging.getLogger(__name__)
DEFAULT_DIRECTORY = config.LOCAL_ARCHIVE_DIR / "international-explainers"
EXPECTED_FAILURES = (ValueError, csv.Error, OSError, RuntimeError, AzureError, OpenAIError)


@dataclass(frozen=True)
class Commission:
    signal: Signal
    context: ContextPack
    collected: ContextData
    headline: str


def commission(collected: ContextData, *, end_year: int) -> Commission:
    card = build_card(collected, end_year=end_year)
    if card["status"] != "ok":
        raise ValueError("An explainer requires a shared observation year for all three Baltic countries")
    period = card["comparison_period"]
    series = collected.series
    metric = series[0].metric
    if metric not in (WORLD_BANK_METRIC, OWID_METRIC):
        raise ValueError("Only the two approved comparison measures may be commissioned")
    values = {country["code"]: country["comparison_value"] for country in card["countries"]}
    high = max(values, key=values.__getitem__)
    low = min(values, key=values.__getitem__)
    fields = {f"value_{geo.lower()}": value for geo, value in values.items()}
    fields["spread"] = values[high] - values[low]
    field_units: dict[str, str | None] = {}
    if metric == WORLD_BANK_METRIC:
        headline = f"Baltic GDP per person in {period}: a price-adjusted comparison"
        fields["price_base_year"] = 2021
        field_units["price_base_year"] = None
        scope = (
            "World Bank GDP per person is economic output, not salary, household income or wealth. "
            "Purchasing power parities adjust for differences in price levels between countries. "
            "Constant international dollars are not euros or a current exchange-rate conversion."
        )
        attribution = (
            "World Bank, World Development Indicators; International Comparison Program and the "
            "original providers listed in the linked indicator metadata."
        )
    else:
        headline = f"Comparing Baltic territorial CO2 emissions per person in {period}"
        scope = (
            "Territorial fossil-fuel and industrial CO2 per person, excluding land-use change. "
            "Not all greenhouse gases, not consumption-based emissions and not a person's full footprint. "
            "International aviation and shipping are excluded from individual-country totals."
        )
        attribution = (
            "Global Carbon Budget and population sources, processed by Our World in Data. "
            "The linked metadata identifies the original providers and dataset versions."
        )
    facts = tuple(
        ContextFact(
            field=f"value_{geo.lower()}", value=values[geo], unit=series[0].unit,
            label=f"{COUNTRIES[geo][1]}'s own level, not a gap", kind="peer",
            source_id=collected.data.source_id, period=period, metric=metric, geography=geo,
            dataset=series[0].source.dataset,
        )
        for geo in COUNTRIES
    )
    pack = ContextPack(
        facts=facts, period_labels=(period,), series_considered=len(series),
        observations=(
            "Annual levels are compared on the same definition and observation year.",
            scope,
            "The comparison establishes differences, not why they exist or what policy caused them.",
            "Required source attribution: " + attribution,
        ),
    )
    signal = Signal(
        detector="commissioned_comparison", metric=metric, metric_label=series[0].metric_label,
        geography="Baltic", period=period, value=fields["spread"], unit=series[0].unit,
        comparison_basis=(
            f"Latvia, Estonia and Lithuania on the same definition in {period}; "
            "the spread is the highest country's level minus the lowest, not a change over time"
        ),
        score=0.0, section=series[0].section, fields=fields, field_units=field_units,
        sources=(
            series[0].source,
            SourceRef(
                source_id=collected.metadata.source_id, retrieved_at=collected.metadata.retrieved_at,
                dataset=f"{series[0].source.dataset}:metadata",
                dataset_version=series[0].source.dataset_version, url=collected.metadata.url,
            ),
        ),
        context={
            "geographies": ", ".join(COUNTRIES), "high_geo": high, "low_geo": low,
            "frequency": "annual", "measurement_scope": scope,
            "source_attribution": attribution, "commission": "annual comparison explainer",
            "commissioned_headline": headline,
        },
    )
    return Commission(signal, pack, collected, headline)


def evaluate_article(
    selected: Commission, writer: LlmWriter, *, attempts: list[WriterAttempt],
) -> Article:
    signal, pack = selected.signal, selected.context
    generated = generate_article(
        signal, writer, pack=pack, paragraphs=5, live_chart=False, attempt_log=attempts,
        headline_override=selected.headline,
    )
    if not generated.publishable:
        return generated.article

    def revise(previous: Article, notes: Sequence[str]) -> Article | None:
        revised = generate_article(
            signal, writer, pack=pack, paragraphs=5, live_chart=False,
            editor_notes=notes, editor_draft=previous, attempt_log=attempts,
            headline_override=selected.headline,
        )
        return revised.article if revised.publishable else None

    outcome = run_desk(
        generated.article, writer, revise=revise, pack=pack,
        finding=Finding(
            detector=signal.detector, comparison_basis=signal.comparison_basis,
            among_strongest=False, commissioned=True,
        ),
    )
    article = outcome.revised_article or generated.article
    if outcome.publishable and is_servable(article):
        article.provenance["published_observations"] = [
            figure.to_json() for figure in figures_from(article, signal, selected.collected.series)
        ]
    return article


async def run(
    http: CollectorHttp, writer: LlmWriter, store: ArticleStore, vintages: VintageStore,
    *, publish: bool, archive: RawArchive,
) -> dict[str, Any]:
    end_year = utcnow().year - 1
    previous = await store.published_findings()
    results: list[dict[str, Any]] = []
    attempts: list[WriterAttempt] = []
    for source_id, collect in (("worldbank", collect_worldbank), ("owid", collect_owid)):
        try:
            async with asyncio.timeout(SOURCE_TIMEOUT_SECONDS):
                collected = await collect(http, end_year=end_year)
            selected = commission(collected, end_year=end_year)
            signal = selected.signal
            key = finding_key(signal.metric, signal.geography, signal.period)
            if key in previous:
                results.append({"source_id": source_id, "status": "already_published", "finding": key})
                continue
            if publish:
                for item in (collected.data, collected.metadata):
                    if item.from_cache:
                        await archive.store(item)
            article = evaluate_article(selected, writer, attempts=attempts)
            if not is_servable(article):
                await store.put(article)
                log.error("%s explainer withheld by factual/editorial checks", source_id)
                results.append({
                    "source_id": source_id, "status": "rejected", "slug": article.slug,
                    "validator": article.provenance["validator"], "editor": article.provenance.get("editor"),
                })
                continue
            await store.put(article)
            if publish:
                await vintages.record(figures_from(article, signal, collected.series))
                await store.write_index([article])
                if key not in await store.published_findings():
                    raise RuntimeError("Article was stored but its index entry could not be verified")
            results.append({
                "source_id": source_id, "status": "published" if publish else "preview",
                "slug": article.slug, "headline": article.headline, "period": signal.period,
                "url": f"https://portabaltica.naurolabs.com/article/{article.slug}" if publish else None,
                "validator_passed": True, "editor": article.provenance["editor"],
            })
        except EXPECTED_FAILURES as exc:
            log.exception("%s explainer failed", source_id)
            results.append({"source_id": source_id, "status": "failed", "error": str(exc)})
    return {
        "generated_at": isoformat(utcnow()), "mode": "publication" if publish else "local_preview",
        "revision": config.REVISION or None,
        "status": "ok" if all(row["status"] in ("published", "preview", "already_published") for row in results) else "incomplete",
        "results": results, "writer_attempts": summarize_attempts(attempts),
    }


async def execute(directory: Path, *, publish: bool) -> dict[str, Any]:
    account = config.STORAGE_ACCOUNT_URL if publish else ""
    if publish and (not account or not config.REVISION):
        raise ValueError("Publication requires the existing storage account and exact NEWSROOM_REVISION")
    archive = RawArchive(local_dir=directory / "raw", account_url=account)
    store = ArticleStore(local_dir=directory / "articles", account_url=account)
    vintages = VintageStore(local_dir=directory / "articles", account_url=account)
    state = ConditionalState(directory / "conditional-state.json")
    writer = AzureOpenAIWriter()
    async with CollectorHttp(archive, state=state, max_retries=1) as http:
        report = await run(http, writer, store, vintages, publish=publish, archive=archive)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "report.json").write_bytes(json_bytes(report))
    return report


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preview", action="store_true", help="Evaluate with the model; store only local previews")
    mode.add_argument("--publish", action="store_true", help="Evaluate and publish only articles approved by every existing gate")
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    for name in ("azure", "httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    try:
        report = asyncio.run(execute(args.directory, publish=args.publish))
    except EXPECTED_FAILURES as exc:
        log.error("international explainers failed: %s", exc)
        return 1
    log.info("%s", json_bytes(report).decode().rstrip())
    return 0 if report["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
