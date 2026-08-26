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
        missing = [d.metric for d in EUROSTAT_DATASETS if not d.chart_ref]
        assert not missing, (
            f"{missing} have no chart_ref, so nothing joins them to the dashboard "
            f"config and they are exempt from the drift check by accident"
        )

    def test_each_chart_ref_names_a_real_indicator(self, dashboard) -> None:
        unknown = [
            (d.metric, d.chart_ref)
            for d in EUROSTAT_DATASETS
            if d.chart_ref not in dashboard
        ]
        assert not unknown, (
            f"{unknown} point at dashboard indicators that do not exist; the "
            f"article's chart link would 404 and the drift check cannot compare them"
        )


class TestTheConfigsAgree:
    @pytest.mark.parametrize(
        "spec", EUROSTAT_DATASETS, ids=lambda s: s.metric
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
        "spec", EUROSTAT_DATASETS, ids=lambda s: s.metric
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
