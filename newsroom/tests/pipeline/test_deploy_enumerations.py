"""The deploy workflow's hand-written lists must equal the populations they stand for.

WHY THIS FILE
-------------
`newsroom-ci.yml` verifies two things after a publish, and each verifies them
against a list written by hand:

    required='newsroom_edition newsroom_weekly'          the timers
    grep -oE "\\{ name: '[A-Za-z_]+', value:" main.bicep  the app settings

Both are correct today. Both are the shape this repository has now been bitten
by three times: **a guard that enumerates its subject separately from the
subject.** `AGENTS.md` states the rule and the reason — "a shared enumeration
cannot drift; two enumerations always will, and the drift is silent in the
direction that reports success."

The timer list is the sharper case, because it has *already* drifted once. It
read `newsroom_edition` alone, which was right when that was the only timer and
became wrong the moment `#108` added `newsroom_weekly` — the consumer nobody
edited, correct for every case that existed when it was written. That was fixed
by adding the second name. **The fix has the same shape as the fault:** add a
third timer to `function_app.py` and the list does not grow, and a timer that
fails to register is invisible again. A weekly timer's silence takes a week to
notice; a monthly one would take a month.

THE SETTINGS PATTERN IS FRAGILE IN THE DANGEROUS DIRECTION
----------------------------------------------------------
The grep is line-anchored: it requires `{ name: 'X', value:` to appear on one
line. Bicep does not require that. Measured — one entry reformatted to the
multi-line form, which `az bicep build` accepts and compiles to byte-identical
ARM:

    workflow grep       12 -> 11   NEWSROOM_WEEKLY_SCHEDULE no longer found
    structural parse    12 -> 12

So a reformatting nothing would flag silently stops the deploy check from
watching the very setting the check was written for. **That is a false negative**,
and unlike the false positive that preceded it — a pattern that matched `_LRS`
out of a storage SKU and failed every deploy loudly — this one fails toward "no
finding here" and nobody hears it.

WHAT THIS FILE DOES, AND WHAT IT CANNOT
---------------------------------------
`.github/workflows/` is not this session's to edit, so this asserts the
agreement rather than removing the duplication. That is second best and is
stated as such: the better fix is for the workflow to read the population
instead of restating it, and for the settings that means reading the **compiled
ARM** rather than the Bicep source —

    az bicep build --file infrastructure/main.bicep --stdout

— whose `appSettings` array is a JSON list of objects with a literal `name`. That
is format-independent by construction: no source-text pattern can be defeated by
whitespace, because there is no source text involved. Measured, it yields the
same 12 names.

Until then, these assertions fail on the day either list stops matching its
population, in either direction.

EACH DIRECTION IS REPORTED SEPARATELY, AND THAT IS THE POINT
------------------------------------------------------------
The first version of this file asserted a bare equality per pair. That is one
artefact for two faults which call for **opposite** responses, and the failure
found it within hours of merging.

Reviewing `#264`, the manager planted a third timer by inserting it immediately
above `async def newsroom_weekly` — which put the new function between
`newsroom_weekly` and its own decorators, reassigning them. The guard went red,
correctly, and reported:

    waits for  [newsroom_edition, newsroom_weekly]
    declares   [newsroom_edition, newsroom_monthly]

…under a message that explained only the *declared-but-not-watched* case. The
real fault was the other one: `newsroom_weekly` had silently stopped being a
timer. It still exists, still deploys, and would never fire again.

**Following the message would have made it worse.** A reader adds
`newsroom_monthly` to `required=`, sees it still red, removes `newsroom_weekly`
— and the suite goes green with the weekly newsroom dead. The check written to
notice a timer that stops publishing would have been edited into blessing one.

So the two directions carry different text now, and the vanished-timer message
says *do not resolve this by editing the workflow list* in as many words. The
same split applies to the settings pair, where the asymmetry is the reverse: a
setting the grep cannot see narrows the check silently, while a spurious match
fails the deploy loudly and gets noticed.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WORKFLOW = REPO / ".github" / "workflows" / "newsroom-ci.yml"
FUNCTION_APP = REPO / "newsroom" / "function_app.py"
BICEP = REPO / "infrastructure" / "main.bicep"


def _declared_timers() -> set[str]:
    """Every function carrying an Azure Functions timer trigger.

    Parsed, not grepped: the question is which *functions* are timers, and a
    decorator name in a comment or a docstring reads the same to a regex.
    """
    tree = ast.parse(FUNCTION_APP.read_text(encoding="utf-8"))
    timers = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            func = dec.func if isinstance(dec, ast.Call) else dec
            if isinstance(func, ast.Attribute) and func.attr == "timer_trigger":
                timers.add(node.name)
    return timers


def _workflow_required_timers() -> set[str]:
    text = WORKFLOW.read_text(encoding="utf-8")
    match = re.search(r"required='([^']+)'", text)
    assert match is not None, (
        "no `required='...'` timer list in newsroom-ci.yml. If the health check "
        "now derives its own list, delete this assertion — do not weaken it."
    )
    return set(match.group(1).split())


def _workflow_settings_pattern() -> str:
    """The grep the workflow uses, read from the workflow rather than restated."""
    text = WORKFLOW.read_text(encoding="utf-8")
    match = re.search(r'grep -oE "([^"]+)" infrastructure/main\.bicep', text)
    assert match is not None, (
        "no `grep -oE \"...\" infrastructure/main.bicep` in newsroom-ci.yml."
    )
    return match.group(1)


def _template_app_settings() -> set[str]:
    """The appSettings array, scoped by bracket matching.

    Shared with `test_deployed_settings.py`'s reasoning: searching the whole
    file sweeps in `sku:` and `runtime:` blocks that use the same `{ name: ... }`
    shape.
    """
    text = BICEP.read_text(encoding="utf-8")
    cursor = text.index("[", text.index("appSettings: ["))
    depth = 0
    for end, char in enumerate(text[cursor:], start=cursor):
        depth += (char == "[") - (char == "]")
        if depth == 0:
            break
    else:  # pragma: no cover - an unbalanced template fails the build first
        raise AssertionError("appSettings array is not closed in main.bicep")
    names = set(re.findall(r"\{\s*name:\s*'([A-Za-z_][A-Za-z_0-9]*)'", text[cursor:end]))
    assert names, "no `{ name: '...' }` entries inside the appSettings array"
    return names


def test_the_probes_read_real_files() -> None:
    """Control.

    Every assertion below is a set comparison, and two empty sets are equal.
    A path that stopped resolving, or a regex that stopped matching, would make
    the whole file pass while checking nothing — the failure mode this repo has
    now found seven times, always in the direction that reports success.
    """
    assert WORKFLOW.exists() and FUNCTION_APP.exists() and BICEP.exists()
    assert len(_declared_timers()) >= 2, _declared_timers()
    assert len(_template_app_settings()) >= 10
    assert _workflow_required_timers()
    assert _workflow_settings_pattern()


def test_the_health_check_watches_every_timer_that_exists() -> None:
    """The list has drifted once already; this is what notices the next time.

    The two directions are reported separately, and that is not tidiness. A bare
    inequality is one artefact for two faults that call for opposite responses,
    and the natural reading of "these lists differ" is the benign one — so a
    reader steered wrong here fixes the symptom and buries the cause.
    """
    declared = _declared_timers()
    watched = _workflow_required_timers()

    unwatched = sorted(declared - watched)
    vanished = sorted(watched - declared)

    assert not vanished, (
        f"newsroom-ci.yml waits for {vanished} after a publish and "
        f"function_app.py no longer declares {'it' if len(vanished) == 1 else 'them'} "
        f"as a timer. **Do not resolve this by editing the workflow list.** A "
        f"timer named here and absent from the app is either a rename, a "
        f"removal, or — the case that produced this message the first time — a "
        f"function that has been separated from its decorators, so it still "
        f"exists, still deploys, and is silently no longer a timer at all. "
        f"Removing the name would make this test green while that cadence stops "
        f"publishing, which is the exact failure the check exists to catch. "
        f"Confirm the function still carries @app.timer_trigger before "
        f"concluding it was meant to go."
    )

    assert not unwatched, (
        f"function_app.py declares {unwatched} and newsroom-ci.yml does not wait "
        f"for {'it' if len(unwatched) == 1 else 'them'} after a publish. A timer "
        f"that is not waited for can fail to register with the deploy still "
        f"green, and the only symptom is that a cadence quietly stops "
        f"publishing — a week of silence for the weekly, which is how #108's "
        f"absence went unnoticed. Add the name to `required=`."
    )


def test_the_settings_grep_finds_every_templated_setting() -> None:
    """The pattern must not be defeated by how the template happens to be laid out.

    Measured: reformatting one entry to the multi-line form — valid Bicep,
    accepted by `az bicep build`, compiling to identical ARM — takes the grep
    from 12 names to 11 and drops `NEWSROOM_WEEKLY_SCHEDULE`. The deploy check
    then passes while no longer watching the setting it was written for.
    """
    pattern = _workflow_settings_pattern()
    text = BICEP.read_text(encoding="utf-8")

    # The workflow's own pattern, applied here. POSIX ERE and Python's engine
    # agree on this construct; anything fancier would need translating and is
    # a reason to stop restating the pattern at all.
    found = {
        m.group(1)
        for m in re.finditer(pattern.replace("[A-Za-z_]+", "([A-Za-z_]+)"), text)
    }
    expected = _template_app_settings()

    invisible = sorted(expected - found)
    spurious = sorted(found - expected)

    assert not invisible, (
        f"the deploy check's grep cannot see {invisible}, which the appSettings "
        f"array declares. The pattern is line-anchored and Bicep does not "
        f"require that layout, so the check now reports 'every templated setting "
        f"is deployed' while no longer knowing about "
        f"{'that setting' if len(invisible) == 1 else 'those settings'}. It "
        f"narrows silently and keeps returning success. The durable fix is to "
        f"read the compiled ARM — `az bicep build --file "
        f"infrastructure/main.bicep --stdout` — whose appSettings entries carry "
        f"a literal `name`, rather than matching source text at all."
    )

    assert not spurious, (
        f"the deploy check's grep matches {spurious}, which are not appSettings "
        f"entries. This direction fails the deploy loudly rather than quietly, "
        f"so it will be noticed — but it is noticed *at deploy time*, and the "
        f"first version of this pattern matched `_LRS` out of a storage SKU."
    )
