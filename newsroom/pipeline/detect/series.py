"""Time series primitives for deterministic detection.

Deliberately tiny and dependency-free: the detectors are the heart of the
newsroom and they should be readable without knowing pandas. Everything here is
immutable, so a detector cannot mutate the series another detector is about to
read.

Periods are ISO strings and sort lexicographically in chronological order —
``2026-07`` < ``2026-08``, ``2026-08-24`` < ``2026-08-25``. That property is
what lets the whole module avoid date parsing.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass
from typing import Iterator, Sequence

from newsroom.pipeline.models import SourceRef

_MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

_ORDINALS = ("first", "second", "third", "fourth")

#: What one observation is, per frequency, singular and plural.
_READING_WORDS = {
    "daily": ("daily reading", "daily readings"),
    "monthly": ("month", "months"),
    "quarterly": ("quarter", "quarters"),
    "annual": ("year", "years"),
}


def reading_word(frequency: str, count: int) -> str:
    """What one observation in this series is, in words a reader can picture.

    The divergence basis said "across 119 earlier periods". In one live run
    the editor sent two articles back for the same reason -- "does not specify
    the period over which the earlier periods were measured" -- and it was
    right. "Period" is our word for a row in a table, not a unit of time. A
    reader cannot tell 119 days from 119 quarters, and neither could the
    writer, so it hedged and the desk refused it.
    """
    singular, plural = _READING_WORDS.get(frequency, ("reading", "readings"))
    return singular if count == 1 else plural


@dataclass(frozen=True)
class Observation:
    period: str
    value: float


@dataclass(frozen=True)
class TimeSeries:
    """One metric, one geography, ordered oldest to newest."""

    metric: str
    metric_label: str
    geography: str
    unit: str
    section: str
    observations: tuple[Observation, ...]
    source: SourceRef
    frequency: str = "monthly"
    chart_ref: str | None = None

    def __post_init__(self) -> None:
        periods = [o.period for o in self.observations]
        if periods != sorted(periods):
            raise ValueError(f"{self.metric}/{self.geography}: observations are not in period order")
        if len(set(periods)) != len(periods):
            raise ValueError(f"{self.metric}/{self.geography}: duplicate periods")

    def __len__(self) -> int:
        return len(self.observations)

    def __iter__(self) -> Iterator[Observation]:
        return iter(self.observations)

    @property
    def values(self) -> tuple[float, ...]:
        return tuple(o.value for o in self.observations)

    @property
    def periods(self) -> tuple[str, ...]:
        return tuple(o.period for o in self.observations)

    @property
    def latest(self) -> Observation:
        if not self.observations:
            raise ValueError(f"{self.metric}/{self.geography}: empty series")
        return self.observations[-1]

    @property
    def previous(self) -> Observation | None:
        return self.observations[-2] if len(self.observations) >= 2 else None

    def at(self, period: str) -> Observation | None:
        for observation in self.observations:
            if observation.period == period:
                return observation
        return None

    def history(self) -> tuple[Observation, ...]:
        """Everything except the latest point — what the latest is judged against."""
        return self.observations[:-1]

    def tail(self, n: int) -> tuple[Observation, ...]:
        return self.observations[-n:] if n > 0 else ()

    def season_key(self, period: str) -> str:
        """The part of a period that repeats each year.

        ``2026-08`` -> ``08``; ``2026-08-24`` -> ``08-24``; ``2026-Q3`` -> ``Q3``.
        """
        _, _, rest = period.partition("-")
        return rest or period

    def season_label(self, period: str) -> str:
        """``season_key`` as something a reader can read, and a writer can quote.

        The key is an index. Printed into prose it produced "for the same point
        in the year (08)", where 08 is a month that the numeric scanner reads as
        the figure 8 -- a number the writer is asked to restate but cannot
        declare, because no signal field holds it. That silently blocked every
        seasonal article. See test_basis_declarable.py.
        """
        key = self.season_key(period)
        if re.fullmatch(r"\d{2}", key):
            return _MONTH_NAMES[int(key) - 1] if 1 <= int(key) <= 12 else key
        if match := re.fullmatch(r"(\d{2})-(\d{2})", key):
            month, day = int(match.group(1)), int(match.group(2))
            if 1 <= month <= 12:
                return f"{day} {_MONTH_NAMES[month - 1]}"
        if match := re.fullmatch(r"[Qq]([1-4])", key):
            return f"the {_ORDINALS[int(match.group(1)) - 1]} quarter"
        return key

    def same_season_history(self, period: str) -> tuple[Observation, ...]:
        """Prior-year observations for the same point in the year."""
        key = self.season_key(period)
        return tuple(
            o
            for o in self.observations
            if o.period != period and self.season_key(o.period) == key
        )

    def replace_observations(self, observations: Sequence[Observation]) -> TimeSeries:
        return TimeSeries(
            metric=self.metric,
            metric_label=self.metric_label,
            geography=self.geography,
            unit=self.unit,
            section=self.section,
            observations=tuple(observations),
            source=self.source,
            frequency=self.frequency,
            chart_ref=self.chart_ref,
        )


def pct_change(new: float, old: float) -> float | None:
    """Percentage change, or ``None`` when the base makes it meaningless."""
    if old == 0:
        return None
    return (new - old) / abs(old) * 100.0


def robust_sigma(values: Sequence[float]) -> float:
    """Spread of a series, resistant to the outlier we are trying to detect.

    Uses the median absolute deviation scaled to a normal-equivalent sigma. A
    plain standard deviation would be inflated by the very spike under test,
    which is how naive detectors end up silent on real records.
    """
    if len(values) < 2:
        return 0.0
    median = statistics.median(values)
    mad = statistics.median([abs(v - median) for v in values])
    if mad > 0:
        return mad * 1.4826
    # A series flat enough to have zero MAD still deserves a fallback rather
    # than a divide-by-zero, so fall back to stdev.
    try:
        return statistics.stdev(values)
    except statistics.StatisticsError:
        return 0.0
