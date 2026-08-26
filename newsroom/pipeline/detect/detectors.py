"""Stage 2 — deterministic detection. No language model is involved.

What counts as news is decided here, by pure functions over time series, and
nowhere else. Every detector:

* takes an immutable :class:`~newsroom.pipeline.detect.series.TimeSeries`,
* returns a :class:`~newsroom.pipeline.models.Signal` or ``None``,
* names its ``comparison_basis`` — the thing the value is measured against,
* and scores newsworthiness by combining **magnitude** with **rarity**.

The rarity term is what keeps the pipeline honest. A 15% swing in day-ahead
power prices is a Tuesday; a 15% swing in the unemployment rate is a year's
biggest story. Scoring magnitude alone would fire constantly on the volatile
series and never on the quiet ones, which is exactly the failure mode the
README calls out: *a detector that fires on everything is as broken as one that
never fires*.

Each detector documents the conditions under which it must stay silent, and the
test suite asserts both directions.
"""

from __future__ import annotations

import logging
import statistics
from dataclasses import dataclass
from typing import Mapping, Sequence

from newsroom.pipeline.detect.series import (
    Observation,
    TimeSeries,
    pct_change,
    reading_word,
    robust_sigma,
    spell_count,
)
from newsroom.pipeline.models import Signal
from newsroom.pipeline import units

log = logging.getLogger(__name__)


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _scale(value: float, full: float) -> float:
    """Map ``value`` onto ``[0, 1]``, saturating at ``full``."""
    if full <= 0:
        return 0.0
    return _clamp(abs(value) / full)


# ---------------------------------------------------------------------------
# 1. Record highs and lows
# ---------------------------------------------------------------------------
def detect_record_extreme(
    series: TimeSeries,
    *,
    min_history: int = 12,
    min_margin_pct: float = 0.5,
) -> Signal | None:
    """The latest reading is the highest or lowest in the series.

    Stays silent when:

    * there is less history than ``min_history`` — "record in three months" is
      not a record, it is a short series;
    * the latest merely ties the previous extreme;
    * it beats the previous extreme by less than ``min_margin_pct``, which is
      measurement noise dressed up as a milestone.
    """
    history = series.history()
    if len(history) < min_history:
        return None

    latest = series.latest
    highs = max(history, key=lambda o: o.value)
    lows = min(history, key=lambda o: o.value)

    if latest.value > highs.value:
        direction, previous = "high", highs
    elif latest.value < lows.value:
        direction, previous = "low", lows
    else:
        return None

    margin = abs(latest.value - previous.value)
    margin_pct = pct_change(latest.value, previous.value)
    if margin_pct is None or abs(margin_pct) < min_margin_pct:
        return None

    rarity = _scale(len(history), 60)
    magnitude = _scale(margin_pct, 10)
    score = _clamp(0.60 + 0.25 * rarity + 0.15 * magnitude)

    return Signal(
        detector="record_extreme",
        metric=series.metric,
        metric_label=series.metric_label,
        geography=series.geography,
        period=latest.period,
        value=latest.value,
        unit=series.unit,
        comparison_basis=(
            f"the previous record {direction} of {previous.value:g} {series.unit} "
            f"in {previous.period}, across {len(series)} observations since {series.periods[0]}"
        ),
        score=score,
        section=series.section,
        chart_ref=series.chart_ref,
        fields={
            "latest_value": latest.value,
            "previous_record_value": previous.value,
            "margin": margin,
            "margin_pct": abs(margin_pct),
            "observation_count": float(len(series)),
        },
        sources=[series.source],
        context={
            "direction": direction,
            "latest_period": latest.period,
            "previous_record_period": previous.period,
            "series_starts": series.periods[0],
            "frequency": series.frequency,
        },
    )


