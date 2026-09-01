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
