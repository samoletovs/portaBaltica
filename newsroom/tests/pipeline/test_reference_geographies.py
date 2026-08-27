"""EU27 is a denominator, not a competitor.

"Latvian unemployment is a point above the EU average" is a story about
Latvia, and the EU figure is what makes it one. "EU unemployment hit a
four-year high" is somebody else's beat, filed by somebody with a Brussels
correspondent. This newsroom covers three countries and borrows the fourth
number to measure them against.

The distinction cannot be left to intention, because ``detect_all`` runs every
single-series detector over whatever it is handed and asks the same question
of each: *is this reading remarkable for this series?* That is a good question
about Latvia and an out-of-scope one about the EU aggregate. Collect EU27
without excluding it and the very first run produces EU records, EU streaks
and EU sharp moves — all true, all correctly traceable, and none of them ours.

So the split is enforced in one place, ``detect/series.py``, and the collector,
the detectors and the prose layer all read it from there.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.collect.opendata import BALTIC
from newsroom.pipeline.context import BALTIC_STATES
from newsroom.pipeline.detect.detectors import detect_all
from newsroom.pipeline.detect.series import (
    COLLECTED_GEOGRAPHIES,
    REFERENCE_GEOGRAPHIES,
    SUBJECT_GEOGRAPHIES,
    Observation,
    TimeSeries,
    is_reference,
)
from newsroom.pipeline.models import SourceRef

SOURCE = SourceRef(source_id="eurostat", retrieved_at="2026-08-27T00:00:00Z")

#: A shape no detector can ignore: two years of ordinary variation and then a
#: record spike. Fires `record_extreme` and `sharp_move`. If a series like this
#: produces nothing, it is because the geography was excluded, not because the
#: data was too dull to notice.
#:
#: The first draft of this fixture was ten flat readings and a spike, which
#: fires *nothing* — a flat run has no variance, so the sigma-based detectors
#: refuse it. `test_the_same_series_for_latvia_fires` caught that, which is
#: the entire reason it is written.
_NOISE = [
    6.1, 6.3, 6.0, 6.4, 6.2, 6.5, 6.1, 6.3, 6.2, 6.4, 6.0, 6.2,
    6.3, 6.1, 6.4, 6.2, 6.5, 6.3, 6.1, 6.2, 6.4, 6.3, 6.2, 6.1,
]
LOUD = tuple(
    Observation(period=f"{2024 + (i // 12)}-{(i % 12) + 1:02d}", value=value)
    for i, value in enumerate([*_NOISE, 9.8])
)


def series(geography: str) -> TimeSeries:
    return TimeSeries(
        metric="unemployment_rate",
        metric_label="Unemployment rate",
        geography=geography,
        unit="%",
        section="labour",
        observations=LOUD,
        source=SOURCE,
    )


class TestTheSplitIsOneDefinition:
    def test_the_eu_aggregate_is_a_reference(self) -> None:
        assert is_reference("EU27_2020")

    @pytest.mark.parametrize("geography", ["LV", "EE", "LT"])
    def test_a_baltic_state_is_not(self, geography: str) -> None:
        assert not is_reference(geography)

    def test_the_collector_asks_for_both(self) -> None:
        """Collected is subjects plus references, and nothing else."""
        assert COLLECTED_GEOGRAPHIES == SUBJECT_GEOGRAPHIES + REFERENCE_GEOGRAPHIES
        assert "EU27_2020" in COLLECTED_GEOGRAPHIES

    def test_no_geography_is_both(self) -> None:
        assert not set(SUBJECT_GEOGRAPHIES) & set(REFERENCE_GEOGRAPHIES)

    def test_every_copy_of_the_subject_list_agrees(self) -> None:
        """`opendata.BALTIC`, `context.BALTIC_STATES` and the detectors' own
        filter were three separate literals. Three copies of a rule are three
        chances to check the wrong one."""
        assert BALTIC == SUBJECT_GEOGRAPHIES
        assert BALTIC_STATES == SUBJECT_GEOGRAPHIES


class TestNothingIsDetectedOnAReference:
    def test_a_loud_eu_series_produces_no_signal(self) -> None:
        """The whole point. This series would fire several detectors."""
        signals = detect_all([series("EU27_2020")])

        assert signals == [], [s.detector for s in signals]

    def test_the_same_series_for_latvia_fires(self) -> None:
        """The negative control for the test above: prove the fixture is loud.

        Without this, `signals == []` is satisfied by a fixture too dull to
        detect anything, and the exclusion would be untested while looking
        proven.
        """
        signals = detect_all([series("LV")])

        assert signals, "the fixture is not loud enough to prove an exclusion"

    def test_a_reference_does_not_dilute_a_baltic_run(self) -> None:
        """Mixing the two is the ordinary case once collection includes EU27."""
        mixed = detect_all([series("LV"), series("EU27_2020")])

        assert mixed
        assert all(s.geography != "EU27_2020" for s in mixed)


class TestDivergenceCountsSubjectsOnly:
    def test_the_eu_is_not_a_fourth_country(self) -> None:
        """`detect_divergence` needs three geographies and compares spread.

        The EU aggregate sits inside the range of its own members by
        construction, so counting it as a fourth country both changes the
        spread and makes the resulting sentence false: "the gap between the
        Baltic states" would silently include a continent.
        """
        def at(geography: str, last: float) -> TimeSeries:
            return TimeSeries(
                metric="unemployment_rate",
                metric_label="Unemployment rate",
                geography=geography,
                unit="%",
                section="labour",
                observations=tuple(
                    Observation(
                        period=f"{2024 + (i // 12)}-{(i % 12) + 1:02d}",
                        value=last + (0.1 if i % 2 else 0.0),
                    )
                    for i in range(24)
                ),
                source=SOURCE,
            )

        signals = detect_all(
            [at("LV", 6.0), at("EE", 7.0), at("LT", 8.0), at("EU27_2020", 7.0)]
        )

        for signal in signals:
            reported = signal.fields.get("geographies")
            if reported is not None:
                assert "EU27_2020" not in reported
