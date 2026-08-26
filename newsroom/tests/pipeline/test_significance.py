"""The measurement floor, tested against the story that motivated it.

The first test reconstructs a real published article. On 2026-08-24 the wire ran
"Estonia's Unemployment Rate Declines to 6.6% in June 2026" off a one-tenth move
in a Labour Force Survey estimate. If the gate is removed, weakened, or made
score-sensitive, that test fails — which is the point. Every test here is
written so it fails when the *requirement* is unmet, not merely when the code is
edited.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.detect.series import Observation, TimeSeries
from newsroom.pipeline.models import Signal, SourceRef
from newsroom.pipeline.significance import (
    DIFFERENCE_FIELD,
    NOT_A_MOVEMENT,
    UnknownDetector,
    assess,
    difference_of,
    floor_for,
    gate,
    publication_floor,
)

SOURCE = SourceRef(source_id="eurostat", retrieved_at="2026-08-24T10:00:00Z")


def series(
    values, *, metric="unemployment_rate", geography="EE", unit="%", label="unemployment rate"
) -> TimeSeries:
    return TimeSeries(
        metric=metric,
        metric_label=label,
        geography=geography,
        unit=unit,
        section="labour",
        observations=tuple(
            Observation(period=f"2026-{i + 1:02d}", value=v) for i, v in enumerate(values)
        ),
        source=SOURCE,
        frequency="monthly",
    )


def signal(detector: str, fields: dict, *, metric="unemployment_rate", geography="EE") -> Signal:
    return Signal(
        detector=detector,
        metric=metric,
        metric_label="unemployment rate",
        geography=geography,
        period="2026-06",
        value=6.6,
        unit="%",
        comparison_basis="the previous reading",
        score=0.9,
        section="labour",
        fields=fields,
        sources=[SOURCE],
    )


class TestTheStoryThatShouldNotHaveRun:
    """Estonia's unemployment rate, June 2026, down one tenth of a point."""

    def test_a_one_tenth_move_in_a_survey_rate_is_not_a_decline(self) -> None:
        lfs = series([6.9, 6.8, 6.8, 6.7, 6.7, 6.6])
        finding = signal("sharp_move", {"latest_value": 6.6, "previous_value": 6.7, "change": -0.1})

        verdict = assess(finding, lfs)

        assert not verdict.material, (
            "a 0.1pp move in a Labour Force Survey estimate was reported as a decline; "
            "the gate must refuse it"
        )
        assert "Labour Force Survey" in verdict.reason

    def test_a_high_score_does_not_buy_a_way_past_the_floor(self) -> None:
        # The whole hazard is a quiet day promoting an unmeasurable move.
        lfs = series([6.9, 6.8, 6.8, 6.7, 6.7, 6.6])
        finding = signal("sharp_move", {"latest_value": 6.6, "previous_value": 6.7, "change": -0.1})
        object.__setattr__(finding, "score", 1.0)

        assert not assess(finding, lfs).material

    def test_a_move_that_clears_the_floor_still_runs(self) -> None:
        lfs = series([6.9, 6.8, 6.8, 6.7, 6.7, 5.9])
        finding = signal("sharp_move", {"latest_value": 5.9, "previous_value": 6.7, "change": -0.8})

        assert assess(finding, lfs).material, "0.8pp is a real move and must not be suppressed"


