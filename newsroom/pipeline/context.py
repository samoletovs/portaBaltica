"""Stage 3b — the context pack: what else the newsroom already knows.

THE PROBLEM THIS EXISTS TO FIX
------------------------------
``collect_open_data`` fetches roughly fifty series every run — seventeen metrics
across three or four geographies. ``detect_all`` finds signals in them. And then
``generate_article`` was handed **one signal from one series** and everything
else was thrown away.

The cost of that is visible in the published wire. On 2026-08-25 the pipeline
wrote three separate articles:

    Hourly labour costs in Latvia reach 16.3 EUR per hour in 2025
    Hourly labour costs in Estonia rise to 21.1 EUR
    Hourly labour costs in Lithuania reach 17.8 EUR per hour

Three recitations of the same statistic, when the newsroom was holding, in
memory, at that exact moment, the one fact that makes it a story: *Latvia has
the cheapest labour in the Baltics, and the gap is closing.* The Latvian piece
then spent its remaining three paragraphs restating its own first sentence and
promising that "future data releases will provide further insights".

It was not short of words. It was short of context it already had.

WHAT A CONTEXT PACK IS
----------------------
Four kinds of fact, all assembled deterministically from series the pipeline has
already retrieved and archived:

``peers``
    The same metric in the other Baltic states at the same period, plus where
    this geography ranks among them.

``companions``
    Related metrics for the *same* geography — labour cost against inflation and
    unemployment, power prices against the spread, house prices against
    construction output. This is what turns a number into an economy.

``placement``
    Where the latest reading sits in its own history: how many readings there
    are, the previous record and when it was set, where the series began.

``trajectory``
    The same point in the year one year and five years earlier, and the change
    since.

WHY THIS DOES NOT WEAKEN THE SAFETY GATE — READ THIS BEFORE CHANGING IT
----------------------------------------------------------------------
Every numeric fact here is merged into ``Signal.fields`` under a namespaced key,
and ``Signal.fields`` is exactly what the validator resolves ``signal_field``
against. So a context figure faces **the identical check, at the identical zero
tolerance**, as a figure the detector produced. Nothing is exempted, no check is
relaxed, and no new path to publication is opened.

The model still cannot write a number it was not given. It is simply given more
numbers that are true.

THE COLLISION RULE, WHICH IS LOAD-BEARING
-----------------------------------------
``reconcile_figures`` declares a numeral the writer forgot to file **only when
exactly one verified field justifies it**. Two fields sharing a value make the
numeral ambiguous, the reconciler correctly refuses to guess, and the article is
rejected for an undeclared number.

That is not hypothetical. The streak detector emits ``streak_start_value =
5.9``; ``series_start_value`` for the same series is *also* 5.9, because the
streak runs the whole length of the series. Adding it blindly would have taken
a working article and broken it.

So ``_without_collisions`` drops any context fact whose value is already
justifiable from the signal, and peers never include the signal's own
geography — where a collision is guaranteed rather than merely likely.
"""

from __future__ import annotations

import logging
import re
from calendar import monthrange
from dataclasses import dataclass, replace
from datetime import date
from typing import Any, Iterable, Literal, Mapping, Sequence

from newsroom import numeric_scan
from newsroom.pipeline.detect.series import (
    SUBJECT_GEOGRAPHIES,
    Observation,
    TimeSeries,
)
from newsroom.pipeline.models import Signal

log = logging.getLogger(__name__)

FactKind = Literal["peer", "companion", "placement", "trajectory"]

#: The three states this wire covers. Order is the ranking order in prose.
#: Re-exported rather than restated: a fourth copy of this tuple is a fourth
#: chance for the collector, the detectors and the prose to disagree about
#: whether the EU aggregate is a subject or a denominator.
BALTIC_STATES: tuple[str, ...] = SUBJECT_GEOGRAPHIES

COUNTRY_NAMES: Mapping[str, str] = {
    "LV": "Latvia",
    "EE": "Estonia",
    "LT": "Lithuania",
    "Baltic": "the Baltic states",
    "EU27_2020": "the EU",
}

