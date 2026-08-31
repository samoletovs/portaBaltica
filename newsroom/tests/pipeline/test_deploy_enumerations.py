"""The deploy workflow must derive its populations, not restate them.

WHY THIS FILE
-------------
`newsroom-ci.yml` verifies two things after a publish, and each used to verify
them against a list written by hand:

    required='newsroom_edition newsroom_weekly'          the timers
    grep -oE "\\{ name: '[A-Za-z_]+', value:" main.bicep  the app settings

Both were correct when written. Both were the shape this repository has now been
bitten by three times: **a guard that enumerates its subject separately from the
subject.** `AGENTS.md` states the rule and the reason — "a shared enumeration
cannot drift; two enumerations always will, and the drift is silent in the
direction that reports success."

The timer list was the sharper case, because it had *already* drifted once. It
read `newsroom_edition` alone, which was right when that was the only timer and
became wrong the moment `#108` added `newsroom_weekly` — the consumer nobody
edited, correct for every case that existed when it was written. That was fixed
by adding the second name. **The fix had the same shape as the fault:** add a
third timer to `function_app.py` and the list would not grow, and a timer that
fails to register is invisible again. A weekly timer's silence takes a week to
notice; a monthly one would take a month.

THE SETTINGS PATTERN WAS FRAGILE IN THE DANGEROUS DIRECTION
------------------------------------------------------------
The grep was line-anchored: it required `{ name: 'X', value:` to appear on one
line. Bicep does not require that. Measured — one entry reformatted to the
multi-line form, which `az bicep build` accepts and compiles to byte-identical
ARM:

    workflow grep       12 -> 11   NEWSROOM_WEEKLY_SCHEDULE no longer found
    structural parse    12 -> 12

So a reformatting nothing would flag silently stopped the deploy check from
watching the very setting the check was written for. **That is a false
negative**, and unlike the false positive that preceded it — a pattern that
matched `_LRS` out of a storage SKU and failed every deploy loudly — this one
failed toward "no finding here" and nobody would hear it.

WHAT CHANGED, AND WHAT THIS FILE DOES NOW
-----------------------------------------
An earlier version of this file asserted the *agreement* between each list and
its population, because `.github/workflows/` was not that session's to edit. It
said plainly that this was second best and named the durable fix: have the
workflow read the population instead of restating it, and for the settings read
the **compiled ARM** rather than the Bicep source —

    az bicep build --file infrastructure/main.bicep --stdout

— whose `appSettings` array is a JSON list of objects with a literal `name`.
That is format-independent by construction: no source-text pattern can be
defeated by whitespace, because there is no source text involved.

That fix shipped. Both derivations live in `scripts/deployment-contract.py`,
pinned by `test_deployment_contract.py` — including the reformatting case that
defeated the grep, and an empty-set refusal so a broken extractor cannot let
absence resolve to success.

So the two parity assertions were **deleted rather than weakened**, which is
what their own failure message instructed, and what remains is the narrower
claim that a second enumeration has not come back. The two entry-point guards
below are untouched: they never depended on the duplication.

WHY THEY REPORTED EACH DIRECTION SEPARATELY, KEPT BECAUSE THE LESSON OUTLIVES THEM
---------------------------------------------------------------------------------
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

Those two assertions are gone with the duplication they watched, but the rule
they earned is not: **when one artefact can mean two things that need opposite
fixes, say which.** The entry-point guards below follow it.

A NEAR-MISS WORTH RECORDING, BECAUSE IT HAPPENED IN THIS FILE
-------------------------------------------------------------
Adding the entry-point assertions below, an edit landed their body immediately
above `test_the_probes_read_real_files`'s **docstring and asserts** while removing
its `def` line. That control's assertions were then executing inside a different
test, under a different name.

The suite reported **4 passed** and nothing was red — because the assertions
still ran. The only tell was arithmetic: three tests plus two new ones is five,
and the run said four. Had the absorbing test later been renamed or removed, the
vacuity control would have gone with it silently.

So: **after adding tests to a file, count the declarations, not the passes.** A
merged test is green by construction, and this file's whole subject is checks
that keep returning success after they have stopped checking.
"""

from __future__ import annotations

import ast
import importlib.util
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WORKFLOW = REPO / ".github" / "workflows" / "newsroom-ci.yml"
FUNCTION_APP = REPO / "newsroom" / "function_app.py"
BICEP = REPO / "infrastructure" / "main.bicep"


