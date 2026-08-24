"""Tier A open-data collectors — the sources we write original analysis from.

Each collector turns a public API response into
:class:`~newsroom.pipeline.detect.series.TimeSeries` objects. Nothing here
interprets the data; interpretation is stage 2's job and is deterministic.

Only sources registered in ``newsroom/sources.yaml`` are reachable from here —
the registry lookup is what supplies the endpoint, the licence and the
attribution that ends up in the article's provenance block.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

from newsroom.pipeline.collect.httpclient import CollectorHttp
from newsroom.pipeline.detect.series import Observation, TimeSeries
from newsroom.pipeline.models import SourceRef, isoformat, utcnow
from newsroom.pipeline.safety import registry

log = logging.getLogger(__name__)

BALTIC = ("LV", "EE", "LT")


# ---------------------------------------------------------------------------
# Eurostat (JSON-stat 2.0)
# ---------------------------------------------------------------------------
class EurostatDataset:
    """A single Eurostat dataset and how to read it as a per-country series."""

    def __init__(
        self,
        *,
        dataset: str,
        metric: str,
        metric_label: str,
        unit: str,
        section: str,
        params: dict[str, str],
        frequency: str = "monthly",
        chart_ref: str | None = None,
        periods: int = 60,
    ) -> None:
        self.dataset = dataset
        self.metric = metric
        self.metric_label = metric_label
        self.unit = unit
        self.section = section
        self.params = params
        self.frequency = frequency
        self.chart_ref = chart_ref
        self.periods = periods


EUROSTAT_DATASETS: tuple[EurostatDataset, ...] = (
    EurostatDataset(
        dataset="une_rt_m",
        metric="unemployment_rate",
        metric_label="unemployment rate",
        unit="% of the labour force",
        section="labour",
        frequency="monthly",
        chart_ref="labour.unemployment",
        params={"s_adj": "SA", "age": "TOTAL", "sex": "T", "unit": "PC_ACT"},
    ),
    EurostatDataset(
        dataset="prc_hicp_manr",
        metric="hicp_annual_rate",
        metric_label="annual consumer price inflation (HICP)",
        unit="%",
        section="economy",
        frequency="monthly",
        chart_ref="economy.inflation",
        params={"coicop": "CP00", "unit": "RCH_A"},
    ),
)


def _jsonstat_index(sizes: Sequence[int], coords: Sequence[int]) -> int:
    index = 0
    for size, coord in zip(sizes, coords):
        index = index * size + coord
    return index


def parse_jsonstat(
    payload: dict[str, Any],
    spec: EurostatDataset,
    *,
    retrieved_at: str,
    url: str,
) -> list[TimeSeries]:
    """Turn a JSON-stat 2.0 response into one series per geography.

    Eurostat returns ``value`` as a **sparse** mapping of flat-index -> number:
    a period with no observation yet is simply absent rather than null. Treating
    a missing key as zero would invent a collapse in the data, so missing points
    are dropped and the series is simply shorter.
    """
    dimension_ids: list[str] = payload.get("id", [])
    sizes: list[int] = payload.get("size", [])
    dimensions = payload.get("dimension", {})
    raw_values = payload.get("value", {})

    if "geo" not in dimension_ids or "time" not in dimension_ids:
        log.warning("%s: response lacks geo/time dimensions", spec.dataset)
        return []

    def values_at(flat_index: int) -> float | None:
        if isinstance(raw_values, list):
            if 0 <= flat_index < len(raw_values):
                value = raw_values[flat_index]
                return float(value) if isinstance(value, (int, float)) else None
            return None
        value = raw_values.get(str(flat_index))
        return float(value) if isinstance(value, (int, float)) else None

    geo_index: dict[str, int] = dimensions["geo"]["category"]["index"]
    time_index: dict[str, int] = dimensions["time"]["category"]["index"]
    if isinstance(time_index, list):  # some responses use a list form
        time_index = {period: i for i, period in enumerate(time_index)}
    if isinstance(geo_index, list):
        geo_index = {geo: i for i, geo in enumerate(geo_index)}

    dataset_version = payload.get("updated") or payload.get("extension", {}).get("datasetVersion")

    series_out: list[TimeSeries] = []
    for geo, geo_pos in geo_index.items():
        observations: list[Observation] = []
        for period, time_pos in sorted(time_index.items(), key=lambda kv: kv[1]):
            coords = []
            for dim_id in dimension_ids:
                if dim_id == "geo":
                    coords.append(geo_pos)
                elif dim_id == "time":
                    coords.append(time_pos)
                else:
                    coords.append(0)
            value = values_at(_jsonstat_index(sizes, coords))
            if value is not None:
                observations.append(Observation(period=period, value=value))
        if not observations:
            log.info("%s/%s: no observations returned", spec.dataset, geo)
            continue
        observations.sort(key=lambda o: o.period)
        series_out.append(
            TimeSeries(
                metric=spec.metric,
                metric_label=spec.metric_label,
                geography=geo,
                unit=spec.unit,
                section=spec.section,
                observations=tuple(observations),
                frequency=spec.frequency,
                chart_ref=spec.chart_ref,
                source=SourceRef(
                    source_id="eurostat",
                    retrieved_at=retrieved_at,
                    dataset=spec.dataset,
                    dataset_version=str(dataset_version) if dataset_version else None,
                    url=url,
                ),
            )
        )
    return series_out


async def collect_eurostat(
    http: CollectorHttp,
    datasets: Iterable[EurostatDataset] = EUROSTAT_DATASETS,
    *,
    geographies: Sequence[str] = BALTIC,
) -> list[TimeSeries]:
    source = registry().get("eurostat")
    out: list[TimeSeries] = []
    for spec in datasets:
        url = source.endpoint.format(dataset=spec.dataset)
        params: list[tuple[str, str]] = [
            ("format", "JSON"),
            ("lang", "EN"),
            ("lastTimePeriod", str(spec.periods)),
            *spec.params.items(),
            *[("geo", geo) for geo in geographies],
        ]
        result = await http.fetch(
            source_id="eurostat",
            url=url,
            cache_ttl_minutes=source.cache_ttl_minutes,
            accept="application/json",
            params=params,  # type: ignore[arg-type]
        )
        if not result.ok or result.item is None:
            log.warning("eurostat/%s: %s", spec.dataset, result.skipped_reason)
            continue
        try:
            payload = json.loads(result.item.body)
        except json.JSONDecodeError:
            log.error("eurostat/%s: response was not JSON", spec.dataset)
            continue
        out.extend(
            parse_jsonstat(payload, spec, retrieved_at=result.item.retrieved_at, url=result.item.url)
        )
    return out


# ---------------------------------------------------------------------------
# Elering — Nord Pool day-ahead electricity prices
# ---------------------------------------------------------------------------
def parse_elering(
    payload: dict[str, Any],
    *,
    retrieved_at: str,
    url: str,
    geographies: Sequence[str] = BALTIC,
) -> list[TimeSeries]:
    """Aggregate Elering's sub-hourly price points into daily series.

    Two series per country are produced because they answer different
    questions: the daily **mean** is what a household pays on average, while the
    daily **spread** between the cheapest and dearest interval is what decides
    whether shifting industrial load is worth doing. Aggregating to whole days
    also makes the collector indifferent to Elering's resolution, which is
    currently 15 minutes rather than the hourly it used to be.

    The current (partial) day is dropped: a day that is still being filled in
    would otherwise look like a collapse in volume against complete days.
    """
    data = payload.get("data", {})
    today = utcnow().date().isoformat()
    series_out: list[TimeSeries] = []

    for geo in geographies:
        points = data.get(geo.lower()) or []
        by_day: dict[str, list[float]] = {}
        for point in points:
            timestamp = point.get("timestamp")
            price = point.get("price")
            if timestamp is None or not isinstance(price, (int, float)):
                continue
            day = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).date().isoformat()
            by_day.setdefault(day, []).append(float(price))

        complete = {day: prices for day, prices in by_day.items() if day < today and prices}
        if not complete:
            continue

        source = SourceRef(
            source_id="elering",
            retrieved_at=retrieved_at,
            dataset="nps/price day-ahead",
            url=url,
        )
        means = tuple(
            Observation(period=day, value=round(sum(prices) / len(prices), 2))
            for day, prices in sorted(complete.items())
        )
        spreads = tuple(
            Observation(period=day, value=round(max(prices) - min(prices), 2))
            for day, prices in sorted(complete.items())
        )
        series_out.append(
            TimeSeries(
                metric="day_ahead_power_price",
                metric_label="day-ahead wholesale electricity price",
                geography=geo,
                unit="EUR/MWh",
                section="energy",
                observations=means,
                frequency="daily",
                chart_ref="energy.electricity",
                source=source,
            )
        )
        series_out.append(
            TimeSeries(
                metric="day_ahead_power_spread",
                metric_label="daily spread between the cheapest and dearest power interval",
                geography=geo,
                unit="EUR/MWh",
                section="energy",
                observations=spreads,
                frequency="daily",
                chart_ref="energy.electricity",
                source=source,
            )
        )
    return series_out


async def collect_elering(http: CollectorHttp, *, days: int = 120) -> list[TimeSeries]:
    source = registry().get("elering")
    end = utcnow().replace(hour=23, minute=59, second=59, microsecond=0)
    start = (end - timedelta(days=days)).replace(hour=0, minute=0, second=0)
    result = await http.fetch(
        source_id="elering",
        url=source.endpoint,
        cache_ttl_minutes=source.cache_ttl_minutes,
        accept="application/json",
        params={
            "start": start.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "end": end.strftime("%Y-%m-%dT%H:%M:%S.999Z"),
        },
    )
    if not result.ok or result.item is None:
        log.warning("elering: %s", result.skipped_reason)
        return []
    try:
        payload = json.loads(result.item.body)
    except json.JSONDecodeError:
        log.error("elering: response was not JSON")
        return []
    if not payload.get("success", True):
        log.error("elering: API reported failure")
        return []
    return parse_elering(payload, retrieved_at=result.item.retrieved_at, url=result.item.url)


async def collect_open_data(http: CollectorHttp) -> list[TimeSeries]:
    """Every tier A collector. A failing source costs coverage, never accuracy."""
    series: list[TimeSeries] = []
    for name, coroutine in (("elering", collect_elering(http)), ("eurostat", collect_eurostat(http))):
        try:
            series.extend(await coroutine)
        except Exception:  # noqa: BLE001 - one bad source must not sink the run
            log.exception("%s collector failed; continuing with fewer series", name)
    log.info("collected %d series from tier A sources", len(series))
    return series


__all__ = [
    "EUROSTAT_DATASETS",
    "EurostatDataset",
    "collect_elering",
    "collect_eurostat",
    "collect_open_data",
    "parse_elering",
    "parse_jsonstat",
]
