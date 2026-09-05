"""Failures reproduced by the independent publication review."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import jsonschema

from newsroom.pipeline import corrections
from newsroom.pipeline.detect.detectors import detect_streak
from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.revisions import find_revisions
from newsroom.pipeline.run import RunReport, _store_all, _watch_revisions
from newsroom.pipeline.safety import validate
from newsroom.pipeline.vintage import VintageLedger, VintageStore, figures_from
from newsroom.pipeline.write.generator import GenerationResult
from newsroom.tests.conftest import ELECTRICITY_SIGNAL, _tier_a_article
from newsroom.tests.pipeline.conftest import make_signal, series_from
from newsroom.tests.pipeline.test_index_accumulates import article
from newsroom.tests.pipeline.test_revision_watch_is_wired import _figure, _series, _stored_article


def fresh_report() -> RunReport:
    signal = make_signal(
        metric="unemployment_rate", geography="EE", period="2026-06", value=7.4,
        fields={"latest_value": 7.4},
    )
    published = article("fresh-story", published_at="2026-09-05T00:00:00Z")
    published.provenance["signal_finding"] = "unemployment_rate|EE|2026-06"
    result = GenerationResult(signal, published, SimpleNamespace(passed=True))
    return RunReport(generated=[result], series=[_series(7.4)])


@pytest.mark.asyncio
async def test_publication_snapshot_has_a_declared_schema_and_is_not_model_supplied(
    tmp_path: Path,
) -> None:
    store = ArticleStore(account_url="", local_dir=tmp_path)
    report = fresh_report()
    report.generated[0].article.provenance["published_observations"] = [{"value": 999}]
    await _store_all(store, report)
    document = await store.read_published("fresh-story")
    assert document is not None
    snapshots = document["provenance"]["published_observations"]
    schema = json.loads(
        (Path(__file__).parents[2] / "schemas" / "article.schema.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(snapshots, schema["properties"]["provenance"]["properties"]["published_observations"])
    assert len(snapshots) == 1
    assert snapshots[0]["value"] == 7.4
    assert snapshots[0]["source_id"] == "eurostat"
    assert snapshots[0]["raw_source"] is True


@pytest.mark.asyncio
async def test_log_failure_does_not_prevent_fresh_vintage_registration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = ArticleStore(account_url="", local_dir=tmp_path)
    vintages = VintageStore(account_url="", local_dir=tmp_path)
    await store.write_published("estonia-unemployment", _stored_article())
    await vintages.save(VintageLedger([_figure(6.6)]))
    report = fresh_report()
    await _store_all(store, report)
    monkeypatch.setattr(store, "append_corrections", AsyncMock(side_effect=OSError("log outage")))
    with pytest.raises(OSError):
        await _watch_revisions(store, report, vintages=vintages)
    assert {(f.slug, f.value) for f in await vintages.load()} == {
        ("estonia-unemployment", 6.6), ("fresh-story", 7.4),
    }


@pytest.mark.parametrize("interruption", ["before_watch", "ledger_read", "ledger_write"])
@pytest.mark.asyncio
async def test_retry_registers_publication_time_observations_not_current_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, interruption: str,
) -> None:
    store = ArticleStore(account_url="", local_dir=tmp_path)
    vintages = VintageStore(account_url="", local_dir=tmp_path)
    report = fresh_report()
    await _store_all(store, report)
    assert len(report.published) == 1
    assert await store.published_findings() == {"unemployment_rate|EE|2026-06"}
    if interruption != "before_watch":
        method = "load" if interruption == "ledger_read" else "save"
        with monkeypatch.context() as patch:
            patch.setattr(vintages, method, AsyncMock(side_effect=OSError("ledger outage")))
            with pytest.raises(OSError):
                await _watch_revisions(store, report, vintages=vintages)
    # A fresh run generates nothing: seen-findings has already suppressed it.
    await _watch_revisions(store, RunReport(series=[_series(8.4)]), vintages=vintages)
    rows = list(await vintages.load())
    assert len(rows) == 1
    assert rows[0].value == 7.4
    assert rows[0].observed_at == report.series[0].source.retrieved_at
    stored = await store.read_published("fresh-story")
    assert stored is not None
    assert "8.4" in stored["corrections"][0]["description"]


@pytest.mark.asyncio
async def test_failed_index_does_not_register_an_unpublished_snapshot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = ArticleStore(account_url="", local_dir=tmp_path)
    vintages = VintageStore(account_url="", local_dir=tmp_path)
    report = fresh_report()
    with monkeypatch.context() as patch:
        patch.setattr(store, "write_index", AsyncMock(side_effect=OSError("index outage")))
        await _store_all(store, report)
    await _watch_revisions(store, report, vintages=vintages)
    await _watch_revisions(store, RunReport(series=[_series(7.8)]), vintages=vintages)
    assert list(await vintages.load()) == []


@pytest.mark.parametrize("next_value", [7.8, 6.6, None])
@pytest.mark.asyncio
async def test_old_source_notice_is_reconciled_independently_of_current_fingerprint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, next_value: float | None,
) -> None:
    store = ArticleStore(account_url="", local_dir=tmp_path)
    vintages = VintageStore(account_url="", local_dir=tmp_path)
    await store.write_published("estonia-unemployment", _stored_article())
    await vintages.save(VintageLedger([_figure(6.6)]))
    with monkeypatch.context() as patch:
        patch.setattr(store, "append_corrections", AsyncMock(side_effect=OSError("log outage")))
        with pytest.raises(OSError):
            await _watch_revisions(store, RunReport(series=[_series(7.4)]), vintages=vintages)
    stored = await store.read_published("estonia-unemployment")
    assert stored is not None
    first_note = stored["corrections"][0]
    next_series = [] if next_value is None else [_series(next_value)]
    for _ in range(2):
        await _watch_revisions(store, RunReport(series=next_series), vintages=vintages)
    log = json.loads((tmp_path / "corrections.json").read_text(encoding="utf-8"))
    first_entries = [e for e in log if e["description"] == first_note["description"]]
    assert len(first_entries) == 1
    assert first_entries[0]["corrected_at"] == first_note["corrected_at"]
    assert len(log) == (2 if next_value == 7.8 else 1)


def test_a_revision_to_an_interior_streak_observation_is_detected() -> None:
    periods = ["2026-04", "2026-05", "2026-06", "2026-07"]
    raw = series_from([6, 7, 8, 9], periods=periods)
    signal = detect_streak(raw)
    assert signal is not None
    published = article("streak", published_at="2026-09-05T00:00:00Z")
    ledger = VintageLedger(figures_from(published, signal, [raw]))
    assert {f.period for f in ledger} == set(periods)
    revised = series_from([6, 10, 8, 9], periods=periods)
    assert detect_streak(revised) is None
    revisions = find_revisions(ledger, [revised])
    assert [(r.figure.period, r.figure.value, r.current_value) for r in revisions] == [
        ("2026-05", 7, 10),
    ]


@pytest.mark.parametrize("text", [
    "The price reflects a rate of 142.5 euros per megawatt-hour and may boost regional productivity.",
    "The data do not indicate weak demand and the increase stems from nuclear plant closures.",
    "The price reflects a rate of 142.5 euros per megawatt-hour, suggesting resilient regional demand.",
    "The price reflects a rate of 142.5 euros per megawatt-hour, owing to nuclear plant closures.",
    "The data do not indicate weak demand, suggesting resilient regional demand.",
    "The price reflects a rate of 142.5 euros per megawatt-hour owing to nuclear plant closures.",
    "The data do not indicate weak demand and economists see bottlenecks and suggest a change in policy.",
    "The data do not indicate weak demand or economists see bottlenecks and suggest a change in policy.",
    "The data do not indicate weak demand and economists agree and suggest a change in policy.",
    "The data do not indicate weak demand and they agree and suggest a change in policy.",
])
def test_a_supported_or_denied_causal_clause_does_not_excuse_its_sibling(text: str) -> None:
    candidate = _tier_a_article()
    candidate["body"][0]["text"] = text
    verdict = validate(candidate, signal=ELECTRICITY_SIGNAL)
    check = next(c for c in verdict.checks if c.name == "no_unsupported_mechanism")
    assert not check.passed
    assert check.blocks == (0,)


@pytest.mark.parametrize("text", [
    "The data do not indicate weaker demand or suggest a change in policy.",
    "The data cannot establish the cause and do not indicate weaker demand.",
    "The data do not indicate weaker demand or supply changes.",
    "The data do not indicate weaker demand or supply changes; the data do not suggest a change in policy.",
])
def test_coordinated_denials_retain_their_subject_and_negation(text: str) -> None:
    candidate = _tier_a_article()
    candidate["body"][0]["text"] = text
    verdict = validate(candidate, signal=ELECTRICITY_SIGNAL)
    assert verdict.passed, verdict.failure_summary()


def test_unrecognized_intervening_fragment_requires_explicit_denial_scope() -> None:
    candidate = _tier_a_article()
    candidate["body"][0]["text"] = (
        "The data do not indicate weaker demand or supply changes or suggest a change in policy."
    )
    check = next(
        c for c in validate(candidate, signal=ELECTRICITY_SIGNAL).checks
        if c.name == "no_unsupported_mechanism"
    )
    assert not check.passed
    assert check.blocks == (0,)


@pytest.mark.parametrize("text", [
    "According to Elering, Latvian day-ahead electricity settled at an average of 142.5 euros per megawatt-hour.",
    "The reported day-ahead average was 142.5 euros per megawatt-hour.",
])
def test_verified_data_reporting_does_not_require_a_prose_document(text: str) -> None:
    candidate = _tier_a_article()
    candidate["body"][0]["text"] = text
    verdict = validate(candidate, signal=ELECTRICITY_SIGNAL)
    assert verdict.passed, verdict.failure_summary()


@pytest.mark.parametrize("text", [
    "According to Latvijas Banka, Latvian day-ahead electricity settled at an average of 142.5 euros per megawatt-hour.",
    "According to Elering, Latvian day-ahead electricity settled at an average of 142.5 euros per megawatt-hour and may boost regional productivity.",
    "The reported day-ahead average was 142.5 euros per megawatt-hour and the increase stems from nuclear plant closures.",
])
def test_data_reporting_exemption_preserves_source_identity_and_causal_gate(text: str) -> None:
    candidate = _tier_a_article()
    candidate["body"][0]["text"] = text
    assert not validate(candidate, signal=ELECTRICITY_SIGNAL).passed


@pytest.mark.asyncio
async def test_scheduled_issue_retry_reconciles_original_note_and_timestamp(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = ArticleStore(account_url="", local_dir=tmp_path)
    await store.write_published("estonia-unemployment", _stored_article())
    correction = corrections.EditorialCorrection(
        slug="estonia-unemployment", description="The comparison was misstated.",
        previous_value="a comparison with the previous month",
    )
    with monkeypatch.context() as patch:
        patch.setattr(store, "append_corrections", AsyncMock(side_effect=OSError("log outage")))
        assert await corrections.issue(store, [correction]) == ["estonia-unemployment"]
    stored = await store.read_published(correction.slug)
    assert stored is not None
    original = stored["corrections"][0]
    monkeypatch.setattr(corrections, "utcnow", lambda: datetime(2030, 1, 1, tzinfo=timezone.utc))
    writer = Mock(wraps=store._write_published)
    monkeypatch.setattr(store, "_write_published", writer)
    for _ in range(2):
        assert await corrections.issue(store, [correction]) == []
    writer.assert_not_called()
    entries = json.loads((tmp_path / "corrections.json").read_text(encoding="utf-8"))
    assert entries == [correction.to_log_entry(original, stored["headline"])]
