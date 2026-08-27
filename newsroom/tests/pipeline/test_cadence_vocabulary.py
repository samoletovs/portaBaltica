"""One cadence vocabulary, checked against the other place that holds it.

`_adjacent` decides whether two readings are one period apart, and looks the
step up in `_CADENCE_STEP`. A miss returns `True` — the check passes — which
is the correct default for a period *label* it cannot parse, and the wrong one
for a cadence it has simply never heard of.

`_READING_WORDS` in `series.py` holds the same vocabulary for a different job:
naming the unit in prose. **The two disagreed.** `_READING_WORDS` knew
`daily`, `_CADENCE_STEP` did not, and the collector carries two daily series —
Elering's day-ahead power price and its zone spread. So for those two the
contiguity check was switched off, silently, and a gapped run reported:

    four consecutive daily moves in the same direction, from 1 EUR/MWh
    in 2026-08-01

across an eighteen-day hole. That is the fault #150 was written to fix, still
live in the fix, for the one cadence the fix did not know about.

Session A found the identical shape on the dashboard within the hour: a
frequency missing from `MAX_AGE_MONTHS` falls through `|| 30` to the *annual*
allowance, so a new weekly series would be granted thirty months of staleness
before the freshness gate spoke. Their sentence for it:

    Nothing in a toolchain notices that a `Literal` grew a member and a
    `frozenset` did not.

Both are a vocabulary in two places with a lookup that fails open. The type
checker cannot see it, because neither is a type; the linter cannot, because
both are valid; and the suite could not, because nothing compared them.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS
from newsroom.pipeline.detect.detectors import _CADENCE_STEP, detect_streak
from newsroom.pipeline.detect.series import _READING_WORDS, Observation, TimeSeries
from newsroom.pipeline.models import SourceRef

SOURCE = SourceRef(source_id="elering", retrieved_at="2026-08-27T00:00:00Z")


def rising(periods: list[str], frequency: str) -> TimeSeries:
    return TimeSeries(
        metric="day_ahead_power_price",
        metric_label="day-ahead power price",
        geography="LV",
        unit="EUR/MWh",
        section="energy",
        frequency=frequency,
        source=SOURCE,
        observations=tuple(
            Observation(period=p, value=float(i))
            for i, p in enumerate(periods, start=1)
        ),
    )


class TestTheVocabulariesAgree:
    def test_every_named_cadence_has_a_step(self) -> None:
        """The gap that was live: `daily` was in one list and not the other."""
        missing = sorted(set(_READING_WORDS) - set(_CADENCE_STEP))

        assert not missing, (
            f"{missing} can be named in prose but has no step, so _adjacent "
            f"cannot tell whether two of its readings are consecutive and "
            f"passes them. The contiguity check is off for that cadence and "
            f"nothing says so."
        )

    def test_every_step_has_a_word(self) -> None:
        """The other direction: a step for a cadence prose cannot name."""
        missing = sorted(set(_CADENCE_STEP) - set(_READING_WORDS))

        assert not missing, (
            f"{missing} has a cadence step but no reading word, so a signal "
            f"would describe its window as 'readings' while the detector "
            f"treats it as a known cadence"
        )

    def test_every_frequency_in_use_is_in_both(self) -> None:
        """The registry is the third copy, and it is the one that matters."""
        in_use = {spec.frequency for spec in EUROSTAT_DATASETS}
        unknown = sorted(in_use - set(_CADENCE_STEP) - set(_READING_WORDS))

        assert not unknown, f"{unknown} is collected but named nowhere"

    def test_both_vocabularies_are_populated(self) -> None:
        """The companion: two empty dicts satisfy every assertion above."""
        assert len(_CADENCE_STEP) >= 5
        assert len(_READING_WORDS) >= 5


class TestADailySeriesIsCheckedLikeAnyOther:
    def test_a_gap_breaks_a_daily_run(self) -> None:
        """Five readings across twenty-two days, with eighteen missing."""
        gapped = rising(
            ["2026-08-01", "2026-08-02", "2026-08-20", "2026-08-21", "2026-08-22"],
            "daily",
        )

        assert detect_streak(gapped) is None

    def test_a_contiguous_daily_run_still_fires(self) -> None:
        """The companion. Without it the assertion above is satisfied by a
        detector that cannot read a date at all."""
        contiguous = rising(
            ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"],
            "daily",
        )

        signal = detect_streak(contiguous)

        assert signal is not None
        assert "four consecutive daily moves" in signal.comparison_basis

    def test_a_month_boundary_is_not_a_gap(self) -> None:
        """31 August to 1 September is one day, not a jump between months."""
        across = rising(
            ["2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"],
            "daily",
        )

        assert detect_streak(across) is not None

    @pytest.mark.parametrize(
        "frequency,periods",
        [
            ("monthly", ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]),
            ("quarterly", ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1"]),
            ("semi-annual", ["2024-S1", "2024-S2", "2025-S1", "2025-S2", "2026-S1"]),
            ("annual", ["2022", "2023", "2024", "2025", "2026"]),
        ],
    )
    def test_the_calendar_cadences_are_unaffected(
        self, frequency: str, periods: list[str]
    ) -> None:
        """Adding a second scale must not disturb the first."""
        assert detect_streak(rising(periods, frequency)) is not None
