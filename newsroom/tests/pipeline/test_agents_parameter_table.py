"""The parameter table in ``AGENTS.md`` must equal the code it describes.

WHY THIS FILE EXISTS
--------------------
The section it guards -- *"Prose is where the unmeasured number hides"* -- argues
that a figure written into a sentence is never checked, and it shipped with two
of them. Neither was in its fenced block:

    shipped                 measured             where it sat
    "28 str / 7 numeric"    28 / 5 / 6 = 39      prose introducing the table
    "eight of them"         17 of 17             prose following the table

The first used two different keys in one table -- *interpolated* for the string
column and *every int and bool* for the numeric one -- so it summed to 35 where
the four signatures declare 39, and could be reconciled against nothing. It was
caught by a reader who reproduced the check split exactly and then could not
reproduce the counts.

So this is the same move the section itself recommends, applied to the section:
a figure that matters is derived rather than typed, and the derivation is run.
Add a parameter to any of the four builders and the document goes stale --
loudly, here, rather than silently on the page.

THE KEY, STATED ONCE
--------------------
Every parameter the four correction builders declare, classified by

  * its annotated type -- ``str``/``str | None`` against ``int``/``bool``; and
  * whether its value reaches an ``f``-string placeholder in the body, which is
    the only way a reader ever sees it.

One key, three columns, and they must sum to the declared count. That last
assertion is what makes the table checkable at all: the shipped version had no
column for the six parameters a reader never sees, so nothing could notice that
28 + 7 was not 39.

WHY THE COLUMNS ARE NOT ``str`` AND ``int``
--------------------------------------------
``claims_low: bool`` selects which wording is used and is never printed;
``corrected_at: str | None`` is metadata on the record. Counting either among
the figures a reader is shown would put two parameters in the population that
cannot carry a number onto the page -- which is precisely the sort of
mis-scoped denominator ``AGENTS.md`` calls *a name that lies about its
population*.

WHAT IS DELIBERATELY NOT CHECKED
--------------------------------
The prose around the table. A test that asserted the sentences were worded a
particular way would be the word-list mistake this repo keeps making: it would
encode today's phrasing rather than the property. Only the figures are pinned,
because only the figures can be derived.
"""

from __future__ import annotations

import ast
import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[3]
AGENTS = REPO / "AGENTS.md"
SOURCE = REPO / "newsroom" / "pipeline" / "revisions.py"
FIXTURES = REPO / "newsroom" / "tests" / "pipeline" / "test_scope_correction.py"

BUILDERS = (
    "record_correction_note",
    "origin_correction_note",
    "span_correction_note",
    "comparison_correction_note",
)
STR_LIKE = frozenset({"str", "str | None"})
NUM_LIKE = frozenset({"int", "bool"})


def _functions() -> dict[str, ast.FunctionDef]:
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    found = {
        n.name: n
        for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name in BUILDERS
    }
    missing = set(BUILDERS) - set(found)
    assert not missing, f"builders not found in {SOURCE.name}: {sorted(missing)}"
    return found


def _parameters(fn: ast.FunctionDef) -> list[tuple[str, str]]:
    a = fn.args
    return [
        (x.arg, ast.unparse(x.annotation) if x.annotation else "")
        for x in (a.posonlyargs + a.args + a.kwonlyargs)
    ]


def _printed(fn: ast.FunctionDef) -> set[str]:
    """Names whose value reaches an f-string placeholder anywhere in the body."""
    seen: set[str] = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.FormattedValue):
            for sub in ast.walk(node.value):
                if isinstance(sub, ast.Name):
                    seen.add(sub.id)
    return seen


def _measured() -> dict[str, tuple[int, int, int, int]]:
    """(printed str, printed numeric, never printed, declared) per builder."""
    out = {}
    for name, fn in _functions().items():
        params = _parameters(fn)
        shown = _printed(fn)
        s = sum(1 for p, t in params if t in STR_LIKE and p in shown)
        n = sum(1 for p, t in params if t in NUM_LIKE and p in shown)
        u = sum(1 for p, _ in params if p not in shown)
        out[name] = (s, n, u, len(params))
    return out


