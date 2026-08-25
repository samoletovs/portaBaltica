"""Detection tests.

Every detector is tested in **both** directions. A detector that fires on
everything is as broken as one that never fires, so for each rule there is at
least one fixture that must produce a signal and at least one boundary fixture
that must produce none.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.detect import (
    Threshold,
    detect_all,
    detect_divergence,
    detect_record_extreme,
    detect_seasonal_deviation,
    detect_sharp_move,
    detect_streak,
    detect_structural_divergence,
    detect_threshold_cross,
)
from newsroom.tests.pipeline.conftest import monthly_periods, quarterly_periods, series_from


# ---------------------------------------------------------------------------
# Record highs and lows
# ---------------------------------------------------------------------------
class TestRecordExtreme:
    def test_should_signal_when_latest_beats_every_earlier_reading(self):
        series = series_from([5.0, 5.2, 5.1, 5.4, 5.3, 5.5, 5.2, 5.4, 5.6, 5.3, 5.5, 5.4, 6.2])

        signal = detect_record_extreme(series)

        assert signal is not None
        assert signal.detector == "record_extreme"
        assert signal.value == 6.2
        assert signal.fields["previous_record_value"] == 5.6
        assert "previous record high" in signal.comparison_basis

    def test_should_signal_on_a_record_low(self):
        series = series_from([5.0, 5.2, 5.1, 5.4, 5.3, 5.5, 5.2, 5.4, 5.6, 5.3, 5.5, 5.4, 4.1])

        signal = detect_record_extreme(series)

        assert signal is not None
        assert signal.context["direction"] == "low"

    def test_should_stay_silent_when_history_is_too_short(self):
        # A "record" over four months is a short series, not a record.
        series = series_from([5.0, 5.2, 5.1, 9.9])

        assert detect_record_extreme(series) is None

    def test_should_stay_silent_when_the_latest_merely_ties_the_previous_high(self):
        series = series_from([5.0, 5.2, 5.1, 5.4, 5.3, 5.5, 5.2, 5.4, 5.6, 5.3, 5.5, 5.4, 5.6])

        assert detect_record_extreme(series) is None

    def test_should_stay_silent_when_the_record_is_beaten_by_noise(self):
        # 5.6 -> 5.601 is a 0.018% margin: a rounding artefact, not a milestone.
        series = series_from([5.0, 5.2, 5.1, 5.4, 5.3, 5.5, 5.2, 5.4, 5.6, 5.3, 5.5, 5.4, 5.601])

        assert detect_record_extreme(series) is None

    def test_should_score_a_longer_history_higher_than_a_shorter_one(self):
        short = series_from([5.0] * 6 + [5.1, 5.2, 5.0, 5.1, 5.2, 5.0, 6.0])
        long = series_from([5.0] * 40 + [5.1, 5.2, 5.0, 5.1, 5.2, 5.0, 6.0])

        short_signal = detect_record_extreme(short)
        long_signal = detect_record_extreme(long)

        assert short_signal is not None and long_signal is not None
        assert long_signal.score > short_signal.score


# ---------------------------------------------------------------------------
# Streaks
# ---------------------------------------------------------------------------
class TestStreak:
    def test_should_signal_on_consecutive_rises(self):
        # Deltas: -0.2, +0.1, +0.2, +0.2, +0.3, +0.3 — a trailing run of five.
        series = series_from([5.0, 4.8, 4.9, 5.1, 5.3, 5.6, 5.9])

        signal = detect_streak(series)

        assert signal is not None
        assert signal.fields["streak_length"] == 5
        assert signal.fields["streak_start_value"] == 4.8
        assert signal.context["direction"] == "rising"

    def test_should_stay_silent_on_two_consecutive_moves(self):
        # Two in a row is a coin landing the same way twice, not a trend.
        series = series_from([5.0, 5.4, 5.2, 5.3, 5.5])

        assert detect_streak(series) is None

    def test_should_fire_exactly_at_the_minimum_length_and_not_below(self):
        three = series_from([5.0, 5.1, 5.2, 5.3])
        two = series_from([5.0, 4.9, 5.1, 5.2])

        assert detect_streak(three, min_length=3) is not None
        assert detect_streak(two, min_length=3) is None

    def test_should_treat_an_unchanged_period_as_breaking_the_streak(self):
        series = series_from([5.0, 5.1, 5.2, 5.3, 5.3])

        assert detect_streak(series) is None

    def test_should_score_a_longer_streak_higher(self):
        short = series_from([5.0, 5.1, 5.2, 5.3])
        long = series_from([5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8])

        assert detect_streak(long).score > detect_streak(short).score  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# Threshold crossings
# ---------------------------------------------------------------------------
class TestThresholdCross:
    zero = Threshold(name="zero-price", value=0.0, weight=0.95, unit_label="EUR/MWh")
    hundred = Threshold(name="€100/MWh", value=100.0, weight=0.45, unit_label="EUR/MWh")

    def test_should_signal_when_the_series_crosses_into_negative_prices(self):
        series = series_from([40.0, 22.5, -3.4], metric="day_ahead_power_price", section="energy")

        signal = detect_threshold_cross(series, [self.zero])

        assert signal is not None
        assert signal.context["threshold_name"] == "zero-price"
        assert signal.context["direction"] == "downward"

    def test_should_stay_silent_when_both_readings_are_the_same_side(self):
        # Sitting above €100 for a fortnight is a steady state, not a crossing.
        series = series_from([140.0, 155.0, 149.0], metric="day_ahead_power_price", section="energy")

        assert detect_threshold_cross(series, [self.hundred]) is None

    def test_should_stay_silent_when_no_thresholds_are_configured(self):
        series = series_from([40.0, -3.4], metric="day_ahead_power_price", section="energy")

        assert detect_threshold_cross(series, []) is None

    def test_should_weight_the_zero_crossing_above_the_hundred_crossing(self):
        negative = series_from([40.0, -3.4], metric="day_ahead_power_price", section="energy")
        expensive = series_from([95.0, 104.0], metric="day_ahead_power_price", section="energy")

        zero_signal = detect_threshold_cross(negative, [self.zero])
        hundred_signal = detect_threshold_cross(expensive, [self.hundred])

        assert zero_signal.score > hundred_signal.score  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# Cross-country divergence
# ---------------------------------------------------------------------------
class TestDivergence:
    @staticmethod
    def _group(lv, ee, lt):
        return {
            "LV": series_from(lv, geography="LV"),
            "EE": series_from(ee, geography="EE"),
            "LT": series_from(lt, geography="LT"),
        }

    def test_should_signal_when_one_country_breaks_away(self):
        group = self._group(
            lv=[6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 9.5],
            ee=[6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0],
            lt=[6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 6.1],
        )

        signal = detect_divergence(group)

        assert signal is not None
        assert signal.geography == "Baltic"
        assert signal.context["highest_geography"] == "LV"
        assert signal.fields["spread_vs_typical"] > 2.0

    def test_should_stay_silent_when_the_countries_move_together(self):
        group = self._group(
            lv=[6.0, 6.2, 6.4, 6.6, 6.8, 7.0, 7.2, 7.4],
            ee=[6.1, 6.3, 6.5, 6.7, 6.9, 7.1, 7.3, 7.5],
            lt=[5.9, 6.1, 6.3, 6.5, 6.7, 6.9, 7.1, 7.3],
        )

        assert detect_divergence(group) is None

    def test_should_stay_silent_when_countries_are_habitually_far_apart(self):
        # A metric where LT always sits well above LV must not generate the same
        # "divergence" story every single period.
        group = self._group(
            lv=[4.0, 4.1, 4.0, 4.1, 4.0, 4.1, 4.0, 4.1],
            ee=[6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 6.1],
            lt=[9.0, 9.1, 9.0, 9.1, 9.0, 9.1, 9.0, 9.1],
        )

        assert detect_divergence(group) is None

    def test_should_stay_silent_with_only_two_countries(self):
        group = {
            "LV": series_from([6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 9.5], geography="LV"),
            "EE": series_from([6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0], geography="EE"),
        }

        assert detect_divergence(group) is None

    def test_should_stay_silent_when_periods_do_not_overlap(self):
        group = {
            "LV": series_from([6.0] * 8, geography="LV", periods=monthly_periods(8, start_year=2020)),
            "EE": series_from([9.0] * 8, geography="EE", periods=monthly_periods(8, start_year=2024)),
            "LT": series_from([7.0] * 8, geography="LT", periods=monthly_periods(8, start_year=2025)),
        }

        assert detect_divergence(group) is None


# ---------------------------------------------------------------------------
# Structural divergence — sustained and widening
# ---------------------------------------------------------------------------
class TestStructuralDivergence:
    """The slow story that ``detect_divergence`` is built to ignore.

    Latvia's services surplus and Lithuania's were within a few hundred million
    euro of one another in 2010 and eight billion apart by 2025. No quarter in
    that run was remarkable on its own, which is exactly why the spread-based
    detector cannot see it — and why this one exists.
    """

    @staticmethod
    def _group(lv, ee, lt, *, metric="services_balance", chart_ref=None):
        periods = quarterly_periods(len(lv))
        return {
            geo: series_from(
                values,
                geography=geo,
                periods=periods,
                metric=metric,
                metric_label="the services balance",
                unit="million EUR",
                section="trade",
                frequency="quarterly",
                chart_ref=chart_ref,
            )
            for geo, values in (("LV", lv), ("EE", ee), ("LT", lt))
        }

    #: A gap that opens early and compounds: LV flat, LT climbing away.
    @staticmethod
    def _widening(n=24):
        return (
            [300 + 8 * i for i in range(n)],
            [340 + 10 * i for i in range(n)],
            [250 + 95 * i for i in range(n)],
        )

    # -- fires ---------------------------------------------------------------
    def test_should_signal_when_a_gap_opens_and_keeps_widening(self):
        lv, ee, lt = self._widening()

        signal = detect_structural_divergence(self._group(lv, ee, lt))

        assert signal is not None
        assert signal.detector == "structural_divergence"
        assert signal.geography == "Baltic"
        assert signal.context["highest_geography"] == "LT"
        assert signal.context["lowest_geography"] == "LV"
        assert signal.context["direction"] == "widening"
        assert signal.fields["widening_ratio"] > 1.5

    def test_should_report_how_long_the_ordering_has_held(self):
        # "Structural" is a claim about duration, so the duration is counted
        # and published rather than implied by the detector's name.
        lv, ee, lt = self._widening()

        signal = detect_structural_divergence(self._group(lv, ee, lt))

        assert signal is not None
        assert signal.fields["sustained_periods"] >= 8

    def test_should_signal_when_the_ordering_has_inverted(self):
        # The strongest form: the country now furthest ahead used to be behind.
        signal = detect_structural_divergence(
            self._group(
                lv=[1000.0] * 24,
                ee=[700.0] * 24,
                lt=[400 + 70 * i for i in range(24)],
            )
        )

        assert signal is not None
        assert signal.context["direction"] == "inverted"
        assert signal.fields["early_gap"] < 0

    def test_should_not_report_a_ratio_across_a_sign_change(self):
        # Dividing a positive gap by the negative one it grew out of yields a
        # number that reads like a measurement and means nothing. Better to
        # omit the field than to hand the writer a figure it cannot interpret.
        signal = detect_structural_divergence(
            self._group(
                lv=[1000.0] * 24,
                ee=[700.0] * 24,
                lt=[400 + 70 * i for i in range(24)],
            )
        )

        assert signal is not None
        assert "widening_ratio" not in signal.fields

    # -- stays silent --------------------------------------------------------
    def test_should_stay_silent_on_a_one_off_break(self):
        # One country jumps in the final quarter only. That is a real story and
        # it belongs to detect_divergence; claiming it is structural would be
        # false.
        signal = detect_structural_divergence(
            self._group(
                lv=[6.0] * 24,
                ee=[6.1] * 24,
                lt=[6.0] * 23 + [20.0],
            )
        )

        assert signal is None

    def test_should_stay_silent_when_the_gap_is_converging(self):
        # The laggard is catching up. Reporting a closing gap as divergence
        # would invert the finding.
        signal = detect_structural_divergence(
            self._group(
                lv=[200 + 40 * i for i in range(24)],
                ee=[1200.0] * 24,
                lt=[2000.0] * 24,
            )
        )

        assert signal is None

    def test_should_stay_silent_when_the_gap_is_wide_but_flat(self):
        # The case that most needs suppressing: three countries permanently far
        # apart are not news for being far apart today. Only movement is.
        signal = detect_structural_divergence(
            self._group(
                lv=[400.0] * 24,
                ee=[1200.0] * 24,
                lt=[2400.0] * 24,
            )
        )

        assert signal is None

    def test_should_stay_silent_when_the_ordering_keeps_swapping(self):
        # Values straddling zero produce enormous relative gaps from nothing.
        # A stable ordering is what separates a structural gap from noise, and
        # this is the fixture that proves the ordering test carries that weight.
        signal = detect_structural_divergence(
            self._group(
                lv=[1.0, -1.0] * 12,
                ee=[-1.0, 1.0] * 12,
                lt=[0.5, -0.5] * 12,
            )
        )

        assert signal is None

    def test_should_stay_silent_when_the_gap_is_small_against_the_level(self):
        # Constructed so that only the magnitude floor can reject it: the gap
        # grows more than fivefold, the ordering is stable, and the history is
        # long -- but 460 on a level of 10,000 is not a divergence.
        signal = detect_structural_divergence(
            self._group(
                lv=[10000.0] * 24,
                ee=[10100.0] * 24,
                lt=[10000 + 20 * i for i in range(24)],
            )
        )

        assert signal is None

    def test_should_stay_silent_when_history_is_too_short(self):
        # Twelve quarters cannot establish that anything is structural.
        lv, ee, lt = self._widening(n=12)

        assert detect_structural_divergence(self._group(lv, ee, lt)) is None

    def test_should_stay_silent_with_only_two_countries(self):
        lv, ee, lt = self._widening()
        group = self._group(lv, ee, lt)
        del group["EE"]

        assert detect_structural_divergence(group) is None

    # -- contracts -----------------------------------------------------------
    def test_should_carry_the_chart_ref_so_the_reader_can_check_it(self):
        # The signal must carry the dashboard's chart id, taken from the series,
        # not the metric name. A chart_ref of "services_balance_something" that
        # the API cannot serve renders a "Live data" frame with nothing in it,
        # which is the failure test_chart_ref_contract.py exists to prevent.
        lv, ee, lt = self._widening()
        group = self._group(lv, ee, lt, chart_ref="services_balance")

        signal = detect_structural_divergence(group)

        assert signal is not None
        assert signal.chart_ref == "services_balance"

    def test_should_count_in_quarters_not_bare_periods(self):
        # "across the first 8 periods" names no unit of time; the desk rejected
        # two live articles for exactly that hedge. See test_basis_declarable.
        lv, ee, lt = self._widening()

        signal = detect_structural_divergence(self._group(lv, ee, lt))

        assert signal is not None
        assert "quarters" in signal.comparison_basis
        assert "periods" not in signal.comparison_basis

    def test_answers_a_different_question_from_plain_divergence(self):
        # The justification for a second detector, asserted rather than argued.
        #
        # These are not looser and stricter versions of one another. A
        # single-quarter break is divergence's story and emphatically not a
        # structural one, so the two disagree outright on that shape. On a
        # decade-long trend they may both speak, but only one of them can say
        # how long it has run or how much it has grown -- and without those two
        # facts the finding is just a spread, which is what left this story
        # untold.
        one_off = self._group(lv=[6.0] * 24, ee=[6.1] * 24, lt=[6.0] * 23 + [20.0])

        assert detect_divergence(one_off) is not None
        assert detect_structural_divergence(one_off) is None

        lv, ee, lt = self._widening()
        sustained = self._group(lv, ee, lt)
        structural = detect_structural_divergence(sustained)

        assert structural is not None
        assert structural.fields["sustained_periods"] >= 8
        assert structural.fields["widening_ratio"] > 1.5
        # Whatever plain divergence makes of the same series, it has no field
        # for duration and none for growth against the start of the record.
        plain = detect_divergence(sustained)
        assert plain is None or (
            "sustained_periods" not in plain.fields and "widening_ratio" not in plain.fields
        )


# ---------------------------------------------------------------------------
# Seasonal deviation
# ---------------------------------------------------------------------------
class TestSeasonalDeviation:
    @staticmethod
    def _five_augusts(final: float):
        # One observation per August, five years running.
        periods = [f"{year}-08" for year in range(2021, 2026)] + ["2026-08"]
        values = [18.0, 18.4, 17.8, 18.2, 18.1, final]
        return series_from(
            values,
            periods=periods,
            metric="mean_air_temperature",
            metric_label="mean air temperature",
            unit="°C",
            section="environment",
        )

    def test_should_signal_when_the_reading_is_far_from_the_seasonal_normal(self):
        signal = detect_seasonal_deviation(self._five_augusts(23.5))

        assert signal is not None
        assert signal.context["direction"] == "above"
        assert signal.fields["baseline_years"] == 5
        assert "for the same" in signal.comparison_basis

    def test_should_stay_silent_on_a_routine_seasonal_reading(self):
        # 18.6 against Augusts of 17.8-18.4 is an ordinary summer.
        assert detect_seasonal_deviation(self._five_augusts(18.6)) is None

    def test_should_stay_silent_without_enough_prior_years(self):
        series = series_from(
            [18.0, 18.4, 25.0],
            periods=["2024-08", "2025-08", "2026-08"],
            metric="mean_air_temperature",
            unit="°C",
            section="environment",
        )

        assert detect_seasonal_deviation(series, min_years=3) is None

    def test_should_not_confuse_winter_with_summer(self):
        # A February reading must be judged against Februaries. With only one
        # prior February in the series there is no baseline, so nothing fires.
        periods = ["2024-02", "2024-08", "2025-02", "2025-08", "2026-08", "2026-02"]
        series = series_from(
            [-2.0, 18.0, -1.5, 18.4, 18.2, -1.8],
            periods=sorted(periods),
            metric="mean_air_temperature",
            unit="°C",
            section="environment",
        )

        signal = detect_seasonal_deviation(series)

        assert signal is None


# ---------------------------------------------------------------------------
# Sharp period-over-period moves
# ---------------------------------------------------------------------------
class TestSharpMove:
    def test_should_signal_on_a_jump_far_outside_the_series_own_volatility(self):
        series = series_from([50.0, 51.0, 50.5, 51.2, 50.8, 51.1, 50.9, 51.3, 50.7, 51.0, 78.0])

        signal = detect_sharp_move(series)

        assert signal is not None
        assert signal.fields["move_vs_typical"] > 2.5
        assert signal.context["direction"] == "up"

    def test_should_stay_silent_on_a_routine_wiggle_in_a_volatile_series(self):
        # Day-ahead power swings +-30 routinely. A 25-point move is a Tuesday,
        # and a magnitude-only detector would wrongly call it news.
        values = [40.0, 95.0, 30.0, 120.0, 25.0, 88.0, 35.0, 110.0, 28.0, 92.0, 117.0]
        series = series_from(
            values, metric="day_ahead_power_price", unit="EUR/MWh", section="energy"
        )

        assert detect_sharp_move(series) is None

    def test_should_stay_silent_when_the_move_is_statistically_large_but_trivially_small(self):
        # A metronomic series makes any wobble a huge z-score. The absolute floor
        # is what stops a 0.2% change becoming a headline.
        series = series_from([100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0,
                              100.0, 100.0, 100.0, 100.2])

        assert detect_sharp_move(series, min_abs_pct=1.0) is None

    def test_should_stay_silent_without_enough_history_to_judge_volatility(self):
        series = series_from([50.0, 51.0, 90.0])

        assert detect_sharp_move(series) is None

    def test_should_not_let_the_spike_inflate_its_own_yardstick(self):
        # A plain stdev would include the 78.0 jump and shrink its own z-score.
        # The robust sigma must keep it detectable.
        series = series_from([50.0, 51.0, 50.5, 51.2, 50.8, 51.1, 50.9, 51.3, 50.7, 51.0, 78.0])

        signal = detect_sharp_move(series)

        assert signal is not None
        assert signal.fields["typical_move"] < 2.0


# ---------------------------------------------------------------------------
# Signal invariants and orchestration
# ---------------------------------------------------------------------------
class TestSignalInvariants:
    def test_every_signal_names_its_comparison_basis(self):
        group = {
            "LV": series_from([6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 9.5], geography="LV"),
            "EE": series_from([6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0], geography="EE"),
            "LT": series_from([6.0, 6.1, 6.0, 6.1, 6.0, 6.1, 6.0, 6.1], geography="LT"),
        }

        signals = detect_all(list(group.values()))

        assert signals
        for produced in signals:
            assert produced.comparison_basis.strip()
            assert 0.0 <= produced.score <= 1.0
            assert produced.fields
            assert produced.sources

    def test_signal_ids_are_stable_across_repeated_detection(self):
        series = series_from([5.0, 5.2, 5.1, 5.4, 5.3, 5.5, 5.2, 5.4, 5.6, 5.3, 5.5, 5.4, 6.2])

        first = detect_record_extreme(series)
        second = detect_record_extreme(series)

        assert first is not None and second is not None
        assert first.id == second.id

    def test_a_flat_uneventful_series_produces_no_signals_at_all(self):
        # The quiet day. Nothing about this data warrants an article, and the
        # detectors must say so rather than reaching for something.
        flat = series_from([5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0])

        assert detect_all([flat]) == []

    def test_detect_all_tolerates_an_empty_series(self):
        empty = series_from([])

        assert detect_all([empty]) == []

    @pytest.mark.parametrize(
        "values",
        [
            [5.0, 5.1],
            [5.0],
            [],
        ],
    )
    def test_short_series_never_raise(self, values):
        assert detect_all([series_from(values)]) == []
