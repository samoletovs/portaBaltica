"""Shared fixtures and builders for the newsroom test suite.

Nothing here touches Azure. The language model is always a stub.
"""

from __future__ import annotations

from typing import Sequence

import pytest

from newsroom.pipeline.detect.series import Observation, TimeSeries
from newsroom.pipeline.models import Signal, SourceRef

RETRIEVED_AT = "2026-08-24T11:00:00Z"


def source_ref(source_id: str = "eurostat", dataset: str = "test_ds") -> SourceRef:
    return SourceRef(
        source_id=source_id,
        retrieved_at=RETRIEVED_AT,
        dataset=dataset,
        url="https://example.invalid/data",
    )


def monthly_periods(count: int, *, start_year: int = 2020, start_month: int = 1) -> list[str]:
    periods = []
    year, month = start_year, start_month
    for _ in range(count):
        periods.append(f"{year:04d}-{month:02d}")
        month += 1
        if month > 12:
            month = 1
            year += 1
    return periods


def quarterly_periods(count: int, *, start_year: int = 2011, start_quarter: int = 1) -> list[str]:
    periods = []
    year, quarter = start_year, start_quarter
    for _ in range(count):
        periods.append(f"{year:04d}-Q{quarter}")
        quarter += 1
        if quarter > 4:
            quarter = 1
            year += 1
    return periods


def series_from(
    values: Sequence[float],
    *,
    metric: str = "unemployment_rate",
    metric_label: str = "unemployment rate",
    geography: str = "LV",
    unit: str = "%",
    section: str = "labour",
    frequency: str = "monthly",
    periods: Sequence[str] | None = None,
    source_id: str = "eurostat",
    chart_ref: str | None = None,
) -> TimeSeries:
    """Build a TimeSeries from bare values, with generated monthly periods."""
    labels = list(periods) if periods is not None else monthly_periods(len(values))
    if len(labels) != len(values):
        raise ValueError("periods and values must be the same length")
    return TimeSeries(
        metric=metric,
        metric_label=metric_label,
        geography=geography,
        unit=unit,
        section=section,
        frequency=frequency,
        observations=tuple(Observation(p, float(v)) for p, v in zip(labels, values)),
        source=source_ref(source_id),
        chart_ref=chart_ref,
    )


def make_signal(**overrides) -> Signal:
    defaults = dict(
        detector="record_extreme",
        metric="unemployment_rate",
        metric_label="unemployment rate",
        geography="LV",
        period="2026-07",
        value=6.8,
        unit="%",
        comparison_basis="the previous record high of 6.5 % in 2025-03, across 40 observations",
        score=0.8,
        section="labour",
        fields={"latest_value": 6.8, "previous_record_value": 6.5, "margin": 0.3},
        sources=[source_ref()],
        context={"direction": "high", "latest_period": "2026-07"},
    )
    defaults.update(overrides)
    return Signal(**defaults)  # type: ignore[arg-type]


@pytest.fixture
def signal() -> Signal:
    return make_signal()