#: Which other metrics illuminate this one, most informative first.
#:
#: This is an editorial judgement, not a statistical one, and it is deliberately
#: short. Three companions is enough to situate a finding; ten is a data dump
#: that pushes the writer back towards recitation.
COMPANION_METRICS: Mapping[str, tuple[str, ...]] = {
    "hourly_labour_cost": ("unemployment_rate", "hicp_annual_rate", "gdp_growth"),
    "unemployment_rate": ("gdp_growth", "hourly_labour_cost", "economic_sentiment"),
    "hicp_annual_rate": ("producer_prices", "day_ahead_power_price", "retail_turnover"),
    "producer_prices": ("hicp_annual_rate", "industrial_production", "day_ahead_power_price"),
    "retail_turnover": ("hicp_annual_rate", "unemployment_rate", "economic_sentiment"),
    "industrial_production": ("producer_prices", "gdp_growth", "goods_balance"),
    "economic_sentiment": ("gdp_growth", "unemployment_rate", "retail_turnover"),
    "gdp_growth": ("unemployment_rate", "economic_sentiment", "industrial_production"),
    "house_prices": ("construction_output", "hourly_labour_cost", "hicp_annual_rate"),
    "construction_output": ("house_prices", "gdp_growth", "producer_prices"),
    "day_ahead_power_price": ("day_ahead_power_spread", "hicp_annual_rate", "producer_prices"),
    "day_ahead_power_spread": ("day_ahead_power_price", "hicp_annual_rate"),
    "trade_balance": ("goods_balance", "services_balance", "gdp_growth"),
    "goods_balance": ("trade_balance", "industrial_production", "producer_prices"),
    "services_balance": ("trade_balance", "transport_services_balance", "goods_balance"),
    "transport_services_balance": ("services_balance", "goods_balance", "trade_balance"),
    "financial_services_balance": ("services_balance", "trade_balance"),
    "ict_services_balance": ("services_balance", "other_business_services_balance"),
    "other_business_services_balance": ("services_balance", "ict_services_balance"),
}

#: How far back a companion reading may be and still be worth showing, in
#: months. Annual series are the reason this is generous: GDP for 2025 is
#: legitimate context for a July 2026 labour-cost figure, but a reading three
#: years stale is not context, it is noise.
COMPANION_MAX_AGE_MONTHS = 24

#: Ordinal words for peer ranking. The pack never emits a bare "1st", because a
#: numeral in the prose needs a declared figure and a rank is not a measurement.
_RANK_WORDS = ("highest", "second-highest", "third-highest", "fourth-highest")
_RANK_WORDS_LOW = ("lowest", "second-lowest", "third-lowest", "fourth-lowest")

_QUARTER = re.compile(r"^(\d{4})-?[Qq]([1-4])$")
_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")
_YEAR = re.compile(r"^(\d{4})$")


@dataclass(frozen=True, slots=True)
class ContextFact:
    """One verified number from a series other than the one that triggered.

    ``field`` is the namespaced key it is merged into ``Signal.fields`` under,
    which is what the model must cite in ``signal_field`` and what the validator
    resolves. ``label`` is the sentence-fragment the writer is shown, and it
    always names the period the value belongs to — a companion reading is
    routinely from a different period than the signal, and a writer that cannot
    see that will imply they are contemporaneous.
    """

    field: str
    value: float
    unit: str | None
    label: str
    kind: FactKind
    source_id: str
    period: str
    metric: str | None = None
    geography: str | None = None
    dataset: str | None = None

    def provenance_record(self) -> dict[str, Any]:
        record: dict[str, Any] = {
            "field": self.field,
            "kind": self.kind,
            "period": self.period,
            "source_id": self.source_id,
        }
        if self.metric:
            record["metric"] = self.metric
        if self.geography:
            record["geography"] = self.geography
        if self.dataset:
            record["dataset"] = self.dataset
        return record


