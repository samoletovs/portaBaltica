"""Capture and replay without a model, publication side effects or a scheduler."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

from newsroom.pipeline.collect.httpclient import CollectorHttp, ConditionalState
from newsroom.pipeline.evidence.codec import (
    FORMAT_VERSION, MAX_RAW_BYTES, compare_rows, csv_bytes, dictionary_bytes, digest, json_bytes, normalize,
)
from newsroom.pipeline.evidence.errors import EXPECTED_FAILURES
from newsroom.pipeline.evidence.selection import SERIES_ID, capture_url, validate_source_url
from newsroom.pipeline.evidence.store import EvidenceStore, put_local
from newsroom.pipeline.models import RawItem, isoformat, utcnow

log = logging.getLogger(__name__)


def _timestamp(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("retrieval timestamp is missing")
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        raise ValueError("retrieval timestamp must include a timezone")
    if moment > datetime.now(timezone.utc):
        raise ValueError("retrieval timestamp cannot be in the future")
    return moment


class CaptureArchive:
    def __init__(self, store: EvidenceStore) -> None:
        self.store_backend = store

    async def store(self, item: RawItem) -> str:
        if len(item.body) > MAX_RAW_BYTES:
            raise ValueError("response exceeds the pilot's 2 MiB bound")
        name = "raw/" + item.archive_name
        await asyncio.to_thread(
            self.store_backend.put, name, item.body, content_type=item.content_type,
        )
        return name

    def read(self, archive_name: str) -> bytes:
        return self.store_backend.read("raw/" + archive_name)


def _provenance(item: RawItem) -> dict[str, Any]:
    validate_source_url(item.url)
    _timestamp(item.retrieved_at)
    if item.http_status != 200:
        raise ValueError("a snapshot requires a successful HTTP 200 source response")
    return {
        "request_url": item.url, "retrieved_at": item.retrieved_at,
        "sha256": item.digest, "http_status": item.http_status,
        "etag": item.etag, "last_modified": item.last_modified,
    }


def _snapshot_key(snapshot_id: str, name: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{32}", snapshot_id):
        raise ValueError("invalid snapshot identifier")
    return f"snapshots/{snapshot_id}/{name}"


def commit_snapshot(
    store: EvidenceStore, item: RawItem, *, origin: dict[str, Any] | None = None,
    snapshot_id: str | None = None,
) -> dict[str, Any]:
    provenance = _provenance(item)
    normalized = normalize(item.body)
    stable = snapshot_id is not None
    snapshot_id = snapshot_id or uuid4().hex
    _snapshot_key(snapshot_id, "manifest.json")
    raw_name = "raw/" + item.archive_name
    if store.read(raw_name) != item.body:
        raise ValueError("stored raw response differs from the captured bytes")
    documents = {
        "normalized.json": json_bytes(normalized),
        "observations.csv": csv_bytes(normalized, provenance),
        "dictionary.json": dictionary_bytes(normalized),
    }
    hashes = {"raw": {"name": raw_name, "sha256": item.digest}}
    for filename, body in documents.items():
        name = _snapshot_key(snapshot_id, filename)
        store.put(name, body, content_type="text/csv; charset=utf-8" if filename.endswith(".csv") else "application/json")
        hashes[filename] = {"name": name, "sha256": digest(body)}
    manifest = {
        "format_version": FORMAT_VERSION, "series_id": SERIES_ID,
        "snapshot_id": snapshot_id, "status": "complete",
        "created_at": item.retrieved_at if stable else isoformat(utcnow()), "provenance": provenance,
        "origin": origin or {"kind": "live_capture"}, "artifacts": hashes,
        "row_count": len(normalized["rows"]),
        "missing_count": sum(row["missing"] for row in normalized["rows"]),
        "flagged_count": sum(bool(row["status"]) for row in normalized["rows"]),
        "attribution": "Source: Eurostat",
        "modifications": "Selected Baltic countries and periods; normalized to JSON and CSV. Raw response retained.",
        "disclaimer": "Eurostat is not responsible for this transformed archive or its interpretation.",
    }
    store.put(_snapshot_key(snapshot_id, "manifest.json"), json_bytes(manifest))
    return manifest


def _read_manifest(store: EvidenceStore, snapshot_id: str) -> dict[str, Any]:
    manifest = json.loads(store.read(_snapshot_key(snapshot_id, "manifest.json")))
    if not isinstance(manifest, dict):
        raise ValueError("snapshot manifest must be an object")
    if (
        manifest.get("format_version") != FORMAT_VERSION or manifest.get("snapshot_id") != snapshot_id
        or manifest.get("series_id") != SERIES_ID or manifest.get("status") != "complete"
    ):
        raise ValueError("unsupported or incomplete snapshot manifest")
    provenance = manifest.get("provenance")
    if not isinstance(provenance, dict) or not all(
        isinstance(provenance.get(key), str) for key in ("request_url", "retrieved_at", "sha256")
    ):
        raise ValueError("invalid snapshot provenance")
    if provenance.get("http_status") != 200:
        raise ValueError("snapshot provenance is not a successful HTTP response")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ValueError("snapshot artifact index is missing")
    required = {"raw", "normalized.json", "observations.csv"}
    if not required.issubset(artifacts) or not set(artifacts).issubset(required | {"dictionary.json"}):
        raise ValueError("snapshot artifact index has missing or unknown entries")
    for key in artifacts:
        artifact = artifacts.get(key)
        if (
            not isinstance(artifact, dict) or not isinstance(artifact.get("name"), str)
            or not isinstance(artifact.get("sha256"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"])
        ):
            raise ValueError(f"invalid snapshot artifact: {key}")
    return manifest


def replay(store: EvidenceStore, snapshot_id: str, export_dir: Path | None = None) -> dict[str, Any]:
    manifest = _read_manifest(store, snapshot_id)
    provenance = manifest["provenance"]
    validate_source_url(provenance["request_url"])
    _timestamp(provenance["retrieved_at"])
    bodies = {}
    for key in manifest["artifacts"]:
        artifact = manifest["artifacts"][key]
        if key != "raw" and artifact["name"] != _snapshot_key(snapshot_id, key):
            raise ValueError("snapshot artifact points outside its release")
        bodies[key] = store.read(artifact["name"])
        if digest(bodies[key]) != artifact["sha256"]:
            raise ValueError(f"stored {key} failed its SHA-256 check")
    if digest(bodies["raw"]) != provenance["sha256"]:
        raise ValueError("raw bytes disagree with source provenance")
    normalized = normalize(bodies["raw"])
    if (
        json_bytes(normalized) != bodies["normalized.json"]
        or csv_bytes(normalized, provenance) != bodies["observations.csv"]
        or ("dictionary.json" in bodies and dictionary_bytes(normalized) != bodies["dictionary.json"])
    ):
        raise ValueError("replayed observations do not reproduce the stored release")
    expected_counts = {
        "row_count": len(normalized["rows"]),
        "missing_count": sum(row["missing"] for row in normalized["rows"]),
        "flagged_count": sum(bool(row["status"]) for row in normalized["rows"]),
    }
    if any(manifest.get(key) != count for key, count in expected_counts.items()):
        raise ValueError("manifest coverage counts disagree with the stored response")
    if export_dir is not None:
        for filename in ("normalized.json", "observations.csv"):
            put_local(export_dir, filename, bodies[filename])
        put_local(export_dir, "dictionary.json", dictionary_bytes(normalized))
        put_local(export_dir, "manifest.json", json_bytes(manifest))
        put_local(export_dir, "source.json", bodies["raw"])
    return {"manifest": manifest, "data": normalized}


def compare(store: EvidenceStore, before_id: str, after_id: str) -> dict[str, Any]:
    before, after = replay(store, before_id), replay(store, after_id)
    old_time = _timestamp(before["manifest"]["provenance"]["retrieved_at"])
    new_time = _timestamp(after["manifest"]["provenance"]["retrieved_at"])
    if old_time > new_time:
        raise ValueError("comparison snapshots must be in retrieval-time order")
    return {
        "before": before_id, "after": after_id,
        "before_observed_at": before["manifest"]["provenance"]["retrieved_at"],
        "after_observed_at": after["manifest"]["provenance"]["retrieved_at"],
        **compare_rows(before["data"], after["data"]),
    }


async def capture(
    store: EvidenceStore, *, client: httpx.AsyncClient | None = None, previous: str | None = None,
) -> dict[str, Any]:
    run_id = uuid4().hex
    journal = f"runs/{run_id}/"
    started = {"run_id": run_id, "series_id": SERIES_ID, "started_at": isoformat(utcnow())}
    put_local(store.root, journal + "started.json", json_bytes(started))
    try:
        prior = await asyncio.to_thread(replay, store, previous) if previous else None
        archive = CaptureArchive(store)
        # Each attempt asks upstream, rather than calling a TTL hit a new observation.
        state = ConditionalState(store.root / "runs" / run_id / "http-state.json")
        async with CollectorHttp(archive, client=client, state=state) as http:
            result = await http.fetch(
                source_id="eurostat", url=capture_url(), cache_ttl_minutes=0,
                force=True, accept="application/json",
            )
        if not result.ok or result.item is None or result.item.from_cache:
            raise ValueError(f"no fresh source response: {result.skipped_reason}")
        delta = None
        if prior:
            if _timestamp(prior["manifest"]["provenance"]["retrieved_at"]) > _timestamp(result.item.retrieved_at):
                raise ValueError("previous snapshot is newer than the captured response")
            delta = compare_rows(prior["data"], normalize(result.item.body))
        manifest = await asyncio.to_thread(commit_snapshot, store, result.item)
        if delta is not None:
            delta.update({"before": previous, "after": manifest["snapshot_id"]})
        outcome = {
            **started, "completed_at": isoformat(utcnow()),
            "status": "unchanged" if delta and delta["unchanged"] else "captured",
            "snapshot_id": manifest["snapshot_id"], "comparison": delta,
        }
    except EXPECTED_FAILURES as exc:
        outcome = {
            **started, "completed_at": isoformat(utcnow()), "status": "failed",
            "error_type": type(exc).__name__, "error": str(exc),
        }
        put_local(store.root, journal + "result.json", json_bytes(outcome))
        log.exception("evidence capture %s failed", run_id)
        raise
    put_local(store.root, journal + "result.json", json_bytes(outcome))
    return outcome


async def import_legacy(store: EvidenceStore, raw_path: Path, metadata_path: Path) -> dict[str, Any]:
    metadata = json.loads(metadata_path.read_bytes())
    if not isinstance(metadata, dict) or not all(
        isinstance(metadata.get(key), str)
        for key in ("sha256", "request_url", "retrieved_at", "blob_name", "storage_account_url")
    ) or type(metadata.get("http_status")) is not int:
        raise ValueError("legacy metadata is missing its original request or provenance fields")
    body = raw_path.read_bytes()
    if digest(body) != metadata.get("sha256"):
        raise ValueError("legacy response does not match its recorded full SHA-256")
    if not metadata.get("blob_name") or not metadata.get("storage_account_url"):
        raise ValueError("legacy import requires the original Blob reference")
    item = RawItem(
        source_id="eurostat", url=metadata["request_url"],
        retrieved_at=metadata["retrieved_at"], body=body, content_type="application/json",
        http_status=metadata["http_status"],
    )
    _provenance(item)
    await CaptureArchive(store).store(item)
    return await asyncio.to_thread(
        commit_snapshot, store, item,
        origin={
            "kind": "audited_legacy_import", "blob_name": metadata["blob_name"],
            "storage_account_url": metadata["storage_account_url"],
            "imported_at": isoformat(utcnow()),
        },
    )