def _declared_timers() -> set[str]:
    """Every timer's **registered** name, resolved as the SDK resolves it.

    Parsed, not grepped: the question is which *functions* are timers, and a
    decorator name in a comment or a docstring reads the same to a regex.

    The registered name is `@app.function_name`'s value when that decorator is
    present, and the Python function's own name otherwise. That is not a guess —
    measured against the real `azure.functions` SDK:

        @app.timer_trigger(...) alone            -> registers as the def name
        @app.function_name('x') positionally     -> registers as 'x'
        @app.function_name(name='x') by keyword  -> registers as 'x'

    This used to return `node.name` unconditionally, which was correct for this
    repo — all four entry points spell the two the same — and wrong in general
    in **both** directions. It would have missed a timer whose `function_name`
    differs from its `def`, reporting a disagreement against a derivation that
    was right; and it is what makes the comparison meaningful when the two
    genuinely differ.
    """
    tree = ast.parse(FUNCTION_APP.read_text(encoding="utf-8"))
    timers = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        registered = node.name
        is_timer = False
        for dec in node.decorator_list:
            func = dec.func if isinstance(dec, ast.Call) else dec
            attr = getattr(func, "attr", "")
            if attr in TIMER_DECORATORS:
                is_timer = True
            elif attr == "function_name" and isinstance(dec, ast.Call):
                # Keyword and positional both reach the SDK; only reading one
                # is how the derivation this guards loses a timer.
                for kw in dec.keywords:
                    if kw.arg == "name" and isinstance(kw.value, ast.Constant):
                        if isinstance(kw.value.value, str):
                            registered = kw.value.value
                for arg in dec.args:
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        registered = arg.value
        if is_timer:
            timers.add(registered)
    return timers



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


def _module_level_functions() -> list[tuple[str, list[str]]]:
    """Every top-level function in `function_app.py`, with its decorator names.

    Top-level only — `ast.walk` would descend into nested functions, which are
    not registration candidates and would be reported as undecorated.
    """
    tree = ast.parse(FUNCTION_APP.read_text(encoding="utf-8"))
    out = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        names = []
        for dec in node.decorator_list:
            func = dec.func if isinstance(dec, ast.Call) else dec
            names.append(getattr(func, "attr", getattr(func, "id", "")))
        out.append((node.name, names))
    return out


def _sdk_decorators_mentioning(trigger_class: str) -> frozenset[str]:
    """`FunctionApp` decorator names whose implementation builds `trigger_class`.

    Derived from the installed SDK rather than written down here, because a
    hand-listed vocabulary is what produced three consecutive blind spots in
    this chain — each list correct for the forms this repository happens to use,
    and silent about the ones it does not.
    """
    import inspect

    import azure.functions as func

    app = func.FunctionApp()
    found = set()
    for name in dir(app):
        if name.startswith("_"):
            continue
        attribute = getattr(app, name, None)
        if not callable(attribute):
            continue
        try:
            source = inspect.getsource(attribute)
        except (OSError, TypeError):  # pragma: no cover - C or stripped builds
            continue
        if trigger_class in source:
            found.add(name)
    return frozenset(found)


#: Decorators that register a function as an Azure Functions **timer**.
#:
#: `timer_trigger` and `schedule` are aliases and both produce a `TimerTrigger`,
#: measured against the SDK rather than assumed. `#292` and `#295` each fixed a
#: reader that recognised one spelling and missed another; hardcoding one name
#: here would be the third instance of the same mistake.
TIMER_DECORATORS = _sdk_decorators_mentioning("TimerTrigger")

#: Every decorator that registers a function at all — 23 in the installed SDK,
#: of which this repository uses two.
#:
#: This was `{"timer_trigger", "route"}`, hand-written, with a comment arguing
#: that a new trigger kind "fails on the day it is added, which is the right
#: moment to widen this deliberately". It does fail — but with a message that
#: says *"Azure will not register them"*, which is false, and a remedy
#: (*"give it a leading underscore"*) that would bury a live timer and turn
#: every test green. Failing loudly is not the same as steering correctly.
TRIGGER_DECORATORS = _sdk_decorators_mentioning("Trigger(") | {"route"}


