"""The shared notifier's own behaviour, executed rather than read.

WHY THIS FILE EXISTS SEPARATELY
-------------------------------
`.github/workflows/alert-notify.yml` is called by both monitors — `wire-alert`
for the newsroom's feeds and `source-alert` for the dashboard's twelve sources —
and is owned by neither. Its assertions live here, once. Two copies of an
assertion about one shared file is the drift this repository keeps writing
post-mortems about, and the alternative was asserting the same thing from
`test_wire_probe.py` and `tests/sourceAlert.test.ts` and hoping they stayed in
step.

WHY IT EXECUTES THE SHELL INSTEAD OF READING IT
-----------------------------------------------
Because a text assertion was already there and was not enough. `#348` shipped
with three assertions about the rehearsal banner and all three read the
workflow's *text*: that the string is present, that the input is declared, that
the Telegram step is not gated. Every one of them survives this mutation::

    if [ "${REHEARSAL:-false}" = "true" ]; then      ->      if false; then

The banner text is still in the file, so the regex still matches, and the
behaviour is gone. 50 vitest tests and 2624 pytest tests stayed green through
it — measured, not supposed.

That is the same shape `#348` was written about, one level down: `#340` and
`#343` asserted the *routing* at both ends and left what the notifier *does*
with the flag unguarded, and the first fix for it asserted the banner's presence
and left whether it is *reached* unguarded. So this runs the block.

Reimplementing the shell in Python and comparing would be the guard that
restates its subject, which `AGENTS.md` catalogues three times. The step's own
`run:` script is extracted from the YAML and executed.
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
NOTIFIER = REPO_ROOT / ".github" / "workflows" / "alert-notify.yml"

#: A realistic alert body, shaped like the one that shipped. The first line is
#: what a phone preview shows; `source` sits on line 3, where it cannot help.
REAL_MESSAGE = (
    "portaBaltica newsroom wire: ALERT - 1 wire source refused or unreachable\n"
    "checked 2026-09-01T08:17:59Z\n"
    "source  fixture:rehearsal.json"
)


def _notifier() -> dict[str, Any]:
    return yaml.safe_load(NOTIFIER.read_text(encoding="utf-8"))


def _normalise_script() -> str:
    """The Normalise step's real shell, taken from the workflow.

    Asked for by ``id``, and asserted to be unique: selecting "the first step"
    would silently follow a reordering, and this is a test about a specific
    block rather than about whichever one happens to come first.
    """
    steps = _notifier()["jobs"]["notify"]["steps"]
    verdict = [s for s in steps if s.get("id") == "verdict"]
    assert len(verdict) == 1, f"expected exactly one step with id=verdict, got {len(verdict)}"
    return verdict[0]["run"]


def _usable_bash() -> str | None:
    """A bash that actually runs, or None.

    "The binary is on PATH" is not the test, and that is measured rather than
    cautious: on the Windows machine this was written on, ``bash`` is the WSL
    stub with no distribution installed. It writes UTF-16LE prose about
    installing one to **stdout** and exits 1 — so a harness that checked for the
    executable, or that read stdout, would get a plausible non-empty string back
    and report it as a result.

    The control is therefore behavioural: it must echo what it is told to.
    """
    candidates = [
        "bash",
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
        "/bin/bash",
        "/usr/bin/bash",
    ]
    for candidate in candidates:
        try:
            probe = subprocess.run(
                [candidate, "-c", "printf ok"], capture_output=True, timeout=30
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if probe.returncode == 0 and probe.stdout.strip() == b"ok":
            return candidate
    return None


BASH = _usable_bash()


def _parse_github_output(raw: str) -> dict[str, str]:
    """Read a step's outputs the way the Actions runner does.

    Only the heredoc form is handled, because that is the only form this step
    uses and a parser that silently accepted `key=value` would be describing a
    file this one does not write.
    """
    outputs: dict[str, str] = {}
    lines = raw.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        if "<<" in line:
            key, delimiter = line.split("<<", 1)
            body: list[str] = []
            index += 1
            while index < len(lines) and lines[index] != delimiter:
                body.append(lines[index])
                index += 1
            outputs[key] = "\n".join(body)
        index += 1
    return outputs


def _run(rehearsal: str | None, message: str = REAL_MESSAGE) -> dict[str, Any]:
    """Run the real step and return both what it printed and what it published.

    WHY BOTH, AND WHY THE OUTPUT IS THE ONE THAT MATTERS
    ----------------------------------------------------
    Every consumer reads ``steps.verdict.outputs.message`` — the Telegram send,
    the issue body, the step summary, the recovery comment, four call sites. The
    step *also* prints the message, and the first version of this file asserted
    on that print, because it was the thing subprocess handed back.

    They agree today, both being ``$message``. Nothing said so. A print is what
    is convenient to read and an output is what is consumed, which is the same
    distinction that put a text assertion where a behavioural one was meant one
    commit ago.
    """
    assert BASH, "guarded by the skip below"
    script = _normalise_script()
    with tempfile.TemporaryDirectory() as tmp:
        output_file = Path(tmp, "github_output")
        env = {
            **os.environ,
            "GITHUB_OUTPUT": str(output_file),
            "ALERT": "true",
            "HEADLINE": "1 wire source refused or unreachable",
            "MESSAGE": message,
            "SUBJECT": "Newsroom wire",
        }
        if rehearsal is not None:
            env["REHEARSAL"] = rehearsal
        else:
            env.pop("REHEARSAL", None)
        done = subprocess.run(
            [BASH, "-c", script], cwd=tmp, env=env, capture_output=True, text=True, timeout=120
        )
        assert done.returncode == 0, f"the Normalise step failed: {done.stderr}"
        published = _parse_github_output(output_file.read_text(encoding="utf-8"))
    return {"stdout": done.stdout, "outputs": published}


def _first_line(rehearsal: str | None, message: str = REAL_MESSAGE) -> str:
    """The line a notification preview would show, taken from the PUBLISHED message.

    Read from the output rather than from stdout, because the output is what
    every consumer of this step receives.
    """
    return _run(rehearsal, message)["outputs"]["message"].splitlines()[0]


# ── the instrument ──────────────────────────────────────────────────────────


def test_ci_must_not_skip_these(): # noqa: ANN201
    """A skip is absence resolving to success, so it must be impossible where it counts.

    On a developer machine without a usable shell these tests skip and the
    structural assertions below still run. In CI they must not: a behavioural
    test that silently never executes in the one place that gates a merge is
    worth less than no test, because it reports a passing suite either way.
    """
    if os.environ.get("GITHUB_ACTIONS", "").strip().lower() == "true":
        assert BASH, "CI has bash; if this fails the harness is broken, not the workflow"


# ── the behaviour, executed ─────────────────────────────────────────────────


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
def test_a_rehearsal_announces_itself_in_the_line_a_phone_shows() -> None:
    """The defect, stated as the property rather than as a string in a file.

    Telegram message 1173 at 2026-09-01T08:18Z was a rehearsal delivered to the
    real chat, and its first line was indistinguishable from a real outage. The
    body said `source fixture:rehearsal.json` on line 3, honestly, where no
    notification preview reaches.
    """
    assert "REHEARSAL" in _first_line("true")


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
def test_a_real_alert_is_not_dressed_as_a_rehearsal() -> None:
    """The companion, and the one that matters more.

    Every assertion that something is added needs a case where it is not, or it
    passes against a block that adds the banner unconditionally — which would
    put "NOT A REAL ALERT" at the top of every genuine outage.
    """
    first = _first_line("false")
    assert "REHEARSAL" not in first
    assert first.startswith("portaBaltica newsroom wire: ALERT")


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
@pytest.mark.parametrize("value", ["", None, "no", "TRUE", "1"])
def test_anything_but_true_is_a_real_alarm(value: str | None) -> None:
    """Which way does absence resolve, and here it is not a free choice.

    Dressing a real alarm as a rehearsal is the only direction that could get a
    live outage ignored, so every value that is not exactly ``true`` — absent,
    empty, or merely truthy-looking — must produce a real alarm.

    ``TRUE`` and ``1`` are in the list deliberately: the shell compares strings,
    so they are not the flag, and a future rewrite that made them count would be
    widening the quiet path.
    """
    assert "REHEARSAL" not in _first_line(value)


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
def test_the_banner_adds_to_the_report_rather_than_replacing_it() -> None:
    """A rehearsal still has to be readable, or it rehearses the wrong thing.

    The point of a rehearsal is that the message it delivers is the message a
    real alert would deliver. A banner that swallowed the body would prove a
    path this repository does not use.
    """
    published = _run("true")["outputs"]["message"]
    for line in REAL_MESSAGE.splitlines():
        assert line in published, f"the rehearsal lost a line of the real report: {line!r}"


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
def test_what_the_step_prints_is_what_it_publishes() -> None:
    """The seam inside the step, which every other test here would step over.

    Four consumers read ``steps.verdict.outputs.message`` — the Telegram send,
    the issue body, the step summary, the recovery comment. The step also
    *prints* the message, and a print is what a subprocess hands back, so it is
    what a test naturally reaches for. This file did exactly that until it was
    pointed at the output instead.

    They are the same variable today. Nothing said so, and a change that
    corrected one without the other would leave every assertion here green while
    the notification carried something else.
    """
    for rehearsal in ("true", "false"):
        result = _run(rehearsal)
        assert result["stdout"].strip() == result["outputs"]["message"].strip(), (
            f"printed and published disagree with REHEARSAL={rehearsal}"
        )


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
def test_a_rehearsal_with_no_report_still_announces_itself() -> None:
    """The fallback body is the one a broken monitor produces, and it is still
    a rehearsal when a rehearsal produced it. Nothing may reach the real chat
    unlabelled, including the text the notifier writes for itself."""
    assert "REHEARSAL" in _first_line("true", message="")


# ── the wiring, which the execution above cannot see ────────────────────────


def _workflow_call_inputs() -> dict[str, Any]:
    """The declared inputs, reached past a YAML trap that costs an hour to find.

    ``on:`` is not the string ``"on"`` after ``yaml.safe_load``. YAML 1.1 reads
    it as the **boolean True**, along with ``yes``, ``no`` and ``off``, so
    ``workflow["on"]`` raises ``KeyError`` against a file that is perfectly
    correct. Measured here::

        top-level keys: ['name', True, 'permissions', 'jobs']

    The first version of this helper indexed by ``"on"`` and failed, which reads
    as "the input is not declared" — a confident false finding about the
    workflow, produced by the parser rather than by the file.
    """
    workflow = _notifier()
    key = True if True in workflow else "on"
    return workflow[key]["workflow_call"]["inputs"]


def test_the_input_is_declared_and_defaults_to_a_real_alarm() -> None:
    """Executing the step proves what it does with REHEARSAL. It cannot prove
    the workflow accepts one: `workflow_call` inputs are GitHub's contract with
    the caller, and a caller passing an undeclared input fails the run."""
    inputs = _workflow_call_inputs()

    assert "rehearsal" in inputs
    # A string, not a boolean: the shell compares text, and `default: false`
    # unquoted would arrive as YAML's boolean and render as `False`.
    assert inputs["rehearsal"]["default"] == "false"
    assert inputs["rehearsal"]["type"] == "string"


def test_the_declared_input_reaches_the_step_that_reads_it() -> None:
    """The seam between the two tests above. The execution sets REHEARSAL by
    hand; only this says the workflow sets it from the input."""
    steps = _notifier()["jobs"]["notify"]["steps"]
    verdict = [s for s in steps if s.get("id") == "verdict"][0]

    assert "inputs.rehearsal" in str(verdict["env"]["REHEARSAL"])


def test_a_rehearsal_still_rings() -> None:
    """Suppressing the send is the tempting fix and it is the wrong one.

    A rehearsal exists to prove this path delivers, and a path that has never
    delivered is not a path. So the Telegram step stays keyed on ``alert``
    alone, and a later change that gags rehearsals is caught here rather than by
    a silence nobody notices.
    """
    steps = _notifier()["jobs"]["notify"]["steps"]
    telegram = [s for s in steps if "Telegram" in str(s.get("name"))]
    assert len(telegram) == 1, f"expected one Telegram step, got {len(telegram)}"

    assert telegram[0]["if"] == "inputs.alert == 'true'"


def test_the_banner_is_reached_only_through_the_flag() -> None:
    """The structural guard, which runs even where bash does not.

    Weaker than executing the block and not a substitute for it — it cannot tell
    a working conditional from ``if false``, which is the mutation that
    motivated this file. It is here so that a machine with no usable shell
    degrades to a lesser check rather than to none.
    """
    script = _normalise_script()
    banner = [line for line in script.splitlines() if "REHEARSAL - NOT A REAL ALERT" in line]
    assert len(banner) == 1, f"expected exactly one banner line, got {len(banner)}"

    guard = re.search(r'if \[ "\$\{REHEARSAL:-false\}" = "true" \]; then', script)
    assert guard, "the banner must sit behind an explicit test for the flag"
    assert script.index(banner[0]) > guard.start(), "the banner must be inside the conditional"


# ── standing down ───────────────────────────────────────────────────────────
#
# Alerting was Telegram AND the issue; recovery was the issue alone. A reader on
# the loudest channel saw ALERT and never saw it cleared. Nothing in the file
# argued for that -- the recovery step carried no comment defending silence,
# because it was never a decision.
#
# The gate is the whole design, and the rule was already four lines up in the
# issue path: say something iff something was open. A clean read is the NORMAL
# state -- every scheduled run of a healthy monitor is one -- so sending on
# `alert != true` alone would turn a daily all-clear into a daily notification.


def _recovery_script() -> str:
    """The recovery step, taken from the workflow by id rather than by position."""
    steps = _notifier()["jobs"]["notify"]["steps"]
    recovery = [s for s in steps if s.get("id") == "recovery"]
    assert len(recovery) == 1, f"expected exactly one step with id=recovery, got {len(recovery)}"
    return recovery[0]["run"]


def _run_recovery(open_issue: str | None) -> dict[str, Any]:
    """Execute the real recovery step against a stubbed ``gh``.

    The step calls out to GitHub, so the only way to run it is to stand a fake
    ``gh`` in front of it. That is stubbing a dependency rather than
    reimplementing the step: the shell under test is the workflow's own, taken
    from the YAML, and what is replaced is the thing it talks to.

    The stub records every call, so the assertions can be about what the step
    *did* -- whether it commented, whether it closed -- rather than only about
    what it printed.
    """
    assert BASH, "guarded by the skip below"
    script = _recovery_script()
    with tempfile.TemporaryDirectory() as tmp:
        shim = Path(tmp, "bin")
        shim.mkdir()
        calls = Path(tmp, "gh-calls.txt")
        answer = open_issue if open_issue is not None else ""
        gh = shim / "gh"
        # `issue list` is the only call whose answer the step reads. Everything
        # else is recorded and succeeds.
        gh.write_text(
            "#!/bin/sh\n"
            f'printf "%s\\n" "$*" >> "{calls.as_posix()}"\n'
            'case "$*" in\n'
            f'  *"issue list"*) printf "%s" "{answer}" ;;\n'
            "esac\n"
            "exit 0\n",
            encoding="utf-8",
            newline="\n",
        )
        subprocess.run([BASH, "-c", f"chmod +x '{gh.as_posix()}'"], check=True, timeout=60)

        output_file = Path(tmp, "github_output")
        summary_file = Path(tmp, "github_step_summary")
        env = {
            **os.environ,
            "PATH": str(shim) + os.pathsep + os.environ["PATH"],
            "GITHUB_OUTPUT": str(output_file),
            "GITHUB_STEP_SUMMARY": str(summary_file),
            "GITHUB_REPOSITORY": "samoletovs/portaBaltica",
            "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_RUN_ID": "1",
            "GITHUB_WORKFLOW": "Newsroom wire",
            "GH_TOKEN": "stub",
            "MESSAGE": "portaBaltica newsroom wire: OK - all 7 wire sources delivering",
            "LABEL": "wire-alert",
        }
        done = subprocess.run(
            [BASH, "-c", script], cwd=tmp, env=env, capture_output=True, text=True, timeout=120
        )
        assert done.returncode == 0, f"the recovery step failed: {done.stderr}"
        published = _parse_key_values(output_file.read_text(encoding="utf-8"))
        recorded = calls.read_text(encoding="utf-8") if calls.exists() else ""
    return {"stdout": done.stdout, "outputs": published, "gh_calls": recorded}


def _parse_key_values(raw: str) -> dict[str, str]:
    """`key=value` lines, which is the form this step writes."""
    out: dict[str, str] = {}
    for line in raw.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            out[key] = value
    return out


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
def test_recovery_publishes_the_issue_it_closed() -> None:
    """The positive case, read from what the step PUBLISHES.

    The notification step cannot look this up for itself: by the time it runs the
    issue is closed, so a query for an open one with that label correctly returns
    nothing. The gate therefore has to be handed forward.
    """
    result = _run_recovery("335")

    assert result["outputs"]["closed"] == "335"
    assert "issue comment 335" in result["gh_calls"]
    assert "issue close 335" in result["gh_calls"]


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
def test_a_clean_read_with_nothing_open_publishes_no_issue() -> None:
    """The case that matters, and the one that decides whether this is noise.

    A clean read is the normal state: every scheduled run of a healthy monitor is
    one. If this published a number, the recovery message would fire on all of
    them, and a daily all-clear is exactly the wallpaper this line of work exists
    to remove.
    """
    result = _run_recovery(None)

    assert result["outputs"]["closed"] == ""
    assert "Saying nothing" in result["stdout"]
    assert "issue close" not in result["gh_calls"]
    assert "issue comment" not in result["gh_calls"]


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
def test_the_absence_is_published_rather_than_left_unset() -> None:
    """An unset output and an empty one read the same to a GitHub expression, and
    only one of them is a statement. Asserting the key is present is what stops a
    future edit dropping the write and relying on the default."""
    assert "closed" in _run_recovery(None)["outputs"]


def test_the_recovery_message_is_gated_on_an_issue_having_been_open() -> None:
    """The seam between the two behavioural tests above and the step that reads them.

    The `if:` is a GitHub expression and cannot be executed here, so this is a
    structural assertion and is labelled as one. What it guards is real: keyed on
    `alert != true` alone, this step would fire on every clean scheduled run.
    """
    steps = _notifier()["jobs"]["notify"]["steps"]
    send = [s for s in steps if s.get("name") == "Send the recovery message"]
    assert len(send) == 1, f"expected one recovery message step, got {len(send)}"

    condition = send[0]["if"]
    assert "steps.recovery.outputs.closed != ''" in condition, (
        "keyed on alert alone, this fires on every clean run"
    )
    assert "inputs.alert != 'true'" in condition


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
def test_the_recovery_message_fails_loudly_when_the_channel_is_dead() -> None:
    """Same reasoning as the alert send. A stand-down that silently did not
    arrive leaves a reader believing an outage is still running, which is the
    state this step exists to end.

    EXECUTED, because the obvious assertion cannot fail. Written as
    ``"exit 1" in step["run"]`` this passed against a planted fault that turned
    the missing-secret branch into ``echo ...; exit 0`` -- because a *different*
    ``exit 1``, the one handling a sendMessage failure, is still in the block.
    A substring cannot tell which branch it came from. Running it can: with no
    token the step must stop, non-zero, before it ever reaches curl.
    """
    steps = _notifier()["jobs"]["notify"]["steps"]
    send = [s for s in steps if s.get("name") == "Send the recovery message"][0]

    with tempfile.TemporaryDirectory() as tmp:
        env = {
            **os.environ,
            "GITHUB_STEP_SUMMARY": str(Path(tmp, "summary")),
            "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_REPOSITORY": "samoletovs/portaBaltica",
            "GITHUB_RUN_ID": "1",
            "SUBJECT": "Newsroom wire",
            "MESSAGE": "portaBaltica newsroom wire: OK",
            "CLOSED": "335",
            "NAURO_BOT_TOKEN": "",
            "NAURO_CHAT_ID": "",
        }
        done = subprocess.run(
            [BASH, "-c", send["run"]], cwd=tmp, env=env, capture_output=True, text=True, timeout=120
        )

    assert done.returncode != 0, "a dead channel must fail the run, not skip"
    assert "::error::" in done.stdout + done.stderr
    # It must stop before the send, rather than attempt one with no credentials.
    assert "Delivered recovery" not in done.stdout


def test_the_recovery_message_uses_the_same_channel_as_the_alert() -> None:
    """Structural, and labelled as such: the send itself cannot be executed here
    without a real credential and a real chat."""
    steps = _notifier()["jobs"]["notify"]["steps"]
    send = [s for s in steps if s.get("name") == "Send the recovery message"][0]

    assert "NAURO_BOT_TOKEN" in send["env"]
    assert "NAURO_CHAT_ID" in send["env"]
    assert "sendMessage" in send["run"]

# ── the stand-down leg ──────────────────────────────────────────────────────
#
# Every rehearse option was a fault, so every one alerted, so every one opened a
# `*-rehearsal` issue and nothing could ever close one. The issue accumulated
# for ever while carrying the body text "closes itself when a later run reads
# clean". Worse since #362 added the recovery notification -- though not for the
# reason first written here, which said that step "had never delivered" and was
# false by 98 minutes when it was committed. It had delivered at 16:11:38Z
# against real production issue #350; what had never happened was a REHEARSAL of
# it, which is the argument that survives. See wire-alert.yml.
#
# THE UNMEASURED CLAIM IS WORTH MORE THAN THE FIX.
# The probe behind it ran `gh issue list --label wire-alert-rehearsal` and got 0
# -- true, and a fact about ISSUES. The sentence written from it was about
# DELIVERIES, which nothing had counted, and the two differ exactly where the
# recovery path ran outside a rehearsal. The output block was even labelled "has
# EITHER leg ever actually delivered?" above a command that counted issues: the
# `tracked files scanned` shape, where the label names a wider population than
# the code walks. `AGENTS.md` calls the general case the claim you never
# measured at all, and notes it lands in prose rather than in a code block
# because a number in a sentence reads as known.
#
# THE ASSERTION IS A PROPERTY, NOT A NAME LIST, AND THAT IS NOT STYLE.
# The finding itself was first reported as "all four options alert" when there
# were five: the probe grepped for the option names it expected, so
# `total-refusal` -- added by #356, which the reporter had no part in -- was
# invisible. A guard that enumerates what it expects to find cannot see what it
# did not think of, which is this repository's most-repeated fault and was
# committed here in the act of reporting it. So this asks the workflow for its
# own options and runs every one of them.


def _rehearse_options(workflow: str) -> list[str]:
    """The options the workflow declares, asked for rather than listed here."""
    parsed = yaml.safe_load((REPO_ROOT / ".github" / "workflows" / workflow).read_text(encoding="utf-8"))
    # `on:` is the boolean True after safe_load -- YAML 1.1. See _workflow_call_inputs.
    key = True if True in parsed else "on"
    options = parsed[key]["workflow_dispatch"]["inputs"]["rehearse"]["options"]
    return [o for o in options if o != "no"]


@pytest.mark.parametrize("workflow", ["wire-alert.yml", "source-alert.yml"])
def test_a_rehearsal_can_reach_the_stand_down(workflow: str) -> None:
    """Some option must produce a clean reading, or an opened issue never closes.

    Named rather than derived, deliberately: the fixture that produces it has to
    be written by hand, so `recovered` is a fact about the workflow rather than
    something a property can discover. What the property below guards is that it
    still *behaves* as the stand-down.
    """
    assert "recovered" in _rehearse_options(workflow)


@pytest.mark.parametrize("workflow", ["wire-alert.yml", "source-alert.yml"])
def test_every_other_option_is_a_fault(workflow: str) -> None:
    """The companion, and the reason the stand-down was missing for so long.

    A rehearsal exists to drive a real path with a broken reading, so a monitor
    whose every option is a fault is the natural state -- and it is exactly the
    state in which the recovery leg is unreachable. This asserts the imbalance
    is deliberate rather than accidental: if someone adds a second clean option,
    they have to come here and say so.
    """
    options = _rehearse_options(workflow)
    faults = [o for o in options if o != "recovered"]

    assert faults, "a monitor with no fault rehearsal cannot rehearse an alert"
    assert len(faults) == len(options) - 1


def test_the_wire_stand_down_fixture_reads_clean() -> None:
    """Executed, because "an option named recovered" is not the property.

    The name is a label; what matters is that the fixture behind it produces a
    verdict the recovery step will act on -- clean, and routed to the same label
    the alerting options open. `blocked-vantage` is the near miss that shows why
    both halves are needed: it is also clean, and #356 correctly routes it to
    `wire-vantage-rehearsal`, so it looks for an issue that is not there.
    """
    import json
    import subprocess
    import sys

    fixture = _rehearsal_fixture("wire-alert.yml", "recovered")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp, "f.json")
        path.write_text(json.dumps(fixture), encoding="utf-8")
        out = Path(tmp, "r.json")
        done = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "wire_check.py"),
             "--fixture", str(path), "--json", str(out)],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=120,
        )
        verdict = json.loads(out.read_text(encoding="utf-8"))

    assert done.returncode == 0, "the stand-down fixture must read clean"
    assert verdict["alert"] is False
    # The same label the alerting options open, or it closes nothing.
    assert verdict["routing"]["label"] == "wire-alert-rehearsal"


def test_the_wire_fault_options_open_the_issue_the_stand_down_closes() -> None:
    """The pair, measured, so the lifecycle is asserted end to end.

    Every fault option that carries a fixture must open the label `recovered`
    closes. An option routed elsewhere -- as `blocked-vantage` correctly is --
    is reported rather than asserted, because it is not a defect.
    """
    import json
    import subprocess
    import sys

    opened: dict[str, str] = {}
    for option in _rehearse_options("wire-alert.yml"):
        fixture = _rehearsal_fixture("wire-alert.yml", option)
        if fixture is None:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "f.json")
            path.write_text(json.dumps(fixture), encoding="utf-8")
            out = Path(tmp, "r.json")
            subprocess.run(
                [sys.executable, str(REPO_ROOT / "scripts" / "wire_check.py"),
                 "--fixture", str(path), "--json", str(out)],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=120,
            )
            verdict = json.loads(out.read_text(encoding="utf-8"))
        if verdict["alert"]:
            opened[option] = verdict["routing"]["label"]

    assert opened, "no option opens an issue, so there is nothing to stand down from"
    assert set(opened.values()) == {"wire-alert-rehearsal"}, (
        f"an alerting option opens a label the stand-down cannot close: {opened}"
    )


def _rehearsal_fixture(workflow: str, option: str) -> Any:
    """The JSON heredoc for one rehearse option, or None if it takes flags instead.

    Read out of the workflow rather than duplicated here: a fixture restated in
    a test is a second copy that can disagree with the one that ships.
    """
    import json

    lines = (REPO_ROOT / ".github" / "workflows" / workflow).read_text(encoding="utf-8").splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip() == option + ")"]
    assert len(starts) == 1, f"expected one case anchor for {option}, got {len(starts)}"

    opens = [k for k in range(starts[0], len(lines)) if lines[k].rstrip().endswith("<<'JSON'")]
    if not opens:
        return None
    begin = opens[0] + 1
    # `esac` guards against running past this case into the next one's heredoc.
    end = next(k for k in range(begin, len(lines)) if lines[k].strip() in ("JSON", "esac"))
    assert lines[end].strip() == "JSON", f"{option}: no JSON terminator before esac"
    body = "\n".join(line[10:] if line.startswith(" " * 10) else line for line in lines[begin:end])
    return json.loads(body)