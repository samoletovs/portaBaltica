"""Pinned annual context sources, used only by the non-publishing pilot."""

from __future__ import annotations

import csv
import io
import json
import math
import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Mapping

from newsroom.pipeline.collect.httpclient import CollectorHttp
from newsroom.pipeline.detect.series import Observation, SUBJECT_GEOGRAPHIES, TimeSeries
from newsroom.pipeline.models import RawItem, SourceRef
from newsroom.pipeline.safety import registry

START_YEAR = 2000
COUNTRIES = {"LV": ("LVA", "Latvia"), "EE": ("EST", "Estonia"), "LT": ("LTU", "Lithuania")}
ISO3_TO_GEO = {iso3: geo for geo, (iso3, _) in COUNTRIES.items()}
MAX_PAYLOAD_BYTES = 2 * 1024 * 1024
WORLD_BANK_INDICATOR = "NY.GDP.PCAP.PP.KD"
WORLD_BANK_TITLE = "GDP per capita, PPP (constant 2021 international $)"
WORLD_BANK_METRIC = "worldbank_gdp_per_capita_ppp_2021"
WORLD_BANK_UNIT = "constant 2021 international dollars per person"
OWID_CHART = "co-emissions-per-capita"
OWID_COLUMN = "emissions_total_per_capita"
OWID_VARIABLE = 1119914
OWID_METRIC = "owid_fossil_co2_per_capita"
OWID_UNIT = "tonnes CO2 per person"


@dataclass(frozen=True)
class ContextData:
    series: tuple[TimeSeries, ...]
    definition: str
    original_sources: str
    source_updated: str
    data: RawItem
    metadata: RawItem
    annotations: Mapping[tuple[str, str], Mapping[str, str]]


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be non-empty text")
    return value


def _date(value: Any, label: str) -> str:
    text = _text(value, label)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ValueError(f"{label} must be an ISO date")
    date.fromisoformat(text)
    return text


def _body(item: RawItem) -> str:
    if not 200 <= item.http_status < 300:
        raise ValueError(f"{item.source_id}: non-success archived HTTP status")
    if len(item.body) > MAX_PAYLOAD_BYTES:
        raise ValueError(f"{item.source_id}: payload exceeds the pilot's 2 MiB limit")
    return item.body.decode("utf-8-sig")


def _worldbank_payload(item: RawItem) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = json.loads(_body(item))
    if not isinstance(payload, list) or len(payload) != 2 or not isinstance(payload[1], list):
        raise ValueError("World Bank response must contain pagination and records")
    page = _object(payload[0], "World Bank pagination")
    rows = [_object(row, "World Bank record") for row in payload[1]]
    if (
        type(page.get("page")) is not int or page["page"] != 1
        or type(page.get("pages")) is not int or page["pages"] != 1
        or type(page.get("total")) is not int or page["total"] != len(rows)
    ):
        raise ValueError("World Bank response is incomplete or paginated; refusing a partial series")
    return page, rows


def _period(value: Any, end_year: int) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}", value):
        raise ValueError("observation period must be a four-digit year")
    if not START_YEAR <= int(value) <= end_year:
        raise ValueError(f"observation year {value} is outside the requested window")
    return value


def _number(value: Any) -> float | None:
    if value is None:
        return None
    if type(value) not in (int, float) or value < 0:
        raise ValueError("observations must be finite, non-negative numbers or null")
    try:
        number = float(value)
    except OverflowError as exc:
        raise ValueError("observations must be finite, non-negative numbers or null") from exc
    if not math.isfinite(number):
        raise ValueError("observations must be finite, non-negative numbers or null")
    return number


def _series(
    cells: Mapping[tuple[str, str], float | None],
    *,
    metric: str,
    label: str,
    unit: str,
    section: str,
    item: RawItem,
    dataset: str,
    version: str,
) -> tuple[TimeSeries, ...]:
    source = SourceRef(
        source_id=item.source_id, retrieved_at=item.retrieved_at,
        dataset=dataset, dataset_version=version, url=item.url,
    )
    return tuple(
        TimeSeries(
            metric=metric, metric_label=label, geography=geo, unit=unit, section=section,
            frequency="annual", chart_ref=None, source=source, origin=None,
            observations=tuple(
                Observation(period, value)
                for (country, period), value in sorted(cells.items())
                if country == geo and value is not None
            ),
        )
        for geo in SUBJECT_GEOGRAPHIES
    )