# ---------------------------------------------------------------------------
# 2. Streaks
# ---------------------------------------------------------------------------
def detect_streak(series: TimeSeries, *, min_length: int = 3) -> Signal | None:
    """Consecutive same-direction moves.

    Stays silent when the run is shorter than ``min_length``. Two months in the
    same direction is a coin flip landing twice; it is not a trend, and calling
    it one is how a data wire loses its credibility.

    A flat period breaks a streak rather than extending it, because "unchanged"
    is not a move in either direction.
    """
    if len(series) < min_length + 1:
        return None

    deltas = [
        series.observations[i].value - series.observations[i - 1].value
        for i in range(1, len(series))
    ]
    last = deltas[-1]
    if last == 0:
        return None
    sign = 1 if last > 0 else -1

    run = 0
    for delta in reversed(deltas):
        if (delta > 0 and sign > 0) or (delta < 0 and sign < 0):
            run += 1
        else:
            break
    if run < min_length:
        return None

    start = series.observations[-(run + 1)]
    latest = series.latest
    cumulative = latest.value - start.value
    cumulative_pct = pct_change(latest.value, start.value)

    rarity = _scale(run, 8)
    magnitude = _scale(cumulative_pct or 0.0, 15)
    score = _clamp(0.45 + 0.35 * rarity + 0.20 * magnitude)

    direction = "rising" if sign > 0 else "falling"
    return Signal(
        detector="streak",
        metric=series.metric,
        metric_label=series.metric_label,
        geography=series.geography,
        period=latest.period,
        value=latest.value,
        unit=series.unit,
        comparison_basis=(
            f"{run} consecutive {series.frequency} moves in the same direction, "
            f"from {start.value:g} {series.unit} in {start.period}"
        ),
        score=score,
        section=series.section,
        chart_ref=series.chart_ref,
        fields={
            "latest_value": latest.value,
            "streak_length": float(run),
            "streak_start_value": start.value,
            "cumulative_change": cumulative,
            "cumulative_change_pct": abs(cumulative_pct) if cumulative_pct is not None else 0.0,
        },
        sources=[series.source],
        context={
            "direction": direction,
            "latest_period": latest.period,
            "streak_start_period": start.period,
            "frequency": series.frequency,
        },
    )


# ---------------------------------------------------------------------------
# 3. Threshold crossings
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Threshold:
    """A level whose crossing is meaningful for a particular metric.

    ``weight`` is editorial: crossing zero on a wholesale power price (negative
    prices — the grid paying you to consume) matters more than crossing €100.
    """

    name: str
    value: float
    weight: float = 0.5
    unit_label: str = ""


def detect_threshold_cross(
    series: TimeSeries,
    thresholds: Sequence[Threshold],
) -> Signal | None:
    """The series moved from one side of a named level to the other.

    Stays silent when the latest and previous readings sit on the *same* side,
    however far from the line they are. A metric that has been above €100 for a
    fortnight is not "crossing" anything, and reporting it as such would
    manufacture an event out of a steady state.
    """
    previous = series.previous
    if previous is None or not thresholds:
        return None
    latest = series.latest

    for threshold in thresholds:
        was_above = previous.value > threshold.value
        is_above = latest.value > threshold.value
        if was_above == is_above:
            continue

        overshoot = abs(latest.value - threshold.value)
        overshoot_pct = (
            abs(overshoot / threshold.value * 100.0) if threshold.value != 0 else _scale(overshoot, 1) * 100
        )
        score = _clamp(0.45 + 0.40 * _clamp(threshold.weight) + 0.15 * _scale(overshoot_pct, 20))

        return Signal(
            detector="threshold_cross",
            metric=series.metric,
            metric_label=series.metric_label,
            geography=series.geography,
            period=latest.period,
            value=latest.value,
            unit=series.unit,
            comparison_basis=(
                f"the {threshold.name} level of {threshold.value:g} {threshold.unit_label or series.unit}, "
                f"which the series was on the other side of in {previous.period} "
                f"at {previous.value:g} {series.unit}"
            ),
            score=score,
            section=series.section,
        chart_ref=series.chart_ref,
            fields={
                "latest_value": latest.value,
                "previous_value": previous.value,
                "threshold_value": threshold.value,
                "distance_from_threshold": overshoot,
            },
            sources=[series.source],
            context={
                "threshold_name": threshold.name,
                "direction": "upward" if is_above else "downward",
                "latest_period": latest.period,
                "previous_period": previous.period,
            },
        )
    return None


