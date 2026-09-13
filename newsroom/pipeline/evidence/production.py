"""Archive the collector's own response and expose only completed, checked packs."""

from __future__ import annotations

import json
import logging
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from azure.core.exceptions import ResourceNotFoundError
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient

from newsroom.pipeline import config
from newsroom.pipeline.evidence import catalogue
from newsroom.pipeline.evidence.codec import (
    compare_rows, csv_bytes, dictionary_bytes, digest, json_bytes, normalize,
)
from newsroom.pipeline.evidence.selection import DATASET, SERIES_ID
from newsroom.pipeline.evidence.errors import EXPECTED_FAILURES
from newsroom.pipeline.evidence.store import DEFAULT_DIRECTORY, EvidenceStore
from newsroom.pipeline.evidence.workflow import _provenance, _snapshot_key, commit_snapshot, replay
from newsroom.pipeline.models import RawItem, isoformat, utcnow

log = logging.getLogger(__name__)
AUDITED_LEGACY_IDS = (
    "85e48db98f634d12af47a7324b1cd4dd",
    "811c9fbc583e42cebf24e477b8519ecf",
    "dbb0d61b4ce54f3aaabaae1402a82132",
    "5d0a588eac784e0ea34a703f32bc4220",
)
PUBLIC_ERROR = "Evidence capture or durable publication failed; no new article evidence link was issued."


def enabled() -> bool:
    return os.environ.get("NEWSROOM_EVIDENCE_ENABLED", "").lower() == "true"


def binding_key(source_id: str, dataset: str, retrieved_at: str, url: str) -> str:
    fields = (source_id, dataset, retrieved_at, url)
    if any(not isinstance(value, str) or not value or "\n" in value or "\r" in value for value in fields):
        raise ValueError("an exact evidence binding requires four non-empty identity fields")
    return digest("\n".join(fields).encode("utf-8"))


def snapshot_id_for(item: RawItem) -> str:
    identity = binding_key(item.source_id, DATASET, item.retrieved_at, item.url)
    return digest((identity + "\n" + item.digest).encode("utf-8"))[:32]


def _read_optional(store: EvidenceStore, name: str) -> bytes | None:
    try:
        return store.read(name)
    except (FileNotFoundError, ResourceNotFoundError):
        return None


def _summary(manifest: dict[str, Any], normalized: dict[str, Any]) -> dict[str, Any]:
    return {
        "snapshot_id": manifest["snapshot_id"], "observed_at": manifest["provenance"]["retrieved_at"],
        "source_updated_at": normalized["source_updated_at"],
        **{key: manifest[key] for key in ("row_count", "missing_count", "flagged_count")},
    }


def _comparison(before: dict[str, Any], after: dict[str, Any], before_id: str, after_id: str) -> dict[str, Any]:
    delta = compare_rows(before, after)
    previous_periods = {row["period"] for row in before["rows"]}
    maximum = max(previous_periods)
    expanded = sum(c["kind"] == "new_period" and c["period"] <= maximum for c in delta["changes"])
    new = sum(c["kind"] == "new_period" and c["period"] > maximum for c in delta["changes"])
    return {
        **delta, "before": before_id, "after": after_id,
        "expanded_coverage": expanded, "new_periods": new,
        "filled_missing": sum(c["kind"] == "filled_missing" for c in delta["changes"]),
        "became_missing": sum(c["kind"] == "became_missing" for c in delta["changes"]),
        "status_changes": sum(c["kind"] == "status_change" for c in delta["changes"]),
        "removed_periods": sum(c["kind"] == "removed_period" for c in delta["changes"]),
    }


