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

from newsroom.pipeline.run import run_once  # noqa: E402

log = logging.getLogger(__name__)

app = func.FunctionApp()


@app.function_name(name="newsroom_edition")
@app.timer_trigger(
    schedule="0 0 14 * * *",
    arg_name="timer",
    run_on_startup=False,
    use_monitor=True,
)
async def newsroom_edition(timer: func.TimerRequest) -> None:
    """Daily edition.

    14:00 UTC sits after Nord Pool publishes day-ahead prices (~13:00 CET) and
    after Eurostat's usual 11:00 CET release window, so a run has the freshest
    data both sources will offer that day.
    """
    if timer.past_due:
        log.warning("timer is past due; running anyway")
    report = await run_once()
    log.info("edition: %s", report.summary())
    for error in report.errors:
        log.error("edition error: %s", error)


@app.function_name(name="newsroom_run_now")
@app.route(route="newsroom/run", auth_level=func.AuthLevel.FUNCTION, methods=["POST"])
async def newsroom_run_now(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for operators. Same code path as the timer."""
    report = await run_once()
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
