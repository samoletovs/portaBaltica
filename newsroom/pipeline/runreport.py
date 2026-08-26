"""What happened on the last run, written where something can read it.

WHY THIS EXISTS
---------------
On 2026-08-25 the timer fired on schedule, the run completed inside its
timeout, and every tier A article it produced was rejected. The wire published
one syndicated card. Nothing anywhere said so.

That was not a monitoring gap that happened to be open. Application Insights is
receiving nothing from this app — no requests, no traces, no exceptions, no
custom events — and the Log Analytics workspace has no tables at all, despite
the connection string being present. So the only evidence a run had happened
was the articles it published, which meant a run that published nothing was
indistinguishable from a timer that never fired.

This is the same failure mode as a data source that silently freezes, which
this project has already been bitten by twice — the Riga OData endpoint and the
maritime CSVs that have been header-only since March. Both are caught because
``/api/system-status`` probes them and a human can see the result. A newsroom
that stops publishing deserves the same treatment.

WHAT IT IS NOT
--------------
It is not telemetry and it does not replace it. It is one small JSON document
per run, written to the container the site already reads from, using the
managed identity that already has permission. It cannot fail the run: the
caller wraps it, and a write that does not happen costs visibility, not
articles.

THE CONTRACT
------------
``articles/runs/latest.json`` always holds the most recent run.
``articles/runs/<YYYY-MM-DD>/<HHMMSS>.json`` holds the history, so a bad
afternoon can be reconstructed rather than inferred.

The shape is deliberately flat and boring, because something else has to
consume it — a status probe belongs on the API side, which this package does
not own. ``stale_after_hours`` is included so a probe does not have to hardcode
the schedule: it can compare ``finished_at`` against now and say "overdue"
without knowing anything about cron.
"""

from __future__ import annotations

import logging
from typing import Any

from newsroom.pipeline import config
from newsroom.pipeline.models import isoformat, utcnow
from newsroom.pipeline.publish import ArticleStore

log = logging.getLogger(__name__)

#: Where the latest report lives, relative to the articles container root.
LATEST_BLOB = "runs/latest.json"

#: How long after a run the report should be treated as stale. The schedule is
#: at most three runs a day, so a report older than this means a run was missed
#: rather than merely being between runs. Stated in the document so a consumer
#: does not have to know the cron expression.
STALE_AFTER_HOURS = 26

REPORT_VERSION = 1


def _history_blob(finished_at: str) -> str:
    day = finished_at[:10]
    stamp = finished_at[11:19].replace(":", "")
    return f"runs/{day}/{stamp}.json"


def build_run_report(report: Any, *, trigger: str, finished_at: str | None = None) -> dict[str, Any]:
    """The document, from a :class:`~newsroom.pipeline.run.RunReport`.

    Duck-typed and defensive throughout. This runs at the very end of a run
    that may already have gone wrong, and a report that raises while explaining
    a failure is worse than no report — it turns a bad run into a crashed one.
    """
    finished = finished_at or isoformat(utcnow())

    def count(name: str) -> int:
        try:
            return len(getattr(report, name, ()) or ())
        except TypeError:
            return 0

    published = list(getattr(report, "published", ()) or ())
    rejected = list(getattr(report, "rejected", ()) or ())
    desk = list(getattr(report, "desk", ()) or ())

    desk_actions: dict[str, int] = {}
    for outcome in desk:
        action = getattr(getattr(outcome, "action", None), "value", None)
        if action:
            desk_actions[action] = desk_actions.get(action, 0) + 1

    # The number that matters. Nine published articles from thirty runs and
    # nine from three are the same "published" count and completely different
    # states of health, and only this distinguishes them.
    generated = list(getattr(report, "generated", ()) or ())
    attempts = [
        int(g.article.provenance.get("attempts", 1))
        for g in generated
        if getattr(getattr(g, "article", None), "provenance", None)
    ]

    return {
        "version": REPORT_VERSION,
        "finished_at": finished,
        "trigger": trigger,
        "schedule": config.SCHEDULE,
        "stale_after_hours": STALE_AFTER_HOURS,
        "summary": str(getattr(report, "summary", lambda: "")() or ""),
        "counts": {
            "signals_detected": count("signals"),
            "articles_generated": len(generated),
            "published": len(published),
            "rejected": len(rejected),
            "syndicated": count("syndicated"),
            "errors": count("errors"),
            "style_notes": count("style_notes"),
        },
        "original_articles": {
            # Split out because tier A is the thing that keeps failing, and a
            # published count that includes syndicated cards hid exactly that:
            # the day the wire published nothing original still reported one
            # published article.
            "generated": len(generated),
            "publishable": sum(1 for g in generated if getattr(g, "publishable", False)),
            "attempts_total": sum(attempts),
            "attempts_max": max(attempts, default=0),
        },
        "desk": desk_actions,
        "published_slugs": [getattr(a, "slug", "") for a in published][:50],
        "rejected_slugs": [getattr(a, "slug", "") for a in rejected][:50],
        "errors": [str(e) for e in (getattr(report, "errors", ()) or ())][:20],
    }


async def write_run_report(
    report: Any,
    *,
    trigger: str,
    store: ArticleStore | None = None,
    finished_at: str | None = None,
) -> dict[str, Any]:
    """Write the report to ``runs/latest.json`` and to the dated history."""
    document = build_run_report(report, trigger=trigger, finished_at=finished_at)
    target = store or ArticleStore()
    await target.put_json(LATEST_BLOB, document)
    await target.put_json(_history_blob(document["finished_at"]), document)
    log.info("run report written: %s", document["summary"])
    return document


__all__ = [
    "LATEST_BLOB",
    "REPORT_VERSION",
    "STALE_AFTER_HOURS",
    "build_run_report",
    "write_run_report",
]