def test_the_sdk_vocabulary_is_derived_and_not_empty() -> None:
    """Control on both derivations, in three directions.

    An empty or near-empty set would make the entry-point assertion below
    vacuous — every function would look undecorated, or none would — so the
    floor matters as much as the members.
    """
    assert "timer_trigger" in TIMER_DECORATORS, sorted(TIMER_DECORATORS)
    assert "schedule" in TIMER_DECORATORS, (
        f"`schedule` is a timer decorator in the installed SDK and is missing "
        f"from {sorted(TIMER_DECORATORS)}. It was invisible to both readers in "
        f"this chain until it was measured."
    )
    assert TIMER_DECORATORS <= TRIGGER_DECORATORS, (
        f"a timer decorator that is not a trigger decorator: "
        f"{sorted(TIMER_DECORATORS - TRIGGER_DECORATORS)}"
    )
    # The SDK exposes far more than this repo uses; a set that collapsed to the
    # two we use would mean the derivation had stopped reading the SDK.
    assert len(TRIGGER_DECORATORS) >= 10, sorted(TRIGGER_DECORATORS)


def test_every_derived_timer_decorator_really_makes_a_timer() -> None:
    """Behavioural confirmation, because the derivation reads source text.

    `_sdk_decorators_mentioning` matches on a class name appearing in a
    decorator's implementation, which is a heuristic. This applies each one and
    reads back what the SDK registered — so a name that merely *mentions*
    `TimerTrigger` without producing one cannot silently widen the vocabulary.
    """
    import azure.functions as func

    for decorator_name in sorted(TIMER_DECORATORS):
        app = func.FunctionApp()
        decorate = getattr(app, decorator_name)

        @app.function_name(name="probe")
        @decorate(
            schedule="0 0 5 * * *",
            arg_name="t",
            run_on_startup=False,
            use_monitor=True,
        )
        async def _probe(t):  # noqa: ANN001, ANN202
            return None

        registered = app.get_functions()
        assert len(registered) == 1, (decorator_name, registered)
        trigger = type(registered[0].get_trigger()).__name__
        assert trigger == "TimerTrigger", (
            f"`@app.{decorator_name}` was derived as a timer decorator but "
            f"registers a {trigger}."
        )


def test_every_entry_point_carries_a_trigger() -> None:
    """A public function here that is not registered is not a function at all.

    `function_app.py` uses one convention throughout: helpers take a leading
    underscore and no decorators, entry points take `@app.function_name` and
    exactly one trigger. So a *public* top-level function with no trigger is a
    registration that will not happen — the app deploys, the function exists,
    and Azure never calls it.

    This generalises the fault `#266` was written about. There, a function
    separated from its decorators was caught only because it happened to be a
    timer the deploy workflow waits for by name. Measured on master, doing the
    same thing to `newsroom_weekly_now` — the operator route that runs the
    weekly wrap by hand — left **2135 tests passing**. Nothing watches the
    routes, and that one is the manual fallback for the timer failing: losing
    both silently means the recovery path is missing at exactly the moment it is
    needed.
    """
    undecorated = [
        name
        for name, decorators in _module_level_functions()
        if not name.startswith("_") and not (TRIGGER_DECORATORS & set(decorators))
    ]

    assert not undecorated, (
        f"{undecorated} are public top-level functions in function_app.py "
        f"carrying no decorator the installed SDK registers a trigger for.\n\n"
        f"The usual cause is a function separated from its decorators by an edit "
        f"above it — check the lines immediately preceding the `def` first. If "
        f"the decorator IS there, the SDK may have gained a spelling this "
        f"vocabulary is derived from but does not match; widen "
        f"`_sdk_decorators_mentioning` rather than the function.\n\n"
        f"**Do not resolve this with a leading underscore unless the function is "
        f"genuinely a helper.** Underscoring a decorated function hides it from "
        f"this assertion while Azure goes on registering it, which turns a "
        f"visible fault into an entry point nothing watches."
    )


