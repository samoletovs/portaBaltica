"""Production evidence acceptance tests; synthetic bytes and in-memory Blob I/O."""

from __future__ import annotations

import hashlib
import json
import shutil
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import NonCallableMagicMock, call, create_autospec
from uuid import uuid4

import httpx
import pytest
from azure.core import MatchConditions
from azure.core.exceptions import (
    ResourceExistsError,
    ResourceModifiedError,
    ResourceNotFoundError,
    ServiceRequestError,
)
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobClient, BlobServiceClient, ContainerClient, StorageStreamDownloader

from newsroom.pipeline import config
from newsroom.pipeline.evidence import catalogue, production, workflow
from newsroom.pipeline.evidence import store as evidence_store
from newsroom.pipeline.evidence.production import EvidenceService
from newsroom.pipeline.evidence.store import EvidenceStore
from newsroom.pipeline.models import RawItem
from newsroom.tests.pipeline.test_evidence_archive import EXPECTED_ROWS, SOURCE_URL, raw_bytes, source_payload

JsonDict = dict[str, Any]
PREFIX = "evidence/v1/"


class MemoryBlobs:
    """SDK-shaped storage with enforced create-only writes and optimistic concurrency."""

    def __init__(self, *, fail_suffix: str | None = None) -> None:
        self.bodies: dict[str, bytes] = {}
        self.etags: dict[str, str] = {}
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.lock = threading.RLock()
        self.fail_suffix = fail_suffix
        self.client = create_autospec(ContainerClient, instance=True, spec_set=True)
        self.client.upload_blob.side_effect = self.upload
        self.client.download_blob.side_effect = self.download
        self.client.get_blob_client.side_effect = self.blob
        self.conflicts = 0
        self.interleave_name: str | None = None
        self.interleave_body: bytes | None = None
        self.read_barrier: threading.Barrier | None = None
        self.barrier_name: str | None = None
        self.barrier_reads = 0

    def seed(self, name: str, body: bytes) -> None:
        with self.lock:
            self.bodies[name] = body
            self.etags[name] = f'"{uuid4().hex}"'

    def upload(self, name: str, data: bytes, **kwargs: Any) -> NonCallableMagicMock:
        with self.lock:
            self.calls.append(("write", name, dict(kwargs)))
            if self.fail_suffix and name.endswith(self.fail_suffix):
                raise ServiceRequestError(
                    "synthetic write failure AccountKey=PRIVATE_SENTINEL; "
                    "https://private.invalid/approval?sig=PRIVATE_SENTINEL",
                )
            if name == self.interleave_name and self.interleave_body is not None:
                self.seed(name, self.interleave_body)
                self.interleave_body = None
            exists = name in self.bodies
            if kwargs.get("match_condition") == MatchConditions.IfNotModified:
                assert kwargs.get("etag"), "a conditional replacement needs the downloaded ETag"
                if not exists or kwargs["etag"] != self.etags[name]:
                    self.conflicts += 1
                    raise ResourceModifiedError("synthetic stale ETag", status_code=412)
            if kwargs.get("if_match") and kwargs["if_match"] != self.etags.get(name):
                self.conflicts += 1
                raise ResourceModifiedError("synthetic stale ETag", status_code=412)
            absent_only = (
                not kwargs.get("overwrite", False)
                or kwargs.get("if_none_match") == "*"
                or kwargs.get("match_condition") == MatchConditions.IfMissing
            )
            if exists and absent_only:
                raise ResourceExistsError("synthetic existing object", status_code=409)
            self.seed(name, bytes(data))
            return self.blob(name)

    def download(self, blob: str, **kwargs: Any) -> StorageStreamDownloader:
        with self.lock:
            self.calls.append(("read", blob, dict(kwargs)))
            if blob not in self.bodies:
                raise ResourceNotFoundError("synthetic absent object", status_code=404)
            body, etag = self.bodies[blob], self.etags[blob]
            sync = (
                self.read_barrier if blob == self.barrier_name and self.barrier_reads < 2 else None
            )
            if sync is not None:
                self.barrier_reads += 1
        if sync is not None:
            sync.wait(timeout=10)
        result = create_autospec(StorageStreamDownloader, instance=True)
        result.readall.return_value = body
        result.properties = SimpleNamespace(etag=etag)
        return result

    def blob(self, name: str) -> NonCallableMagicMock:
        result = create_autospec(BlobClient, instance=True, spec_set=True)
        result.upload_blob.side_effect = lambda data, **kwargs: self.upload(name, data, **kwargs)
        result.download_blob.side_effect = lambda **kwargs: self.download(name, **kwargs)

        def properties(**kwargs: Any) -> SimpleNamespace:
            with self.lock:
                if name not in self.bodies:
                    raise ResourceNotFoundError("synthetic absent object", status_code=404)
                return SimpleNamespace(etag=self.etags[name])

        result.get_blob_properties.side_effect = properties
        result.exists.side_effect = lambda **kwargs: name in self.bodies
        return result

    def document(self, name: str) -> JsonDict:
        return json.loads(self.bodies[PREFIX + name])


