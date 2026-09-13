"""Exercise the existing collector, detectors and writer with production evidence."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import create_autospec

import httpx
import pytest

from newsroom.pipeline.collect import httpclient, opendata
from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp, ConditionalState
from newsroom.pipeline.detect.detectors import detect_record_extreme
from newsroom.pipeline.evidence import production, workflow
from newsroom.pipeline.evidence.__main__ import main as evidence_main
from newsroom.pipeline.evidence.store import EvidenceStore
from newsroom.pipeline.models import SourceRef
from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.run import RunReport, _store_all
from newsroom.pipeline.runreport import build_run_report
from newsroom.pipeline.write import StubWriter, generate_article
from newsroom.pipeline.write import llm
from newsroom.tests.pipeline.test_evidence_archive import raw_bytes, source_payload
from newsroom.tests.pipeline.test_evidence_production import (
    MemoryBlobs,
    expected_binding_key,
    forbid_live_network,
    original_item,
    production_directory,
    service_for,
)

JsonDict = dict[str, Any]
UNEMPLOYMENT = next(spec for spec in opendata.EUROSTAT_DATASETS if spec.metric == "unemployment_rate")


@pytest.fixture(autouse=True)
def forbid_model_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        llm.AzureOpenAIWriter, "complete_json",
        create_autospec(llm.AzureOpenAIWriter.complete_json, side_effect=AssertionError("archive called a model")),
    )
    monkeypatch.setattr(
        llm, "_client", create_autospec(llm._client, side_effect=AssertionError("archive created a model client")),
    )


@pytest.fixture
def collector_clock(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    clock = SimpleNamespace(now=datetime(2021, 2, 4, 10, tzinfo=timezone.utc))
    for module in (httpclient, opendata, production, workflow):
        monkeypatch.setattr(module, "utcnow", lambda: clock.now)
    return clock


async def collect_response(
    directory: Path, service: production.EvidenceService | None, *,
    body: bytes | None = None, status_code: int = 200,
    requests: list[httpx.Request] | None = None,
) -> list[Any]:
    archive = RawArchive(local_dir=directory / "collector-raw", account_url="")

    def response(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        return httpx.Response(
            status_code, content=detector_payload() if body is None else body,
            headers={"content-type": "application/json", "etag": '"original-eurostat"'},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        async with CollectorHttp(
            archive, client=client, state=ConditionalState(directory / "conditional.json"),
            max_retries=1,
        ) as collector:
            return await opendata.collect_eurostat(collector, (UNEMPLOYMENT,), evidence=service)


def detector_payload() -> bytes:
    payload = source_payload()
    periods = [f"2020-{month:02d}" for month in range(1, 13)] + ["2021-01"]
    payload["dimension"]["time"]["category"] = {
        "index": {period: position for position, period in enumerate(periods)},
        "label": {period: period for period in periods},
    }
    payload["size"][payload["id"].index("time")] = len(periods)
    payload["value"] = {
        str(geo * len(periods) + month): 6.8 if month == 12 else 6.5 if month == 0 else 6.2
        for geo in range(4) for month in range(len(periods))
    }
    payload["status"] = {"12": "p"}
    payload["updated"] = "2021-02-03T08:00:00Z"
    return raw_bytes(payload)


def test_unbound_source_serialization_remains_backward_compatible() -> None:
    source = SourceRef(
        source_id="eurostat", dataset="une_rt_m", retrieved_at="2020-03-06T10:00:00Z",
        dataset_version="2020-03-04T08:00:00Z", url="https://example.invalid/original",
    )

    assert source.to_json() == {
        "source_id": "eurostat", "dataset": "une_rt_m", "retrieved_at": "2020-03-06T10:00:00Z",
        "dataset_version": "2020-03-04T08:00:00Z", "url": "https://example.invalid/original",
    }


async def test_reopened_collector_cache_keeps_the_exact_original_source_identity(
    production_directory: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed = datetime(2021, 2, 4, 10, tzinfo=timezone.utc)
    monkeypatch.setattr(httpclient, "utcnow", lambda: observed)
    raw_archive = RawArchive(local_dir=production_directory / "collector-raw", account_url="")
    state_path = production_directory / "conditional.json"
    requests: list[httpx.Request] = []

    def source(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert len(requests) == 1, "reopening the client must still honour its persisted TTL"
        return httpx.Response(200, content=detector_payload(), headers={"etag": '"original"'})

    async with httpx.AsyncClient(transport=httpx.MockTransport(source)) as client:
        async with CollectorHttp(
            raw_archive, client=client, state=ConditionalState(state_path), max_retries=1,
        ) as collector:
            first = await opendata.collect_eurostat(collector, (UNEMPLOYMENT,))
        observed += timedelta(minutes=5)
        async with CollectorHttp(
            raw_archive, client=client, state=ConditionalState(state_path), max_retries=1,
        ) as reopened:
            reused = await opendata.collect_eurostat(reopened, (UNEMPLOYMENT,))

    assert len(requests) == 1
    assert first and reused
    assert [series.source.to_json() for series in reused] == [series.source.to_json() for series in first]
    assert all(series.source.url == str(requests[0].url) for series in reused)
    assert all(series.source.retrieved_at == "2021-02-04T10:00:00Z" for series in reused)
    assert [series.observations for series in reused] == [series.observations for series in first]
    archives = list((production_directory / "collector-raw").rglob("*.raw"))
    assert len(archives) == 1
    assert archives[0].read_bytes() == detector_payload()


async def test_real_collector_binds_its_own_exact_response_before_any_article_selection(
    production_directory: Path, collector_clock: SimpleNamespace,
) -> None:
    service, public = service_for(production_directory)
    requests: list[httpx.Request] = []
    body = raw_bytes()

    series = await collect_response(production_directory, service, body=body, requests=requests)

    assert len(requests) == 1, "evidence must not independently refetch Eurostat"
    assert series
    snapshot_ids = {value.source.evidence_snapshot_id for value in series}
    assert None not in snapshot_ids and len(snapshot_ids) == 1
    snapshot_id = snapshot_ids.pop()
    manifest = public.document(f"snapshots/{snapshot_id}/manifest.json")
    assert public.bodies[f"evidence/v1/snapshots/{snapshot_id}/source.json"] == body
    assert manifest["provenance"]["request_url"] == str(requests[0].url)
    assert manifest["provenance"]["retrieved_at"] == "2021-02-04T10:00:00Z"
    assert manifest["provenance"]["sha256"] == hashlib.sha256(body).hexdigest()
    for value in series:
        assert value.source.url == manifest["provenance"]["request_url"]
        assert value.source.retrieved_at == manifest["provenance"]["retrieved_at"]
    identity = original_item(url=str(requests[0].url), retrieved_at="2021-02-04T10:00:00Z", body=body)
    binding = public.document(f"bindings/{expected_binding_key(identity)}.json")
    assert binding["snapshot_id"] == snapshot_id
    assert binding["raw_sha256"] == hashlib.sha256(body).hexdigest()
    archives = list((production_directory / "collector-raw").rglob("*.raw"))
    assert len(archives) == 1 and archives[0].read_bytes() == body
    assert service.outcomes[-1]["status"] == "captured"


async def test_cached_collector_response_reuses_one_public_vintage_after_restart(
    production_directory: Path, collector_clock: SimpleNamespace,
) -> None:
    service, public = service_for(production_directory)
    requests: list[httpx.Request] = []
    first = await collect_response(production_directory, service, requests=requests)
    original_id = first[0].source.evidence_snapshot_id
    original_url = first[0].source.url
    collector_clock.now += timedelta(minutes=5)
    restarted = production.EvidenceService(service.canonical, service.public)

    cached = await collect_response(production_directory, restarted, requests=requests)

    assert len(requests) == 1
    assert {value.source.evidence_snapshot_id for value in cached} == {original_id}
    assert {value.source.url for value in cached} == {original_url}
    assert {value.source.retrieved_at for value in cached} == {"2021-02-04T10:00:00Z"}
    index = public.document("index.json")
    assert index["last_attempt"]["status"] == "reused"
    assert index["last_attempt"]["attempted_at"] == "2021-02-04T10:05:00Z"
    assert index["last_success_at"] == "2021-02-04T10:00:00Z"
    assert len(public.document("months/2021-02.json")["snapshots"]) == 1
    assert restarted.outcomes[-1]["status"] == "reused"


async def test_http_304_revalidation_is_not_a_fresh_source_observation(
    production_directory: Path, collector_clock: SimpleNamespace,
) -> None:
    service, public = service_for(production_directory)
    first = await collect_response(production_directory, service)
    original_id = first[0].source.evidence_snapshot_id
    collector_clock.now += timedelta(hours=30)
    requests: list[httpx.Request] = []

    reused = await collect_response(
        production_directory, service, status_code=304, body=b"", requests=requests,
    )

    assert len(requests) == 1
    assert requests[0].headers["If-None-Match"] == '"original-eurostat"'
    assert {value.source.evidence_snapshot_id for value in reused} == {original_id}
    assert {value.source.retrieved_at for value in reused} == {"2021-02-04T10:00:00Z"}
    index = public.document("index.json")
    assert index["last_attempt"]["status"] == "reused"
    assert index["last_attempt"]["attempted_at"] == "2021-02-05T16:00:00Z"
    assert index["last_success_at"] == "2021-02-04T10:00:00Z"
    assert len(public.document("months/2021-02.json")["snapshots"]) == 1


async def test_disabled_archive_preserves_collector_values_and_source_metadata(
    production_directory: Path, collector_clock: SimpleNamespace, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("NEWSROOM_EVIDENCE_ENABLED", raising=False)
    assert production.enabled() is False
    service, public = service_for(production_directory)

    disabled = await collect_response(production_directory / "off", None)
    enabled = await collect_response(production_directory / "on", service)

    assert disabled and enabled
    assert [value.observations for value in disabled] == [value.observations for value in enabled]
    assert [value.origin for value in disabled] == [value.origin for value in enabled]
    for before, after in zip(disabled, enabled):
        original = before.source.to_json()
        linked = after.source.to_json()
        assert linked.pop("evidence_snapshot_id")
        assert original == linked
        assert "evidence_snapshot_id" not in original
    assert len(public.document("months/2021-02.json")["snapshots"]) == 1
    assert not (production_directory / "off" / "snapshots").exists()


@pytest.mark.parametrize("status_code", [500, 404])
async def test_collector_http_failure_is_reported_even_when_no_raw_item_exists(
    production_directory: Path, collector_clock: SimpleNamespace, status_code: int,
) -> None:
    service, public = service_for(production_directory)

    result = await collect_response(production_directory, service, status_code=status_code)

    assert result == []
    assert service.outcomes[-1]["status"] == "failed"
    assert not service.outcomes[-1].get("snapshot_id")
    report = build_run_report(SimpleNamespace(evidence=service.report()), trigger="evidence-test")
    assert report["evidence"]["enabled"] is True
    assert report["evidence"]["status"] == "failed"
    assert report["evidence"]["last_attempt"]["status"] == "failed"
    index = public.document("index.json")
    assert index["last_attempt"]["status"] == "failed"
    assert index["latest_snapshot_id"] is None and index["last_success_at"] is None
    assert not any("/bindings/" in name or "/snapshots/" in name for name in public.bodies)


async def test_collector_public_storage_failure_keeps_series_without_a_false_evidence_link(
    production_directory: Path, collector_clock: SimpleNamespace,
) -> None:
    service, public = service_for(
        production_directory, public=MemoryBlobs(fail_suffix="/manifest.json"),
    )

    series = await collect_response(production_directory, service)

    assert series, "an evidence outage must not remove existing open-data behaviour"
    assert all(value.source.evidence_snapshot_id is None for value in series)
    assert all("evidence_snapshot_id" not in value.source.to_json() for value in series)
    assert public.document("index.json")["last_attempt"]["status"] == "failed"
    assert service.outcomes[-1]["status"] == "failed"
    assert not any("/bindings/" in name or name.endswith("/manifest.json") for name in public.bodies)


async def test_real_article_keeps_published_observations_and_original_source_snapshot(
    production_directory: Path, collector_clock: SimpleNamespace,
) -> None:
    service, public = service_for(production_directory)
    series = await collect_response(production_directory, service)
    latvia = next(value for value in series if value.geography == "LV")
    signal = detect_record_extreme(latvia)
    assert signal is not None
    assert signal.sources[0].evidence_snapshot_id == latvia.source.evidence_snapshot_id
    writer = StubWriter({
        "headline": "Latvian unemployment reaches its highest reading since 2020",
        "dek": "The January reading stands above the earlier high in Eurostat's series.",
        "blocks": [{
            "text": (
                "Latvia's unemployment rate reached 6.8% in January, above the previous "
                "record of 6.5% and the highest since 2020."
            ),
            "figures": [
                {"value": 6.8, "signal_field": "latest_value", "rendered_as": "6.8%"},
                {"value": 6.5, "signal_field": "previous_record_value", "rendered_as": "6.5%"},
            ],
        }],
        "tags": ["labour", "latvia", "unemployment"],
    })

    generated = generate_article(signal, writer, max_attempts=1)

    assert writer.calls, "exercise the generator, not a fabricated Article fixture"
    assert generated.article.provenance["sources"] == [latvia.source.to_json()]
    assert generated.article.provenance["sources"][0]["evidence_snapshot_id"]
    snapshot_id = generated.article.provenance["sources"][0]["evidence_snapshot_id"]
    assert public.document(f"snapshots/{snapshot_id}/manifest.json")["status"] == "complete"
    assert generated.publishable, generated.verdict.failure_summary()
    prose = [block.text for block in generated.article.body if block.type == "paragraph"]
    articles = ArticleStore(local_dir=production_directory / "articles", account_url="")
    report = RunReport(series=series, generated=[generated])

    await _store_all(articles, report)
    stored = await articles.read_published(generated.article.slug)

    assert not report.errors
    assert stored is not None
    assert stored["provenance"]["sources"] == [latvia.source.to_json()]
    assert stored["provenance"]["sources"][0]["evidence_snapshot_id"] == snapshot_id
    assert [block["text"] for block in stored["body"] if block["type"] == "paragraph"] == prose
    observations = stored["provenance"]["published_observations"]
    assert observations, "the existing FrozenEvidence table must retain its publication-time readings"
    published_cells = {
        (value["geography"], value["period"], value["value"])
        for value in observations if value["raw_source"]
    }
    assert {("LV", "2021-01", 6.8), ("LV", "2020-01", 6.5)} <= published_cells
    assert {value["observed_at"] for value in observations} == {latvia.source.retrieved_at}
    normalized = public.document(f"snapshots/{snapshot_id}/normalized.json")
    original_cells = {
        (value["geo"], value["period"], value["value"]) for value in normalized["rows"]
        if not value["missing"]
    }
    assert published_cells <= original_cells


def test_archive_only_replay_and_compare_commands_never_request_a_model(
    production_directory: Path,
) -> None:
    store = EvidenceStore(production_directory)
    item = original_item()
    store.put("raw/" + item.archive_name, item.body)
    manifest = workflow.commit_snapshot(store, item)

    assert evidence_main([
        "--directory", str(production_directory), "replay", manifest["snapshot_id"],
        "--export-directory", str(production_directory / "review"),
    ]) == 0
    assert evidence_main([
        "--directory", str(production_directory), "compare",
        manifest["snapshot_id"], manifest["snapshot_id"],
        "--output", str(production_directory / "comparison.json"),
    ]) == 0
    assert json.loads((production_directory / "comparison.json").read_bytes())["unchanged"] is True
    assert (production_directory / "review" / "source.json").read_bytes() == item.body


def test_collect_only_cli_uses_real_collector_and_never_calls_editorial_models(
    production_directory: Path, collector_clock: SimpleNamespace, monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_client = httpx.AsyncClient
    requests: list[httpx.Request] = []
    body = raw_bytes()

    def response(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, content=body, headers={"content-type": "application/json"})

    def offline_client(**kwargs: Any) -> httpx.AsyncClient:
        return real_client(transport=httpx.MockTransport(response), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", create_autospec(real_client, side_effect=offline_client))

    result = evidence_main(["--directory", str(production_directory), "collect-only"])

    assert result == 0
    assert len(requests) == 1
    index = json.loads((production_directory / "public" / "index.json").read_bytes())
    assert index["last_attempt"]["status"] == "captured"
    snapshot_id = index["latest_snapshot_id"]
    assert (production_directory / "public" / "snapshots" / snapshot_id / "source.json").read_bytes() == body


def test_publish_audited_cli_is_offline_and_retries_existing_packs_without_models(
    production_directory: Path,
) -> None:
    source = EvidenceStore(production_directory)
    original_retrievals: list[str] = []
    for day, snapshot_id in enumerate(production.AUDITED_LEGACY_IDS, start=6):
        item = original_item(retrieved_at=f"2020-03-{day:02d}T10:00:00Z")
        original_retrievals.append(item.retrieved_at)
        source.put("raw/" + item.archive_name, item.body)
        workflow.commit_snapshot(source, item, snapshot_id=snapshot_id)

    first = evidence_main(["--directory", str(production_directory), "publish-audited"])
    second = evidence_main(["--directory", str(production_directory), "publish-audited"])

    assert first == second == 0
    public = production_directory / "public"
    month = json.loads((public / "months" / "2020-03.json").read_bytes())
    assert len(month["snapshots"]) == len(production.AUDITED_LEGACY_IDS)
    assert {entry["snapshot_id"] for entry in month["snapshots"]} == set(production.AUDITED_LEGACY_IDS)
    index = json.loads((public / "index.json").read_bytes())
    assert index["last_success_at"] == max(original_retrievals)
    assert index["last_attempt"]["attempted_at"] != index["last_success_at"]
    for snapshot_id in production.AUDITED_LEGACY_IDS:
        assert (public / "snapshots" / snapshot_id / "source.json").read_bytes() == raw_bytes()
