"""National time-base indices cannot establish absolute country rankings."""

from __future__ import annotations

from dataclasses import replace

import pytest

from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, EurostatDataset, parse_jsonstat
from newsroom.pipeline.context import build_context, enrich_signal
from newsroom.pipeline.detect.detectors import (
    detect_divergence,
    detect_record_extreme,
    detect_structural_divergence,
)
from newsroom.pipeline.write.prompts import build_user_prompt
from newsroom.tests.pipeline.conftest import monthly_periods, quarterly_periods


NATIONAL_INDICES = {
    "building_permits", "building_permits_residential", "building_permits_non_residential",
    "business_registrations", "business_bankruptcies", "wages_mfg", "wages_it",
    "labour_productivity",
}


def parsed(spec, values):
    countries = tuple(values)
    count = len(next(iter(values.values())))
    periods = (
        [str(2000 + i) for i in range(count)] if spec.frequency == "annual"
        else quarterly_periods(count) if spec.frequency == "quarterly"
        else monthly_periods(count)
    )
    payload = {
        "id": ["geo", "time"], "size": [len(countries), len(periods)],
        "dimension": {
            "geo": {"category": {"index": list(countries)}},
            "time": {"category": {"index": periods}},
        },
        "value": [value for country in countries for value in values[country]],
    }
    return parse_jsonstat(
        payload, spec, retrieved_at="2026-09-14T12:00:00Z",
        url=f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{spec.dataset}",
    )


def spec_for(metric):
    return next(spec for spec in EUROSTAT_DATASETS if spec.metric == metric)


@pytest.mark.parametrize("metric", sorted(NATIONAL_INDICES))
def test_national_indices_keep_own_history_but_withhold_country_level_comparisons(metric):
    spec = spec_for(metric)
    series = parsed(spec, {
        "LV": [100.0] * 7 + [111.7],
        "EE": [100.0] * 7 + [99.55],
        "LT": [100.0] * 7 + [107.17],
        "EU27_2020": [100.0] * 7 + [95.0],
    })
    signal = detect_record_extreme(series[0], min_history=6)
    assert signal is not None
    pack = build_context(signal, series)

    assert pack.placement is not None, "own-history evidence must not be suppressed"
    assert pack.of_kind("peer") == ()
    assert pack.of_kind("denominator") == ()
    assert not any("Baltic states" in note for note in pack.observations)
    assert any("own base" in note for note in pack.observations)
    prompt = build_user_prompt(enrich_signal(signal, pack), pack=pack)
    assert "own base" in prompt
    assert "own_base_index" not in prompt, "the comparison policy is not writer-facing prose"
    assert "peer_ee" not in prompt
    assert "index" in signal.metric_label


@pytest.mark.parametrize("detector", [detect_divergence, detect_structural_divergence])
def test_national_index_level_spreads_are_not_divergence_findings(detector):
    spec = spec_for("labour_productivity")
    values = {
        "LV": [300 + 8 * i for i in range(24)],
        "EE": [340 + 10 * i for i in range(24)],
        "LT": [250 + 95 * i for i in range(24)],
    }
    if detector is detect_divergence:
        values = {"LV": [100] * 23 + [180], "EE": [101] * 24, "LT": [99] * 24}
    series = parsed(spec, values)

    assert detector({s.geography: s for s in series}) is None

    # Spatial GDP volume indices use a common EU benchmark, not each country's
    # own historical level. "Index" is not itself a reason to refuse comparison.
    spatial = EurostatDataset(
        dataset="prc_ppp_ind", metric="gdp_volume", metric_label="GDP volume per capita index",
        unit="index points", section="economy",
        params={"ppp_cat": "GDP", "na_item": "VI_PPS_EU27_2020_HAB"},
    )
    common = parsed(spatial, values)
    assert detector({s.geography: s for s in common}) is not None


def test_common_spatial_index_and_comparable_rates_still_supply_peer_rankings():
    spatial = EurostatDataset(
        dataset="prc_ppp_ind", metric="gdp_volume", metric_label="GDP volume per capita index",
        unit="index points", section="economy",
        params={"ppp_cat": "GDP", "na_item": "VI_PPS_EU27_2020_HAB"},
    )
    for spec in (spatial, spec_for("unemployment_rate")):
        series = parsed(spec, {"LV": [60] * 7 + [71], "EE": [80] * 8, "LT": [90] * 8})
        signal = detect_record_extreme(series[0], min_history=6)
        assert signal is not None
        pack = build_context(signal, series)
        assert len(pack.of_kind("peer")) == 2
        assert any("lowest of the three Baltic states" in note for note in pack.observations)


def test_comparability_survives_observation_replacement_and_cannot_be_filtered_away():
    series = parsed(spec_for("labour_productivity"), {
        "LV": [100] * 7 + [180], "EE": [101] * 8, "LT": [99] * 8,
    })
    replacements = [s.replace_observations(s.observations) for s in series]
    assert detect_divergence({s.geography: s for s in replacements}) is None
    mixed = [replace(replacements[0], level_comparison="common_scale"), *replacements[1:]]
    assert detect_divergence({s.geography: s for s in mixed}, min_geographies=1) is None


def test_all_current_national_index_definitions_declare_their_basis():
    declared = {
        spec.metric for spec in EUROSTAT_DATASETS if spec.level_comparison == "own_base_index"
    }
    assert declared == NATIONAL_INDICES
    assert declared == {
        spec.metric for spec in EUROSTAT_DATASETS if spec.params.get("unit") in {"I20", "I21"}
    }
    assert spec_for("economic_sentiment").level_comparison == "common_scale"