@pytest.fixture
def production_directory() -> Iterator[Path]:
    directory = Path(__file__).resolve().parents[3] / ".newsroom-evidence" / "tests" / uuid4().hex
    directory.mkdir(parents=True)
    try:
        yield directory
    finally:
        shutil.rmtree(directory)


@pytest.fixture(autouse=True)
def forbid_live_network(monkeypatch: pytest.MonkeyPatch) -> None:
    for transport, method in (
        (httpx.HTTPTransport, "handle_request"),
        (httpx.AsyncHTTPTransport, "handle_async_request"),
    ):
        monkeypatch.setattr(
            transport, method,
            create_autospec(getattr(transport, method), side_effect=AssertionError("real network forbidden")),
        )


def original_item(
    *, retrieved_at: str = "2020-03-06T10:00:00Z", body: bytes | None = None,
    from_cache: bool = False, url: str = SOURCE_URL,
) -> RawItem:
    return RawItem(
        source_id="eurostat", url=url, retrieved_at=retrieved_at,
        content_type="application/json", body=raw_bytes() if body is None else body,
        http_status=200, from_cache=from_cache, etag='"synthetic-eurostat"',
    )


def expected_binding_key(item: RawItem) -> str:
    return hashlib.sha256(
        f"eurostat\nune_rt_m\n{item.retrieved_at}\n{item.url}".encode("utf-8"),
    ).hexdigest()


def service_for(
    directory: Path, *, public: MemoryBlobs | None = None, private: MemoryBlobs | None = None,
) -> tuple[EvidenceService, MemoryBlobs]:
    public = public or MemoryBlobs()
    canonical = EvidenceStore(directory / "private", container=private.client if private else None)
    return EvidenceService(canonical, EvidenceStore(directory / "public", container=public.client)), public


def entry(snapshot_id: str, observed_at: str) -> JsonDict:
    return {
        "snapshot_id": snapshot_id, "observed_at": observed_at,
        "source_updated_at": "2020-03-04T08:00:00Z",
        "row_count": 6, "missing_count": 2, "flagged_count": 5,
    }


def assert_complete_public_pack(blobs: MemoryBlobs, snapshot_id: str, item: RawItem) -> JsonDict:
    base = f"snapshots/{snapshot_id}/"
    manifest = blobs.document(base + "manifest.json")
    assert manifest["status"] == "complete"
    assert manifest["snapshot_id"] == snapshot_id
    assert manifest["provenance"]["sha256"] == hashlib.sha256(item.body).hexdigest()
    assert manifest["provenance"]["request_url"] == item.url
    assert manifest["provenance"]["retrieved_at"] == item.retrieved_at
    assert blobs.bodies[PREFIX + base + "source.json"] == item.body
    assert blobs.document(base + "normalized.json")["rows"] == EXPECTED_ROWS
    assert manifest["row_count"] == 6
    assert manifest["missing_count"] == 2
    assert manifest["flagged_count"] == 5
    for filename in ("normalized.json", "observations.csv", "dictionary.json"):
        assert manifest["artifacts"][filename]["sha256"] == hashlib.sha256(
            blobs.bodies[PREFIX + base + filename],
        ).hexdigest()
    return manifest


