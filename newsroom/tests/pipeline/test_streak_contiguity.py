"""A streak counts readings; it claims consecutive periods. Those differ.

``detect_streak`` walks backwards through the deltas between observations and
counts how many run in the same direction. It then states the result as a
comparison basis:

    four consecutive monthly moves in the same direction, from 1 % in 2026-01

Nothing checked that the readings were in consecutive *periods*. Five readings
dated January, February, August, September and October span ten months with a
five-month hole, and the sentence above asserts a contiguity the data does not
have. That is a claim about the world rather than a weak phrasing, so it is a
truth fault and the detector must not make it.

It reached the newsroom by mirroring: ``digital_skills`` is published every two
years (2021, 2023, 2025) and declared annual, because that is its cadence
between publications rather than between readings. It cannot fire today -- three
observations is below ``min_length + 1`` -- but the fourth reading arrives in
2027 and it would then have claimed four consecutive annual moves across six
years.

Nothing else in the pipeline could catch it. Liveness, freshness and the sanity
bands all read the tip of a series; this hole is in its body.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.detect.detectors import detect_streak
from newsroom.pipeline.detect.series import Observation, TimeSeries
from newsroom.pipeline.models import SourceRef

SOURCE = SourceRef(source_id="eurostat", retrieved_at="2026-08-27T00:00:00Z")


def rising(periods: list[str], frequency: str = "monthly") -> TimeSeries:
    """A series that rises at every reading, so only contiguity is in question."""
    return TimeSeries(
        metric="unemployment_rate",
        metric_label="unemployment rate",
        geography="LV",
        unit="%",
        section="labour",
        frequency=frequency,
        source=SOURCE,
        observations=tuple(
            Observation(period=p, value=float(i))
            for i, p in enumerate(periods, start=1)
        ),
    )


class TestAGapBreaksTheRun:
    def test_readings_across_a_hole_are_not_consecutive_months(self) -> None:
        gapped = rising(["2026-01", "2026-02", "2026-08", "2026-09", "2026-10"])

        assert detect_streak(gapped) is None

    def test_the_same_readings_without_the_hole_do_fire(self) -> None:
        """The companion: prove the fixture is a streak but for the gap."""
        contiguous = rising(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"])

        signal = detect_streak(contiguous)

        assert signal is not None
        assert "four consecutive monthly moves" in signal.comparison_basis

    def test_a_biennial_series_declared_annual_stays_silent(self) -> None:
        """`digital_skills`, and the reason this was found at all."""
        biennial = rising(["2019", "2021", "2023", "2025", "2027"], frequency="annual")

        assert detect_streak(biennial) is None

    def test_only_the_run_is_shortened_not_the_whole_series(self) -> None:
        """A hole early on must not silence a genuine run after it.

        Six readings: a gap between the second and third, then four contiguous
        months. The run after the hole is long enough on its own.
        """
        series = rising(
            ["2025-01", "2025-02", "2026-01", "2026-02", "2026-03", "2026-04"]
        )

        signal = detect_streak(series)

        assert signal is not None
        assert signal.fields["streak_length"] == 3.0
        assert "in 2026-01" in signal.comparison_basis


class TestEveryCadenceStillCounts:
    @pytest.mark.parametrize(
        "frequency,periods",
        [
            ("monthly", ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]),
            ("quarterly", ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1"]),
            ("semi-annual", ["2024-S1", "2024-S2", "2025-S1", "2025-S2", "2026-S1"]),
            ("annual", ["2022", "2023", "2024", "2025", "2026"]),
        ],
    )
    def test_a_contiguous_run_fires(self, frequency: str, periods: list[str]) -> None:
        """The check must not silence the detector it is protecting."""
        signal = detect_streak(rising(periods, frequency=frequency))

        assert signal is not None, f"{frequency} lost its streak"
        assert signal.fields["streak_length"] == 4.0

    def test_an_unrecognised_period_shape_does_not_silence_the_detector(self) -> None:
        """Fail towards the previous behaviour, not towards silence.

        A label the parser cannot read is a reason to stop checking
        contiguity, not a reason to suppress a finding -- silence is
        indistinguishable from a series with nothing to say.
        """
        odd = rising(["wk1", "wk2", "wk3", "wk4", "wk5"])

        assert detect_streak(odd) is not None
