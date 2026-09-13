"""Explicit archive-only operations; no editorial stages or model clients."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from newsroom.pipeline.collect.httpclient import CollectorHttp, ConditionalState
from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, collect_eurostat
from newsroom.pipeline.evidence.catalogue import record_attempt
from newsroom.pipeline.evidence.errors import EXPECTED_FAILURES
from newsroom.pipeline.evidence.production import AUDITED_LEGACY_IDS, EvidenceService
from newsroom.pipeline.evidence.store import EvidenceStore
from newsroom.pipeline.evidence.workflow import CaptureArchive
from newsroom.pipeline.models import isoformat, utcnow

log = logging.getLogger(__name__)


async def collect_only(
    evidence: EvidenceService, *, http: CollectorHttp | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Exercise the real selected collector and its detector-ready provenance."""
    datasets = tuple(spec for spec in EUROSTAT_DATASETS if spec.metric == "unemployment_rate")
    previous_attempts = len(evidence.outcomes)
    try:
        if http is not None:
            series = await collect_eurostat(http, datasets, evidence=evidence)
        else:
            state = ConditionalState(evidence.canonical.root / "production-http-state.json")
            async with CollectorHttp(CaptureArchive(evidence.canonical), state=state, client=client) as collector:
                series = await collect_eurostat(collector, datasets, evidence=evidence)
    except EXPECTED_FAILURES:
        log.exception("archive-only collection failed")
        if len(evidence.outcomes) == previous_attempts or evidence.outcomes[-1]["status"] != "failed":
            await asyncio.to_thread(evidence.record_failure)
        series = []
    if len(evidence.outcomes) == previous_attempts:
        await asyncio.to_thread(evidence.record_failure)
    return {
        **evidence.report(),
        "series": [
            {"geography": item.geography, "metric": item.metric, "source": item.source.to_json()}
            for item in series
        ],
    }


def publish_audited(evidence: EvidenceService, source: EvidenceStore) -> dict[str, Any]:
    """Publish only the explicitly approved, replay-verified legacy IDs."""
    snapshots = []
    for snapshot_id in AUDITED_LEGACY_IDS:
        attempted_at = isoformat(utcnow())
        try:
            manifest = evidence.publish_snapshot(snapshot_id, source_store=source)
            record_attempt(
                evidence.public,
                {"attempted_at": attempted_at, "finished_at": isoformat(utcnow()), "status": "captured"},
                observed_at=manifest["provenance"]["retrieved_at"],
            )
            snapshots.append(snapshot_id)
        except EXPECTED_FAILURES:
            evidence.record_failure(attempted_at=attempted_at)
            raise
    return {"status": "published", "snapshot_ids": snapshots}
