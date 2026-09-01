"""Every `run:` block in every workflow must parse as the shell that runs it.

WHY THIS EXISTS

`#348` added one line of prose to a comment inside `source-alert.yml`:

    // the message's FIRST line, because that is what a phone preview

That comment is the body of ``node -e '...'``. Bash ends a single-quoted
string at the first ``'`` it meets and offers no escape for one inside, so
the apostrophe in *message's* closed the script twelve lines early and handed
the remaining JavaScript to bash. The step died with

    line 78: syntax error near unexpected token `"rehearsal.txt",'

and the notifier — doing exactly what it was designed to do — announced *"the
monitor produced no report, so the sources were NOT checked"* to the real
Telegram channel, at a moment when all twelve sources were healthy. A false
alarm, from a comment, in the file whose subject is not raising false alarms.

WHY IT IS `bash -n` AND NOT A SEARCH FOR APOSTROPHES

An apostrophe is not the rule; it is the instance that happened to bite. The
rule is *this block must parse*, and the only thing that knows what parses is
the parser. A word list here would be `AGENTS.md`'s own trap — it would encode
the one example already known and miss unbalanced quotes, an unclosed heredoc,
a stray backtick, a `case` without `esac`.

`bash -n` reads the whole file and reports syntax errors without running a
single command, which is what makes it usable against a block full of `curl`
and `gh`.

WHAT IT CANNOT SEE

Runtime failure. `bash -n` parses; it does not execute. A block that parses
and then fails on a missing variable is invisible here, and belongs to the
tests that run the block for real — `test_alert_notify.py` does that for the
notifier's rehearsal banner.

`${{ ... }}` is substituted by GitHub *before* bash is handed anything, so it
is replaced here too. Leaving it in would make every block a syntax error and
the check would be red always, which is the same as being off.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[3] / ".github" / "workflows"

#: GitHub expands these before bash sees the script. `X` is a valid bash word,
#: so a substituted expression stays syntactically inert wherever it appears —
#: as a command, an argument, or the right-hand side of an assignment.
EXPRESSION = re.compile(r"\$\{\{.*?\}\}", re.DOTALL)


def _usable_bash() -> str | None:
    """A bash that actually runs, or None.

    Deliberately cautious: on the Windows machine this was written on, a bare
    ``bash`` is the WSL shim, which reports success from a distribution that
    may not be installed. Each candidate is probed rather than assumed.
    """
    for candidate in (
        "bash",
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
        "/bin/bash",
        "/usr/bin/bash",
    ):
        try:
            probe = subprocess.run(
                [candidate, "-c", "exit 0"], capture_output=True, timeout=20
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if probe.returncode == 0:
            return candidate
    return None


BASH = _usable_bash()


def _run_blocks() -> list[tuple[str, str, str]]:
    """(workflow, step name, script) for every `run:` in every workflow.

    Read through the YAML parser rather than by scanning for `run:`, because a
    block's own text can contain that word — several in this repo do, in the
    prose explaining what the block runs.
    """
    found: list[tuple[str, str, str]] = []
    for path in sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        for job_name, job in (doc.get("jobs") or {}).items():
            if not isinstance(job, dict):
                continue
            for index, step in enumerate(job.get("steps") or []):
                if not isinstance(step, dict):
                    continue
                script = step.get("run")
                if not isinstance(script, str):
                    continue
                label = step.get("name") or f"{job_name}[{index}]"
                found.append((path.name, f"{job_name} / {label}", script))
    return found


BLOCKS = _run_blocks()


def test_there_are_blocks_to_check() -> None:
    """The population is not empty, so a clean sweep means something.

    Without this, deleting every workflow — or a change to how they are read —
    turns the parametrised check below into zero tests, and zero tests report
    as a pass. Absence would resolve to success in the guard against a monitor
    whose absence resolved to success.
    """
    assert len(BLOCKS) > 20, f"only {len(BLOCKS)} run: blocks found; the reader is broken"


def test_ci_must_not_skip_this() -> None:
    """In CI the skip below must never apply.

    A check that quietly does nothing on the runner is worse than no check: it
    reports green while measuring nothing, which is the exact failure the
    workflow it guards exists to prevent.
    """
    import os

    if not os.environ.get("CI"):
        pytest.skip("only meaningful on the runner")
    assert BASH, "CI has bash; if this fails the harness is broken, not the workflows"


@pytest.mark.skipif(not BASH, reason="no usable bash on this machine; see _usable_bash")
@pytest.mark.parametrize(
    ("workflow", "step", "script"),
    BLOCKS,
    ids=[f"{w}::{s}" for w, s, _ in BLOCKS],
)
def test_every_run_block_parses(workflow: str, step: str, script: str) -> None:
    assert BASH
    # Normalise line endings before parsing. The runner checks out LF and hands
    # bash exactly that; a Windows working copy may hold CRLF, and bash reads a
    # trailing `\r` as part of the token, so `then\r` is not `then`. Without
    # this the check fails on blocks that are perfectly correct — reporting a
    # defect in files nobody has touched, which is a probe fault wearing a
    # finding's clothes.
    source = EXPRESSION.sub("X", script).replace("\r\n", "\n")
    done = subprocess.run(
        [BASH, "-n"],
        input=source,
        capture_output=True,
        text=True,
        # Not the locale default. Several blocks carry emoji in their
        # notification text, and on a Windows console the default is cp1252,
        # which raises UnicodeEncodeError on the way in. That surfaces as an
        # error against the workflow rather than against this harness, so a
        # perfectly valid block reads as a syntax defect — a probe fault
        # wearing a finding's clothes, in the guard written to catch one.
        encoding="utf-8",
        timeout=60,
    )
    assert done.returncode == 0, (
        f"{workflow} :: {step} does not parse as bash.\n"
        f"{done.stderr.strip()}\n\n"
        "An apostrophe in a comment inside `node -e '...'` is the way this has "
        "actually happened; see the module docstring."
    )
