"""The deploy contract must be derived, not restated.

``scripts/deployment-contract.py`` exists because both checks in
``newsroom-ci.yml`` enumerated their subject a second time. These tests pin the
two properties that make the derivation worth having:

* it survives a **reformatting** of the source that changes no meaning, which
  the grep it replaced did not; and
* it still **fails** when something is genuinely missing, which is the half a
  robustness fix is most likely to break.

Both are asserted as pairs. A parser that returned everything would pass the
first alone, and one that returned nothing would pass neither -- but only
because of the second, so the second is not decoration.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_contract() -> Any:
    """Import ``scripts/deployment-contract.py`` as a module.

    By path rather than via ``sys.path``, matching ``test_wire_probe.py``: the
    filename has a hyphen and is not importable as a name at all.
    """
    path = REPO_ROOT / "scripts" / "deployment-contract.py"
    spec = importlib.util.spec_from_file_location("_deployment_contract", path)
    assert spec and spec.loader, f"cannot load {path}"
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


contract = _load_contract()


TWO_TIMERS = '''
@app.function_name(name="newsroom_edition")
@app.timer_trigger(schedule="0 0 14 * * *", arg_name="timer")
def edition(timer): ...

@app.function_name(name="newsroom_weekly")
@app.timer_trigger(schedule="0 0 15 * * 0", arg_name="timer")
def weekly(timer): ...

@app.function_name(name="newsroom_run_now")
@app.route(route="newsroom/run")
def run_now(req): ...
'''


class TestTheTimerList:
    def test_it_reads_the_timers_and_not_the_routes(self) -> None:
        # newsroom_run_now is an HTTP route. A deploy is not broken when it is
        # absent from a *timer* check, and counting it would make the guard
        # fail for a reason that has nothing to do with a cadence stopping.
        assert contract.timers(TWO_TIMERS) == ["newsroom_edition", "newsroom_weekly"]

    def test_a_third_timer_grows_the_list_with_no_edit_here(self) -> None:
        # The whole point. The hardcoded pair this replaced could not do it,
        # so a third timer that failed to register was invisible -- and for a
        # weekly cadence that silence shows up once a week.
        third = TWO_TIMERS + (
            '\n@app.function_name(name="newsroom_monthly")\n'
            '@app.timer_trigger(schedule="0 0 16 1 * *", arg_name="timer")\n'
            "def monthly(timer): ...\n"
        )
        assert "newsroom_monthly" in contract.timers(third)

    def test_the_real_function_app_declares_both_known_timers(self) -> None:
        source = (REPO_ROOT / "newsroom" / "function_app.py").read_text(
            encoding="utf-8"
        )
        assert contract.timers(source) == ["newsroom_edition", "newsroom_weekly"]

    def test_quoting_style_cannot_hide_a_timer(self) -> None:
        """The defect `#292` found, pinned at the extractor rather than upstream.

        This was a regex requiring ``name="..."`` and Python does not promise
        double quotes. Measured on the version it replaced::

            name="newsroom_weekly"   ->  seen
            name='newsroom_weekly'   ->  NOT seen

        Both parse, the app behaves identically, and a genuinely new
        single-quoted third timer was invisible to the deploy check with the
        whole suite green. The empty-set refusal could not help: the set was
        not empty, it was one short.

        `test_deploy_enumerations.py` asserts the derivation agrees with `ast`,
        which is the parity form and would also fail here. This one names the
        cause, so a reader who breaks it is told *what* about their change was
        wrong rather than that two lists differ.
        """
        double = TWO_TIMERS
        single = TWO_TIMERS.replace('name="newsroom_weekly"', "name='newsroom_weekly'")
        assert single != double, "the fixture rewrite did not apply"

        assert contract.timers(single) == contract.timers(double)
        assert "newsroom_weekly" in contract.timers(single)

    def test_a_new_timer_is_found_whichever_quotes_it_uses(self) -> None:
        # The compound case, and the one that actually bit: not a rename of a
        # known timer but an addition nobody would think to spell twice.
        added = TWO_TIMERS + (
            "\n@app.function_name(name='newsroom_monthly')\n"
            "@app.timer_trigger(schedule='0 0 16 1 * *', arg_name='timer')\n"
            "def monthly(timer): ...\n"
        )
        assert "newsroom_monthly" in contract.timers(added)

    def test_an_async_entry_point_is_a_timer_too(self) -> None:
        # `ast.walk` yields FunctionDef and AsyncFunctionDef as distinct types,
        # so matching only the first would silently drop every async timer --
        # a fresh way to lose one while replacing a way to lose one.
        source = (
            '@app.function_name(name="async_timer")\n'
            '@app.timer_trigger(schedule="0 0 1 * * *", arg_name="t")\n'
            "async def at(t): ...\n"
        )
        assert contract.timers(source) == ["async_timer"]

    def test_all_three_ways_the_sdk_names_a_timer(self) -> None:
        """`#295`, and the third blind spot in a row.

        The first AST version required a `function_name` **keyword** and
        returned nothing without one. Measured against the real
        `azure.functions` SDK, all three of these register a timer::

            @app.timer_trigger(...) with no function_name  -> the def name
            @app.function_name('x')  positionally          -> 'x'
            @app.function_name(name='x')  by keyword       -> 'x'

        It saw only the third. So the fix for the quoting blind spot shipped
        with two more, and the parity guard could not say so: every entry point
        in this repo uses the keyword form and spells `function_name` and `def`
        identically, which makes the disagreement latent rather than live.

        `test_deploy_enumerations.py` executes the rule against the SDK itself.
        This pins that `timers()` implements the same rule.
        """
        bare = (
            '@app.timer_trigger(schedule="0 0 1 * * *", arg_name="t")\n'
            "async def bare_timer(t): ...\n"
        )
        positional = (
            '@app.function_name("positional_name")\n'
            '@app.timer_trigger(schedule="0 0 2 * * *", arg_name="t")\n'
            "async def pd(t): ...\n"
        )
        keyword = (
            '@app.function_name(name="keyword_name")\n'
            '@app.timer_trigger(schedule="0 0 3 * * *", arg_name="t")\n'
            "async def kd(t): ...\n"
        )

        assert contract.timers(bare) == ["bare_timer"]
        assert contract.timers(positional) == ["positional_name"]
        assert contract.timers(keyword) == ["keyword_name"]

    def test_a_route_is_still_not_a_timer(self) -> None:
        # The companion to the case above. Resolving the name from the `def`
        # when no `function_name` is present must not turn every decorated
        # function into a timer -- the trigger is what decides, and dropping
        # that condition would make the three assertions above pass while the
        # check waited on HTTP routes that never register as timers.
        route = (
            '@app.function_name(name="r")\n'
            '@app.route(route="x")\n'
            "async def r(q): ...\n"
        )
        assert contract.timers(route) == []
        assert contract.timers("def helper(): ...") == []


def _arm(settings: list[dict]) -> dict:
    """A compiled-ARM shape: appSettings nested inside a resource's siteConfig."""
    return {
        "resources": [
            {
                "type": "Microsoft.Web/sites",
                "properties": {"siteConfig": {"appSettings": settings}},
            }
        ]
    }


