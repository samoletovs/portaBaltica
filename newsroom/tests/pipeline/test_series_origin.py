"""The series' origin is the series', not the window's.

WHAT WAS WRONG
--------------
Every Eurostat definition was fetched with `lastTimePeriod`, so the oldest
observation in hand was where the newsroom started looking. `context.py`
nonetheless labelled it "where this series begins", labelled the window's
length "how many readings this series contains in total", and emitted
"This is the highest reading anywhere in the series" from a window comparison.

Measured 2026-08-30 across sixteen live definitions:

    window start != true series start        15 of 16   (94%)
    first COORDINATE is not first READING    10 of 16   (63%)

Eight published articles stated a record the full series contradicts. Two more
were true by luck -- word-for-word the same sentence, correct only because the
cube's real extreme happened to fall inside the window -- which is why no prose
guard could separate them.

WHAT THIS FILE PINS
-------------------
1. the origin is the first NON-NULL reading FOR THAT GEOGRAPHY, not the first
   time coordinate the cube offers, and not another country's first reading;
2. the detectors still see exactly the last `periods` readings, so detection
   behaviour is unchanged by this;
3. `_placement` reads the origin rather than the window;
4. with no origin, `_placement` says NOTHING rather than saying it about the
   window under the series' name.
"""

from __future__ import annotations

from newsroom.pipeline.collect.opendata import (
    EurostatDataset,
    parse_jsonstat,
    request_params,
)
from newsroom.pipeline.detect.series import Observation, origin_of


def payload(*, periods, values_by_geo, geos=("LV", "EE")):
    """A JSON-stat cube. `values_by_geo` may carry None for a missing reading."""
    flat = {}
    n_time = len(periods)
    for gi, geo in enumerate(geos):
        for ti, value in enumerate(values_by_geo[geo]):
            if value is not None:
                flat[str(gi * n_time + ti)] = value
    return {
        "id": ["geo", "time"],
        "size": [len(geos), n_time],
        "dimension": {
            "geo": {"category": {"index": {g: i for i, g in enumerate(geos)}}},
            "time": {"category": {"index": {p: i for i, p in enumerate(periods)}}},
        },
        "value": flat,
        "updated": "2026-08-30T00:00:00+0200",
    }


def spec(periods=3):
    return EurostatDataset(
        dataset="test_ds",
        metric="test_metric",
        metric_label="test metric",
        unit="%",
        section="labour",
        params={},
        periods=periods,
    )