def parse_worldbank(data: RawItem, metadata: RawItem, *, end_year: int) -> ContextData:
    _, definitions = _worldbank_payload(metadata)
    if len(definitions) != 1:
        raise ValueError("World Bank metadata must identify exactly one indicator")
    definition = definitions[0]
    if (
        definition.get("id") != WORLD_BANK_INDICATOR
        or definition.get("name") != WORLD_BANK_TITLE
        or _object(definition.get("source"), "World Bank metadata source").get("id") != "2"
    ):
        raise ValueError("World Bank indicator identity or PPP price basis changed")
    description = _text(definition.get("sourceNote"), "World Bank definition")
    original_sources = _text(definition.get("sourceOrganization"), "World Bank original sources")
    page, rows = _worldbank_payload(data)
    if page.get("sourceid") != "2":
        raise ValueError("World Bank data is not from World Development Indicators")
    updated = _date(page.get("lastupdated"), "World Bank lastupdated")
    cells: dict[tuple[str, str], float | None] = {}
    annotations: dict[tuple[str, str], dict[str, str]] = {}
    for row in rows:
        indicator = _object(row.get("indicator"), "World Bank row indicator")
        country = _object(row.get("country"), "World Bank row country")
        iso3 = row.get("countryiso3code")
        if not isinstance(iso3, str) or iso3 not in ISO3_TO_GEO:
            raise ValueError("World Bank returned an unexpected country")
        geo = ISO3_TO_GEO[iso3]
        if country.get("id") != geo or country.get("value") != COUNTRIES[geo][1]:
            raise ValueError("World Bank country identifiers disagree")
        if indicator.get("id") != WORLD_BANK_INDICATOR or indicator.get("value") != WORLD_BANK_TITLE:
            raise ValueError("World Bank returned the wrong indicator or unit basis")
        key = (geo, _period(row.get("date"), end_year))
        if key in cells:
            raise ValueError("duplicate World Bank country/year observation")
        if "value" not in row:
            raise ValueError("World Bank observation has no value field")
        cells[key] = _number(row["value"])
        notes = {}
        for field in ("obs_status", "footnote"):
            note = row.get(field, "")
            if not isinstance(note, str):
                raise ValueError(f"World Bank {field} must be text")
            if note:
                notes[field] = note
        if notes:
            annotations[key] = notes
    return ContextData(
        series=_series(
            cells, metric=WORLD_BANK_METRIC, label=WORLD_BANK_TITLE, unit=WORLD_BANK_UNIT,
            section="economy", item=data, dataset=WORLD_BANK_INDICATOR, version=updated,
        ),
        definition=description, original_sources=original_sources, source_updated=updated,
        data=data, metadata=metadata, annotations=annotations,
    )


