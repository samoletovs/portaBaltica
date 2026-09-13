"""The pilot's versioned measurement contract, independent of moving defaults."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import httpx

from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, request_params
from newsroom.pipeline.safety import registry

SERIES_ID = "baltic-unemployment-v1"
DATASET = "une_rt_m"
GEOGRAPHIES = ("EE", "LV", "LT")
START_PERIOD = "2020-01"
DIMENSIONS = {
    "freq": "M", "s_adj": "SA", "age": "TOTAL", "sex": "T", "unit": "PC_ACT",
}


def source_url() -> str:
    return registry().get("eurostat").endpoint.format(dataset=DATASET)


def capture_url() -> str:
    spec = next(s for s in EUROSTAT_DATASETS if s.metric == "unemployment_rate")
    if spec.dataset != DATASET or {**spec.params, "freq": "M"} != DIMENSIONS:
        raise ValueError("newsroom unemployment definition changed; review the pilot contract")
    params = request_params(spec, geographies=GEOGRAPHIES)
    params.extend([("freq", "M"), ("sinceTimePeriod", START_PERIOD)])
    return str(httpx.URL(source_url(), params=params))


def validate_source_url(url: str) -> None:
    actual, expected = urlsplit(url), urlsplit(source_url())
    if (
        (actual.scheme, actual.netloc, actual.path)
        != (expected.scheme, expected.netloc, expected.path)
        or actual.fragment
    ):
        raise ValueError("request URL is not the registered Eurostat unemployment endpoint")
    query = parse_qs(actual.query)
    for dimension, value in DIMENSIONS.items():
        # Older newsroom requests let the monthly dataset imply freq=M.
        if dimension == "freq" and dimension not in query:
            continue
        if query.get(dimension) != [value]:
            raise ValueError(f"request URL has a different {dimension} selection")
    if not set(GEOGRAPHIES).issubset(query.get("geo", [])):
        raise ValueError("request URL does not cover all three Baltic countries")
