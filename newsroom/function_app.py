"""Azure Functions host for the newsroom pipeline.

Timer-triggered, Flex Consumption, Python. One run produces one edition of the
wire.

Layout note
-----------
This file sits inside ``newsroom/``, which is both a Python package (when the
repository root is on ``sys.path``, as in tests and local runs) and the Function
App's deployment root (where its *contents* are unpacked at ``wwwroot/`` and the
package directory itself no longer exists).

The pipeline uses absolute ``newsroom.*`` imports so that neither layout leaks
into the stage modules. The shim below makes those imports resolve in both, by
registering this directory as the ``newsroom`` package when the surrounding
directory is gone. It runs before any pipeline import, which is why it is at the
top of the module rather than tucked into a helper.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

_HERE = Path(__file__).resolve().parent

if _HERE.name == "newsroom" and (_HERE.parent / "newsroom" / "__init__.py").exists():
    # Repository layout: newsroom/ is a package inside the repo root.
    if str(_HERE.parent) not in sys.path:
        sys.path.insert(0, str(_HERE.parent))
elif "newsroom" not in sys.modules:
    # Deployed layout: wwwroot/ holds this package's contents directly.
    _package = types.ModuleType("newsroom")
    _package.__path__ = [str(_HERE)]  # type: ignore[attr-defined]
    sys.modules["newsroom"] = _package

import json  # noqa: E402
import logging  # noqa: E402
import os  # noqa: E402

import azure.functions as func  # noqa: E402

from newsroom.pipeline.run import run_once  # noqa: E402
from newsroom.pipeline.runreport import write_run_report  # noqa: E402

log = logging.getLogger(__name__)

#: Applied when the app setting is absent, so a fresh deployment still runs.
DEFAULT_SCHEDULE = "0 0 14 * * *"
os.environ.setdefault("NEWSROOM_SCHEDULE", DEFAULT_SCHEDULE)

app = func.FunctionApp()


async def _run_and_report(trigger: str):
    """Run one edition and leave a record that it happened.

    Application Insights is receiving nothing from this app — no requests, no
    traces, no exceptions — so the only evidence a run existed was the articles
    it happened to publish. On a day when it published none, which is what
    2026-08-25 was, that is indistinguishable from the timer never firing. The
    report is written whatever the outcome, so silence becomes readable.
    """
    report = await run_once()
    log.info("edition: %s", report.summary())
    for error in report.errors:
        log.error("edition error: %s", error)
    try:
        await write_run_report(report, trigger=trigger)
    except Exception:  # noqa: BLE001 — observability must not break the run
        log.exception("failed to write the run report")
    return report


@app.function_name(name="newsroom_edition")
@app.timer_trigger(
    # Read from the app setting rather than hardcoded. ``NEWSROOM_SCHEDULE`` was
    # set in Azure to "0 0 5,11,17 * * *" — three runs a day — and this
    # decorator ignored it, so the intent sat in configuration doing nothing
    # while the app ran once daily. A knob that is silently disconnected is
    # worse than no knob: it makes the deployment look configured.
    #
    # ``%NAME%`` is the Functions host's app-setting interpolation. The default
    # below is applied in code because the host has no default syntax, and an
    # unset setting would otherwise fail the trigger binding outright.
    schedule="%NEWSROOM_SCHEDULE%",
    arg_name="timer",
    run_on_startup=False,
    use_monitor=True,
)
async def newsroom_edition(timer: func.TimerRequest) -> None:
    """Scheduled edition.

    The default, 14:00 UTC, sits after Nord Pool publishes day-ahead prices
    (~13:00 CET) and after Eurostat's usual 11:00 CET release window, so a run
    has the freshest data both sources will offer that day.
    """
    if timer.past_due:
        log.warning("timer is past due; running anyway")
    await _run_and_report("timer")


@app.function_name(name="newsroom_run_now")
@app.route(route="newsroom/run", auth_level=func.AuthLevel.FUNCTION, methods=["POST"])
async def newsroom_run_now(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for operators. Same code path as the timer."""
    report = await _run_and_report("manual")
    return func.HttpResponse(
        json.dumps(
            {
                "summary": report.summary(),
                "published": [a.slug for a in report.published],
                "rejected": [a.slug for a in report.rejected],
                "editor_decisions": [decision.to_dict() for decision in report.edited],
                "errors": report.errors,
            },
            ensure_ascii=False,
        ),
        mimetype="application/json",
        status_code=200,
    )
