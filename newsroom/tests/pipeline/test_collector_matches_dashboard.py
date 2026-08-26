"""The newsroom's Eurostat config must not drift from the dashboard's.

WHAT HAPPENED
-------------
Eurostat moved HICP from ECOICOP ver.1 to ver.2 and froze the ver.1 tables on
2026-02-06 with 2025-12 as their last period. The frozen tables still answer
HTTP 200, still list all 467 old codes, and still return well-formed JSON-stat
for a request that pins ``coicop=CP00``. Nothing errors. Nothing logs.

``api/shared/indicators.js`` was migrated for the dashboard in #60.
``newsroom/pipeline/collect/opendata.py`` was not. So the dashboard showed July
2026 inflation while the newsroom read December 2025 and would have written it
up as this month's news -- eight months stale, with every figure "traceable to
its dataset" and every validator check passing, because the number really was
in the payload. It was simply the wrong payload.

The file itself claims the two are copies:

    Every dataset and parameter string here is copied from
    api/shared/indicators.js, which PR #18 verified against live Eurostat

That claim was false for HICP and nothing checked it. A comment asserting an
invariant is not an invariant.

WHY THIS TEST AND NOT A FRESHNESS TEST
--------------------------------------
A staleness check would also have caught it, but only by making a network call,
only after the freeze had already happened, and only for as long as someone
kept the threshold current. This runs offline in milliseconds and fails the
moment the two configs disagree -- which is before the freeze matters.

``chart_ref`` is the join. It already exists on both sides and already means
"the dashboard indicator this series backs", so no new mapping is invented here.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS
from newsroom.pipeline.config import NEWSROOM_DIR

INDICATORS_JS = NEWSROOM_DIR.parent / "api" / "shared" / "indicators.js"

#: Dimensions the two sides legitimately express differently.
#:
#: ``freq`` is a frequency declaration, not a slice of the cube: the dashboard
#: writes it into its query string, while the newsroom carries it as the
#: ``frequency`` attribute and only pins it in params where a dataset needs it.
#: Comparing it would fail on a difference that is not a disagreement.
NOT_COMPARED = {"freq"}

#: Metrics whose chart lives outside ``indicators.js``, exempt from the chart
#: join and checked against their own dashboard module instead.
#:
#: Maritime is genuinely chartless from ``/api/baltic-compare``'s point of view.
#: The dashboard publishes the same Eurostat cubes, but through
#: ``api/shared/ports.js``, which keys on ``rep_mar`` and has no indicator id.
#: Giving the newsroom a ``chart_ref`` of ``port_goods`` would name something
#: that answers 400.
CHARTLESS_METRICS = {"port_goods_throughput"}


def _dashboard_indicators() -> dict[str, dict[str, str]]:
    """Parse ``indicators.js`` for dataset and params, keyed by indicator id.

    Deliberately a regex over the source rather than a JS runtime. The file is a
    flat literal, the shape is stable, and requiring node to run a Python test
    would make this the kind of check people delete when it gets in the way.
    """
    source = INDICATORS_JS.read_text(encoding="utf-8")
    found: dict[str, dict[str, str]] = {}
    for match in re.finditer(
        r"^  (\w+):\s*\{(.*?)^  \},", source, re.M | re.S
    ):
        key, body = match.group(1), match.group(2)
        dataset = re.search(r"dataset:\s*'([^']+)'", body)
        params = re.search(r"params:\s*'([^']*)'", body)
        if not dataset:
            continue
        pinned = {}
        if params:
            for pair in params.group(1).split("&"):
                if "=" in pair:
                    name, value = pair.split("=", 1)
                    pinned[name] = value
        found[key] = {"dataset": dataset.group(1), "params": pinned}
    return found


@pytest.fixture(scope="module")
def dashboard() -> dict[str, dict[str, str]]:
    parsed = _dashboard_indicators()
    assert len(parsed) > 20, (
        f"only parsed {len(parsed)} indicators from indicators.js; the parser has "
        f"drifted from the file's shape and is no longer checking anything"
    )
    return parsed


class TestEveryNewsroomSeriesIsJoinedToTheDashboard:
    def test_each_dataset_declares_a_chart_ref(self) -> None:
        missing = [
            d.metric for d in EUROSTAT_DATASETS
            if not d.chart_ref and d.metric not in CHARTLESS_METRICS
        ]
        assert not missing, (
            f"{missing} have no chart_ref, so nothing joins them to the dashboard "
            f"config and they are exempt from the drift check by accident. If the "
            f"dashboard genuinely cannot chart the series, add it to "
            f"CHARTLESS_METRICS with the reason — exempt on the record is fine, "
            f"exempt by accident is what this test exists to stop."
        )

    def test_each_chart_ref_names_a_real_indicator(self, dashboard) -> None:
        unknown = [
            (d.metric, d.chart_ref)
            for d in EUROSTAT_DATASETS
            if d.chart_ref and d.chart_ref not in dashboard
        ]
        assert not unknown, (
            f"{unknown} point at dashboard indicators that do not exist; the "
            f"article's chart link would 404 and the drift check cannot compare them"
        )

    def test_a_chartless_series_is_still_guarded_against_drift(self) -> None:
        """Exempt from the chart join is not exempt from the cube check.

        The maritime series have no ``/api/baltic-compare`` indicator, so the
        join this file normally uses does not exist for them. That must not
        mean they are unchecked: the failure this whole file was written for —
        the newsroom quietly reading a superseded Eurostat table while the
        dashboard read the current one — applies to them exactly as much.

        So they are compared against the dashboard's own maritime module
        instead. Only the table name is compared: ``ports.js`` deliberately
        leaves ``rep_mar`` unpinned because it wants the per-port breakdown,
        while the newsroom pins it to the country because it wants the national
        total, and that is a documented difference rather than drift.
        """
        ports_js = NEWSROOM_DIR.parent / "api" / "shared" / "ports.js"
        source = ports_js.read_text(encoding="utf-8")

        chartless = [d for d in EUROSTAT_DATASETS if d.metric in CHARTLESS_METRICS]
        assert chartless, "CHARTLESS_METRICS names nothing that exists"

        for spec in chartless:
            # ports.js builds the table name as 'mar_go_qm_' + cc, so the
            # newsroom's literal cannot be found as one string. Compare the
            # prefix, which is the part that goes stale when Eurostat
            # supersedes a cube.
            prefix = spec.dataset.rsplit("_", 1)[0]
            assert f"'{prefix}_'" in source, (
                f"{spec.metric} reads Eurostat table {spec.dataset!r}, which the "
                f"dashboard's ports.js does not mention. Either the newsroom is "
                f"on a different cube from the dashboard, or the dashboard moved "
                f"and this was not updated with it."
            )
            for name, value in spec.params.items():
                if name in NOT_COMPARED or name == "rep_mar":
                    continue
                assert f"{name}={value}" in source, (
                    f"{spec.metric} pins {name}={value} and ports.js does not; "
                    f"the two are reading different slices of the same cube"
                )


#: Only the series joined to an /api/baltic-compare indicator can be compared
#: against it. The chartless ones are covered by
#: ``test_a_chartless_series_is_still_guarded_against_drift`` instead, so
#: nothing here is unchecked -- it is checked somewhere the join exists.
CHARTED_DATASETS = [d for d in EUROSTAT_DATASETS if d.chart_ref]


class TestTheConfigsAgree:
    @pytest.mark.parametrize(
        "spec", CHARTED_DATASETS, ids=lambda s: s.metric
    )
    def test_the_dataset_matches(self, spec, dashboard) -> None:
        expected = dashboard[spec.chart_ref]["dataset"]

        assert spec.dataset == expected, (
            f"{spec.metric} reads Eurostat table {spec.dataset!r} while the "
            f"dashboard indicator {spec.chart_ref!r} reads {expected!r}. This is "
            f"how the newsroom spent eight months reporting December 2025 "
            f"inflation: a superseded table answers HTTP 200 with valid data, so "
            f"nothing fails, it is simply the wrong cube."
        )

    @pytest.mark.parametrize(
        "spec", CHARTED_DATASETS, ids=lambda s: s.metric
    )
    def test_the_pinned_dimensions_match(self, spec, dashboard) -> None:
        expected = {
            k: v
            for k, v in dashboard[spec.chart_ref]["params"].items()
            if k not in NOT_COMPARED
        }
        actual = {k: v for k, v in spec.params.items() if k not in NOT_COMPARED}

        assert actual == expected, (
            f"{spec.metric} pins {json.dumps(actual, sort_keys=True)} while the "
            f"dashboard pins {json.dumps(expected, sort_keys=True)} for "
            f"{spec.chart_ref!r}. An unpinned or differently-pinned dimension "
            f"selects a different slice of the same cube, so both sides return "
            f"numbers and only one of them is the indicator being named."
        )


class TestTheRetiredTablesAreNotComingBack:
    """Named, because they answer HTTP 200 and look healthy."""

    @pytest.mark.parametrize("frozen", ["prc_hicp_manr", "prc_hicp_midx", "prc_hicp_mmor"])
    def test_no_series_reads_a_frozen_ecoicop_v1_table(self, frozen) -> None:
        using = [d.metric for d in EUROSTAT_DATASETS if d.dataset == frozen]

        assert not using, (
            f"{using} read {frozen}, which Eurostat froze on 2026-02-06 with "
            f"2025-12 as its last period. It still serves valid JSON-stat, so the "
            f"failure is silent and looks like stale news rather than a bug."
        )

    def test_no_series_pins_the_retired_coicop_dimension(self) -> None:
        using = [d.metric for d in EUROSTAT_DATASETS if "coicop" in d.params]

        assert not using, (
            f"{using} pin the ver.1 dimension 'coicop'; ver.2 names it 'coicop18' "
            f"and renames all-items CP00 to TOTAL"
        )