def test_capture_publishes_exact_checked_artifacts_before_manifest_binding_and_catalogue(
    production_directory: Path,
) -> None:
    service, public = service_for(production_directory)
    item = original_item()

    outcome = service.capture_item(item)

    assert outcome["status"] == "captured"
    snapshot_id = outcome["snapshot_id"]
    assert_complete_public_pack(public, snapshot_id, item)
    writes = [name for method, name, _ in public.calls if method == "write"]
    manifest_position = writes.index(PREFIX + f"snapshots/{snapshot_id}/manifest.json")
    for filename in ("source.json", "normalized.json", "observations.csv", "dictionary.json"):
        assert writes.index(PREFIX + f"snapshots/{snapshot_id}/{filename}") < manifest_position
    binding_name = f"bindings/{expected_binding_key(item)}.json"
    assert writes.index(PREFIX + binding_name) > manifest_position
    assert writes.index(PREFIX + "months/2020-03.json") > manifest_position
    assert public.document(binding_name) == {
        "version": 1, "source_id": "eurostat", "dataset": "une_rt_m",
        "observed_at": item.retrieved_at, "request_url": item.url,
        "snapshot_id": snapshot_id, "raw_sha256": hashlib.sha256(item.body).hexdigest(),
    }
    index = public.document("index.json")
    assert index["latest_snapshot_id"] == snapshot_id
    assert index["months"] == ["2020-03"]
    assert index["last_success_at"] == item.retrieved_at
    assert [value["snapshot_id"] for value in public.document("months/2020-03.json")["snapshots"]] == [snapshot_id]
    assert service.canonical.read("raw/" + item.archive_name) == item.body
    assert all(name.startswith(PREFIX) for name in public.bodies)


def test_binding_key_is_the_exact_original_tuple_with_real_newline_separators() -> None:
    item = original_item()
    expected = expected_binding_key(item)

    assert production.binding_key("eurostat", "une_rt_m", item.retrieved_at, item.url) == expected
    assert expected != hashlib.sha256(
        f"eurostat\\nune_rt_m\\n{item.retrieved_at}\\n{item.url}".encode(),
    ).hexdigest()
    reordered_url = item.url.replace("freq=M&s_adj=SA", "s_adj=SA&freq=M")
    assert production.binding_key("eurostat", "une_rt_m", item.retrieved_at, reordered_url) != expected
    assert production.binding_key("eurostat", "une_rt_m", item.retrieved_at + " ", item.url) != expected


@pytest.mark.parametrize("setting", [None, "", "false", "1"])
def test_production_archive_is_opt_in(setting: str | None, monkeypatch: pytest.MonkeyPatch) -> None:
    if setting is None:
        monkeypatch.delenv("NEWSROOM_EVIDENCE_ENABLED", raising=False)
    else:
        monkeypatch.setenv("NEWSROOM_EVIDENCE_ENABLED", setting)

    assert production.enabled() is False

    monkeypatch.setenv("NEWSROOM_EVIDENCE_ENABLED", "true")
    assert production.enabled() is True


