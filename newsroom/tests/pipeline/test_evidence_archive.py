"""Offline acceptance tests for the evidence pilot, using synthetic source bytes."""

from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import math
import shutil
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import NonCallableMagicMock, create_autospec
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import pytest
from azure.core.exceptions import ResourceExistsError, ServiceRequestError
from azure.storage.blob import ContainerClient, ContentSettings, StorageStreamDownloader

from newsroom.pipeline.collect import httpclient as collector_http
from newsroom.pipeline.evidence import workflow
from newsroom.pipeline.evidence.codec import compare_rows, csv_bytes, normalize
from newsroom.pipeline.evidence.store import EvidenceStore

JsonDict = dict[str, Any]

RETRIEVED_AT = "2020-03-06T10:00:00Z"
SOURCE_UPDATED_AT = "2020-03-04T08:00:00Z"
SOURCE_URL = (
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m"
    "?freq=M&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT&geo=EE&geo=LV&geo=LT"
    "&sinceTimePeriod=2020-01&lang=en"
)
MEASUREMENT = {"freq": "M", "s_adj": "SA", "age": "TOTAL", "sex": "T", "unit": "PC_ACT"}
EXPECTED_ROWS = [
    {"geo": "EE", "period": "2020-01", "value": 0, "status": "p", "missing": False},
    {"geo": "EE", "period": "2020-02", "value": 4.2, "status": "e b", "missing": False},
    {"geo": "LT", "period": "2020-01", "value": 5.9, "status": "", "missing": False},
    {"geo": "LT", "period": "2020-02", "value": None, "status": ":", "missing": True},
    {"geo": "LV", "period": "2020-01", "value": 6.8, "status": "p", "missing": False},
    {"geo": "LV", "period": "2020-02", "value": None, "status": "u", "missing": True},
]


def source_payload(*, dense: bool = False) -> JsonDict:
    """Two hand-indexed layouts of the same small cube; no production encoder."""
    if dense:
        ids = ["time", "sex", "s_adj", "unit", "age", "geo", "freq"]
        geos = ["EE", "LT", "LV", "FI"]
        periods = ["2020-02", "2019-12", "2020-01"]
        values: Any = [4.2, None, None, 43, 97, 98, 99, 91, 0, 5.9, 6.8, 42]
        statuses: Any = ["e b", ":", "u", None, None, None, None, None, "p", None, "p", None]
    else:
        ids = ["freq", "unit", "geo", "time", "s_adj", "age", "sex"]
        geos = ["LV", "FI", "LT", "EE"]
        periods = ["2019-12", "2020-01", "2020-02"]
        values = {
            "0": 99, "1": 6.8, "3": 91, "4": 42, "5": 43,
            "6": 98, "7": 5.9, "8": None, "9": 97, "10": 0, "11": 4.2,
        }
        statuses = {"1": "p", "2": "u", "8": ":", "10": "p", "11": "e b"}
    codes = {**{name: [value] for name, value in MEASUREMENT.items()}, "geo": geos, "time": periods}
    dimensions = {
        name: {
            "label": name,
            "category": {
                # Sparse index insertion order deliberately disagrees with position.
                "index": list(categories) if dense else {
                    code: position for position, code in reversed(list(enumerate(categories)))
                },
                "label": {code: code for code in categories},
            },
        }
        for name, categories in codes.items()
    }
    return {
        "class": "dataset", "version": "2.0", "label": "Synthetic unemployment fixture",
        "id": ids, "size": [len(codes[name]) for name in ids], "dimension": dimensions,
        "value": values, "status": statuses, "updated": SOURCE_UPDATED_AT,
        "extension": {"fixture_note": "Synthetic test observations, not market evidence."},
    }


def raw_bytes(payload: JsonDict | None = None) -> bytes:
    return (json.dumps(source_payload() if payload is None else payload, indent=1) + "\n\n").encode()