@dataclass(frozen=True, slots=True)
class ContextPack:
    """Everything the newsroom knows that bears on one signal.

    ``observations`` are deterministic English sentences — "Latvia has the
    lowest hourly labour cost of the three Baltic states" — derived from the
    facts by code, not by a model. They carry no numerals, so the writer may
    use them verbatim without needing a declared figure, and they are the
    single most useful thing in the pack: they are analysis that cannot be
    wrong.
    """

    facts: tuple[ContextFact, ...] = ()
    observations: tuple[str, ...] = ()
    period_labels: tuple[str, ...] = ()
    series_considered: int = 0

    def __bool__(self) -> bool:
        return bool(self.facts or self.observations)

    def of_kind(self, kind: FactKind) -> tuple[ContextFact, ...]:
        return tuple(fact for fact in self.facts if fact.kind == kind)

    def fields(self) -> dict[str, float]:
        return {fact.field: fact.value for fact in self.facts}

    def field_units(self) -> dict[str, str | None]:
        return {fact.field: fact.unit for fact in self.facts}

    def to_provenance(self) -> dict[str, Any]:
        return {
            "method": "collected_series",
            "series_considered": self.series_considered,
            "facts": [fact.provenance_record() for fact in self.facts],
            "observations": list(self.observations),
        }


# ── period arithmetic ───────────────────────────────────────────────────
#
# Periods arrive in four shapes across the collectors — ``2025``, ``2026-07``,
# ``2026-Q2`` and ``2026-08-24`` — and companions are routinely on a different
# one from the signal. Lexicographic ordering, which the rest of the pipeline
# relies on, silently breaks across shapes: ``"2026-Q2" > "2026-07"`` because
# ``Q`` sorts above a digit. Everything that compares periods from *different*
# series must go through here instead.


def _period_span(period: str) -> tuple[int, int] | None:
    """A period as the (first, last) **day** it covers, as date ordinals.

    A *span*, not a point, because the collectors mix frequencies and the
    comparison is between different series. Treating the annual period ``2025``
    as its first day alone makes every monthly reading in 2025 look like it
    comes *after* the year 2025, so no monthly companion could ever attach to an
    annual finding — which is precisely the pairing that makes a labour-cost
    story a labour-market story.

    Resolution is days, not months, because Elering publishes power prices
    **daily**. With a month-resolution key every day of a month tied, and
    ``_latest_at_or_before`` kept the first of them: asked for the latest
    reading at 2026-08-24 it returned 2026-08-01, in a market that moves
    several-fold within a month. The label then said "its latest reading, from
    2026-08-01" while the pipeline was holding the 24th.
    """
    text = str(period).strip()
    if match := _QUARTER.match(text):
        year, quarter = int(match.group(1)), int(match.group(2))
        start_month = (quarter - 1) * 3 + 1
        end_month = start_month + 2
        return (
            date(year, start_month, 1).toordinal(),
            date(year, end_month, monthrange(year, end_month)[1]).toordinal(),
        )
    if match := _DAY.match(text):
        year, month, day = (int(part) for part in match.groups())
        try:
            ordinal = date(year, month, day).toordinal()
        except ValueError:
            return None
        return ordinal, ordinal
    if match := _MONTH.match(text):
        year, month = int(match.group(1)), int(match.group(2))
        if 1 <= month <= 12:
            return (
                date(year, month, 1).toordinal(),
                date(year, month, monthrange(year, month)[1]).toordinal(),
            )
    if match := _YEAR.match(text):
        year = int(match.group(1))
        return date(year, 1, 1).toordinal(), date(year, 12, 31).toordinal()
    return None


def _period_start_month(period: str) -> int | None:
    """A period as months since year zero, for coarse age comparisons only."""
    text = str(period).strip()
    if match := _QUARTER.match(text):
        return int(match.group(1)) * 12 + (int(match.group(2)) - 1) * 3
    if match := _DAY.match(text) or _MONTH.match(text):
        year, month = int(match.group(1)), int(match.group(2))
        if 1 <= month <= 12:
            return year * 12 + month - 1
        return None
    if match := _YEAR.match(text):
        return int(match.group(1)) * 12
    return None


def _months_between(later: str, earlier: str) -> int | None:
    a, b = _period_start_month(later), _period_start_month(earlier)
    if a is None or b is None:
        return None
    return a - b


def _latest_at_or_before(series: TimeSeries, period: str) -> Observation | None:
    """The most recent observation not after ``period``, across period shapes.

    A candidate qualifies when it *starts* no later than the target period
    *ends*, so a June 2025 reading is legitimate context for the year 2025 while
    a June 2026 reading is not. Ties break towards the later observation, which
    for a daily series inside a monthly target is the whole point.
    """
    target = _period_span(period)
    if target is None:
        return series.observations[-1] if series.observations else None
    best: Observation | None = None
    best_key: int | None = None
    for observation in series.observations:
        span = _period_span(observation.period)
        if span is None or span[0] > target[1]:
            continue
        if best_key is None or span[0] >= best_key:
            best, best_key = observation, span[0]
    return best