# ---------------------------------------------------------------------------
# 4. Cross-country divergence
# ---------------------------------------------------------------------------
def detect_divergence(
    series_by_geography: Mapping[str, TimeSeries],
    *,
    min_geographies: int = 3,
    min_spread_pct: float = 8.0,
    min_ratio_vs_typical: float = 2.0,
    min_history: int = 6,
) -> Signal | None:
    """LV, EE and LT stopped moving together on the same metric.

    Two conditions must both hold, and the second is what makes this a real
    detector rather than a spread report:

    1. the spread across countries is at least ``min_spread_pct`` of the mean —
       an absolute floor so tiny divergences never qualify;
    2. the spread is at least ``min_ratio_vs_typical`` times the *median
       historical spread for this same metric* — so a metric where the three
       countries always sit far apart does not generate a story every single day
       for saying so.

    Stays silent when the countries move together, when they are habitually this
    far apart, or when the periods do not line up.
    """
    usable = {geo: s for geo, s in series_by_geography.items() if len(s) >= min_history}
    if len(usable) < min_geographies:
        return None

    common = set.intersection(*(set(s.periods) for s in usable.values()))
    if not common:
        return None
    period = max(common)

    latest_values = {geo: s.at(period).value for geo, s in usable.items()}  # type: ignore[union-attr]
    high_geo = max(latest_values, key=lambda g: latest_values[g])
    low_geo = min(latest_values, key=lambda g: latest_values[g])
    spread = latest_values[high_geo] - latest_values[low_geo]
    mean_level = statistics.fmean(latest_values.values())
    if mean_level == 0:
        return None
    spread_pct = abs(spread / mean_level * 100.0)
    if spread_pct < min_spread_pct:
        return None

    historical: list[float] = []
    for other in sorted(common - {period}):
        values = [s.at(other).value for s in usable.values() if s.at(other) is not None]  # type: ignore[union-attr]
        if len(values) == len(usable):
            historical.append(max(values) - min(values))
    if len(historical) < min_history - 1:
        return None
    typical = statistics.median(historical)
    if typical <= 0:
        typical = max(abs(mean_level) * 1e-6, 1e-9)
    ratio = spread / typical
    if ratio < min_ratio_vs_typical:
        return None

    sample = next(iter(usable.values()))
    score = _clamp(
        0.45 + 0.30 * _scale(spread_pct, 25) + 0.25 * _scale(ratio - min_ratio_vs_typical, 3)
    )

    fields = {
        "spread": spread,
        "spread_pct": spread_pct,
        "typical_spread": typical,
        "spread_vs_typical": ratio,
        "highest_value": latest_values[high_geo],
        "lowest_value": latest_values[low_geo],
        # The comparison basis says "across N earlier periods", so N is a
        # number the writer is handed and will reasonably repeat. Anything
        # quotable from the basis has to be declarable, or the article is
        # rejected for using a figure we ourselves supplied.
        "periods_compared": float(len(historical)),
    }
    fields.update({f"value_{geo.lower()}": value for geo, value in latest_values.items()})

    return Signal(
        detector="divergence",
        metric=sample.metric,
        metric_label=sample.metric_label,
        geography="Baltic",
        period=period,
        value=spread,
        unit=sample.unit,
        comparison_basis=(
            f"the median spread of {typical:g} {sample.unit} between the same countries "
            f"across the {len(historical)} earlier "
            f"{reading_word(sample.frequency, len(historical))} in the series"
        ),
        score=score,
        section=sample.section,
        fields=fields,
        sources=[s.source for s in usable.values()],
        context={
            "highest_geography": high_geo,
            "lowest_geography": low_geo,
            "period": period,
            "geographies": ", ".join(sorted(usable)),
            "frequency": sample.frequency,
        },
    )


