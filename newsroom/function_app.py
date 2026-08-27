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

import azure.functions as func  # noqa: E402

from newsroom.pipeline import config  # noqa: E402
from newsroom.pipeline.run import run_once  # noqa: E402
from newsroom.pipeline.runreport import write_run_report  # noqa: E402

log = logging.getLogger(__name__)

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
    # The app setting, honoured. ``NEWSROOM_SCHEDULE`` is set in Azure to
    # "0 0 5,11,17 * * *" — three runs a day — and this decorator used to
    # hardcode "0 0 14 * * *", so the intent sat in configuration doing nothing
    # while the app ran once daily. A knob that is silently disconnected is
    # worse than no knob: it makes a deployment look configured when it is not.
    #
    # Resolved in Python, NOT with the host's ``%NEWSROOM_SCHEDULE%``
    # interpolation. The two look equivalent and are not. ``%NAME%`` is
    # resolved by the *host* against application settings, and the host has no
    # default syntax — so on an app where the setting is missing the trigger
    # binding fails and the function never registers. That is the silent
    # deployment failure the CI deploy job polls for, and it would be caused by
    # the very line meant to make the schedule configurable.
    #
    # App settings reach the Python worker as environment variables before this
    # module is imported, so reading it here sees exactly the same value the
    # host would have interpolated, and ``config.SCHEDULE`` supplies a working
    # default when it is absent. It is also the value the run report states, so
    # the report cannot disagree with the trigger about what schedule is in
    # force.
    schedule=config.SCHEDULE,
    arg_name="timer",
    run_on_startup=False,
    use_monitor=True,
)
async def newsroom_edition(timer: func.TimerRequest) -> None:
    """Scheduled edition.

    The default, 14:00 UTC, sits after Nord Pool publishes day-ahead prices
    (~13:00 CET) and after Eurostat's usual 11:00 CET release window, so a run
    has the freshest data both sources will offer that day. The deployed
    setting asks for 05:00, 11:00 and 17:00 instead.
    """
    if timer.past_due:
        log.warning("timer is past due; running anyway")
    await _run_and_report("timer")


async def _wrap_and_report(trigger: str):
    """Run the weekly wrap and leave a record that it happened.

    The record is written whatever the outcome, and that is the whole point. A
    weekly cron that never fires and a week with nothing worth wrapping produce
    the same silence on the front page — a broken deployment and the feature
    working as designed, indistinguishable. Two runs have already sat queued
    here for sixteen hours looking exactly like healthy ones.

    So a missing weekly report for a week is the signal, and it is only a
    signal because a report is written even when no wrap is.
    """
    from newsroom.pipeline.publish import ArticleStore
    from newsroom.pipeline.weekly import WeeklyOutcome, write_weekly, write_weekly_report
    from newsroom.pipeline.write import AzureOpenAIWriter

    store = ArticleStore()
    try:
        outcome = await write_weekly(store, AzureOpenAIWriter())
    except Exception as exc:  # noqa: BLE001
        log.exception("the weekly wrap failed")
        outcome = WeeklyOutcome(
            outcome="error",
            week_start="",
            week_end="",
            findings_available=0,
            detail=str(exc),
        )

    log.info("weekly: %s — %s", outcome.outcome, outcome.detail)
    try:
        await write_weekly_report(store, outcome, trigger=trigger)
    except Exception:  # noqa: BLE001 — observability must not break the run
        log.exception("failed to write the weekly report")
    return outcome


@app.function_name(name="newsroom_weekly")
@app.timer_trigger(
    # Its own setting, not the daily one. `NEWSROOM_SCHEDULE` is already an app
    # setting rather than a decorator constant, because the two once disagreed
    # and the deployment looked configured for three runs a day while running
    # once. A second timer reading the first's setting would reintroduce that
    # gap in a new place, and would also make the two cadences impossible to
    # move independently.
    #
    # Resolved in Python for the same reason as the daily one: `%NAME%` is
    # interpolated by the host, which has no default syntax, so a missing
    # setting fails the trigger binding and the function never registers.
    schedule=config.WEEKLY_SCHEDULE,
    arg_name="timer",
    run_on_startup=False,
    use_monitor=True,
)
async def newsroom_weekly(timer: func.TimerRequest) -> None:
    """The weekly wrap.

    Sunday 15:00 UTC by default, an hour after the daily edition, so the week's
    last articles are already in the vintage ledger the wrap reads.
    """
    if timer.past_due:
        log.warning("weekly timer is past due; running anyway")
    await _wrap_and_report("timer")


@app.function_name(name="newsroom_weekly_now")
@app.route(
    route="newsroom/weekly", auth_level=func.AuthLevel.FUNCTION, methods=["POST"]
)
async def newsroom_weekly_now(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for operators. Same code path as the weekly timer."""
    outcome = await _wrap_and_report("manual")
    return func.HttpResponse(
        json.dumps(outcome.to_json(), ensure_ascii=False),
        mimetype="application/json",
        status_code=200,
    )


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