class EvidenceService:
    def __init__(self, canonical: EvidenceStore, public: EvidenceStore) -> None:
        if canonical is public:
            raise ValueError("canonical raw and public serving stores must be separate")
        self.canonical = canonical
        self.public = public
        self.outcomes: list[dict[str, Any]] = []

    def report(self) -> dict[str, Any]:
        last = self.outcomes[-1] if self.outcomes else None
        return {
            "enabled": True, "status": last["status"] if last else "unavailable",
            "stale_after_hours": catalogue.STALE_AFTER_HOURS,
            "last_attempt": last, "attempts": list(self.outcomes),
        }

    def _public_data(self, snapshot_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        manifest = json.loads(self.public.read(_snapshot_key(snapshot_id, "manifest.json")))
        if (
            manifest.get("snapshot_id") != snapshot_id or manifest.get("series_id") != SERIES_ID
            or manifest.get("format_version") != 1 or manifest.get("status") != "complete"
        ):
            raise ValueError("invalid completed public snapshot")
        raw = self.public.read(_snapshot_key(snapshot_id, "source.json"))
        provenance = manifest["provenance"]
        item = RawItem(
            source_id="eurostat", url=provenance["request_url"], retrieved_at=provenance["retrieved_at"],
            content_type="application/json", body=raw, http_status=provenance["http_status"],
        )
        _provenance(item)
        if item.digest != provenance["sha256"]:
            raise ValueError("public source failed its SHA-256 check")
        normalized = normalize(raw)
        documents = {
            "normalized.json": json_bytes(normalized), "observations.csv": csv_bytes(normalized, provenance),
            "dictionary.json": dictionary_bytes(normalized),
        }
        if "comparison.json" in manifest["artifacts"]:
            documents["comparison.json"] = self.public.read(_snapshot_key(snapshot_id, "comparison.json"))
        for name, expected in documents.items():
            body = self.public.read(_snapshot_key(snapshot_id, name))
            if body != expected or digest(body) != manifest["artifacts"][name]["sha256"]:
                raise ValueError("public artifact failed replay or its SHA-256 check")
        expected_counts = {
            "row_count": len(normalized["rows"]),
            "missing_count": sum(row["missing"] for row in normalized["rows"]),
            "flagged_count": sum(bool(row["status"]) for row in normalized["rows"]),
        }
        if any(manifest.get(key) != count for key, count in expected_counts.items()):
            raise ValueError("public coverage counts failed replay")
        return manifest, normalized

    def publish_snapshot(
        self, snapshot_id: str, *, source_store: EvidenceStore | None = None,
    ) -> dict[str, Any]:
        """Replay a private snapshot before copying known artifacts; commit manifest last."""
        source = source_store or self.canonical
        verified = replay(source, snapshot_id)
        manifest, normalized = verified["manifest"], verified["data"]
        provenance = manifest["provenance"]
        # Replicate only this replay-verified pack, never a container or an
        # arbitrary imported directory. Completed canonical files stay immutable.
        if source is not self.canonical:
            for artifact in manifest["artifacts"].values():
                self.canonical.put(artifact["name"], source.read(artifact["name"]))
            self.canonical.put(_snapshot_key(snapshot_id, "manifest.json"), json_bytes(manifest))
            replay(self.canonical, snapshot_id)
        existing = _read_optional(self.public, _snapshot_key(snapshot_id, "manifest.json"))
        if existing is not None:
            published, data = self._public_data(snapshot_id)
            if published["provenance"] != provenance or data != normalized:
                raise ValueError("immutable public snapshot disagrees with canonical evidence")
        else:
            raw = source.read(manifest["artifacts"]["raw"]["name"])
            documents = {
                "source.json": raw, "normalized.json": json_bytes(normalized),
                "observations.csv": csv_bytes(normalized, provenance),
                "dictionary.json": dictionary_bytes(normalized),
            }
            published = {**manifest, "artifacts": {}}
            published["origin"] = {
                key: manifest["origin"][key]
                for key in ("kind", "imported_at") if key in manifest["origin"]
            }
            index = catalogue.read_index(self.public)
            prior_id = index.get("latest_snapshot_id")
            if prior_id and prior_id != snapshot_id:
                before_manifest, before = self._public_data(prior_id)
                if catalogue.timestamp(before_manifest["provenance"]["retrieved_at"]) < catalogue.timestamp(provenance["retrieved_at"]):
                    delta = _comparison(before, normalized, prior_id, snapshot_id)
                    documents["comparison.json"] = json_bytes(delta)
                    published["previous_snapshot_id"] = prior_id
                    published["comparison"] = {key: value for key, value in delta.items() if key != "changes"}
            # Freeze the optional predecessor before any public writes. Retries
            # after partial publication must not choose a different comparison.
            plan_key = _snapshot_key(snapshot_id, "publication.json")
            plan_body = json_bytes({
                "previous_snapshot_id": published.get("previous_snapshot_id"),
                "comparison": json.loads(documents["comparison.json"]) if "comparison.json" in documents else None,
            })
            try:
                self.canonical.put(plan_key, plan_body)
            except FileExistsError:
                pass
            plan = json.loads(self.canonical.read(plan_key))
            published.pop("previous_snapshot_id", None)
            published.pop("comparison", None)
            documents.pop("comparison.json", None)
            if plan["previous_snapshot_id"] is not None:
                before_manifest, before = self._public_data(plan["previous_snapshot_id"])
                if catalogue.timestamp(before_manifest["provenance"]["retrieved_at"]) >= catalogue.timestamp(provenance["retrieved_at"]):
                    raise ValueError("publication predecessor is not an earlier observation")
                delta = _comparison(before, normalized, plan["previous_snapshot_id"], snapshot_id)
                if delta != plan["comparison"]:
                    raise ValueError("publication comparison plan failed replay")
                documents["comparison.json"] = json_bytes(delta)
                published["previous_snapshot_id"] = plan["previous_snapshot_id"]
                published["comparison"] = {key: value for key, value in delta.items() if key != "changes"}
            try:
                for name, body in documents.items():
                    key = _snapshot_key(snapshot_id, name)
                    self.public.put(key, body, content_type="text/csv; charset=utf-8" if name.endswith(".csv") else "application/json")
                    published["artifacts"][name] = {"name": key, "sha256": digest(body)}
                self.public.put(_snapshot_key(snapshot_id, "manifest.json"), json_bytes(published))
            except FileExistsError:
                if _read_optional(self.public, _snapshot_key(snapshot_id, "manifest.json")) is None:
                    raise
            published, data = self._public_data(snapshot_id)
            if published["provenance"] != provenance or data != normalized:
                raise ValueError("published evidence differs from the captured response")
        binding = {
            "version": 1, "source_id": "eurostat", "dataset": DATASET,
            "observed_at": provenance["retrieved_at"], "request_url": provenance["request_url"],
            "snapshot_id": snapshot_id, "raw_sha256": provenance["sha256"],
        }
        key = binding_key("eurostat", DATASET, binding["observed_at"], binding["request_url"])
        self.public.put(f"bindings/{key}.json", json_bytes(binding))
        catalogue.publish_entry(self.public, _summary(published, normalized))
        return published

    def _finish(
        self, outcome: dict[str, Any], *, run_id: str, observed_at: str | None = None,
    ) -> dict[str, Any]:
        try:
            catalogue.record_attempt(self.public, outcome, observed_at=observed_at)
            self.canonical.put(f"runs/{run_id}/result.json", json_bytes(outcome))
        except EXPECTED_FAILURES:
            log.exception("evidence attempt status could not be stored durably")
            outcome = {**outcome, "status": "failed", "error": PUBLIC_ERROR}
            outcome.pop("snapshot_id", None)
            try:
                catalogue.record_attempt(self.public, outcome)
            except EXPECTED_FAILURES:
                log.exception("evidence failure status could not be published")
            try:
                self.canonical.put(f"runs/{run_id}/result.json", json_bytes(outcome))
            except EXPECTED_FAILURES:
                log.exception("evidence failed-attempt journal could not be stored")
        self.outcomes.append(outcome)
        return outcome

    def record_failure(self, *, attempted_at: str | None = None) -> dict[str, Any]:
        run_id = uuid4().hex
        attempt = attempted_at or isoformat(utcnow())
        outcome = {
            "attempted_at": attempt, "finished_at": isoformat(utcnow()),
            "status": "failed", "error": PUBLIC_ERROR,
        }
        try:
            self.canonical.put(f"runs/{run_id}/started.json", json_bytes({"attempted_at": attempt}))
        except EXPECTED_FAILURES:
            log.exception("evidence failed-attempt journal unavailable")
        return self._finish(outcome, run_id=run_id)

    def capture_item(self, item: RawItem, *, attempted_at: str | None = None) -> dict[str, Any]:
        run_id = uuid4().hex
        attempt = attempted_at or isoformat(utcnow())
        outcome: dict[str, Any] = {"attempted_at": attempt}
        try:
            self.canonical.put(f"runs/{run_id}/started.json", json_bytes(outcome))
            if item.source_id != "eurostat":
                raise ValueError("only the checked Eurostat contract may be public")
            _provenance(item)
            snapshot_id = snapshot_id_for(item)
            key = binding_key(item.source_id, DATASET, item.retrieved_at, item.url)
            binding_bytes = _read_optional(self.public, f"bindings/{key}.json")
            if binding_bytes is not None:
                binding = json.loads(binding_bytes)
                expected = {
                    "version": 1, "source_id": item.source_id, "dataset": DATASET,
                    "observed_at": item.retrieved_at, "request_url": item.url,
                    "snapshot_id": binding.get("snapshot_id"), "raw_sha256": item.digest,
                }
                if binding != expected:
                    raise ValueError("exact retrieval identity has conflicting evidence")
                snapshot_id = binding["snapshot_id"]
                self._public_data(snapshot_id)
            self.canonical.put("raw/" + item.archive_name, item.body, content_type=item.content_type)
            if _read_optional(self.canonical, _snapshot_key(snapshot_id, "manifest.json")) is None:
                commit_snapshot(self.canonical, item, snapshot_id=snapshot_id)
            verified = replay(self.canonical, snapshot_id)
            if (
                verified["manifest"]["provenance"]["sha256"] != item.digest
                or verified["manifest"]["provenance"]["request_url"] != item.url
                or verified["manifest"]["provenance"]["retrieved_at"] != item.retrieved_at
            ):
                raise ValueError("canonical snapshot does not match the collector response")
            manifest = self.publish_snapshot(snapshot_id)
            status = "reused" if item.from_cache else (
                "unchanged" if manifest.get("comparison", {}).get("unchanged") else "captured"
            )
            outcome.update(status=status, snapshot_id=snapshot_id)
        except EXPECTED_FAILURES:
            log.exception("evidence capture failed")
            outcome.update(status="failed", error=PUBLIC_ERROR)
        outcome["finished_at"] = isoformat(utcnow())
        return self._finish(
            outcome, run_id=run_id,
            observed_at=item.retrieved_at if outcome["status"] != "failed" else None,
        )


@contextmanager
def open_production(root: Path = DEFAULT_DIRECTORY) -> Iterator[EvidenceService]:
    """Cloud-only: configuration or durable storage failure must never fall back."""
    if not config.STORAGE_ACCOUNT_URL:
        raise ValueError("production evidence requires BLOB_ACCOUNT_URL")
    if config.RAW_CONTAINER == config.ARTICLES_CONTAINER:
        raise ValueError("private and public containers must differ")
    with DefaultAzureCredential(process_timeout=60) as credential:
        with BlobServiceClient(config.STORAGE_ACCOUNT_URL, credential=credential) as blobs:
            yield EvidenceService(
                EvidenceStore(root, blobs.get_container_client(config.RAW_CONTAINER)),
                EvidenceStore(root / "public", blobs.get_container_client(config.ARTICLES_CONTAINER)),
            )