def parse_owid(data: RawItem, metadata: RawItem, *, end_year: int) -> ContextData:
    payload = _object(json.loads(_body(metadata)), "OWID metadata")
    chart = _object(payload.get("chart"), "OWID chart")
    if chart.get("originalChartUrl") != f"https://ourworldindata.org/grapher/{OWID_CHART}":
        raise ValueError("OWID metadata describes a different chart")
    columns = _object(payload.get("columns"), "OWID columns")
    if len(columns) != 1:
        raise ValueError("OWID metadata must describe exactly one measure")
    column = _object(next(iter(columns.values())), "OWID measure")
    if (
        column.get("shortName") != OWID_COLUMN or column.get("owidVariableId") != OWID_VARIABLE
        or column.get("unit") != "tonnes per person" or column.get("shortUnit") != "t/person"
        or column.get("type") != "Numeric"
    ):
        raise ValueError("OWID indicator identity or unit changed; review its definition and rights")
    updated = _date(column.get("lastUpdated"), "OWID lastUpdated")
    description = _text(column.get("descriptionShort"), "OWID definition")
    scope = _text(column.get("descriptionKey"), "OWID scope")
    citation = _text(column.get("citationLong"), "OWID original sources")
    if "not land-use change" not in description or "territorial emissions" not in scope:
        raise ValueError("OWID emissions definition no longer matches the approved territorial scope")
    if "Global Carbon" not in citation:
        raise ValueError("OWID original provider changed; review source rights")
    reader = csv.DictReader(io.StringIO(_body(data)), strict=True)
    if reader.fieldnames != ["entity", "code", "year", OWID_COLUMN]:
        raise ValueError("OWID CSV columns do not match the approved per-capita measure")
    cells: dict[tuple[str, str], float | None] = {}
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            raise ValueError("malformed OWID CSV row")
        iso3 = row["code"]
        if iso3 not in ISO3_TO_GEO:
            raise ValueError("OWID country filter was not applied; refusing an unexpected geography")
        geo = ISO3_TO_GEO[iso3]
        if row["entity"] != COUNTRIES[geo][1]:
            raise ValueError("OWID country name and code disagree")
        key = (geo, _period(row["year"], end_year))
        if key in cells:
            raise ValueError("duplicate OWID country/year observation")
        value = row[OWID_COLUMN].strip()
        cells[key] = _number(float(value) if value else None)
    return ContextData(
        series=_series(
            cells, metric=OWID_METRIC, label="Territorial fossil and industrial CO2 per capita",
            unit=OWID_UNIT, section="environment", item=data, dataset=OWID_CHART,
            version=f"{OWID_VARIABLE}:{updated}",
        ),
        definition=f"{description}\n\n{scope}", original_sources=citation, source_updated=updated,
        data=data, metadata=metadata, annotations={},
    )


async def _fetch(
    http: CollectorHttp, source_id: str, url: str, *, accept: str, params: dict[str, Any] | None = None,
) -> RawItem:
    source = registry().get(source_id)
    if source.cache_ttl_minutes is None:
        raise ValueError(f"{source_id}: cache TTL must be declared")
    result = await http.fetch(
        source_id=source_id, url=url, cache_ttl_minutes=source.cache_ttl_minutes,
        accept=accept, params=params,
    )
    if result.item is None:
        raise ValueError(f"{source_id}: {result.skipped_reason or 'no archived response'}")
    return result.item


async def collect_worldbank(http: CollectorHttp, *, end_year: int) -> ContextData:
    source = registry().get("worldbank")
    if source.endpoint != "https://api.worldbank.org/v2":
        raise ValueError("World Bank pilot endpoint changed")
    metadata = await _fetch(
        http, source.id, f"{source.endpoint}/indicator/{WORLD_BANK_INDICATOR}",
        accept="application/json", params={"format": "json", "source": "2"},
    )
    countries = ";".join(COUNTRIES[geo][0] for geo in SUBJECT_GEOGRAPHIES)
    data = await _fetch(
        http, source.id, f"{source.endpoint}/country/{countries}/indicator/{WORLD_BANK_INDICATOR}",
        accept="application/json",
        params={
            "format": "json", "source": "2", "date": f"{START_YEAR}:{end_year}",
            "per_page": 1000, "page": 1, "footnote": "y",
        },
    )
    return parse_worldbank(data, metadata, end_year=end_year)


async def collect_owid(http: CollectorHttp, *, end_year: int) -> ContextData:
    source = registry().get("owid")
    if source.endpoint != f"https://ourworldindata.org/grapher/{OWID_CHART}":
        raise ValueError("OWID pilot endpoint changed")
    metadata = await _fetch(http, source.id, source.endpoint + ".metadata.json", accept="application/json")
    data = await _fetch(
        http, source.id, source.endpoint + ".csv", accept="text/csv",
        params={
            "tab": "chart", "time": f"{START_YEAR}..{end_year}",
            "country": "~".join(COUNTRIES[geo][0] for geo in SUBJECT_GEOGRAPHIES),
            "csvType": "filtered", "useColumnShortNames": "true",
        },
    )
    return parse_owid(data, metadata, end_year=end_year)
