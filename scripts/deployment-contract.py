"""Derive what a deploy must satisfy, from the sources that define it.

Both checks in ``newsroom-ci.yml`` used to enumerate their subject a second
time, which is the failure mode ``AGENTS.md`` calls out: a guard that restates
the logic it guards is a second implementation that can disagree, and the
disagreement is silent in the direction that reports success.

    timers    required='newsroom_edition newsroom_weekly'   hardcoded pair
    settings  grep "{ name: 'X', value:" main.bicep         one line per entry

Both were correct when written. The first does not grow when a third timer is
added, so an unregistered third timer is invisible again -- and for a weekly
cadence that silence is only visible once a week. The second is worse, because
Bicep does not promise one line per entry: reformatting a single ``appSettings``
entry to multi-line compiles to **byte-identical ARM** and takes the grep from
12 to 11, dropping ``NEWSROOM_WEEKLY_SCHEDULE`` -- the setting the check exists
for.

Note the asymmetry with the earlier ``_LRS`` bug in the same grep. That matched
a storage SKU, reported phantom missing settings and failed every deploy
loudly, so it was found in hours. This one fails toward *no finding here*.

So neither list is written down here. ``timers`` reads the decorators, and
``settings`` reads the **compiled** ARM, where ``appSettings`` is JSON with a
literal ``name`` and whitespace cannot defeat it.

Each mode refuses to print an empty set. An extractor that silently matches
nothing would let the caller's ``comm`` report zero missing settings, which is
absence resolving to success in a script whose entire job is to notice absence.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

TIMER = re.compile(
    r'@app\.function_name\(\s*name\s*=\s*"([^"]+)"\s*\)\s*@app\.timer_trigger\(',
)


def timers(source: str) -> list[str]:
    """Every function whose next decorator is a timer trigger.

    Anchored on the pair rather than on ``function_name`` alone, because
    ``newsroom_run_now`` and ``newsroom_weekly_now`` are HTTP routes and a
    deploy is not broken when they are absent from a timer check.
    """
    return sorted(TIMER.findall(source))


def app_settings(template: dict) -> list[str]:
    """Every ``appSettings`` name anywhere in a compiled ARM template.

    Walks rather than indexing a known path: the settings sit under a
    ``siteConfig`` inside a resource array, and hardcoding that route would be
    a third enumeration of something the template already states.
    """
    found: set[str] = set()

    def walk(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            for key, value in node.items():
                if key == "appSettings" and isinstance(value, list):
                    for setting in value:
                        if isinstance(setting, dict) and isinstance(
                            setting.get("name"), str
                        ):
                            found.add(setting["name"])
                walk(value)

    walk(template)
    return sorted(found)


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {"timers", "settings"}:
        print("usage: deployment-contract.py timers|settings", file=sys.stderr)
        return 2

    if argv[1] == "timers":
        source = pathlib.Path("newsroom/function_app.py").read_text(encoding="utf-8")
        names = timers(source)
        what = "timer triggers in newsroom/function_app.py"
    else:
        names = app_settings(json.load(sys.stdin))
        what = "appSettings in the compiled ARM"

    if not names:
        print(f"::error::found no {what} -- the extractor is wrong", file=sys.stderr)
        return 1

    print("\n".join(names))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