class TestTheOriginComesFromTheWholeSeries:
    def test_leading_coordinates_with_no_reading_are_not_the_origin(self):
        """THE 63% CASE, and the one that makes this more than a one-liner.

        Ten of sixteen live cubes offer time coordinates with no data at the
        front. `sts_inpp_m` offers 1976-01 and Lithuania's first reading is
        1998-02, so taking the dimension's first key would publish an origin
        wrong by twenty-two years -- and more authoritative-looking than the
        window boundary it replaced.

        MUTATION THIS CATCHES: reading the first key of the time dimension, or
        the first index position, instead of the first observation that exists.
        """
        p = payload(
            periods=["2020", "2021", "2022", "2023", "2024"],
            values_by_geo={
                "LV": [None, None, 5.0, 6.0, 7.0],
                "EE": [1.0, 2.0, 3.0, 4.0, 5.0],
            },
        )
        by_geo = {
            s.geography: s
            for s in parse_jsonstat(p, spec(periods=2), retrieved_at="t", url="u")
        }

        assert by_geo["LV"].origin.first_period == "2022"
        assert by_geo["LV"].origin.first_value == 5.0
        assert by_geo["LV"].origin.total_observations == 3
        # CONTROL: the geography that DOES start at the first coordinate, read
        # the same way, so a probe that simply never finds a leading null is
        # distinguishable from one that skips them correctly.
        assert by_geo["EE"].origin.first_period == "2020"
        assert by_geo["EE"].origin.total_observations == 5

    def test_each_geography_gets_its_own_origin(self):
        """MUTATION THIS CATCHES: computing one origin for the cube and giving
        it to every country, which would tell a reader Latvia's series begins
        where Estonia's does."""
        p = payload(
            periods=["2020", "2021", "2022", "2023"],
            values_by_geo={"LV": [None, 2.0, 3.0, 4.0], "EE": [9.0, 8.0, 7.0, 6.0]},
        )
        by_geo = {
            s.geography: s
            for s in parse_jsonstat(p, spec(periods=2), retrieved_at="t", url="u")
        }

        assert by_geo["LV"].origin.first_period == "2021"
        assert by_geo["EE"].origin.first_period == "2020"
        assert by_geo["LV"].origin.first_value != by_geo["EE"].origin.first_value

    def test_the_origin_survives_the_window(self):
        """The window is applied AFTER the origin is taken. If it were applied
        first the origin would be the window's, which is the whole defect."""
        p = payload(
            periods=[f"20{n:02d}" for n in range(10, 20)],
            values_by_geo={
                "LV": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0],
                "EE": [1.0] * 10,
            },
        )
        lv = next(
            s for s in parse_jsonstat(p, spec(periods=3), retrieved_at="t", url="u")
            if s.geography == "LV"
        )

        assert lv.periods == ("2017", "2018", "2019"), "the detectors' window moved"
        assert lv.origin.first_period == "2010"
        assert lv.origin.total_observations == 10
        assert len(lv.observations) == 3

    def test_the_counts_are_over_the_series_not_the_window(self):
        """The published defect, reduced: a reading that leads its window and
        does not lead its series.

        MUTATION THIS CATCHES: computing `higher`/`lower` from
        `series.observations`, which is what produced eight false records.
        """
        p = payload(
            periods=[f"20{n:02d}" for n in range(10, 20)],
            # 9.0 at the end leads the last three readings and is beaten by
            # four earlier ones.
            values_by_geo={
                "LV": [20.0, 19.0, 18.0, 17.0, 1.0, 2.0, 3.0, 4.0, 5.0, 9.0],
                "EE": [1.0] * 10,
            },
        )
        lv = next(
            s for s in parse_jsonstat(p, spec(periods=3), retrieved_at="t", url="u")
            if s.geography == "LV"
        )

        assert lv.origin.higher == 4, "four earlier readings beat it"
        assert max(o.value for o in lv.observations) == 9.0, (
            "it does lead the window, which is why the old code called it a record"
        )
        assert lv.origin.prior_high_value == 20.0
        assert lv.origin.prior_high_period == "2010"


class TestDetectionIsUnchanged:
    """Condition 1: the detectors must see exactly what they saw before.

    Before this change the collector sent `lastTimePeriod=N` and used every
    observation returned. Now it fetches everything and keeps the last N. Those
    are the same readings, and this asserts it rather than assuming it.
    """

    def test_the_window_is_the_last_n_readings(self):
        p = payload(
            periods=[f"20{n:02d}" for n in range(10, 20)],
            values_by_geo={"LV": list(range(10)), "EE": [0.0] * 10},
        )
        for n in (1, 2, 5, 9, 10):
            lv = next(
                s for s in parse_jsonstat(p, spec(periods=n), retrieved_at="t", url="u")
                if s.geography == "LV"
            )
            assert len(lv.observations) == n
            assert lv.observations[-1].period == "2019"
            assert [o.value for o in lv.observations] == [
                float(v) for v in range(10 - n, 10)
            ]

    def test_a_window_larger_than_the_series_keeps_everything(self):
        p = payload(
            periods=["2020", "2021", "2022"],
            values_by_geo={"LV": [1.0, 2.0, 3.0], "EE": [1.0, 2.0, 3.0]},
        )
        lv = next(
            s for s in parse_jsonstat(p, spec(periods=99), retrieved_at="t", url="u")
            if s.geography == "LV"
        )

        assert len(lv.observations) == 3

    def test_the_request_no_longer_bounds_the_periods(self):
        """MUTATION THIS CATCHES: restoring `lastTimePeriod`, which silently
        makes every origin the window's again while every test above still
        passes -- they call the parser directly and never see the request.
        """
        params = dict(request_params(spec(periods=40)))

        assert "lastTimePeriod" not in params

    def test_no_two_definitions_collide_on_a_key_without_the_bound(self):
        """The bound was part of the cache key. Removing it could in principle
        make two definitions indistinguishable to the cache, which is how five
        articles once published one metric's figures under another's name."""
        from newsroom.pipeline.collect.httpclient import _cache_key
        from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS
        from newsroom.pipeline.safety import registry

        endpoint = registry().get("eurostat").endpoint
        keys: dict[str, str] = {}
        for definition in EUROSTAT_DATASETS:
            key = _cache_key(
                endpoint.format(dataset=definition.dataset), request_params(definition)
            )
            assert key not in keys, (
                f"{definition.metric} and {keys[key]} are now the same request"
            )
            keys[key] = definition.metric


