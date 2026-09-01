"""The edition must have room to finish.

WHAT HAPPENED

On 2026-09-01 the timer fired on schedule and the run was killed by the host:

    14:00:00  Executing 'Functions.newsroom_edition' (Timer fired at
              2026-09-01T14:00:00.0077895+00:00, Id=f7575a2c-...)
    14:10:00  Timeout value of 00:10:00 exceeded by function
              'Functions.newsroom_edition' (Id: 'f7575a2c-...')
    14:10:00  Executed (Failed, Id=f7575a2c-..., Duration=600011ms)

Nothing published. `runs/latest.json` was not written, because it is written
when a run FINISHES -- so from the outside the day was indistinguishable from
a timer that never fired.

WHY 10 MINUTES WAS NEVER ENOUGH

The previous run had already used 84% of the budget. That figure does not
depend on telemetry retention, which is short: it is derivable from the
published artefact itself, since the timer fires at 14:00:00 and the blob
records `finished_at`.

    2026-08-31  finished_at 14:08:22Z  ->  502 s of 600 s   margin  98 s (16%)
    2026-09-01  killed at   14:10:00Z  ->  600 s of 600 s   margin   0

So the failure was not a surprise so much as an unread warning. A margin of
16% on a job whose cost grows with every editorial gate added is not a margin,
and two gates were added the morning it broke -- `record_claim_holds` and the
percentage-points repair, both of which cost revision attempts, and
`attempts_max` is 3.

WHY THIS IS A PIN AND NOT A CALCULATION

The test cannot know how long the next run will take, so it does not pretend
to. It pins the configured value, which makes lowering it a deliberate,
reviewable act rather than a one-character edit nobody reads -- and records
here what the number was chosen against. That is the same reasoning as an
exemption written as an equality rather than a filter: the assertion exists to
fail the day someone changes the thing it is about.
"""

from __future__ import annotations

import json
from pathlib import Path

HOST_JSON = Path(__file__).resolve().parents[2] / "host.json"

#: The longest run ever observed to SUCCEED, in seconds. Derived from the
#: published blob rather than from telemetry, which does not retain that far.
LONGEST_OBSERVED_SUCCESS_S = 502

#: What the timeout must be, in seconds. Three times the configured 10 minutes
#: that failed, and roughly 3.6x the longest run that has ever completed.
REQUIRED_TIMEOUT_S = 30 * 60


def _timeout_seconds() -> int:
    raw = json.loads(HOST_JSON.read_text(encoding="utf-8"))["functionTimeout"]
    hours, minutes, seconds = (int(part) for part in raw.split(":"))
    return hours * 3600 + minutes * 60 + seconds


def test_the_edition_has_room_to_finish() -> None:
    assert _timeout_seconds() == REQUIRED_TIMEOUT_S, (
        "newsroom/host.json functionTimeout changed. The 10-minute value this "
        "replaced killed the 2026-09-01 edition at exactly 600011ms, and the "
        "run before it had already used 84% of that budget."
    )


def test_the_margin_is_stated_rather_than_assumed() -> None:
    """The pin must actually clear the longest run we have ever seen.

    Without this, `REQUIRED_TIMEOUT_S` and `LONGEST_OBSERVED_SUCCESS_S` are two
    numbers in one file with nothing relating them, and lowering the first
    below the second would leave the suite green -- an assertion about a
    constant, rather than about the thing the constant is for.
    """
    assert REQUIRED_TIMEOUT_S > LONGEST_OBSERVED_SUCCESS_S * 2, (
        f"{REQUIRED_TIMEOUT_S}s leaves less than 2x headroom over the longest "
        f"run that has ever completed ({LONGEST_OBSERVED_SUCCESS_S}s). The "
        "cost of an edition grows with every editorial gate added."
    )
