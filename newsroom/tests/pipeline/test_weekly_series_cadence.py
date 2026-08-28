"""A weekly series is checked like any other — and the year boundary is not a gap.

``test_cadence_vocabulary.py`` records why this file has to exist: a frequency
present in one vocabulary and absent from the other makes ``_adjacent`` return
``True`` by default, so the contiguity check is switched off for that cadence
and nothing says so. ``daily`` was in ``_READING_WORDS`` and not in
``_CADENCE_STEP``, and a gapped run of power prices reported "four consecutive
daily moves" across an eighteen-day hole.

``weekly`` arrives with the same exposure and one hazard the calendar cadences
do not have. **An ISO week label is not a number you can subtract.**
``2026-W01`` follows ``2025-W52``; subtracting the suffixes gives -51, so a run
crossing new year reads as a hole and every streak spanning the turn of the
year is dropped. A 53-week ISO year — 2020, 2026 — puts the same off-by-one one
week earlier.

That failure is silent in the direction that matters: the detector produces no
signal, which is indistinguishable from a series with nothing to say.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, request_params
from newsroom.pipeline.detect.detectors import (
    _CADENCE_STEP,
    _period_weeks,
    detect_streak,
)
from newsroom.pipeline.detect.series import _READING_WORDS, Observation, TimeSeries, reading_word
from newsroom.pipeline.models import SourceRef

SOURCE = SourceRef(source_id="eurostat", retrieved_at="2026-08-28T00:00:00Z")


def rising(periods: list[str], frequency: str = "weekly") -> TimeSeries:
    return TimeSeries(
        metric="weekly_deaths",
        metric_label="weekly deaths",
        geography="LV",
        unit="deaths a week",
        section="environment",
        frequency=frequency,
        source=SOURCE,
        observations=tuple(
            Observation(period=p, value=float(400 + 10 * i))
            for i, p in enumerate(periods, start=1)
        ),
    )


class TestTheWeekOrdinalCountsWeeks:
    def test_a_new_year_is_one_step(self) -> None:
        """The whole reason this is not `int(label[-2:])`."""
        assert _period_weeks("2026-W01") - _period_weeks("2025-W52") == 1

    def test_a_fifty_three_week_year_is_one_step_too(self) -> None:
        """2020 has 53 ISO weeks. An implementation assuming 52 is off here."""
        assert _period_weeks("2021-W01") - _period_weeks("2020-W53") == 1
        assert _period_weeks("2020-W53") - _period_weeks("2020-W52") == 1

    def test_ordinary_weeks_are_one_step(self) -> None:
        """The control: without it every assertion above is satisfied by a
        function that returns a constant."""
        assert _period_weeks("2026-W28") - _period_weeks("2026-W27") == 1
        assert _period_weeks("2026-W28") - _period_weeks("2026-W24") == 4

    @pytest.mark.parametrize(
        "label", ["2026-07", "2026-Q2", "2026", "2026-08-28", "W28", "2026-W00", "2026-W54", ""]
    )
    def test_it_refuses_anything_that_is_not_a_week(self, label: str) -> None:
        assert _period_weeks(label) is None


class TestAWeeklySeriesIsCheckedLikeAnyOther:
    def test_the_cadence_has_a_step(self) -> None:
        assert _CADENCE_STEP["weekly"] == ("week", 1)

    def test_it_can_be_named_in_prose(self) -> None:
        assert reading_word("weekly", 1) == "week"
        assert reading_word("weekly", 4) == "weeks"
        # The fallback it would otherwise have taken. A reader cannot tell four
        # readings from four weeks, and neither could the writer.
        assert reading_word("weekly", 4) != "readings"

    def test_both_vocabularies_carry_it(self) -> None:
        assert "weekly" in _CADENCE_STEP
        assert "weekly" in _READING_WORDS

    def test_a_contiguous_run_fires_and_names_its_unit(self) -> None:
        signal = detect_streak(
            rising(["2026-W24", "2026-W25", "2026-W26", "2026-W27", "2026-W28"])
        )

        assert signal is not None
        assert "four consecutive weekly moves" in signal.comparison_basis

    def test_a_gap_breaks_a_run(self) -> None:
        """Five readings across fourteen weeks, with nine missing.

        Reading order hides this: the observations are consecutive rows and a
        detector counting rows would report four consecutive weekly moves over
        a quarter of a year.
        """
        gapped = rising(["2026-W14", "2026-W15", "2026-W26", "2026-W27", "2026-W28"])

        assert detect_streak(gapped) is None

    def test_a_new_year_is_not_a_gap(self) -> None:
        """The failure the ordinal exists to prevent, at the detector level.

        Under suffix subtraction this run contains a -51 step and is silently
        dropped — no signal, no log line, nothing to notice.
        """
        across = rising(["2025-W50", "2025-W51", "2025-W52", "2026-W01", "2026-W02"])

        assert detect_streak(across) is not None

    def test_a_fifty_three_week_year_is_not_a_gap_either(self) -> None:
        across = rising(["2020-W51", "2020-W52", "2020-W53", "2021-W01", "2021-W02"])

        assert detect_streak(across) is not None

    @pytest.mark.parametrize(
        "frequency,periods",
        [
            ("daily", ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]),
            ("monthly", ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]),
            ("quarterly", ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1"]),
            ("semi-annual", ["2024-S1", "2024-S2", "2025-S1", "2025-S2", "2026-S1"]),
            ("annual", ["2022", "2023", "2024", "2025", "2026"]),
        ],
    )
    def test_the_other_cadences_are_unaffected(
        self, frequency: str, periods: list[str]
    ) -> None:
        """Adding a third scale must not disturb the first two."""
        assert detect_streak(rising(periods, frequency)) is not None


class TestTheWireHasACadenceItDidNotHave:
    """Why any of this was worth doing.

    Every Eurostat series here was monthly or slower, so a daily run consumed
    each release on the first run after it landed and found nothing until the
    next. The 08-27 ranking logged 49 of 50 signals already published and wrote
    zero articles, and called it a quiet day. Depth cannot help — measured
    across 18 indicator/country pairs, a longer window changed the verdict on
    the latest observation zero times — so the only lever is cadence.
    """

    def test_something_on_the_wire_publishes_weekly(self) -> None:
        weekly = [s for s in EUROSTAT_DATASETS if s.frequency == "weekly"]

        assert [s.metric for s in weekly] == ["weekly_deaths"]
        assert weekly[0].dataset == "demo_r_mwk_ts"

    def test_it_is_the_fastest_thing_here(self) -> None:
        """The companion. If everything were weekly this would prove nothing —
        and if nothing were, the claim above would be about an empty set."""
        cadences = {s.frequency for s in EUROSTAT_DATASETS}

        assert "weekly" in cadences
        assert cadences - {"weekly"}, "there is nothing slower to be faster than"
        assert len([s for s in EUROSTAT_DATASETS if s.frequency == "weekly"]) == 1

    def test_it_pins_every_dimension_of_its_cube(self) -> None:
        """`demo_r_mwk_ts` carries freq, sex, unit, geo and time.

        `unit` holds one code today, so an unpinned query happens to return the
        right slice and reports no assumption. Pinning it means a second code
        appearing later is a visible change here rather than a silent choice in
        the response.
        """
        weekly = next(s for s in EUROSTAT_DATASETS if s.frequency == "weekly")

        assert weekly.params == {"sex": "T", "unit": "NR"}

    def test_it_asks_for_two_years_of_weeks(self) -> None:
        """Enough to compare a week against the same week a year earlier, which
        is the only comparison worth making on a mortality series."""
        weekly = next(s for s in EUROSTAT_DATASETS if s.frequency == "weekly")

        assert weekly.periods >= 104


class TestTheNewSpecsCannotCollide:
    """Three definitions on ``sts_cobp_q`` differing only in ``cpa2_1``.

    This is the shape that published a registrations figure under a bankruptcy
    headline: a cache key that misses the dimension two definitions differ in
    serves one metric's payload under the other's name, and every editorial
    gate passes because the figure is real and traceable to its own signal
    field.

    ``test_collect.py`` already asserts globally that no two specs collide.
    This is the local version, naming the group that made the question live
    again, and it reads ``request_params`` rather than restating what a key
    ought to contain.
    """

    def test_the_permit_composition_is_three_distinct_requests(self) -> None:
        permits = [s for s in EUROSTAT_DATASETS if s.dataset == "sts_cobp_q"]

        assert len(permits) == 3
        keys = {tuple(request_params(s)) for s in permits}
        assert len(keys) == 3, "two permit series would request identical data"

    def test_the_permit_composition_is_a_composition(self) -> None:
        """Residential plus non-residential are the halves of the total.

        Stated here so a future repin that quietly makes two of them the same
        segment fails, rather than producing three plausible lines that are
        arithmetically impossible together.
        """
        codes = {
            s.metric: s.params["cpa2_1"]
            for s in EUROSTAT_DATASETS
            if s.dataset == "sts_cobp_q"
        }

        assert codes == {
            "building_permits": "CPA_F41001_41002",
            "building_permits_residential": "CPA_F41001",
            "building_permits_non_residential": "CPA_F41002",
        }

    def test_no_permit_series_uses_the_empty_indicator_code(self) -> None:
        """``indic_bt=PSQM`` answers HTTP 200 and returns nothing.

        Measured 2026-08-28: zero observations across 42 quarters for LV, EE
        and LT. BPRM_SQM carries 106 of 106. An empty cube is indistinguishable
        from a quiet one without looking.
        """
        for spec in (s for s in EUROSTAT_DATASETS if s.dataset == "sts_cobp_q"):
            assert spec.params["indic_bt"] == "BPRM_SQM"

    def test_gas_is_priced_off_a_band_rather_than_the_total(self) -> None:
        """``TOT_GJ`` is the emptiest code in ``nrg_pc_202``, not the fullest.

        Measured across the twenty half-years to 2025-S2: LV=1, EE=1, LT=3
        observations, newest 2024-S1, while every consumption band carries 20
        and reaches 2025-S2.
        """
        gas = next(s for s in EUROSTAT_DATASETS if s.dataset == "nrg_pc_202")

        assert gas.params["nrg_cons"] != "TOT_GJ"
        assert gas.params["nrg_cons"] == "GJ20-199"
        # A band is not a total, and the label a writer puts in a sentence has
        # to say which consumer it describes.
        assert "medium consumer" in gas.metric_label
