"""``len(baseline)`` is a count of years, and must stay one.

`detect_seasonal_deviation` prints "the {spell_count(len(baseline))}-year
average". That is a claim about how many years went into the mean, and it is
true only while one year can contribute at most one reading at a given season
point.

It is not the fault fixed in `detect_streak` and `detect_sharp_move`. Those
stated a **span** or a **contiguity** derived from a count of readings — "four
consecutive monthly moves", "over the preceding 14 quarters" — and a hole
falsifies both. This states a **cardinality**, claims no adjacency and names no
window, so a hole leaves it true. Measured across every collected series: 282
series, 10,558 (period, baseline) pairs, `len(baseline)` equalled the number of
distinct contributing years every time, including the three season keys where
`tourism/EE` is genuinely gapped.

What that rests on is `season_key` returning the whole non-year remainder of a
period, so that `year + "-" + key` reconstructs the period and two readings from
one year cannot collide in one baseline. Nothing else asserts it, and it is one
edit away: coarsen the key and the sentence starts overstating, silently, in
prose a reader is asked to trust.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.detect.detectors import detect_seasonal_deviation
from newsroom.pipeline.detect.series import Observation, SourceRef, TimeSeries

#: One of each period format the collector produces. Annual is included on
#: purpose: `season_key("2026")` is the period itself, so an annual series has
#: no same-season history at all and the detector never speaks for it.
PERIOD_FORMATS = ["2026-08", "2026-Q3", "2026-08-24", "2026-S1", "2026-W15", "2026"]


def _series(periods, values=None, **kw):
    values = values or [1.0 + i for i in range(len(periods))]
    return TimeSeries(
        metric=kw.get("metric", "m"),
        metric_label=kw.get("metric_label", "a metric"),
        geography="LV",
        unit="units",
        section="economy",
        observations=tuple(
            Observation(period=p, value=v) for p, v in zip(periods, values)
        ),
        frequency=kw.get("frequency", "monthly"),
        chart_ref=None,
        source=SourceRef(source_id="s", retrieved_at="x", dataset="d", url="u"),
    )


class TestSeasonKeyIsTheWholeNonYearRemainder:
    """The property the year count depends on."""

    @pytest.mark.parametrize("period", PERIOD_FORMATS)
    def test_year_and_key_reconstruct_the_period(self, period):
        # If they do, then two distinct periods cannot share both a year and a
        # season key -- which is what makes one reading per year per key a
        # structural fact rather than a coincidence of the data.
        series = _series([period])
        key = series.season_key(period)
        year = period.split("-")[0]
        rebuilt = period if key == period else f"{year}-{key}"

        assert rebuilt == period, (
            f"season_key({period!r}) returned {key!r}; the year and the key no "
            "longer reconstruct the period, so two readings from one year can "
            "land in the same baseline and 'the N-year average' overstates"
        )

    def test_a_year_contributes_at_most_one_reading(self):
        # Three Augusts and a September. The September is the latest, so the
        # baseline is the Augusts -- one per year, never two.
        series = _series(["2024-08", "2025-08", "2026-08", "2026-09"])
        baseline = series.same_season_history("2026-09")

        assert [o.period for o in baseline] == []
        baseline = series.same_season_history("2026-08")
        years = [o.period.split("-")[0] for o in baseline]
        assert len(years) == len(set(years))

    def test_the_type_refuses_a_duplicate_period(self):
        # The other half of the guarantee, and the reason no fixture can plant
        # a same-year collision: two readings for one period are rejected
        # outright, so a season key can only be reached once per year.
        with pytest.raises(ValueError, match="duplicate periods"):
            _series(["2025-08", "2025-08"])


class TestTheYearCountSurvivesAGap:
    """A hole in the baseline must not change what the sentence claims."""

    @staticmethod
    def _augusts(periods):
        # Augusts near 18 °C with a hot latest, so the detector speaks.
        values = [17.9, 18.1, 18.0, 18.2, 17.8][: len(periods) - 1] + [23.5]
        return _series(
            periods,
            values,
            metric="mean_air_temperature",
            metric_label="mean air temperature",
        )

    def test_counts_the_years_present_not_the_years_spanned(self):
        # 2023 is missing: four readings across a five-year window. The basis
        # must say four, because four years went into the mean -- it is a
        # cardinality, not a span, and claims no adjacency.
        gapped = self._augusts(["2021-08", "2022-08", "2024-08", "2025-08", "2026-08"])
        signal = detect_seasonal_deviation(gapped)

        assert signal is not None
        assert signal.fields["baseline_years"] == 4
        assert "four-year average" in signal.comparison_basis
        assert "five-year" not in signal.comparison_basis

    def test_says_the_same_thing_when_the_window_is_contiguous(self):
        # The control: same number of readings, no hole. If this and the gapped
        # case disagreed, the count would be tracking the span after all.
        contiguous = self._augusts(["2022-08", "2023-08", "2024-08", "2025-08", "2026-08"])
        signal = detect_seasonal_deviation(contiguous)

        assert signal is not None
        assert signal.fields["baseline_years"] == 4
        assert "four-year average" in signal.comparison_basis

    def test_claims_no_window_and_no_adjacency(self):
        # What separates this basis from the two that had to be fixed. It may
        # not acquire "consecutive", or name the series' cadence, because
        # neither survives a hole.
        signal = detect_seasonal_deviation(
            self._augusts(["2021-08", "2022-08", "2024-08", "2025-08", "2026-08"])
        )

        assert signal is not None
        basis = signal.comparison_basis.lower()
        for word in ("consecutive", "successive", "in a row", "since", "preceding"):
            assert word not in basis, (
                f"the seasonal basis says {word!r}, which is a claim about a span "
                "or a run that a gapped baseline does not support"
            )