class TestOriginOf:
    def test_it_declines_below_three_observations(self):
        """`_placement` has the same floor: a "record" over two readings is not
        a fact about a series."""
        assert origin_of([Observation("2024", 1.0), Observation("2025", 2.0)]) is None

    def test_it_counts_the_rest_of_the_series_against_the_latest(self):
        origin = origin_of(
            [
                Observation("2020", 5.0),
                Observation("2021", 1.0),
                Observation("2022", 9.0),
                Observation("2023", 3.0),
            ]
        )

        assert origin.higher == 2 and origin.lower == 1
        assert origin.total_observations == 4
        assert origin.first_period == "2020" and origin.first_value == 5.0
        assert origin.prior_high_value == 9.0 and origin.prior_high_period == "2022"
        assert origin.prior_low_value == 1.0 and origin.prior_low_period == "2021"


class TestReplacingObservationsDropsTheOrigin:
    """`higher` and `lower` are counted against the latest observation, so they
    are only true for the set they were computed with. A stale placement is
    worse than none, because a consumer cannot tell it is stale."""

    def test_it_does(self):
        from newsroom.tests.pipeline.conftest import series_from

        original = series_from([1.0, 2.0, 3.0, 9.0])
        assert original.origin is not None

        replaced = original.replace_observations(
            [Observation("2030", 1.0), Observation("2031", 2.0)]
        )

        assert replaced.origin is None