@pytest.mark.parametrize("production_mode", [False, True], ids=["pilot-cloud", "production-cloud"])
def test_cloud_context_reuses_one_credential_with_supported_developer_process_timeout(
    production_directory: Path, monkeypatch: pytest.MonkeyPatch, production_mode: bool,
) -> None:
    module = production if production_mode else evidence_store
    credential_factory = create_autospec(DefaultAzureCredential, spec_set=True)
    credential = credential_factory.return_value
    credential.__enter__.return_value = credential
    credential.get_token.side_effect = AssertionError("factory test must not request tokens")
    blob_factory = create_autospec(BlobServiceClient, spec_set=True)
    blobs = blob_factory.return_value
    blobs.__enter__.return_value = blobs
    containers = {
        name: create_autospec(ContainerClient, instance=True, spec_set=True)
        for name in ("raw-feeds", "articles")
    }
    blobs.get_container_client.side_effect = containers.__getitem__
    monkeypatch.setattr(module, "DefaultAzureCredential", credential_factory)
    monkeypatch.setattr(module, "BlobServiceClient", blob_factory)
    account_url = "https://evidence-fixture.blob.core.windows.net"
    monkeypatch.setattr(config, "STORAGE_ACCOUNT_URL", account_url)
    monkeypatch.setattr(config, "RAW_CONTAINER", "raw-feeds")
    monkeypatch.setattr(config, "ARTICLES_CONTAINER", "articles")
    context = (
        production.open_production(production_directory) if production_mode
        else evidence_store.open_store(production_directory, cloud=True)
    )

    with context as opened:
        stores = [opened.canonical, opened.public] if production_mode else [opened]
        for store in stores:
            store.put("factory-smoke/first.json", b"{}")
            store.put("factory-smoke/second.json", b"{}")
        credential_factory.assert_called_once_with(process_timeout=60)
        blob_factory.assert_called_once_with(account_url, credential=credential)
        assert stores[0].container is containers["raw-feeds"]
        if production_mode:
            assert stores[1].container is containers["articles"]

    assert blobs.get_container_client.call_args_list == (
        [call("raw-feeds"), call("articles")] if production_mode else [call("raw-feeds")]
    )
    credential.get_token.assert_not_called()
    credential.__exit__.assert_called_once()
    blobs.__exit__.assert_called_once()


@pytest.mark.parametrize("invalid", ["", "\nmissing", "original\r\ninjected"])
def test_binding_does_not_guess_or_accept_ambiguous_original_urls(invalid: str) -> None:
    with pytest.raises(ValueError):
        production.binding_key("eurostat", "une_rt_m", "2020-03-06T10:00:00Z", invalid)


