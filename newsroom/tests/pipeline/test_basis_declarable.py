"""Every number we hand the writer must be one the writer can declare.

WHY THIS EXISTS
---------------
Three production runs published nothing. One of the two causes was this:

    comparison_basis: "the median spread of 10.87 EUR/MWh between the same
                       countries across 119 earlier periods"
    fields:           spread, spread_pct, typical_spread, spread_vs_typical,
                      highest_value, lowest_value, value_ee, value_lt, value_lv

The basis is given to the model verbatim and the model is told to state it. So
it wrote "across 119 earlier periods" — correctly, using a number we supplied
and verified. But 119 was not in ``fields``, so no figure could cite it, the
validator saw an undeclared number, and the article was rejected.

The pipeline was asking for something and then refusing it.

THE INVARIANT
-------------
Every numeric token in ``comparison_basis`` must be justified by some entry in
``fields``. Anything quotable has to be declarable.

This is a contract between two halves of the pipeline that are otherwise free
to drift, and drift is invisible: it shows up as articles quietly failing to
publish, with a rejection message that names a bare token and explains nothing.
"""

from __future__ import annotations

import re

import pytest

from newsroom import numeric_scan
from newsroom.pipeline.detect.series import reading_word
from newsroom.pipeline.models import Signal
from newsroom.tests.pipeline.conftest import make_signal


def undeclarable_tokens(signal: Signal) -> list[str]:
    """Numbers in the basis that no field can justify."""
    orphans: list[str] = []
    for token in numeric_scan.scan(signal.comparison_basis):
        justified = any(
            numeric_scan.value_justifies(token, float(value))
            for value in signal.fields.values()
            if isinstance(value, (int, float))
        )
        if not justified:
            orphans.append(token.text)
    return orphans


def ambiguous_tokens(signal: Signal) -> list[str]:
    """Numbers in the basis that two or more fields could justify.

    Declarable is not enough. ``reconcile_figures`` files a numeral the writer
    forgot only when **exactly one** verified field justifies it — guessing
    between two would be the sort of plausible invention the pipeline exists to
    prevent — so an ambiguous numeral in pipeline-authored prose is as fatal as
    an orphan one, and fails in exactly the same way.

    It shipped. The seasonal basis read "the 5-year average of 18.1 °C" while
    ``deviation`` held 5.4, which rounds to 5. Two parents, no declaration, and
    every seasonal article rejected for a token the pipeline wrote itself.
    ``undeclarable_tokens`` was green throughout, because 5 *was* declarable.
    """
    from newsroom.pipeline.write import reconcile

    return [
        token.text
        for token in numeric_scan.scan(signal.comparison_basis)
        if len(reconcile._matching_fields(token, signal.fields)) > 1
    ]


