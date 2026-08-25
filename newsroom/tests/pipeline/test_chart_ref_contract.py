"""Every ``chart_ref`` must name a chart that actually exists.

An article's chart is the reader's invitation to check the claim, and
``chart_ref`` is the only thing connecting the two. The pipeline emits it and
the dashboard resolves it, so the two vocabularies have to agree — and nothing
made them.

They did not. The collector emitted ``labour.unemployment`` and
``economy.inflation``; the dashboard knows ``unemployment`` and ``inflation``.
``/api/baltic-compare?indicator=unemployment_rate`` answers **400**. The only
original article on the site rendered a panel captioned "Live data" with no data
in it, and nothing anywhere went red: the pipeline had emitted a string, the
frontend had requested it, and the failure lived in the gap between them.

This test closes that gap by reading the dashboard's own indicator registry —
the single source of truth for what a chart id may be — and asserting every
``chart_ref`` the collector can emit appears in it. It is deliberately a
file-parsing test rather than a mock: a mock of the dashboard vocabulary would
have agreed with whatever the pipeline said, which is precisely how this
survived.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS

REPO_ROOT = Path(__file__).resolve().parents[3]
INDICATORS_JS = REPO_ROOT / "api" / "shared" / "indicators.js"

#: Top-level keys of the INDICATORS object, e.g. ``  unemployment: {``.
_INDICATOR_KEY = re.compile(r"^  ([a-z0-9_]+):\s*\{", re.MULTILINE)


def dashboard_indicator_ids() -> set[str]:
    """Chart ids the dashboard can actually serve."""
    source = INDICATORS_JS.read_text(encoding="utf-8")
    return set(_INDICATOR_KEY.findall(source))


def test_indicator_registry_is_readable() -> None:
    """Guard the guard: a parser that silently finds nothing proves nothing."""
    ids = dashboard_indicator_ids()

    assert INDICATORS_JS.exists(), f"{INDICATORS_JS} is missing"
    assert len(ids) > 20, f"only parsed {len(ids)} indicator ids — the parser has drifted"
    assert "unemployment" in ids
    assert "inflation" in ids


@pytest.mark.parametrize("spec", EUROSTAT_DATASETS, ids=lambda s: s.dataset)
def test_chart_ref_resolves_to_a_real_indicator(spec) -> None:
    if spec.chart_ref is None:
        return

    ids = dashboard_indicator_ids()

    assert spec.chart_ref in ids, (
        f"{spec.dataset} emits chart_ref={spec.chart_ref!r}, which the dashboard "
        f"cannot serve. /api/baltic-compare would answer 400 and the article "
        f"would render an empty 'Live data' panel."
    )


def test_chart_ref_is_never_dotted() -> None:
    """The original mistake, pinned by shape as well as by lookup.

    ``labour.unemployment`` looks like a sensible namespaced id and is not one.
    Nothing in the dashboard vocabulary contains a dot, so a dotted ref is
    always wrong even if someone adds a matching key by accident.
    """
    dotted = [s.chart_ref for s in EUROSTAT_DATASETS if s.chart_ref and "." in s.chart_ref]

    assert dotted == [], f"dotted chart_refs cannot resolve: {dotted}"


def test_collection_is_wide_enough_to_produce_a_wire() -> None:
    """Detection can only find what collection fetched.

    Not a quota — the quality floor in rank.py still decides what publishes,
    and a quiet day still produces a short wire. This asserts the *input* is
    broad enough that the floor is what limits the output, rather than the
    newsroom simply not looking at most of the data it publishes a dashboard
    for.
    """
    sections = {s.section for s in EUROSTAT_DATASETS}

    assert len(EUROSTAT_DATASETS) >= 8, (
        f"only {len(EUROSTAT_DATASETS)} Eurostat series are collected; the "
        f"dashboard publishes far more, so most beats have nothing to report on"
    )
    assert len(sections) >= 3, f"collection only covers {sections}"


def test_metric_names_are_unique() -> None:
    """``max_per_metric`` dedupes by metric, so a collision silently halves output."""
    metrics = [s.metric for s in EUROSTAT_DATASETS]

    assert len(metrics) == len(set(metrics)), f"duplicate metric names: {metrics}"


# ---------------------------------------------------------------------------
# The whole chain, not just the collector
#
# The first version of this file checked EUROSTAT_DATASETS and stopped there.
# That was not enough twice over: the Elering collector also emitted a dotted
# ref, and — worse — the value never reached the article at all, because Signal
# had no chart_ref field and the generator fell back to signal.metric. Every
# collector-level assertion passed while the published article carried
# "unemployment_rate".
#
# A contract test that checks one end of a contract is not a contract test.
# ---------------------------------------------------------------------------


def test_no_collector_emits_a_dotted_ref() -> None:
    """Covers every collector in the module, not the Eurostat list alone."""
    source = (
        Path(__file__).resolve().parents[3]
        / "newsroom" / "pipeline" / "collect" / "opendata.py"
    ).read_text(encoding="utf-8")

    dotted = re.findall(r'chart_ref="([^"]*\.[^"]*)"', source)

    assert dotted == [], f"dotted chart_refs cannot resolve: {dotted}"


def test_signal_carries_chart_ref_separately_from_metric() -> None:
    """The field must exist, or the generator silently falls back to the metric."""
    from newsroom.pipeline.models import Signal

    assert "chart_ref" in Signal.__dataclass_fields__, (
        "Signal has no chart_ref field, so the collector's value is dropped "
        "between detection and writing"
    )


def test_generated_article_uses_the_chart_ref_not_the_metric() -> None:
    """The end of the chain: what actually lands in the article JSON.

    This is the assertion that would have caught the live defect. The metric
    and the chart id differ on purpose, so a generator using the wrong one is
    immediately visible.
    """
    from newsroom.pipeline.write.generator import _coerce_blocks
    from newsroom.pipeline.models import Signal, SourceRef

    signal = Signal(
        detector="record_extreme",
        metric="unemployment_rate",
        metric_label="unemployment rate",
        geography="EE",
        period="2026-06",
        value=6.6,
        unit="%",
        comparison_basis="the same month a year earlier",
        score=0.9,
        section="labour",
        fields={"value": 6.6},
        sources=(
            SourceRef(
                source_id="eurostat",
                dataset="une_rt_m",
                retrieved_at="2026-08-25T06:00:00Z",
            ),
        ),
        chart_ref="unemployment",
    )

    blocks = _coerce_blocks({"blocks": [{"text": "Unemployment fell to 6.6%."}]}, signal)
    chart = next(b for b in blocks if b.chart_ref)

    assert chart.chart_ref == "unemployment", (
        f"article carries chart_ref={chart.chart_ref!r}; the dashboard cannot "
        f"serve the metric name, only the indicator id"
    )
    assert chart.chart_ref in dashboard_indicator_ids()
