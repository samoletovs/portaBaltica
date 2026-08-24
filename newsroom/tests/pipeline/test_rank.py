"""Ranking tests.

The property that matters most is negative: there must be no input for which
ranking invents work. A quiet day stays quiet.
"""

from __future__ import annotations

from newsroom.pipeline.config import RankingPolicy
from newsroom.pipeline.rank import rank
from newsroom.tests.pipeline.conftest import make_signal

POLICY = RankingPolicy(max_articles=8, min_score=0.55, max_per_metric=1)


def signals_scoring(*scores: float, metric: str = "unemployment_rate"):
    return [
        make_signal(score=score, metric=metric, geography=f"G{i}", value=float(i))
        for i, score in enumerate(scores)
    ]


class TestQualityFloor:
    def test_should_drop_every_signal_below_the_floor(self):
        report = rank(signals_scoring(0.9, 0.54, 0.2), POLICY)

        assert len(report.selected) == 1
        assert report.below_floor == 2

    def test_should_produce_nothing_when_no_signal_clears_the_floor(self):
        report = rank(signals_scoring(0.4, 0.3, 0.1), POLICY)

        assert report.selected == []
        assert report.quiet_day

    def test_should_produce_nothing_from_nothing(self):
        report = rank([], POLICY)

        assert report.selected == []
        assert report.considered == 0

    def test_should_include_a_signal_exactly_on_the_floor(self):
        report = rank(signals_scoring(0.55), POLICY)

        assert len(report.selected) == 1


class TestNoPadding:
    def test_a_quiet_day_produces_fewer_articles_than_a_busy_one(self):
        quiet = rank(signals_scoring(0.9), POLICY)
        busy = rank(signals_scoring(0.9, 0.88, 0.86, 0.84, 0.82), POLICY)

        assert len(quiet.selected) == 1
        assert len(busy.selected) == 5

    def test_should_never_return_more_signals_than_it_was_given(self):
        given = signals_scoring(0.9, 0.8)

        report = rank(given, POLICY)

        assert len(report.selected) <= len(given)

    def test_should_not_promote_a_below_floor_signal_when_capacity_is_free(self):
        # Seven slots go unused; the 0.4 signal must still not be written.
        report = rank(signals_scoring(0.9, 0.4), POLICY)

        assert len(report.selected) == 1
        assert all(s.score >= POLICY.min_score for s in report.selected)


class TestCapacityAndDeduplication:
    def test_should_cap_at_the_maximum(self):
        report = rank(signals_scoring(*[0.9] * 12), POLICY)

        assert len(report.selected) == 8
        assert report.over_capacity == 4

    def test_should_keep_only_the_strongest_signal_per_metric_and_geography(self):
        signals = [
            make_signal(score=0.9, detector="record_extreme", value=1.0),
            make_signal(score=0.7, detector="streak", value=2.0),
            make_signal(score=0.6, detector="sharp_move", value=3.0),
        ]

        report = rank(signals, POLICY)

        assert len(report.selected) == 1
        assert report.selected[0].detector == "record_extreme"
        assert report.deduplicated == 2

    def test_should_keep_the_same_metric_for_different_geographies(self):
        signals = [
            make_signal(score=0.9, geography="LV"),
            make_signal(score=0.85, geography="EE"),
        ]

        report = rank(signals, POLICY)

        assert len(report.selected) == 2

    def test_should_order_by_score_descending(self):
        report = rank(signals_scoring(0.6, 0.95, 0.75), POLICY)

        assert [s.score for s in report.selected] == [0.95, 0.75, 0.6]

    def test_should_break_score_ties_by_detector_strength(self):
        signals = [
            make_signal(score=0.8, detector="sharp_move", geography="LV"),
            make_signal(score=0.8, detector="record_extreme", geography="EE"),
        ]

        report = rank(signals, POLICY)

        assert report.selected[0].detector == "record_extreme"

    def test_ranking_is_deterministic_for_the_same_input(self):
        signals = signals_scoring(0.9, 0.9, 0.9, 0.8)

        first = [s.id for s in rank(signals, POLICY).selected]
        second = [s.id for s in rank(signals, POLICY).selected]

        assert first == second


class TestReport:
    def test_should_explain_why_the_wire_is_the_length_it_is(self):
        report = rank(signals_scoring(0.9, 0.8, 0.3), POLICY)

        summary = report.summary()
        assert "3 signal(s) considered" in summary
        assert "1 below the quality floor" in summary

    def test_quiet_day_is_flagged_below_three_articles(self):
        assert rank(signals_scoring(0.9, 0.8), POLICY).quiet_day
        assert not rank(signals_scoring(0.9, 0.8, 0.7), POLICY).quiet_day