def test_retries_and_cached_reads_share_one_vintage_without_refreshing_source_time(
    production_directory: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_attempt = datetime(2020, 3, 6, 10, tzinfo=timezone.utc)
    monkeypatch.setattr(production, "utcnow", lambda: first_attempt)
    monkeypatch.setattr(workflow, "utcnow", lambda: first_attempt)
    service, public = service_for(production_directory)
    item = original_item()
    first = service.capture_item(item)
    immutable = {name: body for name, body in public.bodies.items() if "/snapshots/" in name}
    later = datetime(2020, 3, 9, 10, tzinfo=timezone.utc)
    monkeypatch.setattr(production, "utcnow", lambda: later)
    monkeypatch.setattr(workflow, "utcnow", lambda: later)
    reopened = EvidenceService(service.canonical, service.public)

    retry = reopened.capture_item(item)
    cached = reopened.capture_item(replace(item, from_cache=True))

    assert first["status"] != "failed" and retry["status"] != "failed"
    assert cached["status"] == "reused"
    assert first["snapshot_id"] == retry["snapshot_id"] == cached["snapshot_id"]
    assert {name: body for name, body in public.bodies.items() if "/snapshots/" in name} == immutable
    assert len(public.document("months/2020-03.json")["snapshots"]) == 1
    index = public.document("index.json")
    assert index["last_success_at"] == item.retrieved_at
    assert index["last_attempt"]["attempted_at"] == "2020-03-09T10:00:00Z"
    assert index["last_attempt"]["status"] == "reused"


def test_same_bytes_retrieved_at_a_new_time_are_a_distinct_source_observation(
    production_directory: Path,
) -> None:
    service, public = service_for(production_directory)
    first = service.capture_item(original_item())

    later = service.capture_item(original_item(retrieved_at="2020-03-07T10:00:00Z"))

    assert later["status"] == "unchanged"
    assert later["snapshot_id"] != first["snapshot_id"]
    assert len(public.document("months/2020-03.json")["snapshots"]) == 2
    assert public.document("index.json")["last_success_at"] == "2020-03-07T10:00:00Z"


def test_failed_attempt_retains_last_fresh_source_time_and_last_completed_snapshot(
    production_directory: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2020, 3, 6, 10, tzinfo=timezone.utc)
    monkeypatch.setattr(production, "utcnow", lambda: now)
    service, public = service_for(production_directory)
    item = original_item()
    successful = service.capture_item(item)
    now = datetime(2020, 3, 8, 10, tzinfo=timezone.utc)

    outcome = service.record_failure()

    index = public.document("index.json")
    assert outcome["status"] == "failed"
    assert index["last_attempt"]["status"] == "failed"
    assert index["last_attempt"]["attempted_at"] == "2020-03-08T10:00:00Z"
    assert index["last_success_at"] == item.retrieved_at
    assert index["latest_snapshot_id"] == successful["snapshot_id"]
    assert len(public.document("months/2020-03.json")["snapshots"]) == 1


def test_conflicting_bytes_for_one_original_tuple_never_overwrite_its_binding(
    production_directory: Path,
) -> None:
    service, public = service_for(production_directory)
    item = original_item()
    first = service.capture_item(item)
    immutable = {
        name: body for name, body in public.bodies.items()
        if "/snapshots/" in name or "/bindings/" in name
    }

    conflict = service.capture_item(replace(item, body=item.body + b"\n"))

    assert first["status"] != "failed"
    assert conflict["status"] == "failed"
    assert not conflict.get("snapshot_id")
    assert {
        name: body for name, body in public.bodies.items()
        if "/snapshots/" in name or "/bindings/" in name
    } == immutable
    assert len(public.document("months/2020-03.json")["snapshots"]) == 1


@pytest.mark.parametrize("filename", ["source.json", "normalized.json", "observations.csv", "dictionary.json", "manifest.json"])
def test_failed_public_artifact_never_creates_a_complete_pack_or_binding(
    production_directory: Path, filename: str,
) -> None:
    public = MemoryBlobs(fail_suffix="/" + filename)
    service, _ = service_for(production_directory, public=public)

    outcome = service.capture_item(original_item())

    assert outcome["status"] == "failed"
    assert not outcome.get("snapshot_id")
    assert not any(name.endswith("/manifest.json") for name in public.bodies)
    assert not any("/bindings/" in name for name in public.bodies)
    index = public.document("index.json")
    assert index["latest_snapshot_id"] is None and index["recent"] == []
    assert index["last_success_at"] is None
    assert index["last_attempt"]["status"] == "failed"
    serialized = json.dumps(index)
    assert "PRIVATE_SENTINEL" not in serialized
    assert "private.invalid" not in serialized
    assert len(index["last_attempt"]["error"]) <= 300
    results = list(service.canonical.root.glob("runs/*/result.json"))
    assert len(results) == 1
    assert json.loads(results[0].read_bytes())["status"] == "failed"


def test_authoritative_private_failure_cannot_become_local_only_public_success(
    production_directory: Path,
) -> None:
    private = MemoryBlobs(fail_suffix=".raw")
    service, public = service_for(production_directory, private=private)

    outcome = service.capture_item(original_item())

    assert outcome["status"] == "failed" and not outcome.get("snapshot_id")
    assert public.document("index.json")["last_attempt"]["status"] == "failed"
    assert not any("/snapshots/" in name or "/bindings/" in name for name in public.bodies)
    assert not any("/manifest.json" in name for name in private.bodies)
    assert not (production_directory / "private" / "snapshots").exists()
    assert not (production_directory / "private" / "raw").exists()


def test_interrupted_index_publication_can_be_retried_without_rewriting_the_pack(
    production_directory: Path,
) -> None:
    public = MemoryBlobs(fail_suffix="/index.json")
    service, _ = service_for(production_directory, public=public)
    item = original_item()
    failed = service.capture_item(item)
    pack = {name: body for name, body in public.bodies.items() if "/snapshots/" in name}
    assert failed["status"] == "failed" and not failed.get("snapshot_id")
    assert any(name.endswith("/manifest.json") for name in pack)
    public.fail_suffix = None

    retried = EvidenceService(service.canonical, service.public).capture_item(item)

    assert retried["status"] != "failed"
    assert {name: body for name, body in public.bodies.items() if "/snapshots/" in name} == pack
    assert public.document("index.json")["latest_snapshot_id"] == retried["snapshot_id"]
    assert len(public.document("months/2020-03.json")["snapshots"]) == 1


def test_partial_snapshot_retry_survives_a_newer_capture_completing_first(
    production_directory: Path,
) -> None:
    service, public = service_for(production_directory)
    first = service.capture_item(original_item())
    changed = source_payload()
    changed["value"]["1"] = 6.9
    middle = original_item(retrieved_at="2020-03-08T10:00:00Z", body=raw_bytes(changed))
    middle_id = production.snapshot_id_for(middle)
    public.fail_suffix = "/manifest.json"
    failed = service.capture_item(middle)
    prefix = PREFIX + f"snapshots/{middle_id}/"
    partial_pack = {name: body for name, body in public.bodies.items() if name.startswith(prefix)}
    assert failed["status"] == "failed"
    assert prefix + "comparison.json" in partial_pack
    assert prefix + "manifest.json" not in partial_pack
    public.fail_suffix = None
    changed["value"]["1"] = 7.1
    newest = service.capture_item(
        original_item(retrieved_at="2020-03-09T10:00:00Z", body=raw_bytes(changed)),
    )
    assert newest["status"] != "failed"

    retry = EvidenceService(service.canonical, service.public).capture_item(middle)

    assert retry["status"] != "failed"
    assert retry["snapshot_id"] == middle_id
    assert all(public.bodies[name] == body for name, body in partial_pack.items())
    manifest = public.document(f"snapshots/{middle_id}/manifest.json")
    assert manifest["previous_snapshot_id"] == first["snapshot_id"]
    assert public.document(f"snapshots/{middle_id}/comparison.json")["before"] == first["snapshot_id"]
    assert public.document("index.json")["latest_snapshot_id"] == newest["snapshot_id"]
    assert len(public.document("months/2020-03.json")["snapshots"]) == 3


def test_publishing_an_audited_import_removes_private_origin_metadata(
    production_directory: Path,
) -> None:
    service, public = service_for(production_directory)
    item = original_item()
    service.canonical.put("raw/" + item.archive_name, item.body)
    manifest = workflow.commit_snapshot(
        service.canonical, item,
        origin={
            "kind": "audited_legacy_import",
            "storage_account_url": "https://PRIVATE_SENTINEL.blob.core.windows.net",
            "blob_name": "raw-feeds/private-audits/PRIVATE_SENTINEL.raw",
            "imported_at": "2020-03-08T10:00:00Z",
        },
    )
    canonical_manifest = service.canonical.read(f"snapshots/{manifest['snapshot_id']}/manifest.json")

    service.publish_snapshot(manifest["snapshot_id"])

    published = assert_complete_public_pack(public, manifest["snapshot_id"], item)
    assert "PRIVATE_SENTINEL" not in json.dumps(published)
    assert "storage_account_url" not in json.dumps(published)
    assert "blob_name" not in json.dumps(published)
    assert published["provenance"]["request_url"] == item.url
    assert service.canonical.read(f"snapshots/{manifest['snapshot_id']}/manifest.json") == canonical_manifest


def test_monthly_history_is_complete_even_when_recent_is_bounded(
    production_directory: Path,
) -> None:
    public = MemoryBlobs()
    store = EvidenceStore(production_directory, public.client)
    captures = [entry(f"{number:032x}", f"2020-03-{number + 1:02d}T10:00:00Z") for number in range(30)]

    for capture in reversed(captures):
        catalogue.publish_entry(store, capture)
    catalogue.publish_entry(store, captures[0])

    month = public.document("months/2020-03.json")["snapshots"]
    assert len(month) == 30
    assert {capture["snapshot_id"] for capture in month} == {capture["snapshot_id"] for capture in captures}
    index = public.document("index.json")
    assert len(index["recent"]) < len(month)
    assert index["latest_snapshot_id"] == captures[-1]["snapshot_id"]
    assert index["months"] == ["2020-03"]


@pytest.mark.parametrize("different_months", [False, True], ids=["monthly-CAS", "index-CAS"])
def test_concurrent_catalogue_updates_retry_conflicts_without_lost_entries(
    production_directory: Path, different_months: bool,
) -> None:
    public = MemoryBlobs()
    store = EvidenceStore(production_directory, public.client)
    initial = entry("a" * 32, "2020-03-01T10:00:00Z")
    catalogue.publish_entry(store, initial)
    older = entry("b" * 32, "2020-03-03T10:00:00Z")
    newer = entry("c" * 32, "2020-04-02T10:00:00Z" if different_months else "2020-03-04T10:00:00Z")
    public.read_barrier = threading.Barrier(2)
    public.barrier_name = PREFIX + ("index.json" if different_months else "months/2020-03.json")

    with ThreadPoolExecutor(max_workers=2) as workers:
        jobs = [workers.submit(catalogue.publish_entry, store, capture) for capture in (newer, older)]
        for job in jobs:
            job.result(timeout=15)

    assert public.conflicts >= 1, "the test must exercise an actual stale-ETag retry"
    index = public.document("index.json")
    assert {capture["snapshot_id"] for capture in index["recent"]} == {"a" * 32, "b" * 32, "c" * 32}
    assert index["latest_snapshot_id"] == newer["snapshot_id"]
    assert index["months"] == (["2020-04", "2020-03"] if different_months else ["2020-03"])
    discovered = {
        capture["snapshot_id"] for month in index["months"]
        for capture in public.document(f"months/{month}.json")["snapshots"]
    }
    assert discovered == {"a" * 32, "b" * 32, "c" * 32}


def test_late_finishing_older_attempt_cannot_hide_a_newer_failure_or_refresh_old_data(
    production_directory: Path,
) -> None:
    public = MemoryBlobs()
    store = EvidenceStore(production_directory, public.client)
    failure = {"attempted_at": "2020-03-09T10:00:00Z", "finished_at": "2020-03-09T10:01:00Z", "status": "failed"}
    older = {"attempted_at": "2020-03-08T10:00:00Z", "finished_at": "2020-03-09T10:02:00Z", "status": "reused"}
    catalogue.record_attempt(store, failure)

    catalogue.record_attempt(store, older, observed_at="2020-03-01T10:00:00Z")

    index = public.document("index.json")
    assert index["last_attempt"] == failure
    assert index["last_success_at"] == "2020-03-01T10:00:00Z"
    assert index["stale_after_hours"] > 0


@pytest.mark.parametrize("name", ["snapshots/" + "a" * 32 + "/manifest.json", "bindings/" + "b" * 64 + ".json"])
def test_mutable_catalogue_api_cannot_overwrite_immutable_releases(
    production_directory: Path, name: str,
) -> None:
    store = EvidenceStore(production_directory)
    store.put(name, b"original evidence")
    _, etag = store.read_version(name)

    with pytest.raises(ValueError):
        store.replace(name, b"replaced evidence", etag=etag)

    assert store.read(name) == b"original evidence"
