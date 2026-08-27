"""Eurostat publishes some series by semester, and the newsroom could not read one.

Electricity prices (`nrg_pc_204`, `nrg_pc_205`) and minimum wages
(`earn_mw_cur`) are labelled `2026-S1` and `2026-S2`. Nothing in the collector
read those cubes until the dashboard's definitions were mirrored, so no
semester label had ever reached the context builder.

`_period_span` returned `None` for them, and `None` is not inert. Its callers
treat an unparseable period as "no constraint":

    target = _period_span(period)
    if target is None:
        return series.observations[-1] if series.observations else None

So `_latest_at_or_before(series, "2026-S1")` would hand back the newest
observation in the series — 2026-S2, or a reading from any later year — and
the fact would be labelled with the period the caller asked for rather than
the one the value belongs to. That is the "companion presented as
contemporaneous" hazard the label machinery exists to prevent, arriving
through a period the parser could not read rather than through a period it
read correctly.

Semesters are unambiguous: S1 is January to June, S2 is July to December.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.context import (
    _latest_at_or_before,
    _months_between,
    _period_span,
    _period_start_month,
)
from newsroom.pipeline.detect.series import Observation, TimeSeries, reading_word
from newsroom.pipeline.models import SourceRef

SOURCE = SourceRef(source_id="eurostat", retrieved_at="2026-08-27T00:00:00Z")


def prices(*periods: str) -> TimeSeries:
    return TimeSeries(
        metric="elec_price_household",
        metric_label="household electricity price",
        geography="LV",
        unit="EUR per kWh",
        section="energy",
        frequency="semi-annual",
        source=SOURCE,
        observations=tuple(
            Observation(period=p, value=float(i)) for i, p in enumerate(periods, start=1)
        ),
    )


class TestASemesterIsAPeriod:
    @pytest.mark.parametrize("label", ["2026-S1", "2026-S2", "2026s1", "2026S2"])
    def test_it_parses(self, label: str) -> None:
        assert _period_span(label) is not None

    def test_the_first_half_is_january_to_june(self) -> None:
        from datetime import date

        start, end = _period_span("2026-S1")

        assert start == date(2026, 1, 1).toordinal()
        assert end == date(2026, 6, 30).toordinal()

    def test_the_second_half_is_july_to_december(self) -> None:
        from datetime import date

        start, end = _period_span("2026-S2")

        assert start == date(2026, 7, 1).toordinal()
        assert end == date(2026, 12, 31).toordinal()

    def test_the_halves_do_not_overlap_and_cover_the_year(self) -> None:
        first, second, year = (
            _period_span("2026-S1"),
            _period_span("2026-S2"),
            _period_span("2026"),
        )

        assert first[1] + 1 == second[0]
        assert (first[0], second[1]) == year

    def test_it_has_a_place_on_the_month_scale(self) -> None:
        """Used for coarse age comparisons, so it has to be ordered."""
        assert _period_start_month("2026-S1") < _period_start_month("2026-S2")
        assert _months_between("2026-S2", "2026-S1") == 6


class TestTheParserRefusesToGuess:
    """`None` means "no constraint" downstream, so it must not be reached here."""

    def test_a_reading_from_a_later_semester_is_not_offered_as_an_earlier_one(
        self,
    ) -> None:
        series = prices("2025-S1", "2025-S2", "2026-S1", "2026-S2")

        found = _latest_at_or_before(series, "2025-S2")

        assert found is not None
        assert found.period == "2025-S2", (
            "an unparseable period falls through to the newest observation, "
            "which would label a 2026 price as a 2025 one"
        )

    def test_the_newest_is_still_returned_when_it_qualifies(self) -> None:
        series = prices("2025-S1", "2025-S2", "2026-S1")

        assert _latest_at_or_before(series, "2026-S2").period == "2026-S1"

    def test_a_semester_resolves_inside_a_year(self) -> None:
        """An annual finding may legitimately draw on a semester reading."""
        series = prices("2025-S1", "2025-S2", "2026-S1")

        assert _latest_at_or_before(series, "2025").period == "2025-S2"


class TestTheProseHasAWordForIt:
    def test_a_semester_is_not_called_a_reading(self) -> None:
        """`reading_word` falls back to "readings", which is safe and vague.

        The docstring on that function is explicit that vagueness is the fault
        it exists to prevent: a reader cannot tell 119 days from 119 semesters,
        and neither can the writer, so it hedges and the desk refuses it.
        """
        assert reading_word("semi-annual", 1) == "semester"
        assert reading_word("semi-annual", 4) == "semesters"