class TestPlacementReadsTheOriginNotTheWindow:
    """Condition 3: all three placement claims, including the two NOTES.

    The notes are the half that actually published -- verbatim, in eight of the
    thirteen articles that carried one -- and they are the half a numeric gate
    cannot see, because they are digit-free by design and therefore exempt from
    `no_invented_numbers` and `figures_traceable`.
    """

    @staticmethod
    def _pack(series):
        from newsroom.pipeline.context import build_context

        from newsroom.tests.pipeline.conftest import make_signal

        signal = make_signal(
            metric=series.metric,
            metric_label=series.metric_label,
            geography=series.geography,
            period=series.observations[-1].period,
        )
        return build_context(signal, [series])

    @staticmethod
    def _windowed(values, keep, **kw):
        """A series whose window leads and whose full history does not."""
        from newsroom.pipeline.detect.series import Observation, TimeSeries, origin_of

        from newsroom.tests.pipeline.conftest import series_from

        whole = series_from(values, **kw)
        observations = whole.observations[-keep:]
        return TimeSeries(
            metric=whole.metric,
            metric_label=whole.metric_label,
            geography=whole.geography,
            unit=whole.unit,
            section=whole.section,
            observations=observations,
            source=whole.source,
            frequency=whole.frequency,
            chart_ref=whole.chart_ref,
            origin=origin_of(whole.observations),
        )

    def test_the_record_note_is_not_emitted_for_a_window_leader(self):
        """The published defect, end to end.

        20.0 leads the last three readings and is beaten by two earlier ones,
        so "This is the highest reading anywhere in the series" is false.

        MUTATION THIS CATCHES: `_placement` reading `series.observations` for
        its counts, which is what shipped.
        """
        series = self._windowed([99.0, 50.0, 1.0, 2.0, 20.0], keep=3)
        notes = self._pack(series).observations

        assert not any("highest reading anywhere" in n for n in notes), notes
        # CONTROL: a genuine series record DOES get the note, so the assertion
        # above is a reading rather than a check that no note is ever emitted.
        genuine = self._windowed([1.0, 2.0, 3.0, 4.0, 99.0], keep=3)
        assert any(
            "highest reading anywhere in the series" in n
            for n in self._pack(genuine).observations
        )

    def test_the_rank_note_counts_over_the_series(self):
        """"only a handful ... this is the Nth on record" was the wording that
        published `lithuania-s-construction-output` as fourth-highest when it
        is fourteenth. The rank must be the series' rank."""
        series = self._windowed([9.0, 8.0, 1.0, 2.0, 3.0, 6.0], keep=4)
        notes = self._pack(series).observations

        assert any("third-highest on record" in n for n in notes), notes
        assert not any("highest reading anywhere" in n for n in notes)

    def test_readings_in_series_counts_the_series(self):
        """The window holds three readings; the series holds five.

        The fixture is chosen so the count does not collide with a signal
        field: `_without_collisions` drops any context fact whose value another
        verified field already justifies, which is correct and would otherwise
        make this assertion look like a defect in the origin.
        """
        series = self._windowed([11.0, 2.0, 3.0, 4.0, 5.0], keep=3)
        pack = self._pack(series)

        readings = next(
            f for f in pack.of_kind("placement") if f.field == "readings_in_series"
        )
        assert readings.value == 5, "it counted the window, not the series"
        assert len(series.observations) == 3, "the window really is smaller"

    def test_series_start_value_is_the_series_start(self):
        series = self._windowed([11.0, 2.0, 3.0, 4.0, 5.0], keep=3)
        pack = self._pack(series)

        start = next(
            f for f in pack.of_kind("placement") if f.field == "series_start_value"
        )
        assert start.value == 11.0, "it reported the window's first reading"
        assert "2020" in start.label or start.period, start.label

    def test_previous_record_comes_from_the_series(self):
        """A previous record drawn from the window is the same lie one step
        removed -- and it is the figure a reader is most likely to check."""
        series = self._windowed([50.0, 1.0, 2.0, 3.0, 99.0], keep=3)
        pack = self._pack(series)

        prior = next(
            f for f in pack.of_kind("placement") if f.field == "previous_record"
        )
        assert prior.value == 50.0, "it named the window's runner-up"


class TestWithoutAnOriginPlacementSaysNothing:
    """Absence resolves to silence, not to a window-scoped fact wearing a
    series-scoped label. Elering is a rolling 120 days and genuinely has no
    full history."""

    def test_no_placement_facts_and_no_notes(self):
        from newsroom.tests.pipeline.conftest import series_from

        series = series_from([1.0, 2.0, 3.0, 99.0], origin=None)
        pack = TestPlacementReadsTheOriginNotTheWindow._pack(series)

        assert [f.field for f in pack.of_kind("placement")] == []
        assert not any("in the series" in n for n in pack.observations)

    def test_the_control_shows_the_same_series_WOULD_speak(self):
        """Otherwise the assertion above passes for a series that says nothing
        for some unrelated reason, and proves nothing about the origin."""
        from newsroom.tests.pipeline.conftest import series_from

        with_origin = series_from([1.0, 2.0, 3.0, 99.0])
        pack = TestPlacementReadsTheOriginNotTheWindow._pack(with_origin)

        assert [f.field for f in pack.of_kind("placement")] != []
        assert any("highest reading anywhere" in n for n in pack.observations)