def expected_csv(provenance: JsonDict) -> bytes:
    header = (
        "series_id,dataset,freq,s_adj,age,sex,unit,geo,period,value,status,missing,"
        "observed_at,source_updated_at,source_url,raw_sha256\n"
    )
    coordinate_rows = [
        "EE,2020-01,0,p,false", "EE,2020-02,4.2,e b,false",
        "LT,2020-01,5.9,,false", "LT,2020-02,,:,true",
        "LV,2020-01,6.8,p,false", "LV,2020-02,,u,true",
    ]
    return (
        header + "".join(
            f"baltic-unemployment-v1,une_rt_m,M,SA,TOTAL,T,PC_ACT,{row},"
            f"{provenance['retrieved_at']},{SOURCE_UPDATED_AT},"
            f"{provenance['request_url']},{provenance['sha256']}\n"
            for row in coordinate_rows
        )
    ).encode()


def comparison_pack(rows: list[JsonDict]) -> JsonDict:
    return {
        "format_version": 1, "series_id": "baltic-unemployment-v1", "dataset": "une_rt_m",
        "selection": dict(MEASUREMENT), "start_period": "2020-01",
        "dimension_labels": {}, "source_updated_at": SOURCE_UPDATED_AT,
        "rows": rows,
    }


def row(value: float | None, *, period: str = "2020-01", status: str = "") -> JsonDict:
    return {"geo": "LV", "period": period, "value": value, "status": status, "missing": value is None}


@pytest.fixture
def evidence_directory() -> Iterator[Path]:
    directory = Path(__file__).resolve().parents[3] / ".newsroom-evidence" / "tests" / uuid4().hex
    directory.mkdir(parents=True)
    try:
        yield directory
    finally:
        shutil.rmtree(directory)


@pytest.fixture(autouse=True)
def offline_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    def fixed_now() -> datetime:
        return datetime(2020, 3, 6, 10, tzinfo=timezone.utc)

    monkeypatch.setattr(workflow, "utcnow", fixed_now)
    monkeypatch.setattr(collector_http, "utcnow", fixed_now)
    for transport, method in (
        (httpx.HTTPTransport, "handle_request"),
        (httpx.AsyncHTTPTransport, "handle_async_request"),
    ):
        monkeypatch.setattr(
            transport, method,
            create_autospec(getattr(transport, method), side_effect=AssertionError("real network forbidden")),
        )