# ── fact assembly ───────────────────────────────────────────────────────


def _fact_from(
    series: TimeSeries,
    observation: Observation,
    *,
    field: str,
    label: str,
    kind: FactKind,
) -> ContextFact:
    return ContextFact(
        field=field,
        value=float(observation.value),
        unit=series.unit,
        label=label,
        kind=kind,
        source_id=series.source.source_id,
        period=observation.period,
        metric=series.metric,
        geography=series.geography,
        dataset=series.source.dataset,
    )


def _peers(signal: Signal, by_metric: Mapping[str, list[TimeSeries]]) -> list[ContextFact]:
    """The same metric in the other Baltic states, at the signal's period."""
    if signal.geography not in BALTIC_STATES:
        return []
    facts: list[ContextFact] = []
    for series in by_metric.get(signal.metric, []):
        if series.geography == signal.geography or series.geography not in BALTIC_STATES:
            continue
        observation = _latest_at_or_before(series, signal.period)
        if observation is None:
            continue
        # A peer reading from a different period is still worth having, but the
        # label has to say so or the writer will present them as simultaneous.
        same_period = observation.period == signal.period
        country = COUNTRY_NAMES.get(series.geography, series.geography)
        when = "" if same_period else f", its latest reading, from {observation.period}"
        facts.append(
            _fact_from(
                series,
                observation,
                field=f"peer_{series.geography.lower()}",
                label=f"{country}: {series.metric_label} in {observation.period}{when}",
                kind="peer",
            )
        )
    return facts


def _companions(
    signal: Signal, by_geography: Mapping[str, list[TimeSeries]]
) -> list[ContextFact]:
    """Related metrics for the same geography, at or before the signal period."""
    wanted = COMPANION_METRICS.get(signal.metric, ())
    if not wanted:
        return []
    available = {
        series.metric: series
        for series in by_geography.get(signal.geography, [])
        if series.metric != signal.metric and series.observations
    }
    facts: list[ContextFact] = []
    for metric in wanted:
        series = available.get(metric)
        if series is None:
            continue
        observation = _latest_at_or_before(series, signal.period)
        if observation is None:
            continue
        age = _months_between(signal.period, observation.period)
        if age is not None and age > COMPANION_MAX_AGE_MONTHS:
            continue
        facts.append(
            _fact_from(
                series,
                observation,
                field=f"companion_{metric}",
                label=f"{series.metric_label} in the same economy, {observation.period}",
                kind="companion",
            )
        )
    return facts


def _placement(signal: Signal, series: TimeSeries) -> tuple[list[ContextFact], list[str]]:
    """Where the latest reading sits in the series' own history."""
    facts: list[ContextFact] = []
    notes: list[str] = []
    observations = series.observations
    if len(observations) < 3:
        return facts, notes

    latest = observations[-1]
    history = observations[:-1]
    values = [o.value for o in history]

    facts.append(
        ContextFact(
            field="readings_in_series",
            value=float(len(observations)),
            unit=None,
            label=f"how many {series.frequency} readings this series contains in total",
            kind="placement",
            source_id=series.source.source_id,
            period=f"{observations[0].period}..{latest.period}",
            metric=series.metric,
            geography=series.geography,
            dataset=series.source.dataset,
        )
    )

    above = sum(1 for value in values if value > latest.value)
    below = sum(1 for value in values if value < latest.value)
    # Every observation must be free of digits. The writer is told it may state
    # these as fact without declaring a figure, and that is only safe if there
    # is no numeral in them to declare. Series length is available as
    # `readings_in_series` and the start period sits in `series_start_value`'s
    # own label, so nothing is lost by keeping the sentence itself in words.
    if above == 0:
        notes.append("This is the highest reading anywhere in the series.")
    elif below == 0:
        notes.append("This is the lowest reading anywhere in the series.")
    elif above < len(_RANK_WORDS):
        notes.append(
            "Only a handful of readings in the series have ever been higher; "
            f"this is the {_RANK_WORDS[above]} on record."
        )
    elif below < len(_RANK_WORDS_LOW):
        notes.append(
            "Only a handful of readings in the series have ever been lower; "
            f"this is the {_RANK_WORDS_LOW[below]} on record."
        )

    # The previous record, which is what "a record" is measured against and the
    # single most common thing a reader wants next.
    if above == 0:
        prior = max(history, key=lambda o: o.value)
        facts.append(
            _fact_from(
                series,
                prior,
                field="previous_record",
                label=f"the previous highest reading, set in {prior.period}",
                kind="placement",
            )
        )
    elif below == 0:
        prior = min(history, key=lambda o: o.value)
        facts.append(
            _fact_from(
                series,
                prior,
                field="previous_record",
                label=f"the previous lowest reading, set in {prior.period}",
                kind="placement",
            )
        )

    facts.append(
        _fact_from(
            series,
            observations[0],
            field="series_start_value",
            label=f"where this series begins, in {observations[0].period}",
            kind="placement",
        )
    )
    return facts, notes