def all_detector_signals() -> list[tuple[str, Signal]]:
    """Real output from every detector, built from its own kind of input."""
    from newsroom.pipeline.detect import (
        Threshold,
        detect_divergence,
        detect_record_extreme,
        detect_seasonal_deviation,
        detect_sharp_move,
        detect_streak,
        detect_structural_divergence,
        detect_threshold_cross,
    )
    from newsroom.tests.pipeline.conftest import monthly_periods, quarterly_periods, series_from

    signals: list[tuple[str, Signal]] = []

    def power(values, **kwargs):
        return series_from(
            values,
            periods=monthly_periods(len(values)),
            metric="wholesale_power_price",
            metric_label="the wholesale power price",
            unit="EUR/MWh",
            section="energy",
            **kwargs,
        )

    divergence = detect_divergence(
        {
            "LV": series_from([6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 9.5], geography="LV"),
            "EE": series_from([6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0], geography="EE"),
            "LT": series_from([6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 6.1], geography="LT"),
        }
    )
    if divergence is not None:
        signals.append(("divergence", divergence))

    record = detect_record_extreme(
        series_from([5.0, 5.2, 5.1, 5.4, 5.3, 5.5, 5.2, 5.4, 5.6, 5.3, 5.5, 5.4, 6.2])
    )
    if record is not None:
        signals.append(("record_extreme", record))

    # One observation per August, five years running, the last far above them.
    seasonal = detect_seasonal_deviation(
        series_from(
            [18.0, 18.4, 17.8, 18.2, 18.1, 23.5],
            periods=[f"{year}-08" for year in range(2021, 2026)] + ["2026-08"],
            metric="mean_air_temperature",
            metric_label="mean air temperature",
            unit="°C",
            section="environment",
        )
    )
    if seasonal is not None:
        signals.append(("seasonal_deviation", seasonal))

    # Two years of ordinary power-price noise and then a spike. The basis
    # counts the periods it measured volatility over, so it can strand that
    # count exactly as the divergence basis once did.
    sharp = detect_sharp_move(
        power(
            [
                58.0, 61.0, 59.5, 62.0, 60.5, 63.0, 59.0, 61.5, 60.0, 62.5, 58.5, 61.0,
                59.0, 62.0, 60.0, 63.5, 61.0, 59.5, 62.0, 60.5, 61.5, 59.0, 62.0, 88.0,
            ]
        )
    )
    if sharp is not None:
        signals.append(("sharp_move", sharp))

    # Five straight monthly rises. The basis counts the run.
    streak = detect_streak(power([58.0, 59.2, 60.4, 62.1, 64.3, 67.0]))
    if streak is not None:
        signals.append(("streak", streak))

    crossing = detect_threshold_cross(
        power([88.0, 121.0]),
        [Threshold("hundred-euro", 100.0, weight=0.6, unit_label="EUR/MWh")],
    )
    if crossing is not None:
        signals.append(("threshold_cross", crossing))

    # A gap that opens and compounds over 24 quarters — the shape the
    # spread-based divergence detector is built to stay quiet about. Its basis
    # quotes both an average difference and a count of quarters, so it has two
    # ways to strand an undeclarable number.
    quarters = quarterly_periods(24)
    structural = detect_structural_divergence(
        {
            geo: series_from(
                values,
                geography=geo,
                periods=quarters,
                metric="services_balance",
                metric_label="the services balance",
                unit="million EUR",
                section="trade",
                frequency="quarterly",
            )
            for geo, values in (
                ("LV", [300 + 8 * i for i in range(24)]),
                ("EE", [340 + 10 * i for i in range(24)]),
                ("LT", [250 + 95 * i for i in range(24)]),
            )
        }
    )
    if structural is not None:
        signals.append(("structural_divergence", structural))

    return signals


#: Every detector this contract covers. Asserted rather than assumed: an input
#: that stopped triggering its detector would otherwise turn these into a test
#: of the detectors that still fire, while still reporting green.
#:
#: ``sharp_move``, ``streak`` and ``threshold_cross`` were absent for their
#: whole existence, and ``sharp_move`` was in breach the entire time — its
#: basis counted "the preceding N periods" with no field holding N.
DETECTORS_UNDER_CONTRACT = {
    "divergence",
    "record_extreme",
    "seasonal_deviation",
    "sharp_move",
    "streak",
    "threshold_cross",
    "structural_divergence",
}


class TestTheBasisIsAlwaysDeclarable:
    def test_a_basis_quoting_a_sample_size_must_expose_it(self):
        # The exact production failure, reduced. Without periods_compared in
        # fields, '119' is unquotable and every divergence article dies.
        signal = make_signal(
            comparison_basis=(
                "the median spread of 10.87 EUR/MWh between the same countries "
                "across 119 earlier periods"
            ),
            fields={"spread": 49.64, "typical_spread": 10.87, "periods_compared": 119.0},
        )

        assert undeclarable_tokens(signal) == []

    def test_detects_a_basis_number_with_no_matching_field(self):
        # The guard itself must work, or the contract tests below prove nothing.
        signal = make_signal(
            comparison_basis="the median spread of 10.87 EUR/MWh across 119 earlier periods",
            fields={"spread": 49.64, "typical_spread": 10.87},
        )

        assert "119" in undeclarable_tokens(signal)