def test_the_helper_convention_is_real_and_not_an_empty_excuse() -> None:
    """Control on the exclusion above.

    `name.startswith("_")` is doing real work — it is what keeps
    `_wrap_and_report` and `_run_and_report` out of the assertion. If no such
    helper existed, the exclusion would be untested and could be silently wrong.
    """
    functions = _module_level_functions()
    helpers = [n for n, _ in functions if n.startswith("_")]
    entry_points = [n for n, d in functions if not n.startswith("_")]

    assert helpers, (
        "no underscore-prefixed helpers in function_app.py, so the exclusion in "
        "the assertion above matches nothing and is untested."
    )
    assert entry_points, "no public functions found; the parse is broken"
    # And the helpers must genuinely be undecorated, or the convention this
    # relies on has changed and the exclusion is hiding real entry points.
    for name, decorators in functions:
        if name.startswith("_"):
            assert not (TRIGGER_DECORATORS & set(decorators)), (
                f"{name} is underscore-prefixed and carries a trigger. The "
                f"convention that lets this guard skip underscored functions no "
                f"longer holds, so it is now skipping a real entry point."
            )


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
    # The entry-point population too, since two of the assertions above this
    # file's controls now depend on it.
    assert len(_module_level_functions()) >= 4, _module_level_functions()


def test_the_workflow_derives_both_lists_instead_of_restating_them() -> None:
    """The duplication this file was written to watch is gone; keep it gone.

    Two parity assertions lived here, one per list, each checking that a
    hand-written list still equalled its population. They were second best and
    said so: the better fix was for the workflow to read the population instead
    of restating it, and for the settings to read the compiled ARM.

    That fix shipped, so those assertions were **deleted rather than
    weakened**, which is what their own failure message instructed. What
    replaces them is not a parity check, because there is no longer a second
    enumeration to compare against. It is the narrower claim that a second
    enumeration has not come back.

    `scripts/deployment-contract.py` owns both derivations and is pinned by
    `test_deployment_contract.py`, including the reformatting case that
    defeated the grep and an empty-set refusal, so a broken extractor cannot
    let absence resolve to success.
    """
    text = WORKFLOW.read_text(encoding="utf-8")

    assert re.search(r"required='[^']*newsroom_\w+", text) is None, (
        "newsroom-ci.yml has a hand-written `required='...'` timer list again. "
        "That list drifted once already, and a third timer would not grow it. "
        "Derive it: `python scripts/deployment-contract.py timers`."
    )

    assert re.search(r"grep -oE \"[^\"]*name: '", text) is None, (
        "newsroom-ci.yml is matching appSettings out of the Bicep source "
        "again. Measured: reformatting one entry to multi-line is valid Bicep, "
        "compiles to byte-identical ARM, and takes the match from 12 names to "
        "11, dropping the setting the check exists for. It fails toward 'no "
        "finding here'. Read the compiled ARM instead."
    )

    assert "deployment-contract.py timers" in text, (
        "the timer check no longer derives its list from function_app.py"
    )
    assert "deployment-contract.py settings" in text, (
        "the settings check no longer derives its list from the compiled ARM"
    )


def test_the_sdk_resolves_a_timer_name_the_way_both_sides_assume() -> None:
    """Execute the rule both readers implement, against the SDK itself.

    The docstring above and `scripts/deployment-contract.py` both encode a claim
    about how Azure Functions names a timer. `AGENTS.md` is blunt about that
    shape: an example in guidance is a claim about behaviour, and it must be
    executed rather than asserted — one of this repo's own worked examples was
    false and sat three lines from the code it described.

    So this runs the three forms through `azure.functions` and reads back what
    it registers. If the SDK ever changes the rule, both readers are wrong
    together and silently, and this is the only thing that would say so.
    """
    import azure.functions as func

    app = func.FunctionApp()

    @app.timer_trigger(
        schedule="0 0 1 * * *", arg_name="t", run_on_startup=False, use_monitor=True
    )
    async def bare_timer(t):  # noqa: ANN001, ANN202
        return None

    @app.function_name("positional_name")
    @app.timer_trigger(
        schedule="0 0 2 * * *", arg_name="t", run_on_startup=False, use_monitor=True
    )
    async def positional_def(t):  # noqa: ANN001, ANN202
        return None

    @app.function_name(name="keyword_name")
    @app.timer_trigger(
        schedule="0 0 3 * * *", arg_name="t", run_on_startup=False, use_monitor=True
    )
    async def keyword_def(t):  # noqa: ANN001, ANN202
        return None

    registered = sorted(f.get_function_name() for f in app.get_functions())

    assert registered == ["bare_timer", "keyword_name", "positional_name"], (
        f"the SDK registered {registered}. Both `_declared_timers` here and "
        f"`timers()` in scripts/deployment-contract.py resolve a timer's name as "
        f"`@app.function_name`'s value when present and the `def` name "
        f"otherwise. If that is no longer the rule, both are wrong in the same "
        f"direction and neither would notice."
    )