def _documented() -> dict[str, tuple[int, int, int]]:
    """The table rows as written in AGENTS.md."""
    text = AGENTS.read_text(encoding="utf-8")
    heading = "### It has a shape, and the shape is the type"
    assert heading in text, f"the section this file guards is gone from {AGENTS.name}"
    body = text.split(heading, 1)[1]
    rows = {}
    for name in BUILDERS:
        match = re.search(rf"^{re.escape(name)}\s+(\d+)\s+(\d+)\s+(\d+)\s*$",
                          body, re.MULTILINE)
        assert match, f"no table row for {name} in the AGENTS.md section"
        rows[name] = tuple(int(g) for g in match.groups())
    return rows


class TestTheTableMatchesTheCode:
    def test_every_documented_row_is_the_measured_row(self):
        measured, documented = _measured(), _documented()
        for name in BUILDERS:
            assert documented[name] == measured[name][:3], (
                f"{name}: AGENTS.md says {documented[name]}, the signatures give "
                f"{measured[name][:3]}"
            )

    def test_the_three_columns_sum_to_the_declared_count(self):
        """The check the shipped version could not make: 28 + 7 was not 39."""
        for name, (s, n, u, declared) in _measured().items():
            assert s + n + u == declared, (
                f"{name}: {s} + {n} + {u} = {s + n + u}, but {declared} declared"
            )

    def test_the_documented_totals_are_the_sums_of_the_rows(self):
        text = AGENTS.read_text(encoding="utf-8")
        body = text.split("### It has a shape, and the shape is the type", 1)[1]
        match = re.search(r"^\s+(\d+)\s+(\d+)\s+(\d+)\s+=\s+(\d+) declared\s*$",
                          body, re.MULTILINE)
        assert match, "the total line is missing from the AGENTS.md table"
        totals = tuple(int(g) for g in match.groups())
        measured = _measured()
        assert totals[0] == sum(v[0] for v in measured.values())
        assert totals[1] == sum(v[1] for v in measured.values())
        assert totals[2] == sum(v[2] for v in measured.values())
        assert totals[3] == sum(v[3] for v in measured.values())

    def test_the_two_unprinted_parameters_are_the_ones_named(self):
        """A reader is told which parameters they never see. Check per builder.

        Deliberately a set of (builder, parameter) pairs rather than a union of
        names. A plant proved why: making ``corrected_at`` reach an f-string in
        one builder leaves it unprinted in the other three, so it stays in the
        union and a name-only assertion passes while the document has gone
        stale. The union is a smaller population than the behaviour -- the same
        fault this repo has now found four times.
        """
        expected = {
            ("record_correction_note", "claims_low"),
            ("record_correction_note", "corrected_at"),
            ("origin_correction_note", "corrected_at"),
            ("span_correction_note", "corrected_at"),
            ("comparison_correction_note", "claims_low"),
            ("comparison_correction_note", "corrected_at"),
        }
        actual = set()
        for name, fn in _functions().items():
            shown = _printed(fn)
            actual |= {(name, p) for p, _ in _parameters(fn) if p not in shown}
        assert actual == expected, (
            "AGENTS.md names claims_low and corrected_at as the only parameters "
            f"a reader never sees.\n  gained: {sorted(actual - expected)}\n"
            f"  lost:   {sorted(expected - actual)}"
        )

    def test_the_unprinted_pairs_are_the_documented_third_column(self):
        """And that set must be the size the table's third column totals to."""
        actual = 0
        for name, fn in _functions().items():
            shown = _printed(fn)
            actual += sum(1 for p, _ in _parameters(fn) if p not in shown)
        documented = sum(row[2] for row in _documented().values())
        assert actual == documented, (
            f"the table's 'never printed' column totals {documented}, the code "
            f"has {actual}"
        )


def _fixture_arguments() -> dict[str, dict[str, str]]:
    tree = ast.parse(FIXTURES.read_text(encoding="utf-8"))
    out = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        target, value = node.targets[0], node.value
        if (
            isinstance(target, ast.Name)
            and target.id.isupper()
            and isinstance(value, ast.Call)
            and getattr(value.func, "id", "") == "dict"
        ):
            out[target.id] = {
                kw.arg: ast.unparse(kw.value) for kw in value.keywords if kw.arg
            }
    return out


