"""Bounded index plus complete monthly discovery, merged with optimistic writes."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Callable

from newsroom.pipeline.evidence.codec import json_bytes
from newsroom.pipeline.evidence.selection import DATASET, DIMENSIONS, SERIES_ID, START_PERIOD
from newsroom.pipeline.evidence.store import EvidenceStore

STALE_AFTER_HOURS = 26
RECENT_LIMIT = 24


def timestamp(value: str) -> datetime:
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        raise ValueError("evidence time must have a timezone")
    return moment


def snapshot_order(entry: dict[str, Any]) -> tuple[datetime, str]:
    return timestamp(entry["observed_at"]), entry["snapshot_id"]


def empty_index() -> dict[str, Any]:
    return {
        "version": 1, "series_id": SERIES_ID,
        "title": "Baltic unemployment evidence archive",
        "dataset": DATASET, "selection": dict(DIMENSIONS), "start_period": START_PERIOD,
        "stale_after_hours": STALE_AFTER_HOURS, "last_attempt": None,
        "last_success_at": None, "latest_snapshot_id": None, "months": [], "recent": [],
    }


def read_index(store: EvidenceStore) -> dict[str, Any]:
    body, _ = store.read_version("index.json")
    return _index(body)


def _index(body: bytes | None) -> dict[str, Any]:
    document = json.loads(body) if body is not None else empty_index()
    if not isinstance(document, dict) or document.get("version") != 1 or document.get("series_id") != SERIES_ID:
        raise ValueError("unsupported evidence catalogue")
    if not isinstance(document.get("recent"), list) or not isinstance(document.get("months"), list):
        raise ValueError("invalid evidence discovery catalogue")
    return document


def _update(
    store: EvidenceStore, name: str, merge: Callable[[bytes | None], dict[str, Any]],
) -> dict[str, Any]:
    for _ in range(16):
        body, etag = store.read_version(name)
        document = merge(body)
        if store.replace(name, json_bytes(document), etag=etag):
            return document
    raise OSError("evidence catalogue remained busy after conditional-write retries")


def publish_entry(store: EvidenceStore, entry: dict[str, Any]) -> None:
    month = timestamp(entry["observed_at"]).strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("invalid retrieval month")

    def merge_month(body: bytes | None) -> dict[str, Any]:
        document = json.loads(body) if body else {"version": 1, "month": month, "snapshots": []}
        if document.get("version") != 1 or document.get("month") != month:
            raise ValueError("invalid evidence month")
        entries = {item["snapshot_id"]: item for item in document["snapshots"]}
        existing = entries.get(entry["snapshot_id"])
        if existing is not None and existing != entry:
            raise ValueError("immutable snapshot summary changed")
        entries[entry["snapshot_id"]] = entry
        document["snapshots"] = sorted(entries.values(), key=snapshot_order, reverse=True)
        return document

    monthly = _update(store, f"months/{month}.json", merge_month)

    def merge_index(body: bytes | None) -> dict[str, Any]:
        document = _index(body)
        entries = {item["snapshot_id"]: item for item in document["recent"]}
        # Include the month's committed entries so a retry heals a month whose
        # preceding index update was interrupted.
        entries.update({item["snapshot_id"]: item for item in monthly["snapshots"]})
        recent = sorted(entries.values(), key=snapshot_order, reverse=True)[:RECENT_LIMIT]
        document.update(
            months=sorted(set(document["months"]) | {month}, reverse=True),
            recent=recent,
            latest_snapshot_id=recent[0]["snapshot_id"],
        )
        return document

    _update(store, "index.json", merge_index)


def record_attempt(
    store: EvidenceStore, attempt: dict[str, Any], *, observed_at: str | None = None,
) -> None:
    public_attempt = {
        key: attempt[key] for key in ("attempted_at", "finished_at", "status", "error") if key in attempt
    }

    def merge(body: bytes | None) -> dict[str, Any]:
        document = _index(body)
        current = document.get("last_attempt")
        key = lambda item: (timestamp(item["attempted_at"]), timestamp(item["finished_at"]))
        if current is None or key(public_attempt) >= key(current):
            document["last_attempt"] = public_attempt
        # This is the last *observation*, never the time a cache hit or import
        # happened. A quiet source cannot stay healthy by recycling old bytes.
        if observed_at is not None and attempt["status"] != "failed":
            last = document.get("last_success_at")
            if last is None or timestamp(observed_at) > timestamp(last):
                document["last_success_at"] = observed_at
        return document

    _update(store, "index.json", merge)