class TestPublicationResolution:
    def test_the_floor_is_read_off_the_data_not_asserted(self) -> None:
        assert publication_floor([6.6, 6.7, 6.8]).value == pytest.approx(0.1)
        assert publication_floor([1.25, 1.30]).value == pytest.approx(0.01)
        assert publication_floor([100.0, 101.0]).value == pytest.approx(1.0)

    def test_the_coarsest_reading_sets_the_precision(self) -> None:
        # One unrounded value must not license claims the rest cannot support.
        assert publication_floor([6.6, 6.75]).value == pytest.approx(0.01)

    def test_a_computed_difference_finer_than_the_printed_series_is_refused(self) -> None:
        prices = series([100.0, 101.0, 102.0], metric="house_prices", unit="index")
        finding = signal(
            "sharp_move",
            {"latest_value": 102.0, "previous_value": 101.0, "change": 0.4},
            metric="house_prices",
        )

        verdict = assess(finding, prices)

        assert not verdict.material
        assert "decimal place" in verdict.reason

    def test_the_survey_floor_wins_only_when_it_is_the_larger(self) -> None:
        lfs = series([6.6, 6.7])
        assert floor_for(lfs).kind == "survey"

        coarse = series([7.0, 8.0], metric="unemployment_rate")
        assert floor_for(coarse).kind == "publication", (
            "a survey floor below the printed precision would be a guard that never binds"
        )


class TestEveryDetectorIsAccountedFor:
    """The gate must not become exempt-by-default when a detector is added."""

    def test_an_unregistered_detector_raises_rather_than_passing(self) -> None:
        finding = signal("brand_new_detector", {"latest_value": 6.6, "change": 0.01})

        with pytest.raises(UnknownDetector, match="brand_new_detector"):
            difference_of(finding)

    def test_a_registered_detector_missing_its_field_raises(self) -> None:
        finding = signal("sharp_move", {"latest_value": 6.6})

        with pytest.raises(UnknownDetector, match="change"):
            difference_of(finding)

    def test_every_shipped_detector_is_registered_or_named_exempt(self) -> None:
        from newsroom.pipeline.detect import detectors

        shipped = {
            name.removeprefix("detect_")
            for name in dir(detectors)
            if name.startswith("detect_") and name != "detect_all"
        }
        accounted = set(DIFFERENCE_FIELD) | set(NOT_A_MOVEMENT)

        assert shipped <= accounted, (
            f"detector(s) {sorted(shipped - accounted)} would bypass the measurement "
            f"floor; register them in DIFFERENCE_FIELD or NOT_A_MOVEMENT"
        )

    @pytest.mark.parametrize(
        "detector,fields",
        [
            ("record_extreme", {"latest_value": 6.6, "margin": 0.05}),
            ("streak", {"latest_value": 6.6, "cumulative_change": 0.05}),
            ("threshold_cross", {"latest_value": 6.6, "distance_from_threshold": 0.05}),
            ("seasonal_deviation", {"latest_value": 6.6, "deviation": 0.05}),
            ("sharp_move", {"latest_value": 6.6, "change": 0.05}),
        ],
    )
    def test_no_detector_can_smuggle_a_sub_floor_move_through(self, detector, fields) -> None:
        lfs = series([6.6, 6.7, 6.8])

        assert not assess(signal(detector, fields), lfs).material, (
            f"{detector} reported a 0.05pp move in a survey series"
        )

    def test_a_cross_country_spread_is_exempt_by_name(self) -> None:
        spread = signal("divergence", {"latest_value": 70.2})

        assert difference_of(spread) is None
        assert assess(spread, series([6.6, 6.7])).material


class TestTheGate:
    def test_it_separates_kept_from_suppressed(self) -> None:
        lfs = series([6.9, 6.8, 6.7, 6.6])
        noise = signal("sharp_move", {"latest_value": 6.6, "previous_value": 6.7, "change": -0.1})
        real = signal(
            "sharp_move",
            {"latest_value": 5.6, "previous_value": 6.7, "change": -1.1},
            geography="LV",
        )
        lv = series([6.9, 6.8, 6.7, 5.6], geography="LV")

        report = gate([noise, real], [lfs, lv])

        assert report.kept == [real]
        assert [s for s, _ in report.suppressed] == [noise]
        assert "below it" in report.summary()

    def test_a_signal_with_no_matching_series_is_kept(self) -> None:
        # Losing a real finding to a bookkeeping mismatch is the worse failure.
        orphan = signal("sharp_move", {"latest_value": 6.6, "change": -0.1}, metric="mystery")

        assert gate([orphan], []).kept == [orphan]