class TestEveryVisibleStringHasCarriedAFigure:
    """The 17-of-17 claim.

    Measured across the fixtures that reproduce published notices, because a
    fixture keeps the argument NAMES and the published prose does not -- mapping
    a number in the text back to the parameter that carried it would be a guess.
    """

    def _printed_strings(self) -> set[str]:
        out: set[str] = set()
        for name, fn in _functions().items():
            shown = _printed(fn)
            out |= {
                p for p, t in _parameters(fn) if t in STR_LIKE and p in shown
            }
        return out

    def _carried_a_digit(self) -> set[str]:
        digit = re.compile(r"\d")
        return {
            param
            for kwargs in _fixture_arguments().values()
            for param, literal in kwargs.items()
            if digit.search(literal)
        }

    def test_the_fixture_population_is_the_one_documented(self):
        """Eight notices. A smaller set would weaken the claim silently."""
        assert len(_fixture_arguments()) == 8

    def test_every_string_a_reader_sees_has_carried_a_figure(self):
        printed, carried = self._printed_strings(), self._carried_a_digit()
        assert printed, "no printed string parameters found -- the probe is broken"
        assert printed <= carried, (
            "AGENTS.md claims every visible string parameter has carried a "
            f"figure; these never have: {sorted(printed - carried)}"
        )

    def test_the_documented_count_is_the_measured_count(self):
        printed = self._printed_strings()
        body = AGENTS.read_text(encoding="utf-8").split(
            "### It has a shape, and the shape is the type", 1
        )[1]
        match = re.search(r"carried a figure\s+(\d+) of (\d+)", body)
        assert match, "the 'N of N' line is missing from the AGENTS.md table"
        assert (int(match.group(1)), int(match.group(2))) == (
            len(printed),
            len(printed),
        )

    def test_the_parameter_that_never_carried_one_is_the_unprinted_one(self):
        """A control. Without it the claim above passes on an empty population."""
        declared: set[str] = set()
        for name, fn in _functions().items():
            declared |= {p for p, t in _parameters(fn) if t in STR_LIKE}
        never = declared - self._carried_a_digit()
        assert never == {"corrected_at"}, (
            f"expected only corrected_at to have never carried a digit, got "
            f"{sorted(never)}"
        )


class TestTheCheckSplit:
    """Seven value checks, four presence checks, and the split is by type.

    Classified structurally: a test containing a ``Compare`` node relates two
    values, and anything else is a truthiness test. Reading the parameter names
    instead gets this wrong -- ``not str(value).strip()`` binds a loop variable,
    not a parameter, and a classifier that looks the name up among the
    signatures files both of them as numeric and reports 9/2.
    """

    def _raising_conditions(self) -> list[ast.expr]:
        out = []
        for name, fn in _functions().items():
            for node in ast.walk(fn):
                if isinstance(node, ast.If) and any(
                    isinstance(c, ast.Raise) for c in ast.walk(node)
                ):
                    out.append(node.test)
        return out

    def test_seven_value_checks_and_four_presence_checks(self):
        conditions = self._raising_conditions()
        value = [c for c in conditions if any(
            isinstance(n, ast.Compare) for n in ast.walk(c))]
        presence = [c for c in conditions if c not in value]
        assert (len(value), len(presence)) == (7, 4), (
            f"AGENTS.md says seven value checks and four presence checks; got "
            f"{len(value)} and {len(presence)}: "
            f"{[ast.unparse(c) for c in conditions]}"
        )

    def test_every_value_check_is_on_numeric_parameters_only(self):
        numeric: set[str] = set()
        strings: set[str] = set()
        for name, fn in _functions().items():
            for p, t in _parameters(fn):
                (numeric if t in NUM_LIKE else strings if t in STR_LIKE else set()).add(p)
        for condition in self._raising_conditions():
            if not any(isinstance(n, ast.Compare) for n in ast.walk(condition)):
                continue
            names = {n.id for n in ast.walk(condition) if isinstance(n, ast.Name)}
            assert not (names & strings), (
                f"a value check reads a string parameter: {ast.unparse(condition)}"
            )

    def test_no_presence_check_relates_two_values(self):
        """The other half. Without it, 'presence-only' is asserted of nothing."""
        for condition in self._raising_conditions():
            if any(isinstance(n, ast.Compare) for n in ast.walk(condition)):
                continue
            assert isinstance(condition, (ast.UnaryOp, ast.BoolOp, ast.Name)), (
                f"a presence check is doing something else: "
                f"{ast.unparse(condition)}"
            )


