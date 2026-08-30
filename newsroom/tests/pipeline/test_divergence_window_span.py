"""The divergence bases count qualifying periods, and must not imply a window.

Both divergence detectors draw their counts from `common` — the INTERSECTION of
periods across geographies — so a period missing in any one country drops for
all of them. `common` is therefore gappy in a way no single series is, and two
sentences were reading it as a calendar:

    "across the first 8 quarters of the series"      <- a POSITION
    "the 9 earlier years in the series"              <- the SERIES' contents

Neither survives a hole. Measured over the live corpus (288 series, 78
multi-country groups) three intersections are gapped enough to matter, worst
case `hourly_labour_cost`, whose first eight qualifying readings span
seventeen years. Neither detector fires on those groups today and no published
article is wrong, so this was latent — but `common[:window]` indexes a filtered
list BY POSITION, which is the case the repo's own rule calls dangerous.

The fixture below has a hole inside the first eight, so a detector that reads
`common` as a calendar states 8 where the truth is 18.
"""

from __future__ import annotations

from newsroom.pipeline.detect.detectors import (
    detect_divergence,
    detect_structural_divergence,
)
from newsroom.pipeline.detect.series import Observation, SourceRef, TimeSeries

#: Two quarters, a three-year hole, then eighteen contiguous quarters.
#: `common[:8]` therefore runs 2010-Q1 .. 2014-Q2 — eight readings, eighteen
#: calendar quarters.
GAPPED_QUARTERS = (
    ["2010-Q1", "2010-Q2"]
    + [f"2013-Q{q}" for q in (1, 2, 3, 4)]
    + [f"2014-Q{q}" for q in (1, 2, 3, 4)]
    + [f"{y}-Q{q}" for y in (2015, 2016, 2017) for q in (1, 2, 3, 4)]
)

CONTIGUOUS_QUARTERS = [
    f"{y}-Q{q}" for y in (2013, 2014, 2015, 2016, 2017) for q in (1, 2, 3, 4)
]


def _series(geo, periods, values):
    return TimeSeries(
        metric="unit_labour_cost",
        metric_label="unit labour cost",
        geography=geo,
        unit="index points",
        section="economy",
        observations=tuple(
            Observation(period=p, value=v) for p, v in zip(periods, values)
        ),
        frequency="quarterly",
        chart_ref=None,
        source=SourceRef(source_id="eurostat", retrieved_at="x", dataset="d", url="u"),
    )


def _group(periods):
    """LV highest throughout and pulling away, EE lowest, LT between."""
    n = len(periods)
    return {
        "LV": _series("LV", periods, [100.0 + i * 6.0 for i in range(n)]),
        "LT": _series("LT", periods, [75.0 for _ in range(n)]),
        "EE": _series("EE", periods, [50.0 for _ in range(n)]),
    }


def _spiked_group(periods):
    """A quiet history and one wide latest reading.

    `detect_divergence` compares the newest spread against the MEDIAN of the
    earlier ones, so the steadily-widening group above cannot fire it -- the
    median rises with the gap. This is the shape that does.
    """
    n = len(periods)
    return {
        "LV": _series("LV", periods, [100.0] * (n - 1) + [300.0]),
        "LT": _series("LT", periods, [75.0 for _ in range(n)]),
        "EE": _series("EE", periods, [50.0 for _ in range(n)]),
    }


class TestStructuralDivergenceDoesNotClaimAWindow:
    def test_names_the_range_its_early_readings_actually_span(self):
        signal = detect_structural_divergence(_group(GAPPED_QUARTERS))

        assert signal is not None, "fixture no longer fires; the assertions below are vacuous"
        basis = signal.comparison_basis

        # The eight earliest qualifying readings run 2010-Q1 to 2014-Q2.
        assert "from 2010-Q1 to 2014-Q2" in basis, basis

        # And it must not say those eight readings ARE the series' first eight
        # quarters. They span eighteen.
        assert "first 8 quarters of the series" not in basis, basis
        assert "the first 8" not in basis, basis

    def test_the_hole_is_real_so_the_old_wording_would_have_been_false(self):
        # Guards the fixture itself. If these periods ever became contiguous the
        # test above would keep passing while testing nothing.
        first_eight = GAPPED_QUARTERS[:8]
        assert len(first_eight) == 8
        y0, q0 = first_eight[0].split("-Q")
        y1, q1 = first_eight[-1].split("-Q")
        span = (int(y1) * 4 + int(q1)) - (int(y0) * 4 + int(q0)) + 1
        assert span == 18, f"fixture is no longer gapped: first 8 span {span}"

    def test_says_the_same_kind_of_thing_when_the_history_is_contiguous(self):
        # The control. A contiguous intersection must still name its range, so
        # the sentence has one shape rather than two.
        signal = detect_structural_divergence(_group(CONTIGUOUS_QUARTERS))

        assert signal is not None
        assert "from 2013-Q1 to 2014-Q4" in signal.comparison_basis
        assert "first 8 quarters of the series" not in signal.comparison_basis


class TestDivergenceAttributesItsCountToWhatAllCountriesReport:
    def test_does_not_credit_the_count_to_the_series(self):
        # `historical` holds only periods where every country reported, which
        # is fewer than the series has. "in the series" said the series had
        # that many.
        signal = detect_divergence(_spiked_group(GAPPED_QUARTERS))

        assert signal is not None, "fixture no longer fires; the assertion below is vacuous"
        basis = signal.comparison_basis
        assert "all of them report" in basis, basis
        assert "in the series" not in basis, basis