async def captured(
    store: EvidenceStore, body: bytes, *, previous: str | None = None,
    requests: list[httpx.Request] | None = None,
) -> JsonDict:
    def response(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        return httpx.Response(
            200, content=body,
            headers={"content-type": "application/json", "etag": '"synthetic-fixture"'},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        return await workflow.capture(store, client=client, previous=previous)


def artifact_path(store: EvidenceStore, manifest: JsonDict, artifact: str) -> Path:
    return store.root.joinpath(*manifest["artifacts"][artifact]["name"].split("/"))


def failed_attempt(directory: Path) -> JsonDict:
    results = [json.loads(path.read_bytes()) for path in directory.glob("runs/*/result.json")]
    failures = [result for result in results if result["status"] == "failed"]
    assert len(failures) == 1
    failure = failures[0]
    start = json.loads((directory / "runs" / failure["run_id"] / "started.json").read_bytes())
    assert failure["run_id"] == start["run_id"]
    assert failure["started_at"] == start["started_at"]
    assert failure["completed_at"]
    assert failure["error_type"]
    assert failure["error"]
    assert not failure.get("snapshot_id")
    return failure


def blob_double(*, fail_at: str | None = None) -> tuple[NonCallableMagicMock, dict[str, bytes]]:
    container = create_autospec(ContainerClient, instance=True, spec_set=True)
    bodies: dict[str, bytes] = {}

    def upload(
        *, name: str, data: bytes, overwrite: bool, content_settings: ContentSettings,
    ) -> None:
        assert overwrite is False, "the archive must not overwrite cloud evidence"
        if fail_at and ("/raw/" in name if fail_at == "raw" else name.endswith("/" + fail_at)):
            raise ServiceRequestError("synthetic authoritative write failure")
        if name in bodies:
            raise ResourceExistsError("already captured")
        bodies[name] = data

    def download(blob: str) -> StorageStreamDownloader:
        result = create_autospec(StorageStreamDownloader, instance=True, spec_set=True)
        result.readall.return_value = bodies[blob]
        return result

    container.upload_blob.side_effect = upload
    container.download_blob.side_effect = download
    return container, bodies


@pytest.mark.parametrize("dense", [False, True], ids=["sparse-geo-first", "dense-time-first"])
def test_selected_coordinates_survive_layout_changes_missing_cells_and_flags(dense: bool) -> None:
    normalized = normalize(raw_bytes(source_payload(dense=dense)))

    assert normalized["rows"] == EXPECTED_ROWS
    assert normalized["selection"] == MEASUREMENT
    assert normalized["dataset"] == "une_rt_m"
    assert normalized["source_updated_at"] == SOURCE_UPDATED_AT
    assert set(normalized["dimension_labels"]["geo"]["categories"]) == {"EE", "LV", "LT"}


def test_a_country_with_only_missing_selected_cells_is_not_discarded() -> None:
    payload = source_payload()
    del payload["value"]["1"]

    normalized = normalize(raw_bytes(payload))

    expected = copy.deepcopy(EXPECTED_ROWS)
    expected[4].update(value=None, missing=True)
    assert normalized["rows"] == expected


def test_dataset_wide_status_flag_is_preserved_for_missing_and_present_cells() -> None:
    payload = source_payload()
    payload["status"] = "p"

    normalized = normalize(raw_bytes(payload))

    assert [record["status"] for record in normalized["rows"]] == ["p"] * 6
    assert sum(record["missing"] for record in normalized["rows"]) == 2


@pytest.mark.parametrize(
    ("dimension", "categories"),
    [
        ("unit", ["NR"]), ("age", ["Y15-24"]), ("sex", ["F"]),
        ("freq", ["Q"]), ("s_adj", ["NSA"]), ("age", ["TOTAL", "Y15-24"]),
        ("unit", ["PC_ACT", "NR"]),
    ],
    ids=["wrong-unit", "wrong-age", "wrong-sex", "wrong-frequency", "unadjusted", "mixed-ages", "mixed-units"],
)
def test_unintended_measurement_dimensions_are_rejected(dimension: str, categories: list[str]) -> None:
    payload = source_payload()
    payload["dimension"][dimension]["category"] = {"index": categories}
    payload["size"][payload["id"].index(dimension)] = len(categories)
    payload["value"] = [6.8] * math.prod(payload["size"])
    payload["status"] = {}

    with pytest.raises(ValueError, match=r"(?i)(measurement|basis|dimension|" + dimension + ")"):
        normalize(raw_bytes(payload))


def test_an_unrecognised_dimension_cannot_be_silently_selected() -> None:
    payload = source_payload()
    payload["id"].append("education")
    payload["size"].append(1)
    payload["dimension"]["education"] = {"category": {"index": ["TOTAL"]}}

    with pytest.raises(ValueError, match="dimension"):
        normalize(raw_bytes(payload))


def test_ambiguous_geography_positions_are_not_guessed() -> None:
    payload = source_payload()
    payload["dimension"]["geo"]["category"]["index"]["EE"] = 0

    with pytest.raises(ValueError, match=r"(?i)(categor|position|ambiguous)"):
        normalize(raw_bytes(payload))


def test_csv_preserves_coordinates_missing_values_flags_and_original_provenance() -> None:
    body = raw_bytes()
    provenance = {
        "retrieved_at": RETRIEVED_AT, "request_url": SOURCE_URL,
        "sha256": hashlib.sha256(body).hexdigest(),
    }

    exported = csv_bytes(normalize(body), provenance)

    assert exported == expected_csv(provenance)
    assert b",0,p,false," in exported
    assert b",2020-02,,u,true," in exported


@pytest.mark.parametrize(
    ("before", "after", "kind", "revisions"),
    [
        (row(6.8), row(6.80001), "value_revision", 1),
        (row(6.8, status="p"), row(6.8, status="e"), "status_change", 0),
        (row(None, status="u"), row(6.4, status="p"), "filled_missing", 0),
        (row(6.8, status="p"), row(None, status=":"), "became_missing", 0),
        (row(None, status="u"), row(None, status=":"), "status_change", 0),
    ],
    ids=["sub-editorial-threshold", "flag-only", "missing-filled", "reading-removed", "missing-flag-change"],
)
def test_same_period_diffs_retain_both_values_and_flags(
    before: JsonDict, after: JsonDict, kind: str, revisions: int,
) -> None:
    result = compare_rows(comparison_pack([before]), comparison_pack([after]))

    assert result["unchanged"] is False
    assert result["value_revisions"] == revisions
    assert result["changes"] == [{
        "geo": "LV", "period": "2020-01", "kind": kind, "before": before, "after": after,
    }]


def test_new_month_is_not_a_revision_of_the_previous_reading() -> None:
    old = row(6.8)
    new = row(7.1, period="2020-02", status="p")

    result = compare_rows(comparison_pack([old]), comparison_pack([old, new]))

    assert result["value_revisions"] == 0
    assert result["changes"] == [{
        "geo": "LV", "period": "2020-02", "kind": "new_period", "before": None, "after": new,
    }]


def test_a_period_no_longer_returned_is_reported_not_silently_dropped() -> None:
    old = row(6.8)
    removed = row(7.1, period="2020-02")

    result = compare_rows(comparison_pack([old, removed]), comparison_pack([old]))

    assert result["value_revisions"] == 0
    assert result["changes"] == [{
        "geo": "LV", "period": "2020-02", "kind": "removed_period", "before": removed, "after": None,
    }]


def test_source_update_timestamp_alone_does_not_claim_an_observation_revision() -> None:
    before = comparison_pack([row(6.8)])
    after = copy.deepcopy(before)
    after["source_updated_at"] = "2020-03-05T08:00:00Z"

    result = compare_rows(before, after)

    assert result["changes"] == []
    assert result["value_revisions"] == 0
    assert result["unchanged"] is True


async def test_capture_can_be_replayed_offline_as_the_exact_evidence_pack(
    evidence_directory: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = raw_bytes()
    store = EvidenceStore(evidence_directory)
    requests: list[httpx.Request] = []
    outcome = await captured(store, body, requests=requests)
    assert len(requests) == 1
    assert urlsplit(str(requests[0].url)).path.endswith("/data/une_rt_m")
    query = parse_qs(urlsplit(str(requests[0].url)).query)
    assert {key: query[key] for key in MEASUREMENT} == {key: [value] for key, value in MEASUREMENT.items()}
    assert sorted(query["geo"]) == ["EE", "LT", "LV"]
    assert query["sinceTimePeriod"] == ["2020-01"]
    assert query["format"] == ["JSON"]
    assert set(query) <= set(MEASUREMENT) | {"geo", "sinceTimePeriod", "lang", "format"}
    monkeypatch.setattr(
        httpx.AsyncClient, "send",
        create_autospec(httpx.AsyncClient.send, side_effect=AssertionError("offline replay requested HTTP")),
    )
    monkeypatch.setattr(
        httpx.Client, "send",
        create_autospec(httpx.Client.send, side_effect=AssertionError("offline replay requested HTTP")),
    )
    export = evidence_directory / "review"

    replayed = workflow.replay(store, outcome["snapshot_id"], export_dir=export)

    manifest = replayed["manifest"]
    assert outcome["status"] == "captured"
    assert manifest["status"] == "complete"
    assert manifest["provenance"]["retrieved_at"] == RETRIEVED_AT
    assert manifest["provenance"]["sha256"] == hashlib.sha256(body).hexdigest()
    assert manifest["row_count"] == 6
    assert manifest["missing_count"] == 2
    assert manifest["flagged_count"] == 5
    assert replayed["data"]["rows"] == EXPECTED_ROWS
    assert (export / "source.json").read_bytes() == body
    expected = expected_csv(manifest["provenance"])
    assert (export / "observations.csv").read_bytes() == expected
    assert store.read(manifest["artifacts"]["observations.csv"]["name"]) == expected
    assert json.loads((export / "normalized.json").read_bytes()) == replayed["data"]
    assert json.loads((export / "manifest.json").read_bytes()) == manifest
    dictionary = json.loads((export / "dictionary.json").read_bytes())
    assert set(dictionary["columns"]) == set(next(csv.reader(io.StringIO(expected.decode()))))
    assert "Eurostat" in dictionary["attribution"]
    assert manifest["artifacts"]["dictionary.json"]["sha256"] == hashlib.sha256(
        (export / "dictionary.json").read_bytes(),
    ).hexdigest()
    assert "modifications" in manifest and "disclaimer" in manifest


@pytest.mark.parametrize("reordered", [False, True], ids=["identical-bytes", "reordered-equivalent-cube"])
async def test_unchanged_capture_still_records_a_new_observation_attempt(
    evidence_directory: Path, reordered: bool,
) -> None:
    store = EvidenceStore(evidence_directory)
    requests: list[httpx.Request] = []
    before = await captured(store, raw_bytes(), requests=requests)

    after = await captured(
        store, raw_bytes(source_payload(dense=reordered)),
        previous=before["snapshot_id"], requests=requests,
    )

    assert len(requests) == 2
    assert before["snapshot_id"] != after["snapshot_id"]
    assert before["run_id"] != after["run_id"]
    assert after["status"] == "unchanged"
    assert after["comparison"]["changes"] == []
    assert len(list(evidence_directory.glob("runs/*/result.json"))) == 2
    assert len(list(evidence_directory.glob("snapshots/*/manifest.json"))) == 2


async def test_capture_comparison_detects_small_revisions_without_losing_missing_cells(
    evidence_directory: Path,
) -> None:
    store = EvidenceStore(evidence_directory)
    before = await captured(store, raw_bytes())
    changed = source_payload()
    changed["value"]["1"] = 6.80001
    changed["status"]["1"] = "e"

    after = await captured(store, raw_bytes(changed), previous=before["snapshot_id"])
    comparison = workflow.compare(store, before["snapshot_id"], after["snapshot_id"])

    assert after["status"] == "captured"
    assert comparison["value_revisions"] == 1
    assert comparison["changes"] == after["comparison"]["changes"]
    assert comparison["changes"][0] == {
        "geo": "LV", "period": "2020-01", "kind": "value_revision",
        "before": EXPECTED_ROWS[4], "after": row(6.80001, status="e"),
    }
    assert workflow.replay(store, after["snapshot_id"])["data"]["rows"][-1] == EXPECTED_ROWS[-1]


@pytest.mark.parametrize("artifact", ["raw", "normalized.json", "observations.csv", "dictionary.json"])
async def test_replay_refuses_tampered_artifacts(evidence_directory: Path, artifact: str) -> None:
    store = EvidenceStore(evidence_directory)
    outcome = await captured(store, raw_bytes())
    manifest = workflow.replay(store, outcome["snapshot_id"])["manifest"]
    path = artifact_path(store, manifest, artifact)
    path.write_bytes(path.read_bytes() + b" ")

    with pytest.raises(ValueError, match=r"(?i)(sha|hash|integrity|checksum)"):
        workflow.replay(store, outcome["snapshot_id"])


async def test_legacy_snapshot_without_a_dictionary_artifact_is_replayable(
    evidence_directory: Path,
) -> None:
    store = EvidenceStore(evidence_directory)
    body = raw_bytes()
    outcome = await captured(store, body)
    manifest = workflow.replay(store, outcome["snapshot_id"])["manifest"]
    dictionary_path = artifact_path(store, manifest, "dictionary.json")
    expected_dictionary = dictionary_path.read_bytes()
    dictionary_path.unlink()
    del manifest["artifacts"]["dictionary.json"]
    manifest_path = evidence_directory / "snapshots" / outcome["snapshot_id"] / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    legacy_manifest_bytes = manifest_path.read_bytes()
    export = evidence_directory / "legacy-review"

    replayed = workflow.replay(store, outcome["snapshot_id"], export_dir=export)

    assert replayed["data"]["rows"] == EXPECTED_ROWS
    assert (export / "source.json").read_bytes() == body
    assert (export / "observations.csv").read_bytes() == expected_csv(manifest["provenance"])
    assert (export / "dictionary.json").read_bytes() == expected_dictionary
    assert json.loads((export / "manifest.json").read_bytes()) == manifest
    assert manifest_path.read_bytes() == legacy_manifest_bytes
    assert not dictionary_path.exists(), "replay must not rewrite the historical release"


async def test_missing_declared_dictionary_is_not_treated_as_a_legacy_snapshot(
    evidence_directory: Path,
) -> None:
    store = EvidenceStore(evidence_directory)
    outcome = await captured(store, raw_bytes())
    manifest = workflow.replay(store, outcome["snapshot_id"])["manifest"]
    artifact_path(store, manifest, "dictionary.json").unlink()
    export = evidence_directory / "invalid-review"

    with pytest.raises((OSError, ValueError)):
        workflow.replay(store, outcome["snapshot_id"], export_dir=export)

    assert not export.exists()


@pytest.mark.parametrize("field", ["row_count", "missing_count", "flagged_count"])
async def test_replay_rejects_manifest_coverage_counts_that_disagree_with_source_cells(
    evidence_directory: Path, field: str,
) -> None:
    store = EvidenceStore(evidence_directory)
    outcome = await captured(store, raw_bytes())
    manifest = workflow.replay(store, outcome["snapshot_id"])["manifest"]
    manifest[field] += 1
    manifest_path = evidence_directory / "snapshots" / outcome["snapshot_id"] / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    export = evidence_directory / "invalid-review"

    with pytest.raises(ValueError, match=r"(?i)(coverage|count|disagree)"):
        workflow.replay(store, outcome["snapshot_id"], export_dir=export)

    assert not export.exists()


async def test_replay_recomputes_csv_even_if_a_modified_csv_was_rehashed(
    evidence_directory: Path,
) -> None:
    store = EvidenceStore(evidence_directory)
    outcome = await captured(store, raw_bytes())
    manifest = workflow.replay(store, outcome["snapshot_id"])["manifest"]
    path = artifact_path(store, manifest, "observations.csv")
    changed = path.read_bytes().replace(b",LV,2020-01,6.8,", b",LV,2020-01,8.6,")
    assert changed != path.read_bytes()
    path.write_bytes(changed)
    manifest["artifacts"]["observations.csv"]["sha256"] = hashlib.sha256(changed).hexdigest()
    manifest_path = evidence_directory / "snapshots" / outcome["snapshot_id"] / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match=r"(?i)(reproduc|replay|differ)"):
        workflow.replay(store, outcome["snapshot_id"])


@pytest.mark.parametrize("cloud", [False, True], ids=["local", "authoritative-cloud"])
def test_store_is_idempotent_but_never_replaces_different_bytes(
    evidence_directory: Path, cloud: bool,
) -> None:
    container, remote = blob_double()
    store = EvidenceStore(evidence_directory, container=container if cloud else None)
    name = "snapshots/frozen/observations.csv"
    original = b"period,value\n2020-01,6.8\n"

    store.put(name, original, content_type="text/csv")
    store.put(name, original, content_type="text/csv")
    with pytest.raises(FileExistsError):
        store.put(name, b"period,value\n2020-01,8.6\n", content_type="text/csv")

    assert store.read(name) == original
    if cloud:
        assert len(remote) == 1
        assert not (evidence_directory / "snapshots").exists()


async def test_export_can_be_repeated_but_cannot_overwrite_another_snapshot(
    evidence_directory: Path,
) -> None:
    store = EvidenceStore(evidence_directory / "archive")
    first = await captured(store, raw_bytes())
    export = evidence_directory / "review"
    workflow.replay(store, first["snapshot_id"], export_dir=export)
    original = {path.name: path.read_bytes() for path in export.iterdir()}

    workflow.replay(store, first["snapshot_id"], export_dir=export)
    changed = source_payload()
    changed["value"]["1"] = 6.9
    second = await captured(store, raw_bytes(changed))
    with pytest.raises(FileExistsError):
        workflow.replay(store, second["snapshot_id"], export_dir=export)

    assert {path.name: path.read_bytes() for path in export.iterdir()} == original


@pytest.fixture
def single_request(monkeypatch: pytest.MonkeyPatch) -> None:
    def bounded_collector(archive: Any, **kwargs: Any) -> collector_http.CollectorHttp:
        return collector_http.CollectorHttp(archive, max_retries=1, **kwargs)

    monkeypatch.setattr(
        workflow, "CollectorHttp",
        create_autospec(collector_http.CollectorHttp, side_effect=bounded_collector),
    )


@pytest.mark.parametrize("failure", ["http500", "connection"], ids=["HTTP-500", "fetch-failure"])
async def test_failed_fetch_leaves_explicit_failed_attempt_and_no_release(
    evidence_directory: Path, single_request: None, failure: str,
) -> None:
    store = EvidenceStore(evidence_directory)

    def unavailable(request: httpx.Request) -> httpx.Response:
        assert len(list(evidence_directory.glob("runs/*/started.json"))) == 1
        assert not list(evidence_directory.glob("runs/*/result.json"))
        if failure == "connection":
            raise httpx.ConnectError("synthetic connection failure", request=request)
        return httpx.Response(500, content=b"synthetic source unavailable")

    async with httpx.AsyncClient(transport=httpx.MockTransport(unavailable)) as client:
        with pytest.raises((ValueError, httpx.HTTPError)):
            await workflow.capture(store, client=client)

    failed_attempt(evidence_directory)
    assert not list(evidence_directory.glob("snapshots/*/manifest.json"))


async def test_failed_validation_keeps_exact_raw_bytes_but_not_a_complete_manifest(
    evidence_directory: Path,
) -> None:
    store = EvidenceStore(evidence_directory)
    invalid_body = b'{"class": "dataset", "truncated":'

    with pytest.raises(ValueError):
        await captured(store, invalid_body)

    failed_attempt(evidence_directory)
    archived = list(evidence_directory.glob("raw/**/*.raw"))
    assert len(archived) == 1
    assert archived[0].read_bytes() == invalid_body
    assert not list(evidence_directory.glob("snapshots/*/manifest.json"))


async def test_failed_request_after_a_previous_capture_is_not_reported_as_unchanged(
    evidence_directory: Path, single_request: None,
) -> None:
    store = EvidenceStore(evidence_directory)
    before = await captured(store, raw_bytes())
    manifest_path = evidence_directory / "snapshots" / before["snapshot_id"] / "manifest.json"
    original = manifest_path.read_bytes()

    def unavailable(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(unavailable)) as client:
        with pytest.raises((ValueError, httpx.HTTPError)):
            await workflow.capture(store, client=client, previous=before["snapshot_id"])

    failure = failed_attempt(evidence_directory)
    assert failure["run_id"] != before["run_id"]
    assert manifest_path.read_bytes() == original
    assert len(list(evidence_directory.glob("snapshots/*/manifest.json"))) == 1


@pytest.mark.parametrize(
    "fail_at", ["raw", "normalized.json", "observations.csv", "dictionary.json", "manifest.json"],
)
async def test_authoritative_cloud_write_failure_never_becomes_local_success(
    evidence_directory: Path, fail_at: str,
) -> None:
    container, remote = blob_double(fail_at=fail_at)
    store = EvidenceStore(evidence_directory, container=container)

    with pytest.raises(ServiceRequestError, match="authoritative write failure"):
        await captured(store, raw_bytes())

    assert failed_attempt(evidence_directory)["error_type"] == "ServiceRequestError"
    assert not any(name.endswith("/manifest.json") for name in remote)
    assert not (evidence_directory / "snapshots").exists()
    assert not (evidence_directory / "raw").exists()


async def test_cloud_snapshot_can_be_replayed_without_a_local_artifact_mirror(
    evidence_directory: Path,
) -> None:
    container, remote = blob_double()
    outcome = await captured(EvidenceStore(evidence_directory, container=container), raw_bytes())
    reopened = EvidenceStore(evidence_directory / "fresh-reader", container=container)
    export = evidence_directory / "cloud-review"

    replayed = workflow.replay(reopened, outcome["snapshot_id"], export_dir=export)

    assert replayed["data"]["rows"] == EXPECTED_ROWS
    assert (export / "source.json").read_bytes() == raw_bytes()
    assert (export / "observations.csv").read_bytes() == expected_csv(replayed["manifest"]["provenance"])
    assert len([name for name in remote if name.endswith("/manifest.json")]) == 1
    assert not (evidence_directory / "snapshots").exists()
    assert not (evidence_directory / "raw").exists()


def legacy_files(directory: Path, body: bytes | None = None) -> tuple[Path, Path, JsonDict]:
    body = raw_bytes() if body is None else body
    metadata = {
        "request_url": SOURCE_URL, "retrieved_at": "2020-03-05T11:30:00Z",
        "sha256": hashlib.sha256(body).hexdigest(), "http_status": 200,
        "blob_name": "raw-feeds/2020-03-05/eurostat/synthetic-source.raw",
        "storage_account_url": "https://syntheticarchive.blob.core.windows.net",
    }
    raw_path = directory / "legacy-response.raw"
    metadata_path = directory / "legacy-sidecar.json"
    raw_path.write_bytes(body)
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    return raw_path, metadata_path, metadata


async def test_legacy_import_preserves_original_retrieval_and_records_import_separately(
    evidence_directory: Path,
) -> None:
    raw_path, metadata_path, metadata = legacy_files(evidence_directory)
    store = EvidenceStore(evidence_directory / "archive")

    manifest = await workflow.import_legacy(store, raw_path, metadata_path)
    exported = evidence_directory / "review"
    replayed = workflow.replay(store, manifest["snapshot_id"], export_dir=exported)

    assert replayed["data"]["rows"] == EXPECTED_ROWS
    assert manifest["provenance"]["retrieved_at"] == metadata["retrieved_at"]
    assert manifest["provenance"]["request_url"] == metadata["request_url"]
    assert manifest["provenance"]["sha256"] == metadata["sha256"]
    assert manifest["origin"]["imported_at"] == RETRIEVED_AT
    assert manifest["origin"]["kind"] == "audited_legacy_import"
    assert manifest["origin"]["blob_name"] == metadata["blob_name"]
    assert manifest["origin"]["storage_account_url"] == metadata["storage_account_url"]
    assert (exported / "source.json").read_bytes() == raw_path.read_bytes()
    rows = list(csv.DictReader(io.StringIO((exported / "observations.csv").read_text(encoding="utf-8"))))
    assert {record["observed_at"] for record in rows} == {metadata["retrieved_at"]}
    assert {record["source_updated_at"] for record in rows} == {SOURCE_UPDATED_AT}


@pytest.mark.parametrize(
    "missing", ["request_url", "retrieved_at", "sha256", "http_status", "blob_name", "storage_account_url"],
)
async def test_legacy_import_without_original_provenance_is_rejected(
    evidence_directory: Path, missing: str,
) -> None:
    raw_path, metadata_path, metadata = legacy_files(evidence_directory)
    del metadata[missing]
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    store = EvidenceStore(evidence_directory / "archive")

    with pytest.raises(ValueError):
        await workflow.import_legacy(store, raw_path, metadata_path)

    assert not list(store.root.glob("snapshots/*/manifest.json"))


async def test_legacy_import_checks_response_coordinates_not_only_the_request_sidecar(
    evidence_directory: Path,
) -> None:
    payload = source_payload()
    payload["dimension"]["unit"]["category"] = {"index": ["NR"]}
    raw_path, metadata_path, _ = legacy_files(evidence_directory, raw_bytes(payload))
    store = EvidenceStore(evidence_directory / "archive")

    with pytest.raises(ValueError, match=r"(?i)(unit|measurement|basis)"):
        await workflow.import_legacy(store, raw_path, metadata_path)

    assert not list(store.root.glob("snapshots/*/manifest.json"))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("sha256", "0" * 64),
        ("http_status", 500),
        ("retrieved_at", "2020-03-05T11:30:00"),
        ("request_url", SOURCE_URL.replace("unit=PC_ACT", "unit=NR")),
        ("request_url", SOURCE_URL.replace("age=TOTAL", "age=Y15-24")),
        ("request_url", SOURCE_URL + "&unit=NR"),
    ],
    ids=["wrong-hash", "HTTP-failure", "naive-retrieval", "wrong-unit", "wrong-age", "ambiguous-unit"],
)
async def test_legacy_import_rejects_unverifiable_bytes_or_measurement_basis(
    evidence_directory: Path, field: str, value: Any,
) -> None:
    raw_path, metadata_path, metadata = legacy_files(evidence_directory)
    metadata[field] = value
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    store = EvidenceStore(evidence_directory / "archive")

    with pytest.raises(ValueError):
        await workflow.import_legacy(store, raw_path, metadata_path)

    assert not list(store.root.glob("snapshots/*/manifest.json"))
