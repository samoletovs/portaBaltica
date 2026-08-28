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
PORTS_JS = NEWSROOM_DIR.parent / "api" / "shared" / "ports.js"

#: Dimensions the two sides legitimately express differently.
#:
#: ``freq`` is a frequency declaration, not a slice of the cube: the dashboard
#: writes it into its query string, while the newsroom carries it as the
#: ``frequency`` attribute and only pins it in params where a dataset needs it.
#: Comparing it *as a param* would fail on a difference that is not a
#: disagreement.
#:
#: It is compared as an attribute instead, by ``TestTheCadencesAgree`` below.
#: This note named the field the newsroom carries it in and nothing checked
#: that field, so the exclusion read as "not comparable" rather than "compared
#: elsewhere" -- and the newsroom's cadence went unverified from the day it was
#: written.
NOT_COMPARED = {"freq"}

#: Dimensions the newsroom pins that the dashboard *constructs*, so the literal
#: cannot be found in its source however correct both sides are.
#:
#: ``rep_mar`` is the reporting port. The newsroom pins a country — ``LV`` — for
#: the eleven port specs, while ``ports.js`` builds the parameter one port at a
#: time (``'rep_mar=' + encodeURIComponent(c)``) from its own registry. So
#: ``rep_mar=LV`` appears in neither file's text and a string comparison could
#: only ever fail.
#:
#: It was previously excused inline, as ``or name == "rep_mar"``, with no
#: comment: a legitimate exemption is indistinguishable from a silenced failure
#: once it is written that way, and an exemption nobody can find is not
#: reviewable. Naming it here makes adding a second one a visible diff line.
CONSTRUCTED_BY_THE_DASHBOARD = {"rep_mar"}

#: Eurostat's dimension code for a cadence, as the newsroom names it.
FREQUENCY_OF_CODE = {"M": "monthly", "Q": "quarterly", "A": "annual", "S": "semi-annual"}

