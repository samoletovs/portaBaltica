"""Logical writer invocations, independent of which draft survives.

This is not token or billing accounting: complete_json may perform an SDK
transport retry, and an exception does not establish whether tokens were billed.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, Literal, Sequence


@dataclass
class WriterAttempt:
    signal_id: str
    draft: int
    phase: Literal["initial", "desk_revision"]
    outcome: Literal["started", "returned", "failed"] = "started"


@contextmanager
def record_attempt(
    ledger: list[WriterAttempt] | None, *, signal_id: str, draft: int, desk_revision: bool,
) -> Iterator[None]:
    entry = WriterAttempt(signal_id, draft, "desk_revision" if desk_revision else "initial")
    if ledger is not None:
        ledger.append(entry)
    try:
        yield
        entry.outcome = "returned"
    finally:
        # A returned payload is not a validated or publishable draft.
        if entry.outcome == "started":
            entry.outcome = "failed"


def summarize_attempts(ledger: Sequence[WriterAttempt]) -> dict[str, object]:
    return {
        "scope": "logical complete_json calls for article generation; excludes SDK transport retries, analysis and desk decisions; not token or billing usage",
        "total": len(ledger),
        "max_drafts_per_pass": max((entry.draft for entry in ledger), default=0),
        "returned": sum(entry.outcome == "returned" for entry in ledger),
        "failed": sum(entry.outcome == "failed" for entry in ledger),
        "started": sum(entry.outcome == "started" for entry in ledger),
        "by_phase": {
            phase: sum(entry.phase == phase for entry in ledger)
            for phase in ("initial", "desk_revision")
        },
    }
