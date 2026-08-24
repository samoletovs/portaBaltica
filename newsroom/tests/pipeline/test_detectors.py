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
    detect_threshold_cross,
)
from newsroom.tests.pipeline.conftest import monthly_periods, series_from


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
