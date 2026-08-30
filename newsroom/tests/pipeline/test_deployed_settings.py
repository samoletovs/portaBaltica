"""Every setting the template declares is actually on the running app.

WHY A SECOND TEST, AND WHY IT IS NOT ANOTHER TEMPLATE TEST
-----------------------------------------------------------
`test_infrastructure_supplies_it` in `test_weekly.py` asserts that
`NEWSROOM_WEEKLY_SCHEDULE` and `param newsroomWeeklySchedule string` appear in
`main.bicep`. They do, it passes, and it is right about what it checks. Its
docstring names the failure it exists to prevent:

    a setting the app reads and the template never sets falls back to a default
    forever, which is the same disconnected knob one layer down

**That failure happened anyway, one layer further down again.** Measured against
the live Function App on 2026-08-30:

    template declares                          NEWSROOM_WEEKLY_SCHEDULE
    portabaltica-func has deployed             it does not
    the timer's effective schedule             0 0 15 * * 0   <- the CODE default

The template's population is the template. It cannot see a deployment, so a
parameter that reaches ARM and never reaches the app looks identical to one that
works.

THE CAUSE, VERIFIED RATHER THAN GUESSED
---------------------------------------
`NEWSROOM_WEEKLY_SCHEDULE` entered `config.py` and `main.bicep` in the same
commit, `7cb6000` (#108). Nothing was forgotten in that change.

`.github/workflows/newsroom-ci.yml` publishes the package and then sets exactly
one app setting, `NEWSROOM_REVISION`. **It never runs the Bicep template.** So
this is not a missed step in one pull request: *any* setting added to
`main.bicep` stays undeployed until a human runs `az deployment group create` by
hand. The class is "the template is not applied by CI", and this setting is its
first visible instance.

WHY IT IS INVISIBLE, AND WHY TODAY IS SAFE
------------------------------------------
The two defaults agree:

    main.bicep   param newsroomWeeklySchedule string = '0 0 15 * * 0'
    config.py    _setting("NEWSROOM_WEEKLY_SCHEDULE", default="0 0 15 * * 0")

So the app runs on its own default, which happens to equal the template's
intent, and the weekly timer fires correctly. **Agreement is what hides it.**
The knob is dead: change the parameter, redeploy the template, and the running
app keeps the default. A reader of `main.bicep` would have no way to know.

WHAT THIS FILE CAN AND CANNOT DO
--------------------------------
It compares the template against a **recorded** snapshot of the deployment,
because the unit suite has no network — `newsroom/tests/conftest.py` refuses
non-loopback connections, deliberately, and this file must not be the reason
that is weakened. So it cannot observe production by itself.

That is stated rather than papered over: what it enforces is that *someone
recorded* the deployed settings and that the template and the record agree. A
stale record is a real limitation and is why the file also pins the command that
refreshes it. This is sound, not complete: what it reports is real, but silence
here is weaker than proof, and the live check belongs in the deploy workflow,
which is not this session's to edit.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BICEP = REPO / "infrastructure" / "main.bicep"
SNAPSHOT = REPO / "infrastructure" / "deployed-settings.json"

#: Settings the running app carries that the template deliberately does not.
#:
#: `NEWSROOM_REVISION` is written by the deploy workflow from `GITHUB_SHA`; a
#: template value would be wrong the moment it was applied. The two Telegram
#: values are secrets and are set out of band on purpose — this repo holds no
#: `@secure()` parameter and adding one would be a regression.
DEPLOYED_OUT_OF_BAND = {
    "NEWSROOM_REVISION",
    "NEWSROOM_TELEGRAM_BOT_TOKEN",
    "NEWSROOM_TELEGRAM_CHAT_ID",
}


def _template_app_settings() -> set[str]:
    """The names inside the `appSettings: [ ... ]` array, and nothing else.

    Scoped to the array by bracket matching rather than matched across the whole
    file. The first version of this searched every `{ name: '...' }` in
    `main.bicep` and swept in five SKU and runtime declarations that share the
    shape — `FC1`, `Free`, `PerGB2018`, `Standard_LRS`, `python` — each of which
    would have been reported as an undeployed app setting.

    The obvious repair is a blacklist of those five. That is a word list
    discovered one bite at a time: it is complete only against the names that
    happened to bite, and the sixth `sku: { name: ... }` added to this template
    walks straight past it. Scoping to the array is structural, so no name
    outside it can be matched however it is spelled.
    """
    text = BICEP.read_text(encoding="utf-8")
    start = text.index("appSettings: [")
    cursor = text.index("[", start)
    depth = 0
    for end, char in enumerate(text[cursor:], start=cursor):
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                break
    else:  # pragma: no cover - an unbalanced template would fail the build first
        raise AssertionError("appSettings array is not closed in main.bicep")

    names = set(re.findall(r"\{\s*name:\s*'([A-Za-z_][A-Za-z_0-9]*)'", text[cursor:end]))
    assert names, "no `{ name: '...' }` entries inside the appSettings array"
    return names


def _recorded_deployment() -> dict:
    return json.loads(SNAPSHOT.read_text(encoding="utf-8"))


def test_the_probe_reads_a_template_with_settings_in_it() -> None:
    """Control.

    Every assertion below is a set difference. If the regex stopped matching,
    an empty set would make the comparisons vacuously true — the shape this
    repo has found six times, always failing toward "no finding here".
    """
    names = _template_app_settings()
    assert len(names) >= 10, f"only {len(names)} settings parsed from main.bicep: {sorted(names)}"
    assert "NEWSROOM_SCHEDULE" in names, "the daily schedule should be among them"


def test_the_parse_is_scoped_to_the_settings_array() -> None:
    """Negative control, and the reason this is not a blacklist.

    `main.bicep` declares five `{ name: '...' }` entries outside `appSettings` —
    SKUs and a runtime — and every one of them was reported as a missing app
    setting by the first version of this file. They are excluded structurally,
    so this proves the scoping holds rather than that five specific strings were
    remembered.
    """
    names = _template_app_settings()
    for sku in ("FC1", "Free", "PerGB2018", "Standard_LRS", "python"):
        assert sku not in names, (
            f"{sku!r} is a SKU or runtime name, not an app setting. The parse "
            f"has stopped being scoped to the appSettings array."
        )
    # Positive half, on the same object: the scoping must not have excluded
    # everything. An empty set would pass the loop above perfectly.
    assert "NEWSROOM_WEEKLY_SCHEDULE" in names


def test_every_templated_setting_is_deployed() -> None:
    """The assertion the template-only test cannot make.

    This is the one that would have caught `NEWSROOM_WEEKLY_SCHEDULE` being
    absent from `portabaltica-func` for three days while every signal was green.
    """
    recorded = _recorded_deployment()
    deployed = set(recorded["settings"])
    missing = sorted(_template_app_settings() - deployed)

    assert not missing, (
        f"{missing} are declared in main.bicep and are not on the Function App "
        f"as recorded in {SNAPSHOT.name} (observed {recorded['observed_at']}). "
        f"The app falls back to its code default, so the parameter is a dead "
        f"knob: changing it and redeploying the template changes nothing. "
        f"newsroom-ci.yml publishes code and sets NEWSROOM_REVISION only — it "
        f"never applies the template — so any new setting needs "
        f"`az deployment group create -g portabaltica-rg "
        f"--template-file infrastructure/main.bicep`, or an explicit "
        f"`az functionapp config appsettings set`."
    )


def test_the_snapshot_accounts_for_everything_the_app_carries() -> None:
    """Drift in the other direction, which is the one nobody looks for.

    A setting on the app that the template does not declare is not necessarily
    wrong — three are deliberate — but it must be *named*, because the
    alternative is a value nobody can explain and nobody dares remove.
    """
    recorded = _recorded_deployment()
    deployed = set(recorded["settings"])
    unexplained = sorted(deployed - _template_app_settings() - DEPLOYED_OUT_OF_BAND)

    assert not unexplained, (
        f"{unexplained} are on the Function App and are neither declared in "
        f"main.bicep nor listed in DEPLOYED_OUT_OF_BAND. Either add them to the "
        f"template so a redeploy preserves them, or name them here with the "
        f"reason they are set out of band."
    )


def test_the_snapshot_says_how_to_refresh_itself() -> None:
    """A recorded observation with no procedure rots into a fixture.

    The command lives in the file it describes, so a reader who doubts the
    snapshot can re-take it without reading this test or the pull request that
    added it.
    """
    recorded = _recorded_deployment()
    for field in ("observed_at", "command", "settings"):
        assert recorded.get(field), f"{SNAPSHOT.name} is missing `{field}`"
    assert "appsettings list" in recorded["command"], recorded["command"]