# ---------------------------------------------------------------------------
# 4b. Structural divergence — sustained and widening
# ---------------------------------------------------------------------------
def detect_structural_divergence(
    series_by_geography: Mapping[str, TimeSeries],
    *,
    min_geographies: int = 3,
    min_history: int = 20,
    window: int = 8,
    min_gap_pct: float = 25.0,
    min_widening: float = 1.5,
) -> Signal | None:
    """The countries have been pulling apart for years, not since last quarter.

    :func:`detect_divergence` answers "did they stop moving together *this*
    period", and it deliberately goes quiet when the three sit habitually far
    apart — its second condition divides by the median historical spread
    precisely so that a permanently wide metric does not file a story every day
    for still being wide.

    That silence is right for a spread report and wrong for the most
    consequential kind of economic news, which is slow. Latvia's services
    surplus and Lithuania's were within 350m EUR of one another in 2010 and
    8bn EUR apart by 2025. No single quarter in that run was remarkable, every
    quarter looked like the last, and so the widest divergence in the Baltic
    external accounts was the one shape the pipeline could never see.

    Fires only when all four hold:

    1. enough common history to tell a trend from a run of luck;
    2. the *same* country has been highest and the *same* lowest for at least
       ``window`` consecutive periods — a stable ordering is what separates a
       structural gap from noise straddling zero, and it is the condition that
       does the real work on balance metrics, which have no natural scale;
    3. the current gap is at least ``min_gap_pct`` of the mean absolute level,
       so a gap that is merely arithmetically wide on a near-zero series does
       not qualify;
    4. the gap is at least ``min_widening`` times its average over the *oldest*
       ``window`` periods — it is growing, not merely large. A gap that has
       since inverted outright satisfies this by definition and is reported
       as a difference rather than a ratio, because a ratio across a sign
       change is not a number anyone can interpret.

    Stays silent on a one-off spike — that is ``detect_divergence``'s story —
    on a gap that is converging, and on one that is wide but flat.
    """
    usable = {geo: s for geo, s in series_by_geography.items() if len(s) >= min_history}
    if len(usable) < min_geographies:
        return None

    common = sorted(set.intersection(*(set(s.periods) for s in usable.values())))
    if len(common) < min_history:
        return None

    def values_at(period: str) -> dict[str, float]:
        found = {}
        for geo, series in usable.items():
            observation = series.at(period)
            if observation is not None:
                found[geo] = observation.value
        return found

    latest_values = values_at(common[-1])
    if len(latest_values) < len(usable):
        return None
    high_geo = max(latest_values, key=lambda g: latest_values[g])
    low_geo = min(latest_values, key=lambda g: latest_values[g])

    # How far back does this ordering hold, unbroken? This is the persistence
    # test, and it is deliberately counted rather than assumed: the count goes
    # into the article, so a reader can see how long "structural" means.
    sustained = 0
    for period in reversed(common):
        values = values_at(period)
        if len(values) < len(usable):
            break
        if max(values, key=lambda g: values[g]) != high_geo:
            break
        if min(values, key=lambda g: values[g]) != low_geo:
            break
        sustained += 1
    if sustained < window:
        return None

    latest_gap = latest_values[high_geo] - latest_values[low_geo]
    scale = statistics.fmean([abs(v) for v in latest_values.values()])
    if scale <= 0:
        return None
    gap_pct = latest_gap / scale * 100.0
    if gap_pct < min_gap_pct:
        return None

    def mean_gap(periods: Sequence[str]) -> float | None:
        gaps = []
        for period in periods:
            values = values_at(period)
            if len(values) == len(usable):
                gaps.append(values[high_geo] - values[low_geo])
        return statistics.fmean(gaps) if gaps else None

    early_gap = mean_gap(common[:window])
    recent_gap = mean_gap(common[-window:])
    if early_gap is None or recent_gap is None:
        return None

    widening: float | None
    if early_gap > 0:
        widening = recent_gap / early_gap
        if widening < min_widening:
            return None
    else:
        # The ordering has reversed: the country now furthest ahead used to be
        # behind. No ratio is reported, because dividing across a sign change
        # would hand the writer a figure that means nothing.
        widening = None

    sample = next(iter(usable.values()))
    score = _clamp(0.50 + 0.25 * _scale(gap_pct, 150) + 0.25 * _scale(sustained, 24))

    fields = {
        "gap": latest_gap,
        "gap_pct": gap_pct,
        "early_gap": early_gap,
        "recent_gap": recent_gap,
        # Both of these are quoted in the comparison basis, so both have to be
        # declarable or the article is rejected for citing a figure we supplied
        # ourselves. See test_basis_declarable.py.
        "window_periods": float(window),
        "sustained_periods": float(sustained),
        "highest_value": latest_values[high_geo],
        "lowest_value": latest_values[low_geo],
    }
    if widening is not None:
        fields["widening_ratio"] = widening
    fields.update({f"value_{geo.lower()}": value for geo, value in latest_values.items()})

    return Signal(
        detector="structural_divergence",
        metric=sample.metric,
        metric_label=sample.metric_label,
        geography="Baltic",
        period=common[-1],
        value=latest_gap,
        unit=sample.unit,
        comparison_basis=(
            f"the same countries' average difference of {early_gap:g} {sample.unit} "
            f"across the first {window} {reading_word(sample.frequency, window)} "
            f"of the series"
        ),
        score=score,
        section=sample.section,
        fields=fields,
        sources=[s.source for s in usable.values()],
        context={
            "highest_geography": high_geo,
            "lowest_geography": low_geo,
            "period": common[-1],
            "geographies": ", ".join(sorted(usable)),
            "frequency": sample.frequency,
            "direction": "widening" if widening is not None else "inverted",
        },
        chart_ref=sample.chart_ref,
    )


