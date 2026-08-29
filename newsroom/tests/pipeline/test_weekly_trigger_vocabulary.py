"""The timer says it is the timer, and the report is readable without Azure.

WHAT THIS IS FOR
----------------
Exactly one question about this project cannot be answered by measuring today:
**does the weekly cron actually fire?** The timer landed on Thursday 27 August
and its first scheduled Sunday is 30 August, so until then there is nothing to
observe. Whoever looks afterwards settles it by fetching one blob:

    articles/runs/weekly-<YYYY-MM-DD>.json

``WeeklyOutcome``'s docstring covers the absent case -- "the absence of a record
for a week is itself the signal that the trigger did not fire". This file covers
the case absence cannot: a report that *exists* still has to say whether the
schedule produced it or a person did, and that is the ``trigger`` field alone.

WHY IT NEEDS A GUARD AND NOT JUST A COMMENT
-------------------------------------------
The two values are literals in ``function_app.py``, at two entry points, and the
pre-existing test of the field cannot see either of them:

    document = await write_weekly_report(store, outcome, trigger="timer")
    assert document["trigger"] == "timer"

That supplies the value it asserts. It proves ``write_weekly_report`` copies its
argument through -- worth knowing -- and says nothing about what the *timer*
passes. So if the scheduled entry point were ever refactored to pass "scheduled",
or to share the manual path's "manual", every test in this repo would stay green
and tomorrow's report would be a well-formed lie: a healthy-looking record of a
run the cron never performed.

That is the failure this project keeps finding, arriving on the one artefact
whose whole purpose is to detect it. A mislabelled report is not detectably
different from a correct one, so the label has to be pinned where it is written.

The functions cannot simply import a shared constant instead: Azure Functions
binds triggers by decorator, so each entry point states its own identity. Two
copies in two files with no compiler between them is the same shape as the
``weekly_wrap`` format value, and it gets the same answer -- assert them.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FUNCTION_APP = REPO / "newsroom" / "function_app.py"


def _wrap_and_report_calls() -> list[tuple[str, str]]:
    """Every ``_wrap_and_report(...)`` literal argument, with its function.

    Parsed rather than grepped. A regex over source answers a question about
    text, and the question here is which *function* makes the call -- the whole
    point is that the timer's entry point and the operator's must differ, and
    two identical call lines in different functions look the same to a grep.
    """
    tree = ast.parse(FUNCTION_APP.read_text(encoding="utf-8"))
    found: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for call in ast.walk(node):
            if not isinstance(call, ast.Call):
                continue
            target = call.func
            if not isinstance(target, ast.Name) or target.id != "_wrap_and_report":
                continue
            for arg in call.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    found.append((node.name, arg.value))
    return found


def test_the_probe_can_see_the_call_sites() -> None:
    """Control.

    Every assertion below is about the values found here. If the parser stopped
    finding calls -- a rename, a refactor into a helper -- an empty list would
    make the membership checks vacuously true and this file would pass while
    checking nothing.
    """
    calls = _wrap_and_report_calls()
    assert len(calls) >= 2, f"expected the timer and the manual route, found {calls}"


def test_the_scheduled_entry_point_labels_itself_timer() -> None:
    """The assertion tomorrow's answer rests on."""
    from newsroom.pipeline.weekly import WEEKLY_TRIGGERS

    calls = dict(_wrap_and_report_calls())
    assert calls.get("newsroom_weekly") == "timer", (
        f"the scheduled function passes {calls.get('newsroom_weekly')!r}. "
        f"`runs/weekly-<date>.json` carries this string, and it is the only "
        f"record of whether the Sunday cron fired or an operator ran the wrap "
        f"by hand. A wrong label here is undetectable: the report is still "
        f"well formed, still current, and still wrong about the one thing it "
        f"exists to say. Expected 'timer', from WEEKLY_TRIGGERS={WEEKLY_TRIGGERS}."
    )


def test_the_manual_route_is_distinguishable_from_the_schedule() -> None:
    """Both halves, because one label is only informative against the other.

    If the manual route also said "timer", the field would be a constant, and a
    constant answers nothing. This is the negative control for the assertion
    above rather than a second requirement.
    """
    calls = dict(_wrap_and_report_calls())
    assert calls.get("newsroom_weekly_now") == "manual", (
        f"the operator route passes {calls.get('newsroom_weekly_now')!r}, "
        f"expected 'manual'."
    )
    assert calls["newsroom_weekly"] != calls["newsroom_weekly_now"], (
        "both entry points label their runs the same way, so the trigger field "
        "cannot distinguish a fired cron from a hand-run one."
    )


def test_every_label_used_is_one_the_documentation_declares() -> None:
    """The vocabulary is closed, and `weekly.py` is where it is written down."""
    from newsroom.pipeline.weekly import WEEKLY_TRIGGERS

    used = sorted({trigger for _, trigger in _wrap_and_report_calls()})
    assert used == sorted(WEEKLY_TRIGGERS), (
        f"function_app.py uses {used} and weekly.py documents "
        f"{sorted(WEEKLY_TRIGGERS)}. Equality rather than membership: a label "
        f"in use but undocumented is a report nobody can interpret, and a "
        f"documented label nobody passes is an interpretation that never "
        f"applies."
    )


def test_the_dated_report_path_matches_the_one_documented() -> None:
    """The instruction "fetch runs/weekly-<date>.json" has to stay true.

    `write_weekly_report` builds that name by slicing an ISO instant, and the
    comment block above `WEEKLY_TRIGGERS` tells a reader to fetch it. If the
    naming changed, the documentation would send them to a 404 and they would
    read it as the failure it is meant to detect -- absence meaning "the cron
    never fired" when it really means "someone renamed the blob".
    """
    from newsroom.pipeline import weekly

    source = Path(weekly.__file__).read_text(encoding="utf-8")
    assert re.search(r'f"runs/weekly-\{[^}]+\[:10\]\}\.json"', source), (
        "the dated report is no longer written to runs/weekly-<YYYY-MM-DD>.json. "
        "Update the reader-facing path documented beside WEEKLY_TRIGGERS in the "
        "same change, or a reader following it finds a 404 and mistakes it for "
        "a missed week."
    )
