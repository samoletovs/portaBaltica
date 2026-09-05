"""Regression cases measured during the launch-readiness review."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import replace
from datetime import date
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import pytest

from newsroom.pipeline import publish
from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.revisions import already_recorded, find_revisions
from newsroom.pipeline.run import RunReport, _store_all, _watch_revisions
from newsroom.pipeline.vintage import PublishedFigure, VintageLedger, VintageStore, figures_from
from newsroom.pipeline.write.generator import GenerationResult
from newsroom.pipeline.write import prompts
from newsroom.pipeline.detect.detectors import detect_divergence, detect_structural_divergence
from newsroom.pipeline.detect.series import TimeSeries
from newsroom.pipeline.models import Block, Figure
from newsroom.pipeline.safety import validate
from newsroom.tests.conftest import ELECTRICITY_SIGNAL, _tier_a_article
from newsroom.tests.pipeline.conftest import make_signal, series_from
from newsroom.tests.pipeline.test_index_accumulates import article


def cloud_store(
    monkeypatch: pytest.MonkeyPatch, failed_name: str,
) -> tuple[ArticleStore, dict[str, bytes]]:
    blobs: dict[str, bytes] = {}

    def upload_blob(*, name: str, data: bytes, **kwargs: object) -> None:
        if name == failed_name:
            raise OSError("simulated storage outage")
        blobs[name] = data

    store = ArticleStore(account_url="")
    monkeypatch.setattr(store, "_container_client", lambda: SimpleNamespace(upload_blob=upload_blob))
    monkeypatch.setattr(store, "_write_local", Mock())
    monkeypatch.setattr(store, "_read_existing_index", lambda: [])
    monkeypatch.setattr(publish, "_content_settings", lambda _: None)
    return store, blobs


def test_failed_article_is_not_counted_or_indexed(monkeypatch: pytest.MonkeyPatch) -> None:
    store, blobs = cloud_store(monkeypatch, "lost-story.json")
    result = GenerationResult(
        make_signal(), article("lost-story", published_at="2026-09-05T00:00:00Z"),
        SimpleNamespace(passed=True),
    )
    report = RunReport(generated=[result])
    asyncio.run(_store_all(store, report))
    assert report.errors
    assert report.published == []
    assert json.loads(blobs["index.json"])["articles"] == []


def test_failed_index_is_not_reported_as_publication(monkeypatch: pytest.MonkeyPatch) -> None:
    store, _ = cloud_store(monkeypatch, "index.json")
    report = RunReport(syndicated=[article("stored-story", published_at="2026-09-05T00:00:00Z")])
    asyncio.run(_store_all(store, report))
    assert report.errors
    assert report.published == []


def test_failed_cloud_write_does_not_leave_a_successful_local_mirror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store, _ = cloud_store(monkeypatch, "story.json")
    with pytest.raises(OSError):
        asyncio.run(store.put(article("story", published_at="2026-09-05T00:00:00Z")))
    store._write_local.assert_not_called()


def test_failed_cloud_index_read_cannot_erase_history(monkeypatch: pytest.MonkeyPatch) -> None:
    store = ArticleStore(account_url="")
    monkeypatch.setattr(
        store, "_container_client",
        lambda: SimpleNamespace(download_blob=Mock(side_effect=OSError("read failed"))),
    )
    with pytest.raises(OSError):
        store._read_existing_index()


def test_cloud_success_does_not_require_a_local_mirror(monkeypatch: pytest.MonkeyPatch) -> None:
    store, blobs = cloud_store(monkeypatch, "unused.json")
    monkeypatch.setattr(store, "_write_local", Mock(side_effect=OSError("local disk full")))
    report = RunReport(syndicated=[article("stored-story", published_at="2026-09-05T00:00:00Z")])
    asyncio.run(_store_all(store, report))
    assert len(report.published) == 1
    assert report.errors == []
    assert json.loads(blobs["index.json"])["articles"][0]["slug"] == "stored-story"


@pytest.mark.parametrize("name", ["index.json", "vintages.json", "corrections.json", "story.json"])
def test_cloud_errors_never_fall_back_to_stale_local_documents(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, name: str,
) -> None:
    (tmp_path / name).write_text('{"stale": true}', encoding="utf-8")
    store = ArticleStore(account_url="", local_dir=tmp_path)
    monkeypatch.setattr(store, "_container_client", lambda: SimpleNamespace(
        download_blob=Mock(side_effect=OSError("unavailable")),
    ))
    with pytest.raises(OSError):
        store._read_authoritative(name)
    with pytest.raises(OSError):
        asyncio.run(store.read_json(name))


@pytest.mark.parametrize("error_code", ["BlobNotFound", "ContainerNotFound", None])
def test_only_a_missing_blob_can_be_initialised(
    monkeypatch: pytest.MonkeyPatch, error_code: str | None,
) -> None:
    from azure.core.exceptions import ResourceNotFoundError

    error = ResourceNotFoundError("not found")
    error.error_code = error_code
    store = ArticleStore(account_url="")
    monkeypatch.setattr(store, "_container_client", lambda: SimpleNamespace(
        download_blob=Mock(side_effect=error),
    ))
    if error_code == "BlobNotFound":
        assert store._read_existing_index() == []
    else:
        with pytest.raises(ResourceNotFoundError):
            store._read_existing_index()


@pytest.mark.parametrize("payload", ["null", "{}", '{"articles": [null]}', "{bad"])
def test_corrupt_cloud_index_is_not_overwritten(
    monkeypatch: pytest.MonkeyPatch, payload: str,
) -> None:
    upload = Mock()
    store = ArticleStore(account_url="")
    monkeypatch.setattr(store, "_container_client", lambda: SimpleNamespace(
        download_blob=lambda _: SimpleNamespace(readall=lambda: payload),
        upload_blob=upload,
    ))
    monkeypatch.setattr(store, "_write_local", Mock())
    with pytest.raises(ValueError):
        asyncio.run(store.write_index([]))
    upload.assert_not_called()


def test_failed_publication_does_not_enter_the_vintage_ledger(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    store, _ = cloud_store(monkeypatch, "lost-story.json")
    signal = make_signal()
    result = GenerationResult(
        signal, article("lost-story", published_at="2026-09-05T00:00:00Z"),
        SimpleNamespace(passed=True),
    )
    report = RunReport(
        generated=[result], series=[series_from([6.8], periods=[signal.period])],
    )
    vintages = VintageStore(account_url="", local_dir=tmp_path)
    asyncio.run(_store_all(store, report))
    asyncio.run(_watch_revisions(store, report, vintages=vintages))
    assert list(asyncio.run(vintages.load())) == []


def test_display_rounding_is_not_a_source_revision() -> None:
    raw = series_from(
        [1486367], metric="air_passengers", unit="passengers", geography="LT",
        periods=["2026-Q1"],
    )
    signal = make_signal(
        metric=raw.metric, unit=raw.unit, geography=raw.geography,
        period="2026-Q1", value=1486367,
    )
    published = article("passengers", published_at="2026-09-05T00:00:00Z")
    ledger = VintageLedger(figures_from(published, signal, [raw]))
    assert list(ledger)[0].value == 1486367
    assert find_revisions(ledger, [raw]) == []


def test_divergence_watches_raw_country_constituents() -> None:
    def readings(ee: float) -> list[TimeSeries]:
        return [
            series_from([value], metric="youth_unemployment", geography=geo, periods=["2026-07"])
            for geo, value in (("EE", ee), ("LT", 12.1), ("LV", 16))
        ]

    signal = make_signal(metric="youth_unemployment", geography="Baltic", period="2026-07", value=14)
    published = article("gap", published_at="2026-09-05T00:00:00Z")
    ledger = VintageLedger(figures_from(published, signal, readings(26.1)))
    assert {f.geography for f in ledger if f.raw_source} == {"EE", "LT", "LV"}
    revisions = find_revisions(ledger, readings(30.1))
    assert len(revisions) == 1
    assert revisions[0].figure.geography == "EE"
    assert revisions[0].current_value == 30.1


def test_previous_and_cited_context_observations_are_tracked_at_source_precision() -> None:
    periods = ["2026-06", "2026-07"]
    primary = series_from([1486367, 1510001], metric="air_passengers", unit="passengers",
                          periods=periods)
    companion = series_from([17.12345678], metric="youth_unemployment", geography="EE",
                            periods=["2026-07"])
    signal = make_signal(metric=primary.metric, context={"previous_period": "2026-06"})
    published = article("readings", published_at="2026-09-05T00:00:00Z")
    published.provenance["context"] = {"facts": [{
        "field": "peer_youth_ee", "metric": companion.metric,
        "geography": "EE", "period": "2026-07",
    }]}
    published.body.append(Block(type="paragraph", text="A comparison.", figures=[
        Figure(value=17.1235, signal_field="peer_youth_ee"),
    ]))
    ledger = figures_from(published, signal, [primary, companion])
    assert {(f.metric, f.geography, f.period, f.value) for f in ledger} == {
        ("air_passengers", "LV", "2026-06", 1486367),
        ("air_passengers", "LV", "2026-07", 1510001),
        ("youth_unemployment", "EE", "2026-07", 17.12345678),
    }
    assert all(f.source_id == "eurostat" and f.dataset == "test_ds" for f in ledger)


def test_divergence_summary_cannot_be_replaced_by_a_constituent_in_the_weekly() -> None:
    from newsroom.pipeline.weekly import collect_week

    signal = make_signal(geography="Baltic", value=14)
    group = [series_from([value], geography=geo, periods=[signal.period])
             for geo, value in (("EE", 26.1), ("LV", 16), ("LT", 12.1))]
    ledger = figures_from(article("gap", published_at="2026-09-05T00:00:00Z"), signal, group)
    corpus = collect_week(reversed(ledger), now=date(2026, 9, 6))
    assert [(f.geography, f.value) for f in corpus.figures] == [("Baltic", 14)]


def test_revisions_with_identical_changes_in_different_countries_stay_distinct() -> None:
    signal = make_signal(geography="Baltic")
    published = article("gap", published_at="2026-09-05T00:00:00Z")
    before = [series_from([26.1], geography=geo, periods=[signal.period]) for geo in ("EE", "LV")]
    after = [series_from([30.1], geography=geo, periods=[signal.period]) for geo in ("EE", "LV")]
    revisions = find_revisions(VintageLedger(figures_from(published, signal, before)), after)
    assert len(revisions) == 2
    assert not already_recorded([revisions[0].to_correction()], revisions[1])


def test_small_absolute_revision_of_a_large_value_keeps_full_precision() -> None:
    signal = make_signal(metric="air_passengers", unit="passengers")
    published = article("passengers", published_at="2026-09-05T00:00:00Z")
    before = series_from([1486367], metric=signal.metric, unit=signal.unit, periods=[signal.period])
    after = series_from([1486370], metric=signal.metric, unit=signal.unit, periods=[signal.period])
    revision = find_revisions(VintageLedger(figures_from(published, signal, [before])), [after])[0]
    correction = revision.to_correction()
    assert "1486367" in correction["previous_value"]
    assert "1486370" in correction["description"]
    assert already_recorded([correction], revision)


def test_a_changed_unit_is_not_an_upstream_revision() -> None:
    signal = make_signal()
    published = article("rate", published_at="2026-09-05T00:00:00Z")
    before = series_from([6.8], periods=[signal.period])
    after = replace(series_from([6800], periods=[signal.period]), unit="people")
    ledger = VintageLedger(figures_from(published, signal, [before]))
    assert find_revisions(ledger, [after]) == []


def test_partial_correction_write_repairs_the_public_log_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    from newsroom.tests.pipeline.test_revision_watch_is_wired import _figure, _series, _stored_article

    store = ArticleStore(account_url="", local_dir=tmp_path)
    vintages = VintageStore(account_url="", local_dir=tmp_path)
    asyncio.run(store.write_published("estonia-unemployment", _stored_article()))
    asyncio.run(vintages.save(VintageLedger([_figure(6.6)])))
    append = store._append_corrections
    monkeypatch.setattr(store, "_append_corrections", Mock(side_effect=OSError("log unavailable")))
    with pytest.raises(OSError):
        asyncio.run(_watch_revisions(store, RunReport(series=[_series(7.4)]), vintages=vintages))
    recorded = asyncio.run(store.read_published("estonia-unemployment"))
    assert recorded is not None and len(recorded["corrections"]) == 1
    assert not (tmp_path / "corrections.json").exists()
    monkeypatch.setattr(store, "_append_corrections", append)
    for _ in range(2):
        asyncio.run(_watch_revisions(store, RunReport(series=[_series(7.4)]), vintages=vintages))
    entries = json.loads((tmp_path / "corrections.json").read_text(encoding="utf-8"))
    assert len(entries) == 1
    assert entries[0]["description"] == recorded["corrections"][0]["description"]


def test_editorial_correction_retry_also_repairs_its_log(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    from newsroom.pipeline.revisions import apply_correction_note
    from newsroom.tests.pipeline.test_revision_watch_is_wired import _stored_article

    store = ArticleStore(account_url="", local_dir=tmp_path)
    asyncio.run(store.write_published("estonia-unemployment", _stored_article()))
    note = {"description": "The comparison was misstated.", "corrected_at": "2026-09-05T00:00:00Z",
            "kind": "our_error"}
    append = store._append_corrections
    monkeypatch.setattr(store, "_append_corrections", Mock(side_effect=OSError("log unavailable")))
    with pytest.raises(OSError):
        asyncio.run(apply_correction_note(store, "estonia-unemployment", note))
    monkeypatch.setattr(store, "_append_corrections", append)
    for _ in range(2):
        assert asyncio.run(apply_correction_note(store, "estonia-unemployment", note)) is None
    entries = json.loads((tmp_path / "corrections.json").read_text(encoding="utf-8"))
    assert len(entries) == 1
    assert entries[0]["description"] == note["description"]


def test_legacy_rounded_rows_are_not_accused_of_source_revisions() -> None:
    legacy = {
        "metric": "air_passengers", "geography": "LT", "period": "2026-Q1",
        "value": 1486370, "unit": "passengers", "slug": "old-story",
    }
    figure = PublishedFigure.from_json(legacy)
    assert figure is not None
    raw = series_from([1486367], metric="air_passengers", geography="LT", unit="passengers",
                      periods=["2026-Q1"])
    assert find_revisions(VintageLedger([figure]), [raw]) == []


@pytest.mark.parametrize("text", [
    "The data does not show what drove the change. However, the divergence may reflect differing recovery trajectories.",
    "The data does not show what drove the change; however, the divergence may reflect differing recovery trajectories.",
    "The data cannot confirm the cause, but the divergence is driven by weaker demand.",
    "The data cannot confirm the cause but the divergence is driven by weaker demand.",
    "According to Latvijas Banka, the increase is driven by nuclear plant closures.",
    'The European Central Bank said "Latvia has entered a permanent economic boom."',
    "'Latvia has entered a permanent economic boom.'",
])
def test_unsupported_claims_do_not_pass_on_denial_or_attribution(text: str) -> None:
    candidate = _tier_a_article()
    candidate["body"].append({"type": "paragraph", "text": text})
    verdict = validate(candidate, signal=ELECTRICITY_SIGNAL)
    assert not verdict.passed, text


def test_figures_do_not_excuse_an_unrelated_cause() -> None:
    candidate = _tier_a_article()
    candidate["body"][0]["text"] += " This increase is driven by nuclear plant closures."
    assert not validate(candidate, signal=ELECTRICITY_SIGNAL).passed


@pytest.mark.parametrize("text", [
    'According to Latvijas Banka, "Demand is subdued."',
    "According to Latvijas Banka, “Demand is subdued.”",
    "According to Latvijas Banka, 'Demand is subdued.'",
    "According to Latvijas Banka, ‘Demand is subdued.’",
])
def test_cited_verbatim_text_survives_quote_punctuation(text: str) -> None:
    candidate = _tier_a_article()
    candidate["body"].append({"type": "paragraph", "text": text})
    evidence = [{
        "source_id": "latvijas_banka_news", "source_name": "Latvijas Banka",
        "url": "https://www.bank.lv/review", "document": "Demand is subdued.",
    }]
    candidate["provenance"]["research"] = {"consulted": evidence}
    assert validate(candidate, signal=ELECTRICITY_SIGNAL, evidence=evidence).passed


@pytest.mark.parametrize("fault", ["different_source", "different_url", "uncited", "extra_claim",
                                  "unsupported_headline", "untrusted_provenance"])
def test_document_presence_is_not_blanket_support(fault: str) -> None:
    evidence: list[dict[str, Any]] = [{
        "source_id": "latvijas_banka_news", "url": "https://www.bank.lv/review",
        "document": "Demand is subdued.",
    }]
    candidate = _tier_a_article()
    text = 'According to Latvijas Banka, "Demand is subdued."'
    candidate["provenance"]["research"] = {"consulted": deepcopy(evidence)}
    if fault == "different_source":
        text = 'According to Eurostat, "Demand is subdued."'
    elif fault == "different_url":
        evidence[0]["url"] = "https://www.bank.lv/other"
    elif fault == "uncited":
        candidate["provenance"]["research"]["consulted"] = []
    elif fault == "extra_claim":
        text += " and the increase is driven by nuclear plant closures."
    elif fault == "unsupported_headline":
        candidate["headline"] = 'The European Central Bank said "Latvia is booming."'
    else:
        evidence = []
    candidate["body"].append({"type": "paragraph", "text": text})
    assert not validate(candidate, signal=ELECTRICITY_SIGNAL, evidence=evidence).passed


def test_an_unquoted_excerpt_cannot_launder_a_preceding_claim() -> None:
    candidate = _tier_a_article()
    candidate["body"].append({"type": "paragraph", "text":
        "The increase is driven by nuclear plant closures, according to Latvijas Banka, demand is subdued."
    })
    evidence = [{
        "source_id": "latvijas_banka_news", "url": "https://www.bank.lv/review",
        "document": "Demand is subdued.",
    }]
    candidate["provenance"]["research"] = {"consulted": evidence}
    assert not validate(candidate, signal=ELECTRICITY_SIGNAL, evidence=evidence).passed


def test_quoted_apostrophes_are_not_punctuation_rejections() -> None:
    candidate = _tier_a_article()
    candidate["body"].append({"type": "paragraph", "text":
        "According to Latvijas Banka, ‘Latvia’s demand isn’t strong.’"
    })
    evidence = [{
        "source_id": "latvijas_banka_news", "url": "https://www.bank.lv/review",
        "document": "Latvia's demand isn't strong.",
    }]
    candidate["provenance"]["research"] = {"consulted": evidence}
    assert validate(candidate, signal=ELECTRICITY_SIGNAL, evidence=evidence).passed


@pytest.mark.parametrize("minus", ["-", "−"])
def test_quote_matching_does_not_discard_a_numeric_sign(minus: str) -> None:
    from newsroom.claim_grounding import supported_excerpt
    from newsroom.pipeline.safety import registry

    evidence = [{
        "source_id": "latvijas_banka_news", "url": "https://www.bank.lv/review",
        "document": "Growth was 5%.",
    }]
    assert not supported_excerpt(
        f'According to Latvijas Banka, "Growth was {minus}5%."',
        evidence=evidence, consulted=evidence, registry=registry(),
    )


def test_trusted_evidence_survives_generator_revalidation_and_is_not_published() -> None:
    from newsroom.pipeline.research import ResearchContext, ResearchItem
    from newsroom.pipeline.write import StubWriter, generate_article
    from newsroom.tests.pipeline.test_generation import GOOD_PAYLOAD

    payload = deepcopy(GOOD_PAYLOAD)
    quote = 'According to Latvijas Banka, "Demand is subdued."'
    payload["blocks"].extend([
        {"text": quote, "figures": []},
        {"text": "Unemployment measures people without work who are available and seeking a job.",
         "figures": []},
        {"text": "The increase is driven by nuclear plant closures.", "figures": []},
    ])
    research = ResearchContext(items=(ResearchItem(
        source_id="latvijas_banka_news", source_name="Latvijas Banka",
        role="official_statement", title="Review", url="https://www.bank.lv/review",
        retrieved_at="2026-09-05T00:00:00Z", document="Demand is subdued.",
    ),))
    result = generate_article(make_signal(), StubWriter(payload), research=research, max_attempts=1)
    assert result.publishable, result.verdict.failure_summary()
    assert quote in [block.text for block in result.article.body]
    assert not any("nuclear" in (block.text or "") for block in result.article.body)
    consulted = result.article.provenance["research"]["consulted"]
    assert consulted and all("document" not in item for item in consulted)


@pytest.mark.parametrize("structural", [False, True])
def test_nested_power_spread_names_the_quantity_in_signal_and_prompt(structural: bool) -> None:
    periods = [f"2026-08-{day:02d}" for day in range(1, 21)]
    group = {
        geo: series_from(
            ([100 + offset] * 12 + [latest] * 8 if structural
             else [100 + offset] * 19 + [latest]), metric="day_ahead_power_spread",
            metric_label="daily spread between the cheapest and dearest power interval",
            geography=geo, unit="EUR/MWh", periods=periods, frequency="daily",
        )
        for geo, offset, latest in (("EE", 0, 142.19), ("LV", 10, 233.01), ("LT", 10, 233.01))
    }
    signal = detect_structural_divergence(group) if structural else detect_divergence(group)
    assert signal is not None
    assert "intraday price ranges" in signal.metric_label
    prompt = prompts.build_user_prompt(signal)
    assert "intraday price ranges" in prompt
    assert "not a difference in average prices" in prompt
    assert signal.fields["highest_value"] == 233.01
    assert signal.fields["lowest_value"] == 142.19
    assert signal.value == pytest.approx(90.82)
    ledger = figures_from(article("ranges", published_at="2026-09-05T00:00:00Z"),
                          signal, list(group.values()))
    assert any(f.period == periods[0] and not f.summary for f in ledger)