def _shift_years(period: str, years: int) -> str | None:
    """The same period label, that many years earlier. Shape-preserving.

    ``2026-08-24`` -> ``2025-08-24``, ``2026-Q2`` -> ``2025-Q2``, ``2025`` ->
    ``2024``. Rewriting the year in the label is exact and works across all four
    period shapes, where ordinal arithmetic would have to guess what "the same
    point in the year" means for each of them — and got it wrong for daily
    series, where every day of a month shared one month-resolution key.
    """
    text = str(period).strip()
    if len(text) < 4 or not text[:4].isdigit():
        return None
    return f"{int(text[:4]) - years:04d}{text[4:]}"


def _trajectory(signal: Signal, series: TimeSeries) -> list[ContextFact]:
    """The same point in the year, one year and five years back."""
    facts: list[ContextFact] = []
    latest = series.latest

    for years, field, phrasing in (
        (1, "value_one_year_earlier", "the same point in the year, one year earlier"),
        (5, "value_five_years_earlier", "the same point in the year, five years earlier"),
    ):
        wanted = _shift_years(latest.period, years)
        match = series.at(wanted) if wanted else None
        if match is None:
            continue
        facts.append(
            _fact_from(
                series,
                match,
                field=field,
                label=f"{phrasing} ({match.period})",
                kind="trajectory",
            )
        )
    return facts


def _peer_observations(signal: Signal, peers: Sequence[ContextFact]) -> list[str]:
    """Rank the signal's geography among its peers, in words and no numerals.

    ONLY when every peer reading is from the signal's own period. This sentence
    is the one claim in the whole pack that no numeric check can reach: it is
    deliberately digit-free so the writer may state it without declaring a
    figure, which also means ``no_invented_numbers`` has nothing to bite on. It
    is true because this function computed it, and for no other reason.

    ``_peers`` accepts a stale reading when a neighbour has not published yet —
    useful as a labelled figure, useless in a ranking. Comparing Latvia's
    August power price against Estonia's July one and printing "Latvia has the
    highest of the three Baltic states" would publish a falsehood with nothing
    downstream able to catch it. So a mixed-period comparison produces no
    ranking sentence at all. That costs colour, not correctness.
    """
    if not peers:
        return []
    if any(fact.period != signal.period for fact in peers):
        log.debug(
            "context: no peer ranking for %s/%s, peer periods are not aligned",
            signal.metric,
            signal.period,
        )
        return []
    ranked = sorted(
        [(signal.value, signal.geography), *[(f.value, f.geography or "") for f in peers]],
        key=lambda pair: -pair[0],
    )
    position = next(
        (index for index, (_, geo) in enumerate(ranked) if geo == signal.geography), None
    )
    if position is None:
        return []
    country = COUNTRY_NAMES.get(signal.geography, signal.geography)
    total = len(ranked)
    if position == 0:
        rank_phrase = f"the highest of the {_number_word(total)} Baltic states"
    elif position == total - 1:
        rank_phrase = f"the lowest of the {_number_word(total)} Baltic states"
    else:
        rank_phrase = f"{_RANK_WORDS[min(position, len(_RANK_WORDS) - 1)]} of the {_number_word(total)} Baltic states"
    return [f"{country} has {rank_phrase} for {signal.metric_label}."]