class TestEveryDetectorHonoursIt:
    """Run the real detectors and check the contract on their real output."""

    def test_every_detector_produces_a_fully_declarable_basis(self):
        produced = all_detector_signals()
        covered = {name for name, _ in produced}
        # Coverage is asserted, not assumed. An input that stops triggering its
        # detector would otherwise turn this into a test of one detector while
        # still reporting green.
        assert covered == DETECTORS_UNDER_CONTRACT, (
            f"a detector stopped producing a signal, so it is no longer checked: {covered}"
        )
        offenders = {
            name: (signal.comparison_basis, orphans, sorted(signal.fields))
            for name, signal in produced
            if (orphans := undeclarable_tokens(signal))
        }

        assert not offenders, (
            "these detectors quote a number the writer cannot declare, which "
            f"silently blocks publication: {offenders}"
        )

    def test_every_detector_produces_an_unambiguous_basis(self):
        """And no number in it may have two possible parents.

        The seasonal detector failed this while passing the test above, and the
        symptom was identical: an undeclared numeral and a rejected article.
        """
        produced = all_detector_signals()
        assert {name for name, _ in produced} == DETECTORS_UNDER_CONTRACT
        offenders = {
            name: (signal.comparison_basis, ambiguous, sorted(signal.fields))
            for name, signal in produced
            if (ambiguous := ambiguous_tokens(signal))
        }

        assert not offenders, (
            "these detectors quote a number that two verified fields could "
            "justify, so the reconciler will not file it and the article dies "
            f"on a token the pipeline wrote itself: {offenders}"
        )

    def test_a_count_of_years_is_spelled_rather_than_printed(self):
        """The specific fix, pinned so a later edit cannot quietly undo it."""
        by_name = dict(all_detector_signals())

        assert "five-year average" in by_name["seasonal_deviation"].comparison_basis

    def test_the_sharp_move_basis_exposes_the_periods_it_measured(self):
        """The count in "over the preceding N months" must be a field.

        Undeclared, it was not merely unquotable. ``reconcile`` files a numeral
        the writer forgot when exactly one verified field justifies it, and the
        validator's rounding rule means a ``latest_value`` of 9.5 justifies the
        token ``10``. So on a series where the count landed within half a unit
        of another field, the count was filed against that field and published
        with it — a figure whose stated provenance is simply not where it came
        from, which no gate downstream can see.
        """
        sharp = dict(all_detector_signals())["sharp_move"]

        assert "periods_compared" in sharp.fields
        assert undeclarable_tokens(sharp) == []


class TestTheBasisSaysWhatItCounted:
    """A basis that counts observations must name what it counted.

    "across 119 earlier periods" cost two rejections in a single live run:

        desk reject: ... does not specify the period over which the earlier
                     periods were measured

    "Period" is our word for a row in a table. A reader cannot tell 119 days
    from 119 quarters, and neither could the writer, so it hedged and the desk
    refused it. The count is meaningless without its unit.
    """

    _BARE_COUNT = re.compile(r"\b\d+\s+(?:earlier\s+)?periods?\b", re.IGNORECASE)

    def test_no_detector_counts_in_bare_periods(self):
        for name, signal in all_detector_signals():
            assert not self._BARE_COUNT.search(signal.comparison_basis), (
                f"{name} counts in bare 'periods', which names no unit of time: "
                f"{signal.comparison_basis!r}"
            )

    def test_the_divergence_basis_names_its_unit_of_time(self):
        by_name = dict(all_detector_signals())
        basis = by_name["divergence"].comparison_basis

        assert re.search(
            r"\b\d+\s+earlier\s+(?:daily readings?|months?|quarters?|years?|readings?)\b", basis
        ), f"basis does not say what it counted: {basis!r}"

    @pytest.mark.parametrize(
        "frequency,count,expected",
        [
            ("daily", 119, "daily readings"),
            ("daily", 1, "daily reading"),
            ("monthly", 12, "months"),
            ("quarterly", 4, "quarters"),
            ("annual", 5, "years"),
            # An unknown frequency must still say something truthful rather
            # than falling back to "periods".
            ("hourly", 3, "readings"),
        ],
    )
    def test_reading_word_names_a_unit_a_reader_can_picture(self, frequency, count, expected):
        assert reading_word(frequency, count) == expected


@pytest.mark.parametrize(
    "basis,fields,expected",
    [
        ("compared with 4.2% a year earlier", {"prior_value": 4.2}, []),
        ("compared with 4.2% a year earlier", {"prior_value": 9.9}, ["4.2%"]),
        # A rounded rendering of a verified value is fine; that is the
        # validator's own rule and this must not be stricter than it.
        ("compared with 4.2% a year earlier", {"prior_value": 4.23}, []),
        # Dates are not claims.
        ("compared with June 2026", {"prior_value": 4.2}, []),
    ],
)
def test_orphan_detection_matches_the_validators_own_rounding_rule(basis, fields, expected):
    signal = make_signal(comparison_basis=basis, fields=fields)

    assert undeclarable_tokens(signal) == expected
