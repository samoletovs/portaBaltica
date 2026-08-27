"""`detect_sharp_move` counted readings and named them in the cadence.

The sentence it produced was:

    against a typical quarterly move of 1.96 thousand tonnes
    over the preceding 14 quarters

`len(deltas)` is a count of moves between *readings*. Naming them "quarters"
asserts that the readings are one quarter apart, which is the same claim
`detect_streak` made about consecutive months and false in the same way.

I reported this to the manager as a theoretical exposure I could not
demonstrate: my fixture did not fire, and the companion check showed it did not
fire contiguously either, so the fixture was dull rather than the code safe.
Session A then supplied the shape that made it testable -- **Estonia filed no
vessel statistics at all in 2024**, checked across every one of the 25 x 14 x 2
combinations `mar_tf_qm` offers: 486 non-null cells in 2023, 494 in 2025, zero
in 2024. A series of that shape spans nineteen quarters across fifteen
readings, and the sentence understated the window by five.

The fix is not a new idea. `detect_record_extreme` in the same file already
words its basis "across N observations since <period>" -- it counts
observations, says observations, and names where the window starts. True at any
cadence, and it survives a hole. This is the third detector today to be brought
back to a pattern that was already sitting beside it.

Naming the start period also makes the sentence strictly more informative than
the cadence word was: a reader learns when the comparison window opens rather
than having to multiply.
"""

from __future__ import annotations

import random

from newsroom.pipeline.detect.detectors import detect_sharp_move
from newsroom.pipeline.detect.series import Observation, TimeSeries
from newsroom.pipeline.models import SourceRef

SOURCE = SourceRef(source_id="eurostat", retrieved_at="2026-08-27T00:00:00Z")

#: Sixteen readings: gentle noise, then a jump large enough to fire. Seeded so
#: the fixture is the same one every run -- an unseeded fixture that sometimes
#: fails to fire would make an absence assertion meaningless.
def _values() -> list[float]:
    rng = random.Random(7)
    return [100 + rng.uniform(-1.5, 1.5) for _ in range(15)] + [140.0]


CONTIGUOUS = [f"{2022 + i // 4}-Q{i % 4 + 1}" for i in range(16)]

#: Estonia's real shape: every quarter of one year absent, data either side.
HOLED = [
    p
    for p in (f"{2021 + i // 4}-Q{i % 4 + 1}" for i in range(20))
    if not p.startswith("2024")
]


def series(periods: list[str]) -> TimeSeries:
    return TimeSeries(
        metric="port_goods_throughput",
        metric_label="container throughput",
        geography="EE",
        unit="thousand tonnes",
        section="maritime",
        frequency="quarterly",
        source=SOURCE,
        observations=tuple(
            Observation(period=p, value=v) for p, v in zip(periods, _values())
        ),
    )


class TestTheBasisDoesNotClaimACadence:
    def test_a_holed_series_does_not_name_a_span_it_does_not_cover(self) -> None:
        """Fifteen readings across nineteen quarters, not fourteen quarters."""
        signal = detect_sharp_move(series(HOLED))

        assert signal is not None
        assert "quarters" not in signal.comparison_basis

    def test_it_counts_readings_and_says_readings(self) -> None:
        signal = detect_sharp_move(series(HOLED))

        assert "14 readings" in signal.comparison_basis

    def test_it_names_where_the_window_opens(self) -> None:
        """The holed series starts in 2021, the contiguous one in 2022.

        Naming the start is what makes the sentence true without a cadence
        word, and it is strictly more informative than one.
        """
        assert "since 2021-Q1" in detect_sharp_move(series(HOLED)).comparison_basis
        assert (
            "since 2022-Q1" in detect_sharp_move(series(CONTIGUOUS)).comparison_basis
        )


class TestTheFixtureCanFire:
    """The companion. Both assertions above are satisfied by a detector that
    never fires, and my first attempt at measuring this failed exactly that
    way: no signal, on either a holed or a contiguous series, which I nearly
    read as evidence the holed case was safe."""

    def test_the_contiguous_series_produces_a_signal(self) -> None:
        assert detect_sharp_move(series(CONTIGUOUS)) is not None

    def test_the_holed_series_produces_a_signal(self) -> None:
        assert detect_sharp_move(series(HOLED)) is not None

    def test_a_flat_series_does_not(self) -> None:
        """And the detector is still capable of declining."""
        flat = TimeSeries(
            metric="port_goods_throughput",
            metric_label="container throughput",
            geography="EE",
            unit="thousand tonnes",
            section="maritime",
            frequency="quarterly",
            source=SOURCE,
            observations=tuple(
                Observation(period=p, value=100.0) for p in CONTIGUOUS
            ),
        )

        assert detect_sharp_move(flat) is None