def test_the_timer_derivation_agrees_with_the_structure_it_reads() -> None:
    """The timer derivation is a regex over Python source. This pins it.

    `c78d592` fixed both duplications by deriving instead of restating, and the
    settings half went **structural**: it reads `appSettings` out of the compiled
    ARM, where the names are JSON strings and no source-text pattern can be
    defeated by whitespace. Its own docstring gives the reason —
    *"Bicep does not promise one line per entry"*.

    The timer half stayed lexical, matching `name="..."` with double quotes.
    **Python does not promise double quotes**, which is the same sentence in a
    different language.

    Measured on master, single-quoting one existing name — valid Python, the file
    still parses, behaviour byte-identical:

        ast sees        newsroom_edition, newsroom_weekly
        the derivation  newsroom_edition                    exit 0

    The empty-set refusal cannot help, because the set is not empty. And the
    compound case is the one that matters: adding a *genuinely new* third timer
    with a single-quoted name left **2227 tests passing** while the workflow's
    derivation could not see it — an unregistered timer invisible again, the
    precise failure this whole chain exists to prevent.

    `test_deployment_contract.py` asserts `timers(source) == ["newsroom_edition",
    "newsroom_weekly"]`, so it catches a list that *shrinks* and not one that
    fails to *grow*. That hardcoded pair is also the shape `c78d592` removed from
    the workflow, reappearing in the test that guards its replacement.

    So this compares the derivation against `ast` — the structure the regex is
    approximating. It is the parity assertion that was deleted, aimed at the pair
    that still has two enumerations rather than the pair that no longer does.

    The durable fix is for `timers()` to parse rather than match; it is the last
    lexical reader of a structured source in this chain. `scripts/` is not this
    session's to edit, so this asserts the agreement instead, and says so.

    **`4be3880` shipped that fix, and this test kept earning its place.** Both
    sides now parse, so this is no longer lexical-versus-structural — it is two
    structural readings that must agree on *which name a timer registers under*.
    They did not. Measured against the real `azure.functions` SDK, all three of
    these register a timer, and `timers()` saw only the third:

        @app.timer_trigger(...) with no function_name   -> registers as the def name
        @app.function_name('x')  positionally           -> registers as 'x'
        @app.function_name(name='x')  by keyword        -> registers as 'x'

    `timers()` requires a `function_name` keyword and appends only `if name and
    is_timer`, so a timer declared either of the first two ways is invisible to
    the deploy check — with **2230 other tests passing**. The empty-set refusal
    cannot help again, for the third time: the set is not empty, it is one short.

    My own helper was wrong in the mirror direction and this is what exposed it.
    It returned the `def` name unconditionally, which is right for this repo —
    all four entry points spell the two the same — and would have reported a
    disagreement against a *correct* derivation the day someone gave a function a
    `function_name` that differs from its `def`. Both sides now resolve the name
    the way the SDK does, so the comparison means what it claims.
    """
    spec = importlib.util.spec_from_file_location(
        "deployment_contract", REPO / "scripts" / "deployment-contract.py"
    )
    assert spec and spec.loader, "scripts/deployment-contract.py is not importable"
    contract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(contract)

    derived = sorted(contract.timers(FUNCTION_APP.read_text(encoding="utf-8")))
    structural = sorted(_declared_timers())

    # Both sides controlled, so an equality of two empty lists cannot pass.
    assert structural, "ast found no timers; the structural probe is broken"
    assert derived, "the derivation found no timers"

    assert derived == structural, (
        f"scripts/deployment-contract.py derives {derived} and the registered "
        f"timer names in function_app.py are {structural}.\n\n"
        f"Both sides now parse, so this is no longer about quoting. The "
        f"disagreement is about **which name a timer registers under**, and the "
        f"SDK's rule is: `@app.function_name`'s value when present, the `def` "
        f"name otherwise. Measured against `azure.functions` itself, these are "
        f"all valid and all register a timer:\n"
        f"    @app.timer_trigger(...) with no function_name  -> the def name\n"
        f"    @app.function_name('x')  positionally          -> 'x'\n"
        f"    @app.function_name(name='x')  by keyword       -> 'x'\n\n"
        f"A timer the derivation cannot name is a timer the deploy does not "
        f"wait for, so it can fail to register with every signal green. Check "
        f"which of the three forms is in play before changing anything, and fix "
        f"whichever side got the rule wrong — this test is not the thing to "
        f"edit."
    )