class TestTheSettingsList:
    def test_it_finds_settings_nested_anywhere(self) -> None:
        found = contract.app_settings(
            _arm([{"name": "A", "value": "1"}, {"name": "B", "value": "2"}])
        )
        assert found == ["A", "B"]

    def test_a_removed_setting_is_not_reported(self) -> None:
        # The companion. Without it, a parser that returned every string in the
        # document would pass the test above and never fail on anything.
        found = contract.app_settings(_arm([{"name": "A", "value": "1"}]))
        assert found == ["A"]

    def test_a_setting_without_a_string_name_is_ignored(self) -> None:
        found = contract.app_settings(
            _arm([{"name": "A", "value": "1"}, {"value": "no name"}])
        )
        assert found == ["A"]

    def test_source_formatting_cannot_change_the_answer(self) -> None:
        """The defect this replaced, expressed against the compiled form.

        Bicep does not promise one ``appSettings`` entry per line. The grep
        this fix removed required ``{ name: 'X', value:`` on one line, so a
        purely cosmetic reformatting took it from 12 to 11 -- dropping the
        setting the check was written for. Compiled ARM has no such freedom:
        the two documents below differ only in how they were written.
        """
        compact = json.loads('{"resources":[{"properties":{"siteConfig":'
                             '{"appSettings":[{"name":"X","value":"1"}]}}}]}')
        spread = json.loads(
            """
            {
              "resources": [
                {
                  "properties": {
                    "siteConfig": {
                      "appSettings": [
                        {
                          "name": "X",
                          "value": "1"
                        }
                      ]
                    }
                  }
                }
              ]
            }
            """
        )
        assert contract.app_settings(compact) == contract.app_settings(spread) == ["X"]


class TestItRefusesAnEmptyAnswer:
    """Absence must not resolve to success.

    The caller does ``comm -23 templated deployed``. An extractor that matched
    nothing would hand it an empty set, ``comm`` would report no missing
    settings, and the deploy would go green on the strength of a broken parser
    -- in a check whose entire job is to notice something absent.
    """

    def test_no_timers_found_would_be_refused(self, monkeypatch, capsys) -> None:
        # timers mode reads a fixed path, so the refusal is exercised by
        # pointing that read at a source with no timer in it. An earlier
        # version of this test asserted `main(...) is not None`, which is true
        # of 0, 1 and 2 alike -- a vacuous assertion in a class about vacuity.
        import pathlib

        monkeypatch.setattr(
            pathlib.Path, "read_text", lambda self, **kw: "def nothing(): ..."
        )
        code = contract.main(["deployment-contract.py", "timers"])
        assert code == 1
        assert "the extractor is wrong" in capsys.readouterr().err

    def test_timers_mode_exits_zero_when_it_finds_one(self, monkeypatch, capsys) -> None:
        # The control. Without it the assertion above passes for a timers mode
        # that always fails.
        import pathlib

        monkeypatch.setattr(pathlib.Path, "read_text", lambda self, **kw: TWO_TIMERS)
        code = contract.main(["deployment-contract.py", "timers"])
        assert code == 0
        assert capsys.readouterr().out.split() == [
            "newsroom_edition",
            "newsroom_weekly",
        ]

    def test_settings_mode_exits_nonzero_on_an_empty_document(
        self, monkeypatch, capsys
    ) -> None:
        import io

        monkeypatch.setattr(sys, "stdin", io.StringIO('{"resources": []}'))
        code = contract.main(["deployment-contract.py", "settings"])
        assert code == 1
        assert "the extractor is wrong" in capsys.readouterr().err

    def test_settings_mode_exits_zero_when_there_is_something_to_report(
        self, monkeypatch, capsys
    ) -> None:
        # The control that makes the assertion above mean "empty was refused"
        # rather than "settings mode always fails".
        import io

        monkeypatch.setattr(
            sys,
            "stdin",
            io.StringIO(json.dumps(_arm([{"name": "X", "value": "1"}]))),
        )
        code = contract.main(["deployment-contract.py", "settings"])
        assert code == 0
        assert capsys.readouterr().out.strip() == "X"

    def test_an_unknown_mode_is_refused(self) -> None:
        assert contract.main(["deployment-contract.py", "nonsense"]) == 2