#: Metrics whose chart lives outside ``indicators.js``, exempt from the chart
#: join and checked against their own dashboard module instead.
#:
#: Maritime is genuinely chartless from ``/api/baltic-compare``'s point of view.
#: The dashboard publishes the same Eurostat cubes, but through
#: ``api/shared/ports.js``, which keys on ``rep_mar`` and has no indicator id.
#: Giving the newsroom a ``chart_ref`` of ``port_goods`` would name something
#: that answers 400.
CHARTLESS_METRICS = {
    "port_goods_throughput",
    "port_goods_liquid_bulk",
    "port_goods_dry_bulk",
    "port_goods_containers",
    "port_goods_roro",
}


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
        source = PORTS_JS.read_text(encoding="utf-8")

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
                if name in NOT_COMPARED or name in CONSTRUCTED_BY_THE_DASHBOARD:
                    continue
                if name == "cargo":
                    # ports.js leaves `cargo` unpinned on purpose -- it IS the
                    # axis that module reads -- and lists the codes that
                    # partition the total in CARGO_MIX. So the invariant is
                    # membership of that list, not equality with a query
                    # string, and it is the one that matters: Eurostat's cargo
                    # dimension mixes levels (`LBK_ROIL` sits inside `LBK`), so
                    # a code outside CARGO_MIX would double-count tonnes the
                    # dashboard counts once.
                    if value == "TOTAL":
                        continue
                    assert f"'{value}'" in source, (
                        f"{spec.metric} reads cargo={value}, which is not one of "
                        f"the codes ports.js lists as partitioning the total. "
                        f"Eurostat nests cargo codes, so this may be counting "
                        f"the same tonnes twice."
                    )
                    continue
                assert f"{name}={value}" in source, (
                    f"{spec.metric} pins {name}={value} and ports.js does not; "
                    f"the two are reading different slices of the same cube"
                )

    def test_estonia_is_left_out_of_the_cargo_breakdown_deliberately(self):
        """Estonia publishes ``cargo=TOTAL`` and nothing else.

        The cube answers HTTP 200 for ``cargo=DBK``, returns all 48 quarters in
        its time dimension and carries zero values in them -- checked live for
        DBK, LBK and LCNT. Nothing errors, so a country list that included it
        would spend three requests a run to discover that again, and would look
        like a working configuration.
        """
        breakdown = [
            spec for spec in EUROSTAT_DATASETS
            if spec.section == "maritime" and spec.params.get("cargo") != "TOTAL"
        ]

        assert breakdown, "the cargo composition series have gone"
        assert {spec.params["rep_mar"] for spec in breakdown} == {"LV", "LT"}, (
            "Estonia publishes no cargo breakdown; asking for one returns an "
            "empty series rather than an error"
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


class TestTheCadencesAgree:
    """The newsroom's ``frequency`` against the dashboard's ``freq``.

    ``frequency`` is not decoration. ``detect_streak`` uses it to decide
    whether two readings are one period apart -- a run is broken by a gap --
    and ``reading_word`` uses it to name the unit in prose. A wrong value
    silences the detector on a healthy series and there is nothing to see: the
    metric simply never produces a streak, which is indistinguishable from a
    metric with nothing to say.

    That is the failure that needs a *detector* rather than a threshold,
    because nothing announces it. This is that detector, and it is offline:
    the dashboard's declaration is in the repo, so no network is needed to
    notice the two have drifted apart.

    What it does **not** check is whether either declaration matches how
    Eurostat actually publishes. ``digital_skills`` says annual on both sides
    and arrives every twenty-four months; the dashboard's live contract owns
    that comparison. The two guards chain rather than overlap -- this one ties
    the newsroom to the dashboard, that one ties the dashboard to reality --
    and neither on its own reaches from one end to the other.
    """

    @pytest.mark.parametrize("spec", CHARTED_DATASETS, ids=lambda s: s.metric)
    def test_the_declared_cadence_matches(self, spec, dashboard) -> None:
        code = dashboard[spec.chart_ref]["params"].get("freq")
        if code is None:
            pytest.skip(f"{spec.chart_ref} pins no freq in its query string")
        expected = FREQUENCY_OF_CODE.get(code)

        assert expected is not None, f"unmapped Eurostat freq code {code!r}"
        assert spec.frequency == expected, (
            f"{spec.metric} declares frequency={spec.frequency!r} while the "
            f"dashboard queries {spec.chart_ref!r} with freq={code!r}. "
            f"detect_streak reads this to decide whether two readings are one "
            f"period apart, so a wrong value silences the detector on a healthy "
            f"series and says nothing."
        )

    def test_every_charted_series_is_actually_covered(self, dashboard) -> None:
        """The companion. A parametrised test that skips everything passes.

        If the dashboard stopped writing freq into its query strings, every
        case above would skip and the suite would stay green while checking
        nothing.
        """
        covered = [
            spec
            for spec in CHARTED_DATASETS
            if dashboard[spec.chart_ref]["params"].get("freq")
        ]

        assert len(covered) > 20, (
            f"only {len(covered)} of {len(CHARTED_DATASETS)} charted datasets "
            f"carry a freq to compare against"
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


class TestTheExclusionsAreTheOnesSomeoneDecidedAbout:
    """Every dimension this file declines to compare, held to the full set.

    Both exclusions above are legitimate, and neither could say so. They were
    written as a *subtraction* -- ``if name in NOT_COMPARED: continue`` -- and a
    subtraction admits a new member in silence. Measured directly: adding
    ``unit``, ``s_adj`` and ``geo`` to ``NOT_COMPARED`` leaves all 207 tests in
    this file green. A ``geo`` disagreement means the newsroom reads a
    different *country* from the dashboard, which is the class of fault this
    whole file exists to catch, and the file would have excused it on request.

    So the exclusions are stated as an equality against the full set rather
    than a filter over it. ``expect(offenders).toEqual(KNOWN)``, never
    ``expect(offenders.filter(not_known)).toEqual([])``: both pass today and
    only the first fails the day the exemption becomes a lie. The frontend
    reached the same form independently in ``tests/typecheckGate.test.ts``,
    which pins its five type-check exclusions by equality for the same reason.

    This is the third member of a family found today. ``DELIBERATELY_NEUTRAL``
    on the dashboard side was a comment listing five abstentions with nothing
    to stop a sixth; a live-layout exemption for ``/corrections`` outlived the
    fix it was waiting on, because a filter that matches nothing goes on
    matching nothing forever. **A documented decision that nothing enforces
    decays into an assumption.**
    """

    def test_only_freq_is_left_uncompared_as_a_parameter(self) -> None:
        assert NOT_COMPARED == {"freq"}, (
            f"NOT_COMPARED is {sorted(NOT_COMPARED)}. Adding a dimension here "
            f"stops this file comparing it, permanently and silently. If a "
            f"parameter comparison failed, the newsroom and the dashboard are "
            f"reading different slices of the same cube -- which is the fault "
            f"this file exists to find, not one to excuse."
        )

    def test_freq_is_compared_somewhere_else_as_the_note_claims(self) -> None:
        '''The companion, and the reason the exclusion is honest.

        ``NOT_COMPARED``'s note says ``freq`` is "compared as an attribute
        instead". For the first months of its life nothing compared it, so the
        note read as "not comparable" while meaning "compared elsewhere" and
        closed the enquiry of anyone who came looking. ``TestTheCadencesAgree``
        made it true; this asserts it stays true, because the claim lives in a
        comment and the thing that satisfies it lives 200 lines away with
        nothing connecting them.
        '''
        comparisons = [n for n in vars(TestTheCadencesAgree) if n.startswith("test_")]

        assert comparisons, (
            "NOT_COMPARED excuses 'freq' on the promise that it is compared as "
            "an attribute instead. TestTheCadencesAgree is what keeps that "
            "promise and it now has no tests, so the promise is empty."
        )

    def test_only_rep_mar_is_excused_for_being_constructed(self) -> None:
        assert CONSTRUCTED_BY_THE_DASHBOARD == {"rep_mar"}, (
            f"CONSTRUCTED_BY_THE_DASHBOARD is "
            f"{sorted(CONSTRUCTED_BY_THE_DASHBOARD)}. A dimension belongs here "
            f"only if ports.js builds it rather than writing it literally, so "
            f"no string comparison could succeed. Anything else is a real "
            f"disagreement being excused."
        )

    def test_rep_mar_is_still_constructed_rather_than_written(self) -> None:
        """The companion, and the half `#177` left out.

        The equality above stops the set gaining a member. It says nothing
        about whether the reason for the member it has is still true -- and
        that reason is a fact about ``api/shared/ports.js``, a file this
        session does not own.

        ``rep_mar`` is excused because ports.js builds the value
        (``'rep_mar=' + encodeURIComponent(c)``) rather than writing it, so
        ``rep_mar=LV`` is in neither file's text and the string comparison
        could only ever fail. Write a literal into ports.js tomorrow and the
        comparison becomes possible, meaningful, and skipped -- excusing a
        real disagreement about which COUNTRY the newsroom reads.

        `#177` named that risk in its own description and did not close it,
        having just written the equivalent companion for ``freq`` eight lines
        above. **The correct sibling conceals the broken one**: a reader
        checking whether these exclusions are guarded finds
        ``test_freq_is_compared_somewhere_else_as_the_note_claims`` and stops.

        This is also the sharper form of the carve-out: an exemption resting
        on someone else's source is never permanent, because you are not the
        one who decides. So it has to be re-checked rather than assumed, and
        that is cheap -- it is a substring search against a file already in
        the repo, needing no network.
        """
        source = PORTS_JS.read_text(encoding="utf-8")
        pinned = sorted(
            {d.params["rep_mar"] for d in EUROSTAT_DATASETS if "rep_mar" in d.params}
        )
        assert pinned, "no dataset pins rep_mar, so this test is asserting nothing"

        written = [value for value in pinned if f"rep_mar={value}" in source]

        assert not written, (
            f"ports.js now writes rep_mar={written} literally, so the string "
            f"comparison this exemption exists to avoid would actually "
            f"succeed. Drop 'rep_mar' from CONSTRUCTED_BY_THE_DASHBOARD and "
            f"let the dimension be compared like any other."
        )

    def test_the_search_above_can_find_a_literal_when_there_is_one(self) -> None:
        """The positive control, without which the assertion is unfalsifiable.

        ``"rep_mar=LV" not in source`` is also what a mistyped path, an empty
        file or a renamed parameter returns. An assertion that something is
        absent needs a companion proving it could have been present, so this
        names four parameters ports.js *does* write literally and requires the
        same search to find them.
        """
        source = PORTS_JS.read_text(encoding="utf-8")

        missing = [
            literal
            for literal in ("freq=Q", "direct=TOTAL", "unit=THS_T", "par_mar=TOTAL")
            if literal not in source
        ]

        assert not missing, (
            f"{missing} are no longer written literally in ports.js, so the "
            f"search used by the test above is no longer known to find a "
            f"literal at all and its 'absent' result means nothing."
        )

    def test_the_two_exclusions_do_not_overlap(self) -> None:
        """They excuse for different reasons; a dimension in both hides one."""
        assert not (NOT_COMPARED & CONSTRUCTED_BY_THE_DASHBOARD)
