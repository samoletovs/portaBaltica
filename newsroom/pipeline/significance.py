"""Stage 2b — is this difference big enough to be a difference at all?

THE GAP THIS CLOSES
-------------------
Every detector asks whether a movement is *large* or *unusual*. None of them
asks whether the movement is **measurable**. Those are different questions and
only the second one has a floor.

``detect_sharp_move`` already divides a move by the series' own volatility, and
that is the right test for "is this big for this series". It is the wrong test
for "can this series tell these two readings apart", and on a stable series it
inverts: the calmer the history, the smaller the sigma, so the more impressive a
rounding-width wiggle looks. A survey that is quiet for two years makes its own
noise floor look like signal.

The published wire shows the cost. On 2026-08-24 portaBaltica ran:

    Estonia's Unemployment Rate Declines to 6.6% in June 2026

Unemployment is a Labour Force Survey statistic. It is an estimate from a
sample, published to one decimal place, and a tenth-of-a-point move in a small
member state is not a decline — it is the same number measured twice. Reporting
it as a decline is the CNET failure in statistical dress: not a hallucination,
just a number the pipeline had no business being confident about.

WHAT COUNTS AS THE FLOOR
------------------------
Two floors, and the binding one is whichever is larger.

*Publication resolution* is derived from the data, never asserted. If every
value in a series is published to one decimal place, the series cannot express a
difference smaller than 0.1, so a smaller computed difference is an artefact of
our own arithmetic rather than a fact about Estonia.

*Survey resolution* is declared, for series that are sample estimates rather
than counts. These are editorial thresholds and are labelled as such: the honest
statement is "portaBaltica does not report a move this small", not a claim to
have recovered the official standard error, which Eurostat publishes per release
and which we do not fetch. Research on data-desk practice is explicit that the
threshold should be documented rather than implied, so ``basis`` is written to
be read by a reader, not only by a maintainer.

WHAT THIS DELIBERATELY DOES NOT DO
----------------------------------
It does not lower a score, and it does not rank. A difference below the floor is
not a weak story, it is an absence of one, so the signal is dropped outright and
counted. Making it survivable by any weighting would put it back on the wire on
a quiet day, which is exactly when the wire is most tempted to run it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Mapping, Sequence

from newsroom.pipeline.detect.series import TimeSeries
from newsroom.pipeline.models import Signal

log = logging.getLogger(__name__)

#: Where each detector puts the difference it is claiming.
#:
#: Every detector already emits one, under its own name, because every one of
#: them has to state a comparison basis. Mapping the names here keeps the gate
#: exact — it tests the number the article will actually make a claim about —
#: without asking detectors to grow a second, parallel notion of "the change".
#:
#: A detector missing from this table is not silently exempt. See
#: :func:`difference_of`, which refuses rather than guesses.
DIFFERENCE_FIELD: Mapping[str, str] = {
    "record_extreme": "margin",
    "streak": "cumulative_change",
    "threshold_cross": "distance_from_threshold",
    "seasonal_deviation": "deviation",
    "sharp_move": "change",
}

#: Detectors whose finding is not a movement in one measured series.
#:
#: The divergence pair compares countries at one moment. The claim is about the
#: gap between two series, so a single series' resolution is not the right
#: yardstick and applying one would be a false precision of its own. They are
#: exempt on purpose and by name, so that adding a detector cannot make it
#: exempt by accident.
NOT_A_MOVEMENT = frozenset({"divergence", "structural_divergence"})


@dataclass(frozen=True, slots=True)
class MeasurementFloor:
    """The smallest difference this series can express, and why."""

    value: float
    kind: str  # "publication" | "survey"
    basis: str

    def describes(self, difference: float) -> str:
        return (
            f"a difference of {abs(difference):.6g} against a floor of "
            f"{self.value:.6g} ({self.basis})"
        )


#: Series that are sample estimates rather than counts or administrative totals.
#:
#: The value is the smallest move portaBaltica will report, in the series' own
#: unit. It is an editorial floor, not a recovered standard error, and ``basis``
#: says so in the words a reader gets.
#:
#: 0.5pp for the Baltic LFS rates is chosen because these are monthly estimates
#: for small populations, where the published sampling error is a substantial
#: fraction of a point; anything tighter would be asserting a precision we have
#: not measured. Erring high costs us stories about real but small moves, which
#: is the cheap direction to be wrong in.
SURVEY_FLOORS: Mapping[str, MeasurementFloor] = {
    "unemployment_rate": MeasurementFloor(
        value=0.5,
        kind="survey",
        basis=(
            "the unemployment rate is a Labour Force Survey estimate from a sample, "
            "and portaBaltica does not report a monthly move smaller than 0.5 "
            "percentage points as a change"
        ),
    ),
    "economic_sentiment": MeasurementFloor(
        value=2.0,
        kind="survey",
        basis=(
            "the economic sentiment indicator is built from business and consumer "
            "survey balances rather than measured activity, and portaBaltica does not "
            "report a monthly move smaller than 2.0 index points as a change"
        ),
    ),
}
#: Only metrics that exist in ``collect.opendata`` belong here. An entry for a
#: metric the pipeline never collects is not harmless forward planning — it
#: reads, to anyone auditing the gate, like coverage that is in place. Add the
#: floor in the same change that adds the series.


def _decimals(value: float) -> int:
    """How many decimal places a published value actually carries."""
    text = format(Decimal(repr(float(value))).normalize(), "f")
    _, _, fraction = text.partition(".")
    return len(fraction)


def publication_floor(values: Sequence[float]) -> MeasurementFloor:
    """The finest step the source itself prints, read off the data.

    Nothing is asserted here. If Eurostat publishes 6.6 and 6.5, the series
    cannot express 0.05, so a computed difference of 0.05 is our arithmetic and
    not their measurement.

    The *coarsest* precision in the sample wins, because a series is only as
    precise as its least precise reading; taking the finest would let a single
    unrounded value license claims the rest of the series cannot support.
    """
    if not values:
        return MeasurementFloor(0.0, "publication", "no observations to read a precision from")
    places = max(_decimals(v) for v in values)
    step = 10.0**-places
    printed = f"{step:.{places}f}" if places else "1"
    return MeasurementFloor(
        value=step,
        kind="publication",
        basis=(
            f"the source publishes this series to {places} decimal place"
            f"{'' if places == 1 else 's'}, so it cannot express a difference "
            f"finer than {printed}"
        ),
    )


def floor_for(series: TimeSeries) -> MeasurementFloor:
    """The binding floor: whichever of the two is larger.

    A survey floor that came out below the printed precision would be a floor
    that never binds, which is worse than none because it looks like a guard.
    """
    published = publication_floor(series.values)
    survey = SURVEY_FLOORS.get(series.metric)
    if survey is not None and survey.value >= published.value:
        return survey
    return published


class UnknownDetector(KeyError):
    """A detector claimed a movement but did not say which field holds it."""


def difference_of(signal: Signal) -> float | None:
    """The difference this signal is claiming, or ``None`` if it claims none.

    Refuses rather than guesses. A new detector that emits a movement and is not
    registered in :data:`DIFFERENCE_FIELD` raises, because the alternative —
    treating an unrecognised detector as exempt — is a gate that quietly stops
    guarding the moment someone adds a detector. That is the failure mode this
    module exists to prevent, so it must not be reintroduced by its own
    lookup table.
    """
    if signal.detector in NOT_A_MOVEMENT:
        return None
    try:
        field_name = DIFFERENCE_FIELD[signal.detector]
    except KeyError as exc:
        raise UnknownDetector(
            f"detector {signal.detector!r} is neither registered in DIFFERENCE_FIELD "
            f"nor listed in NOT_A_MOVEMENT, so the significance gate cannot tell "
            f"whether its finding is measurable. Register it in one or the other."
        ) from exc
    value = signal.fields.get(field_name)
    if value is None:
        raise UnknownDetector(
            f"detector {signal.detector!r} declares its difference in field "
            f"{field_name!r}, which is absent from the signal's fields"
        )
    return float(value)


@dataclass(frozen=True, slots=True)
class Materiality:
    material: bool
    floor: MeasurementFloor | None
    difference: float | None
    reason: str


def assess(signal: Signal, series: TimeSeries) -> Materiality:
    """Can this series tell the two readings apart?"""
    difference = difference_of(signal)
    if difference is None:
        return Materiality(True, None, None, "not a movement in a single series")
    floor = floor_for(series)
    if abs(difference) >= floor.value:
        return Materiality(True, floor, difference, floor.describes(difference))
    return Materiality(
        False,
        floor,
        difference,
        (
            f"{signal.metric_label} in {signal.geography} moved "
            f"{abs(difference):.6g} {signal.unit}, which is below the "
            f"{floor.kind} floor of {floor.value:.6g} {signal.unit}: {floor.basis}"
        ),
    )


@dataclass
class SignificanceReport:
    kept: list[Signal]
    suppressed: list[tuple[Signal, Materiality]]

    def summary(self) -> str:
        if not self.suppressed:
            return f"{len(self.kept)} signal(s) cleared the measurement floor"
        return (
            f"{len(self.kept)} signal(s) cleared the measurement floor, "
            f"{len(self.suppressed)} below it"
        )


def gate(
    signals: Sequence[Signal], series_list: Sequence[TimeSeries]
) -> SignificanceReport:
    """Drop findings the source cannot actually resolve.

    Series are matched on ``(metric, geography)``, which is what makes a
    ``TimeSeries`` unique. A signal whose series is not present is kept: this
    gate is not the place to discover a bookkeeping error, and silently
    discarding a real finding because of one would be the worse failure.
    """
    by_key = {(s.metric, s.geography): s for s in series_list}
    report = SignificanceReport(kept=[], suppressed=[])
    for signal in signals:
        series = by_key.get((signal.metric, signal.geography))
        if series is None:
            report.kept.append(signal)
            continue
        verdict = assess(signal, series)
        if verdict.material:
            report.kept.append(signal)
        else:
            report.suppressed.append((signal, verdict))
            log.info("below the measurement floor, not written: %s", verdict.reason)
    return report


__all__ = [
    "DIFFERENCE_FIELD",
    "Materiality",
    "MeasurementFloor",
    "NOT_A_MOVEMENT",
    "SURVEY_FLOORS",
    "SignificanceReport",
    "UnknownDetector",
    "assess",
    "difference_of",
    "floor_for",
    "gate",
    "publication_floor",
]