# ---------------------------------------------------------------------------
# 5. Seasonal deviation
# ---------------------------------------------------------------------------
def detect_seasonal_deviation(
    series: TimeSeries,
    *,
    min_years: int = 3,
    z_threshold: float = 2.0,
    min_deviation_pct: float = 5.0,
) -> Signal | None:
    """Today's reading against the long-run normal *for this point in the year*.

    Stays silent when fewer than ``min_years`` prior years are available to form
    a baseline, and when the deviation is within ``z_threshold`` of that
    baseline. August being warmer than February is not a signal; August being
    two standard deviations off previous Augusts is.
    """
    latest = series.latest
    baseline = series.same_season_history(latest.period)
    if len(baseline) < min_years:
        return None

    values = [o.value for o in baseline]
    mean = statistics.fmean(values)
    sigma = robust_sigma(values)
    if sigma <= 0:
        return None

    deviation = latest.value - mean
    z = deviation / sigma
    if abs(z) < z_threshold:
        return None
    deviation_pct = pct_change(latest.value, mean)
    if deviation_pct is None or abs(deviation_pct) < min_deviation_pct:
        return None

    score = _clamp(0.45 + 0.35 * _scale(z, 4) + 0.20 * _scale(deviation_pct, 30))

    return Signal(
        detector="seasonal_deviation",
        metric=series.metric,
        metric_label=series.metric_label,
        geography=series.geography,
        period=latest.period,
        value=latest.value,
        unit=series.unit,
        comparison_basis=(
            # The mean is rendered exactly as the writer's figure table renders
            # it, via ``units.display_value``. ``:g`` printed 0.744444 into
            # prose the model is required to restate, and it duly published
            # "the nine-year average of 0.744444% quarter on quarter" — six
            # significant figures of false precision on a seasonal mean.
            #
            # ``:.2f`` is NOT the fix and was the previous bug: it renders
            # 7.075 as "7.08" by decimal formatting, while the validator
            # compares using ``round()``. ``display_value`` uses ``round()``
            # too, so what the basis prints is by construction what the gate
            # accepts. test_basis_declarable.py holds that line.
            #
            # And the year count is SPELLED, not printed. It is a count, not a
            # measurement, and as a numeral it collided with ``deviation``:
            # "the 5-year average" beside a deviation of 5.4 gave the token two
            # possible parents, so ``reconcile_figures`` refused to file it and
            # every seasonal article died on a number the pipeline wrote itself.
            f"the {spell_count(len(baseline))}-year average of "
            f"{units.display_value('seasonal_mean', mean)} {series.unit} "
            f"for the same point in the year, {series.season_label(latest.period)}"
        ),
        score=score,
        section=series.section,
        chart_ref=series.chart_ref,
        fields={
            "latest_value": latest.value,
            "seasonal_mean": mean,
            "deviation": deviation,
            "deviation_pct": abs(deviation_pct),
            "z_score": abs(z),
            "baseline_years": float(len(baseline)),
        },
        sources=[series.source],
        context={
            "direction": "above" if deviation > 0 else "below",
            "season_key": series.season_key(latest.period),
            "latest_period": latest.period,
            "baseline_periods": ", ".join(o.period for o in baseline),
        },
    )


