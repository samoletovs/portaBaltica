"""Explicit, local-only comparison evidence. Never runs an edition or a model."""

from __future__ import annotations

import argparse
import asyncio
import csv
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

from newsroom.pipeline import config
from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp, ConditionalState
from newsroom.pipeline.collect.international import (
    COUNTRIES, START_YEAR, ContextData, collect_owid, collect_worldbank,
)
from newsroom.pipeline.evidence.codec import json_bytes
from newsroom.pipeline.models import RawItem, isoformat, utcnow
from newsroom.pipeline.safety import registry
from newsroom.source_registry import SourceRegistryError

log = logging.getLogger(__name__)
DEFAULT_DIRECTORY = config.LOCAL_ARCHIVE_DIR / "international-context"
SOURCE_TIMEOUT_SECONDS = 45


def _evidence(item: RawItem) -> dict[str, Any]:
    return {
        "source_id": item.source_id, "url": item.url, "retrieved_at": item.retrieved_at,
        "sha256": item.digest, "archive_name": item.archive_name,
        "http_status": item.http_status, "from_cache": item.from_cache,
    }


def build_card(collected: ContextData, *, end_year: int) -> dict[str, Any]:
    source = registry().get(collected.data.source_id)
    series = collected.series
    common = set(series[0].periods).intersection(*(set(item.periods) for item in series[1:]))
    period = max(common) if common else None
    countries = []
    for item in series:
        values = {observation.period: observation.value for observation in item}
        latest = item.latest if item.observations else None
        countries.append({
            "code": item.geography, "name": COUNTRIES[item.geography][1],
            "latest": {"period": latest.period, "value": latest.value} if latest else None,
            "comparison_value": values[period] if period is not None else None,
            "observations": [
                {
                    "period": str(year), "value": values.get(str(year)),
                    "status": "observed" if str(year) in values else "missing",
                    "source_notes": dict(collected.annotations.get((item.geography, str(year)), {})),
                }
                for year in range(START_YEAR, end_year + 1)
            ],
        })
    return {
        "status": "ok" if period is not None else "no_common_period",
        "metric": series[0].metric, "label": series[0].metric_label, "unit": series[0].unit,
        "frequency": "annual", "definition": collected.definition,
        "comparison_period": period,
        "comparison_years_behind_window_end": end_year - int(period) if period is not None else None,
        "comparison_policy": "Latest year with an observed value for every Baltic country; no gap-filling.",
        "countries": countries, "original_sources": collected.original_sources,
        "licence": source.licence, "attribution": source.attribution,
        "source_updated": collected.source_updated,
        "source": series[0].source.to_json(),
        "evidence": {"data": _evidence(collected.data), "metadata": _evidence(collected.metadata)},
        "warnings": [
            "Annual background context, not current news or a live reading.",
            f"History is limited to {START_YEAR}-{end_year}; not the complete source series.",
            "This measure must not be spliced into the existing Eurostat series.",
        ] + ([] if period is not None else ["No same-year comparison is supported by the available observations."]),
    }


async def collect_cards(http: CollectorHttp, *, now: datetime | None = None) -> dict[str, Any]:
    moment = now if now is not None else utcnow()
    if moment.tzinfo is None:
        raise ValueError("pilot time must include a timezone")
    end_year = moment.year - 1
    if not START_YEAR <= end_year <= START_YEAR + 100:
        raise ValueError("pilot year is outside the bounded collection window")
    cards = []
    for source_id, collect in (("worldbank", collect_worldbank), ("owid", collect_owid)):
        try:
            async with asyncio.timeout(SOURCE_TIMEOUT_SECONDS):
                collected = await collect(http, end_year=end_year)
            card = build_card(collected, end_year=end_year)
            if card["status"] != "ok":
                log.warning("%s: no complete, same-year Baltic comparison", source_id)
            cards.append(card)
        except (ValueError, csv.Error, OSError, TimeoutError) as exc:
            log.error("%s context pilot failed: %s", source_id, exc)
            cards.append({"source_id": source_id, "status": "unavailable", "error": str(exc)})
    return {
        "schema_version": 1, "mode": "non_publishing_pilot", "publication_allowed": False,
        "status": "ok" if all(card["status"] == "ok" for card in cards) else "incomplete",
        "generated_at": isoformat(moment), "countries": list(COUNTRIES),
        "window": {"start_year": START_YEAR, "end_year": end_year},
        "cards": cards,
    }


async def capture(directory: Path) -> dict[str, Any]:
    archive = RawArchive(local_dir=directory / "raw", account_url="")
    state = ConditionalState(directory / "conditional-state.json")
    async with CollectorHttp(archive, state=state, max_retries=1) as http:
        result = await collect_cards(http)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "evidence-cards.json").write_bytes(json_bytes(result))
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collect", action="store_true", required=True, help="Explicitly opt in to public API requests")
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY, help="Local-only archive and report directory")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        result = asyncio.run(capture(args.directory))
    except (OSError, ValueError, SourceRegistryError) as exc:
        log.error("international context pilot failed: %s", exc)
        return 1
    log.info("Non-publishing pilot: %s; report: %s", result["status"], args.directory / "evidence-cards.json")
    for card in result["cards"]:
        log.info(
            "%s: %s, comparison period %s",
            card.get("metric", card.get("source_id")), card["status"], card.get("comparison_period"),
        )
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