def _number_word(value: int) -> str:
    return {2: "two", 3: "three", 4: "four"}.get(value, str(value))


def _collides(value: float, taken: Mapping[str, float]) -> str | None:
    """Name a verified field that would already justify this value, if any.

    The test is the reconciler's own: render the value the way the writer would
    and ask whether an existing field justifies that token. Anything the
    scanner cannot tokenise falls back to an exact comparison, so an unusual
    rendering fails safe — it is treated as a collision and the fact is dropped,
    which costs context rather than correctness.
    """
    rendered = f"{round(value, 2):g}"
    tokens = numeric_scan.scan(f"about {rendered}")
    if not tokens:
        return next(
            (name for name, other in taken.items() if abs(other - value) < 1e-9), None
        )
    token = tokens[0]
    return next(
        (
            name
            for name, other in taken.items()
            if numeric_scan.value_justifies(token, other)
        ),
        None,
    )


def _without_collisions(
    facts: Iterable[ContextFact], existing: Mapping[str, float]
) -> list[ContextFact]:
    """Drop facts whose value another verified field already justifies.

    See the module docstring. ``reconcile_figures`` refuses to declare an
    ambiguous numeral, so a duplicated value costs an article rather than
    enriching it. Deduplication runs against the detector's own fields *and*
    against context facts already accepted, so the pack is internally unique
    too.
    """
    kept: list[ContextFact] = []
    taken = {name: float(value) for name, value in existing.items()}
    for fact in facts:
        clash = _collides(float(fact.value), taken)
        if clash is not None:
            log.debug(
                "context: dropping %s=%s, already justifiable as %s",
                fact.field,
                fact.value,
                clash,
            )
            continue
        taken[fact.field] = float(fact.value)
        kept.append(fact)
    return kept


def build_context(signal: Signal, series: Sequence[TimeSeries]) -> ContextPack:
    """Assemble everything the newsroom already knows that bears on ``signal``.

    Pure and deterministic: no model, no network, no clock. Given the same
    signal and the same series it returns the same pack, which is what makes
    the numbers in it auditable in the same way the detector's are.
    """
    by_metric: dict[str, list[TimeSeries]] = {}
    by_geography: dict[str, list[TimeSeries]] = {}
    own: TimeSeries | None = None
    for item in series:
        by_metric.setdefault(item.metric, []).append(item)
        by_geography.setdefault(item.geography, []).append(item)
        if item.metric == signal.metric and item.geography == signal.geography:
            own = item

    peers = _peers(signal, by_metric)
    companions = _companions(signal, by_geography)
    placement: list[ContextFact] = []
    trajectory: list[ContextFact] = []
    notes: list[str] = []
    if own is not None:
        placement, notes = _placement(signal, own)
        trajectory = _trajectory(signal, own)

    observations = [*_peer_observations(signal, peers), *notes]
    facts = _without_collisions(
        [*peers, *companions, *placement, *trajectory], signal.fields
    )

    period_labels = sorted(
        {fact.period for fact in facts if _period_span(fact.period) is not None}
    )
    return ContextPack(
        facts=tuple(facts),
        observations=tuple(observations),
        period_labels=tuple(period_labels),
        series_considered=len(series),
    )


def build_context_for(
    signals: Sequence[Signal], series: Sequence[TimeSeries]
) -> dict[str, ContextPack]:
    return {signal.id: build_context(signal, series) for signal in signals}


def enrich_signal(signal: Signal, pack: ContextPack) -> Signal:
    """Merge the pack's verified figures into the signal the writer is given.

    The result is an ordinary ``Signal``: the prompt shows its ``fields`` as
    VERIFIED FIGURES and the validator resolves ``signal_field`` against them,
    both unchanged. ``Signal.id`` is derived from detector, metric, geography,
    period and value, none of which this touches, so provenance and
    deduplication across runs are unaffected.
    """
    if not pack.facts:
        return signal
    return replace(
        signal,
        fields={**signal.fields, **pack.fields()},
        field_units={**dict(signal.field_units), **pack.field_units()},
    )


__all__ = [
    "BALTIC_STATES",
    "COMPANION_METRICS",
    "COUNTRY_NAMES",
    "ContextFact",
    "ContextPack",
    "build_context",
    "build_context_for",
    "enrich_signal",
]