# ---------------------------------------------------------------------------
# 6. Sharp period-over-period moves
# ---------------------------------------------------------------------------
def detect_sharp_move(
    series: TimeSeries,
    *,
    min_history: int = 8,
    sigma_multiple: float = 2.5,
    min_abs_pct: float = 1.0,
) -> Signal | None:
    """A jump that is large *for this series*.

    The threshold is the series' own volatility, measured with a median absolute
    deviation so the move under test does not inflate its own yardstick. This is
    the detector most at risk of firing on everything, so it is deliberately the
    strictest:

    * it needs ``min_history`` prior changes before it will judge anything;
    * the move must exceed ``sigma_multiple`` times the typical move;
    * **and** clear an absolute floor of ``min_abs_pct``, so a metronomically
      flat series does not turn a rounding artefact into a 30-sigma event.

    Stays silent on a routine wiggle in a volatile series, which is the whole
    reason for the sigma term.
    """
    if len(series) < min_history + 2:
        return None
    previous = series.previous
    if previous is None:
        return None
    latest = series.latest

    deltas = [
        series.observations[i].value - series.observations[i - 1].value
        for i in range(1, len(series) - 1)
    ]
    if len(deltas) < min_history:
        return None
    sigma = robust_sigma(deltas)
    if sigma <= 0:
        return None

    change = latest.value - previous.value
    z = abs(change) / sigma
    if z < sigma_multiple:
        return None
    change_pct = pct_change(latest.value, previous.value)
    if change_pct is None or abs(change_pct) < min_abs_pct:
        return None

    score = _clamp(
        0.40 + 0.35 * _scale(z - sigma_multiple, 4) + 0.25 * _scale(change_pct, 20)
    )

    return Signal(
        detector="sharp_move",
        metric=series.metric,
        metric_label=series.metric_label,
        geography=series.geography,
        period=latest.period,
        value=latest.value,
        unit=series.unit,
        comparison_basis=(
            f"the previous reading of {previous.value:g} {series.unit} in {previous.period}, "
            f"against a typical {series.frequency} move of {sigma:.3g} {series.unit} "
            f"over the preceding {len(deltas)} "
            f"{reading_word(series.frequency, len(deltas))}"
        ),
        score=score,
        section=series.section,
        chart_ref=series.chart_ref,
        fields={
            "latest_value": latest.value,
            "previous_value": previous.value,
            "change": change,
            "change_pct": abs(change_pct),
            "typical_move": sigma,
            "move_vs_typical": z,
            # The basis counts the periods it measured volatility over, so the
            # writer is handed that count and will state it. Undeclared, it was
            # not merely unquotable — the reconciler matched "10" to whichever
            # field sat within rounding distance of it and filed the count as,
            # in one case, the latest value. A wrong signal_field is worse than
            # a rejection: it publishes.
            "periods_compared": float(len(deltas)),
        },
        sources=[series.source],
        context={
            "direction": "up" if change > 0 else "down",
            "latest_period": latest.period,
            "previous_period": previous.period,
            "frequency": series.frequency,
        },
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def detect_all(
    series_list: Sequence[TimeSeries],
    *,
    thresholds: Mapping[str, Sequence[Threshold]] | None = None,
) -> list[Signal]:
    """Run every single-series detector over every series.

    Returns whatever fires — possibly nothing, which is a valid and expected
    outcome. Ranking, not detection, decides what gets written.
    """
    thresholds = thresholds or {}
    signals: list[Signal] = []
    for series in series_list:
        if not series.observations:
            continue
        candidates = [
            detect_record_extreme(series),
            detect_streak(series),
            detect_threshold_cross(series, thresholds.get(series.metric, ())),
            detect_seasonal_deviation(series),
            detect_sharp_move(series),
        ]
        signals.extend(s for s in candidates if s is not None)

    by_metric: dict[str, dict[str, TimeSeries]] = {}
    for series in series_list:
        if series.geography in ("LV", "EE", "LT"):
            by_metric.setdefault(series.metric, {})[series.geography] = series
    for group in by_metric.values():
        divergence = detect_divergence(group)
        if divergence is not None:
            signals.append(divergence)
        structural = detect_structural_divergence(group)
        if structural is not None:
            signals.append(structural)

    log.info("detection produced %d signal(s) from %d series", len(signals), len(series_list))
    return signals


__all__ = [
    "Observation",
    "Threshold",
    "TimeSeries",
    "detect_all",
    "detect_divergence",
    "detect_record_extreme",
    "detect_seasonal_deviation",
    "detect_sharp_move",
    "detect_streak",
    "detect_structural_divergence",
    "detect_threshold_cross",
]
