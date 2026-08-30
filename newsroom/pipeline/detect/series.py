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

#: The geographies this wire reports *on*. A detector may fire for these, and
#: an article may be about one of them.
SUBJECT_GEOGRAPHIES: tuple[str, ...] = ("LV", "EE", "LT")

#: Geographies collected to measure the subjects *against*, never reported on
#: for their own sake. The EU aggregate is a denominator, not a competitor:
#: "Latvian unemployment is a point above the EU" is a story about Latvia,
#: while "EU unemployment hit a record" is somebody else's beat and this
#: newsroom has no business filing it.
#:
#: The distinction has to be enforced rather than intended, because every
#: single-series detector runs over whatever it is handed. Collect EU27 without
#: excluding it here and `detect_record_extreme` starts producing EU records on
#: the first run.
REFERENCE_GEOGRAPHIES: tuple[str, ...] = ("EU27_2020",)

#: What the collector asks Eurostat for.
COLLECTED_GEOGRAPHIES: tuple[str, ...] = SUBJECT_GEOGRAPHIES + REFERENCE_GEOGRAPHIES


def is_reference(geography: str) -> bool:
    """True for a geography collected only as a basis for comparison."""
    return geography in REFERENCE_GEOGRAPHIES

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
    "weekly": ("week", "weeks"),
    "monthly": ("month", "months"),
    "quarterly": ("quarter", "quarters"),
    "annual": ("year", "years"),
    # Eurostat prices electricity and legislates minimum wages by semester.
    # Without an entry these degrade to the safe but vague "readings", and the
    # docstring above is about exactly that: a reader cannot tell 119 days from
    # 119 semesters, and neither can the writer.
    "semi-annual": ("semester", "semesters"),
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


_NUMBER_WORDS = (
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
)


def spell_count(value: int) -> str:
    """A small count as a word, so it carries no numeral into the prose.

    ``comparison_basis`` is pipeline-authored prose that the writer is REQUIRED
    to restate, so every numeral in it must be declarable — and declarable is
    not enough. ``reconcile_figures`` will only file a numeral the writer forgot
    when **exactly one** verified field justifies it, and refuses to guess
    between two.

    That refusal is correct and it killed articles. The seasonal basis read "the
    5-year average of 18.1 °C": ``baseline_years`` is 5 and ``deviation`` is
    5.4, which rounds to 5, so the numeral had two possible parents. The
    reconciler declined, the validator saw an undeclared number, and every
    seasonal article failed on a token the pipeline had written itself.

    A count of years is not a measurement, so spelling it removes the numeral
    rather than managing it. Above twelve, fall back to the digit: "one hundred
    and nineteen" is worse prose than the problem it solves, and a count that
    large is unlikely to collide with a measurement anyway.
    """
    if 0 <= value < len(_NUMBER_WORDS):
        return _NUMBER_WORDS[value]
    return str(value)


@dataclass(frozen=True)
class Observation:
    period: str
    value: float


@dataclass(frozen=True)
class SeriesOrigin:
    """Where the whole series starts, and where the latest reading sits in it.

    WHY THIS IS NOT DERIVABLE FROM ``observations``
    -----------------------------------------------
    ``TimeSeries.observations`` is a **window**. Every Eurostat definition is
    fetched with a bounded number of periods, so the oldest observation is
    where the newsroom started looking, not where the series starts. Measured
    across sixteen live definitions, **fifteen of the sixteen disagree** —
    ``demo_gind`` LT by 47 years.

    That gap was published. ``context.py`` labelled the window's first reading
    "where this series begins" and its own count "how many readings this series
    contains in total", and emitted sentences saying "this is the highest
    reading anywhere in the series" — all computed over the window. Eight
    published articles stated a record that the full series contradicts.

    So the facts a sentence about *the series* needs are recorded at collection
    time, when the whole series is in hand, rather than inferred later from a
    slice that cannot support them.

    THE COUNTS ARE RELATIVE TO THE LATEST OBSERVATION
    -------------------------------------------------
    ``higher`` and ``lower`` count the rest of the series against
    ``observations[-1]``, which is what "is this a record?" actually asks. They
    are therefore only valid for the observation set they were computed with,
    which is why :meth:`TimeSeries.replace_observations` drops the origin
    rather than carrying it: a stale count is worse than no count, because a
    consumer cannot tell it is stale.
    """

    #: The first period with an actual reading, for this geography. NOT the
    #: first period the cube offers: measured across sixteen definitions, ten
    #: of them carry time coordinates with no data at the front — ``sts_inpp_m``
    #: offers ``1976-01`` and Lithuania's first reading is ``1998-02``, so
    #: taking the dimension's first key would publish an origin wrong by
    #: twenty-two years and more confident-looking than the window it replaced.
    first_period: str
    first_value: float
    #: How many readings the whole series contains, for this geography.
    total_observations: int
    #: How much of the rest of the series beats the latest reading.
    higher: int
    lower: int
    #: The extreme of the rest of the series — "the previous record", which is
    #: what a record claim is measured against.
    prior_high_period: str
    prior_high_value: float
    prior_low_period: str
    prior_low_value: float


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
    #: What the whole series looks like, when the whole series was fetched.
    #: ``None`` when it was not — Elering is collected as a rolling 120 days
    #: and has no cheap full history — and a consumer must then say nothing
    #: about the series rather than something false about it.
    origin: SeriesOrigin | None = None

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
        """A copy with different readings — and **no origin**.

        ``SeriesOrigin.higher`` and ``.lower`` count the series against the
        latest observation, so they are only true for the observation set they
        were computed with. Carrying them onto a different set would produce a
        confident, stale placement a consumer cannot tell is stale. Dropping
        them makes the caller say nothing about the series, which is the only
        honest answer once the reading they describe has moved.
        """
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


def origin_of(observations: Sequence[Observation]) -> SeriesOrigin | None:
    """Summarise a full series for :class:`SeriesOrigin`.

    Takes the observations that actually carry readings — nulls are dropped
    before this — so ``first_period`` is the first reading rather than the
    first coordinate the cube offers.

    ``None`` below three observations, matching the floor ``_placement`` uses:
    a "record" over two readings is not a fact about a series.
    """
    if len(observations) < 3:
        return None
    latest = observations[-1]
    history = observations[:-1]
    high = max(history, key=lambda o: o.value)
    low = min(history, key=lambda o: o.value)
    return SeriesOrigin(
        first_period=observations[0].period,
        first_value=observations[0].value,
        total_observations=len(observations),
        higher=sum(1 for o in history if o.value > latest.value),
        lower=sum(1 for o in history if o.value < latest.value),
        prior_high_period=high.period,
        prior_high_value=high.value,
        prior_low_period=low.period,
        prior_low_value=low.value,
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
