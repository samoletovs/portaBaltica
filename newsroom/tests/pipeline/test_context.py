"""The context pack: what the newsroom already knows, made usable.

These tests protect two things that are easy to break and expensive to lose:

* the pack finds the peers and companions that turn a number into a story;
* it never introduces a value that collides with one already on the signal,
  because ``reconcile_figures`` refuses to declare an ambiguous numeral and the
  article is then rejected for the number it was given.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline import units
from newsroom.pipeline.context import (
    ContextPack,
    build_context,
    build_context_for,
    enrich_signal,
)
from newsroom.pipeline.write import prompts

from .conftest import make_signal, series_from


def labour_cost_series(geography: str, values, *, periods=None):
    return series_from(
        values,
        metric="hourly_labour_cost",
        metric_label="hourly labour cost",
        geography=geography,
        unit="EUR per hour",
        section="labour",
        frequency="annual",
        periods=periods or [str(year) for year in range(2018, 2018 + len(values))],
    )


LATVIA_YEARS = [str(y) for y in range(2018, 2026)]


@pytest.fixture
def baltic_labour_costs():
    """The real shape of the run that produced three shallow articles."""
    return [
        labour_cost_series("LV", [9.3, 9.9, 10.5, 11.2, 12.4, 13.8, 15.1, 16.3]),
        labour_cost_series("EE", [12.4, 13.0, 13.8, 14.9, 16.8, 18.4, 19.9, 21.1]),
        labour_cost_series("LT", [8.9, 9.6, 10.4, 11.5, 13.2, 15.0, 16.6, 17.8]),
    ]


@pytest.fixture
def labour_signal():
    return make_signal(
        detector="streak",
        metric="hourly_labour_cost",
        metric_label="hourly labour cost",
        geography="LV",
        period="2025",
        value=16.3,
        unit="EUR per hour",
        section="labour",
        comparison_basis="8 consecutive annual moves in the same direction, from 9.3 EUR per hour in 2018",
        fields={"latest_value": 16.3, "streak_start_value": 9.3, "cumulative_change": 7.0},
        context={"direction": "up"},
    )


# ── peers ───────────────────────────────────────────────────────────────


def test_the_pack_finds_the_neighbours(labour_signal, baltic_labour_costs):
    """The fact the wire had in memory and published three articles without."""
    pack = build_context(labour_signal, baltic_labour_costs)

    peers = {fact.field: fact.value for fact in pack.of_kind("peer")}
    assert peers == {"peer_ee": 21.1, "peer_lt": 17.8}


def test_the_pack_never_makes_the_subject_its_own_peer(labour_signal, baltic_labour_costs):
    """A guaranteed value collision, and it would break the article.

    ``peer_lv`` would equal ``latest_value``. Two verified fields justifying
    16.3 makes the numeral ambiguous, the reconciler declines to declare it, and
    the piece is rejected for a number the detector itself produced.
    """
    pack = build_context(labour_signal, baltic_labour_costs)

    assert all(fact.geography != "LV" for fact in pack.of_kind("peer"))


def test_the_ranking_observation_is_stated_in_words(labour_signal, baltic_labour_costs):
    """Rank is analysis a model cannot get wrong, so code writes it.

    It also carries no digits, which means the writer can state it without
    declaring a figure — the one kind of substance available to a paragraph
    that has no number to spend.
    """
    pack = build_context(labour_signal, baltic_labour_costs)

    assert any("lowest of the three Baltic states" in line for line in pack.observations)
    assert not any(any(ch.isdigit() for ch in line) for line in pack.observations)


def test_peers_are_skipped_for_a_geography_with_no_neighbours(baltic_labour_costs):
    signal = make_signal(
        metric="hourly_labour_cost",
        geography="Baltic",
        period="2025",
        value=18.4,
        unit="EUR per hour",
        section="labour",
        fields={"latest_value": 18.4},
    )

    assert build_context(signal, baltic_labour_costs).of_kind("peer") == ()


# ── companions ──────────────────────────────────────────────────────────


def test_the_pack_pulls_related_measures_for_the_same_economy(
    labour_signal, baltic_labour_costs
):
    """Labour cost against unemployment is what makes it a labour-market story."""
    unemployment = series_from(
        [7.4, 7.0, 6.6],
        metric="unemployment_rate",
        metric_label="unemployment rate",
        geography="LV",
        unit="%",
        section="labour",
        frequency="monthly",
        periods=["2025-04", "2025-05", "2025-06"],
    )
    pack = build_context(labour_signal, [*baltic_labour_costs, unemployment])

    companions = {fact.field: fact.value for fact in pack.of_kind("companion")}
    assert companions["companion_unemployment_rate"] == 6.6


def test_a_companion_never_comes_from_the_future(labour_signal, baltic_labour_costs):
    """A 2026 reading is not context for a 2025 finding, it is a contradiction."""
    unemployment = series_from(
        [6.6, 6.1],
        metric="unemployment_rate",
        geography="LV",
        unit="%",
        section="labour",
        periods=["2025-06", "2026-06"],
    )
    pack = build_context(labour_signal, [*baltic_labour_costs, unemployment])

    companion = next(f for f in pack.of_kind("companion") if "unemployment" in f.field)
    assert companion.value == 6.6
    assert companion.period == "2025-06"


def test_a_stale_companion_is_dropped(labour_signal, baltic_labour_costs):
    """Two years out of date is not context, it is noise with a label."""
    stale = series_from(
        [8.0],
        metric="unemployment_rate",
        geography="LV",
        unit="%",
        section="labour",
        periods=["2019-06"],
    )
    pack = build_context(labour_signal, [*baltic_labour_costs, stale])

    assert not any("unemployment" in fact.field for fact in pack.of_kind("companion"))


def test_a_companion_carries_its_own_period_in_its_label(
    labour_signal, baltic_labour_costs
):
    """Or the writer will present two different periods as simultaneous."""
    unemployment = series_from(
        [6.6],
        metric="unemployment_rate",
        geography="LV",
        unit="%",
        section="labour",
        periods=["2025-06"],
    )
    pack = build_context(labour_signal, [*baltic_labour_costs, unemployment])

    companion = next(f for f in pack.of_kind("companion") if "unemployment" in f.field)
    assert "2025-06" in companion.label


# ── placement and trajectory ────────────────────────────────────────────


def test_placement_records_how_long_the_series_is(labour_signal, baltic_labour_costs):
    pack = build_context(labour_signal, baltic_labour_costs)

    readings = next(f for f in pack.of_kind("placement") if f.field == "readings_in_series")
    assert readings.value == 8
    assert readings.unit is None, "a count of years is not a count of euros"


def test_a_record_high_names_the_reading_it_beat():
    series = series_from(
        [4.0, 9.0, 5.0, 6.0, 10.0],
        metric="house_prices",
        geography="LV",
        unit="index",
        section="property",
        periods=["2021", "2022", "2023", "2024", "2025"],
    )
    signal = make_signal(
        metric="house_prices",
        geography="LV",
        period="2025",
        value=10.0,
        unit="index",
        section="property",
        fields={"latest_value": 10.0},
    )
    pack = build_context(signal, [series])

    previous = next(f for f in pack.of_kind("placement") if f.field == "previous_record")
    assert previous.value == 9.0
    assert "2022" in previous.label
    assert any("highest reading" in line for line in pack.observations)


def test_trajectory_finds_the_same_point_in_earlier_years():
    """One year and five years back, on a series that is not monotonic."""
    series = labour_cost_series("LV", [9.3, 9.9, 10.5, 11.2, 12.4, 18.0, 15.1, 16.3])
    signal = make_signal(
        metric="hourly_labour_cost",
        geography="LV",
        period="2025",
        value=16.3,
        unit="EUR per hour",
        section="labour",
        fields={"latest_value": 16.3},
    )
    pack = build_context(signal, [series])

    trajectory = {fact.field: fact.value for fact in pack.of_kind("trajectory")}
    assert trajectory["value_one_year_earlier"] == 15.1
    assert trajectory["value_five_years_earlier"] == 10.5


def test_a_reading_that_is_both_the_record_and_last_year_is_named_once(
    labour_signal, baltic_labour_costs
):
    """In a series that only rises, those two facts are the same observation.

    Offering it twice under two field names is exactly the ambiguity the
    collision rule exists to prevent: the reconciler would decline to declare
    the numeral and the article would be rejected for it. One name is correct.
    """
    pack = build_context(labour_signal, baltic_labour_costs)

    named = [fact.field for fact in pack.facts if fact.value == 15.1]
    assert named == ["previous_record"]


# ── the collision rule ──────────────────────────────────────────────────


def test_a_context_value_that_the_signal_already_carries_is_dropped():
    """The failure this rule exists to prevent, in its exact original form.

    The streak detector emits ``streak_start_value = 9.3``. ``series_start_value``
    for the same series is also 9.3, because the streak runs the whole length of
    the series. Two fields justifying one numeral makes it ambiguous, and the
    article is rejected for a figure that was verified twice over.
    """
    series = labour_cost_series("LV", [9.3, 9.9, 10.5, 11.2, 12.4, 13.8, 15.1, 16.3])
    signal = make_signal(
        detector="streak",
        metric="hourly_labour_cost",
        geography="LV",
        period="2025",
        value=16.3,
        unit="EUR per hour",
        section="labour",
        fields={"latest_value": 16.3, "streak_start_value": 9.3},
    )

    pack = build_context(signal, [series])

    assert "series_start_value" not in pack.fields()
    assert 9.3 not in pack.fields().values()


def test_the_pack_is_internally_unique():
    """Two context facts sharing a value are as ambiguous as one clashing."""
    flat = series_from(
        [5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
        metric="hourly_labour_cost",
        geography="LV",
        unit="EUR per hour",
        section="labour",
        periods=[str(y) for y in range(2020, 2026)],
    )
    signal = make_signal(
        metric="hourly_labour_cost",
        geography="LV",
        period="2025",
        value=5.0,
        unit="EUR per hour",
        section="labour",
        fields={"latest_value": 5.0},
    )

    values = list(build_context(signal, [flat]).fields().values())
    assert len(values) == len(set(values))


# ── enrichment ──────────────────────────────────────────────────────────


def test_enrichment_puts_context_figures_where_the_validator_reads_them(
    labour_signal, baltic_labour_costs
):
    """The whole safety argument in one assertion.

    ``figures_traceable`` resolves ``signal_field`` against the signal payload,
    and ``Signal.to_json`` serialises ``fields``. A context figure that is not
    here is a number the writer can see and cannot legally cite.
    """
    pack = build_context(labour_signal, baltic_labour_costs)
    enriched = enrich_signal(labour_signal, pack)

    assert enriched.fields["peer_ee"] == 21.1
    assert enriched.to_json()["fields"]["peer_ee"] == 21.1
    # And nothing the detector established was displaced.
    assert enriched.fields["latest_value"] == 16.3


def test_enrichment_leaves_the_signal_identity_alone(labour_signal, baltic_labour_costs):
    """``Signal.id`` keys provenance and cross-run deduplication."""
    pack = build_context(labour_signal, baltic_labour_costs)

    assert enrich_signal(labour_signal, pack).id == labour_signal.id


def test_an_empty_pack_returns_the_signal_untouched(labour_signal):
    assert enrich_signal(labour_signal, ContextPack()) is labour_signal


def test_a_companion_is_not_labelled_with_the_subject_unit(
    labour_signal, baltic_labour_costs
):
    """An inflation rate beside a labour cost must not read as EUR per hour.

    This is ``units.py``'s original bug one namespace out: the figure table
    stamped ``signal.unit`` on every field, and published "3.18801 EUR/MWh
    higher than the typical spread" for a ratio.
    """
    inflation = series_from(
        [3.1],
        metric="hicp_annual_rate",
        metric_label="annual consumer price inflation (HICP)",
        geography="LV",
        unit="%",
        section="economy",
        periods=["2025-06"],
    )
    pack = build_context(labour_signal, [*baltic_labour_costs, inflation])
    enriched = enrich_signal(labour_signal, pack)

    label = units.label_for_field(
        "companion_hicp_annual_rate", enriched.unit, overrides=enriched.field_units
    )
    assert label == "%"
    assert "EUR per hour" in prompts._format_figures(enriched)
    assert "companion_hicp_annual_rate = 3.1   (%)" in prompts._format_figures(enriched)


# ── consistency between what the writer is shown twice ──────────────────


def test_the_prompt_shows_one_rendering_of_each_context_figure(
    labour_signal, baltic_labour_costs
):
    """The figure table and the context section must agree, digit for digit.

    ``Signal.__post_init__`` quantises to six significant figures, so a large
    value — a trade balance in millions — is ``1234567.89`` on the fact and
    ``1234570`` on the signal. Printing both invites the writer to declare the
    one the validator does not hold, and the article is rejected for a figure
    the pipeline showed it.
    """
    big = series_from(
        [1234567.89, 2234567.89],
        metric="services_balance",
        metric_label="the services balance",
        geography="EE",
        unit="million EUR",
        section="trade",
        frequency="quarterly",
        periods=["2025-Q3", "2025-Q4"],
    )
    own = series_from(
        [900000.0, 950000.0],
        metric="services_balance",
        metric_label="the services balance",
        geography="LV",
        unit="million EUR",
        section="trade",
        frequency="quarterly",
        periods=["2025-Q3", "2025-Q4"],
    )
    signal = make_signal(
        metric="services_balance",
        metric_label="the services balance",
        geography="LV",
        period="2025-Q4",
        value=950000.0,
        unit="million EUR",
        section="trade",
        fields={"latest_value": 950000.0},
    )
    pack = build_context(signal, [own, big])
    enriched = enrich_signal(signal, pack)

    table = prompts._format_figures(enriched)
    context = prompts._context_section(pack, enriched)

    peer = next(fact for fact in pack.of_kind("peer"))
    rendered = units.display_value(peer.field, float(enriched.fields[peer.field]))
    assert f"{peer.field} = {rendered}" in table
    assert f"{peer.field} = {rendered}" in context



    """No model, no clock, no network — so it is auditable like a detector."""
    first = build_context(labour_signal, baltic_labour_costs)
    second = build_context(labour_signal, baltic_labour_costs)

    assert first == second


# ── determinism ─────────────────────────────────────────────────────────


def test_the_pack_is_deterministic(labour_signal, baltic_labour_costs):
    """No model, no clock, no network — so it is auditable like a detector."""
    first = build_context(labour_signal, baltic_labour_costs)
    second = build_context(labour_signal, baltic_labour_costs)

    assert first == second


def test_build_context_for_keys_on_signal_id(labour_signal, baltic_labour_costs):
    packs = build_context_for([labour_signal], baltic_labour_costs)

    assert set(packs) == {labour_signal.id}


def test_period_labels_cover_every_fact(labour_signal, baltic_labour_costs):
    """Every period in the pack must be quotable, or the writer cannot date it."""
    pack = build_context(labour_signal, baltic_labour_costs)
    literals = prompts.allowed_numeric_literals(labour_signal, pack)

    for fact in pack.facts:
        if fact.period.isdigit():
            assert fact.period in literals


# ── period arithmetic across the four shapes ────────────────────────────


def test_a_daily_series_resolves_to_the_latest_day_not_the_first():
    """The bug: `2026-08-24` collapsed to its month, so every day of August
    shared one key and the selection kept the FIRST of them.

    Elering publishes power prices daily for all three Baltic states, so this
    fired on every power-price story: asked for the latest reading at the 24th
    the pack returned the 1st, in a market that moves several-fold within a
    month, and then labelled it "its latest reading".
    """
    daily = series_from(
        [51.0, 62.0, 74.0],
        metric="day_ahead_power_price",
        metric_label="day-ahead wholesale electricity price",
        geography="EE",
        unit="EUR/MWh",
        section="energy",
        frequency="daily",
        periods=["2026-08-01", "2026-08-12", "2026-08-24"],
    )
    own = series_from(
        [40.0, 45.0, 49.0],
        metric="day_ahead_power_price",
        metric_label="day-ahead wholesale electricity price",
        geography="LV",
        unit="EUR/MWh",
        section="energy",
        frequency="daily",
        periods=["2026-08-01", "2026-08-12", "2026-08-24"],
    )
    signal = make_signal(
        metric="day_ahead_power_price",
        metric_label="day-ahead wholesale electricity price",
        geography="LV",
        period="2026-08-24",
        value=49.0,
        unit="EUR/MWh",
        section="energy",
        fields={"latest_value": 49.0},
    )

    peer = next(f for f in build_context(signal, [own, daily]).of_kind("peer"))

    assert peer.value == 74.0
    assert peer.period == "2026-08-24"


def test_a_day_inside_the_target_month_still_counts_as_at_or_before():
    """Mixed frequencies must keep working: a daily reading is legitimate
    context for a monthly or annual finding in the same span."""
    daily = series_from(
        [10.0, 20.0],
        metric="day_ahead_power_price",
        geography="LV",
        unit="EUR/MWh",
        section="energy",
        frequency="daily",
        periods=["2026-06-02", "2026-06-28"],
    )
    monthly = series_from(
        [1.0, 2.0],
        metric="hicp_annual_rate",
        metric_label="annual consumer price inflation (HICP)",
        geography="LV",
        unit="%",
        section="economy",
        periods=["2026-05", "2026-06"],
    )
    signal = make_signal(
        metric="hicp_annual_rate",
        metric_label="annual consumer price inflation (HICP)",
        geography="LV",
        period="2026-06",
        value=2.0,
        unit="%",
        section="economy",
        fields={"latest_value": 2.0},
    )

    companions = {
        f.field: (f.value, f.period)
        for f in build_context(signal, [monthly, daily]).of_kind("companion")
    }

    assert companions["companion_day_ahead_power_price"] == (20.0, "2026-06-28")


def test_trajectory_is_exact_for_a_daily_series():
    daily = series_from(
        [30.0, 55.0],
        metric="day_ahead_power_price",
        geography="LV",
        unit="EUR/MWh",
        section="energy",
        frequency="daily",
        periods=["2025-08-24", "2026-08-24"],
    )
    signal = make_signal(
        metric="day_ahead_power_price",
        geography="LV",
        period="2026-08-24",
        value=55.0,
        unit="EUR/MWh",
        section="energy",
        fields={"latest_value": 55.0},
    )

    trajectory = {f.field: f.value for f in build_context(signal, [daily]).of_kind("trajectory")}

    assert trajectory["value_one_year_earlier"] == 30.0


# ── the ranking sentence, which no numeric check can reach ──────────────


def test_no_ranking_is_claimed_when_a_peer_reading_is_from_another_period():
    """The one claim in the pack that nothing downstream can verify.

    It is deliberately digit-free so the writer may state it without declaring
    a figure, which also means `no_invented_numbers` has nothing to bite on. So
    it must not be computed across periods: ranking Latvia's August price
    against Estonia's July one and printing "the highest of the three Baltic
    states" would publish a falsehood with no check able to catch it.
    """
    lagging = series_from(
        [9.0],
        metric="hourly_labour_cost",
        metric_label="hourly labour cost",
        geography="EE",
        unit="EUR per hour",
        section="labour",
        frequency="annual",
        periods=["2024"],
    )
    own = labour_cost_series("LV", [9.3, 16.3], periods=["2024", "2025"])
    signal = make_signal(
        metric="hourly_labour_cost",
        metric_label="hourly labour cost",
        geography="LV",
        period="2025",
        value=16.3,
        unit="EUR per hour",
        section="labour",
        fields={"latest_value": 16.3},
    )

    pack = build_context(signal, [own, lagging])

    # The figure is still offered, honestly labelled with its own period...
    peer = next(f for f in pack.of_kind("peer"))
    assert peer.period == "2024"
    assert "2024" in peer.label
    # ...but no ranking is asserted from it.
    assert not any("Baltic states" in line for line in pack.observations)


def test_a_ranking_is_claimed_when_every_peer_is_from_the_same_period(
    labour_signal, baltic_labour_costs
):
    """And the guard must not be so tight that the best sentence never fires."""
    pack = build_context(labour_signal, baltic_labour_costs)

    assert any("lowest of the three Baltic states" in line for line in pack.observations)