class TestACountIsNotAKey:
    """The second table: two rules, identical counts, different sets.

    This is the claim that makes the section worth keeping, so it is derived
    rather than transcribed. If the builders ever stop declaring exactly one
    ``claim`` and one ``corrected_at`` each, the coincidence dissolves and the
    section must be rewritten -- which is what these assertions say out loud.
    """

    def _by_rule(self, builder: str) -> tuple[set[str], set[str]]:
        fn = _functions()[builder]
        shown = _printed(fn)
        interpolated = {p for p, t in _parameters(fn) if t in STR_LIKE and p in shown}
        minus_claim = {p for p, t in _parameters(fn) if t in STR_LIKE and p != "claim"}
        return interpolated, minus_claim

    def test_both_rules_give_the_same_count_in_every_builder(self):
        for builder in BUILDERS:
            interpolated, minus_claim = self._by_rule(builder)
            assert len(interpolated) == len(minus_claim), (
                f"{builder}: the coincidence the section rests on is gone — "
                f"{len(interpolated)} vs {len(minus_claim)}"
            )

    def test_and_a_different_set_in_every_builder(self):
        """The half that matters. Equal counts over equal sets is not a finding."""
        for builder in BUILDERS:
            interpolated, minus_claim = self._by_rule(builder)
            assert interpolated != minus_claim, (
                f"{builder}: the two rules now select the same parameters, so "
                f"the section's example no longer demonstrates anything"
            )
            assert interpolated - minus_claim == {"claim"}
            assert minus_claim - interpolated == {"corrected_at"}

    def test_claim_is_printed_and_corrected_at_is_not_in_every_builder(self):
        """Per builder, never a union — a union is what hid this in the first place."""
        for builder in BUILDERS:
            shown = _printed(_functions()[builder])
            assert "claim" in shown, f"{builder}: claim is no longer quoted to the reader"
            assert "corrected_at" not in shown, f"{builder}: corrected_at is now printed"

    def test_the_documented_rows_match(self):
        body = AGENTS.read_text(encoding="utf-8").split(
            "### A count is not a key", 1
        )[1]
        for label in ("str-like AND interpolated", "str-like MINUS claim"):
            match = re.search(
                rf"^{re.escape(label)}\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$",
                body,
                re.MULTILINE,
            )
            assert match, f"the '{label}' row is missing from the AGENTS.md table"
            documented = [int(g) for g in match.groups()]
            measured = [
                len(self._by_rule(b)[0 if "interpolated" in label else 1])
                for b in BUILDERS
            ]
            assert documented == measured, (
                f"{label}: AGENTS.md says {documented}, measured {measured}"
            )


class TestTheProbeCanSeeAnything:
    """Controls. An absent result is a claim about the instrument first."""

    def test_a_parameter_known_to_exist_is_found(self):
        declared = {p for fn in _functions().values() for p, _ in _parameters(fn)}
        assert "still_stands" in declared

    def test_a_parameter_known_not_to_exist_is_not_found(self):
        declared = {p for fn in _functions().values() for p, _ in _parameters(fn)}
        assert "holds_over" not in declared

    def test_the_f_string_reader_finds_something_and_not_everything(self):
        fn = _functions()["record_correction_note"]
        shown = _printed(fn)
        assert "claim" in shown, "the f-string reader sees nothing -- it is broken"
        assert "corrected_at" not in shown, (
            "the f-string reader sees everything -- it is not discriminating"
        )
