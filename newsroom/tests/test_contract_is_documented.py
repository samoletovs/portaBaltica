"""The documented contract must list every check that runs.

THE DRIFT
---------
``newsroom/README.md`` opens "The validator" with a table of checks and what
each one fails on. It is the only place the contract is stated in one view, and
it is what a reader consults before touching the gate.

It listed **nine** checks while ``CHECK_NAMES`` held **eleven**. Missing were
``no_unsupported_mechanism`` and ``record_claim_holds`` — and the first of those
is not an obscure corner: read from the published run history, it is the
**largest single cause of rejection in production**, 9 of the 17 recorded across
22 dated run reports. The documented summary of the gate omitted the check doing
the most work.

The drift was found the way this kind always is — by someone acting on it. A
session read the table, counted nine, and reported the wrong number of checks
before reading ``CHECK_NAMES``.

WHY A TEST AND NOT A CAREFUL EDIT
---------------------------------
Fixing the table fixes today. It does nothing about the next check, which will
be added by someone who has no reason to know this file exists — which is
exactly how the last two arrived.

``test_validator_rejects.py`` already ends with two meta tests of this shape:
every check must have a fixture proving it can reject something, and every
registered check must actually run. Both exist because two enumerations that
ought to agree drifted while the suite stayed green. This is the third:

    _CHECKS      vs a negative fixture   -- can this check ever fail?
    CHECK_NAMES  vs _CHECKS              -- does this check ever run?
    CHECK_NAMES  vs the README table     -- does anyone know it exists?

**Prose is an enumeration too**, and it was the one nothing walked.

WHY THIS ONE MAY BE A DOCUMENTATION GUARD WHEN MOST MAY NOT
-----------------------------------------------------------
``AGENTS.md`` is emphatic that a repo-wide "identifier named in prose must exist
in code" sweep is the wrong instrument: measured there, it fires 32 times with
zero defects, because prose legitimately names Eurostat codes, Python symbols,
env vars and third-party APIs. It only works scoped to a file whose vocabulary
is closed.

This guard is narrower than that on both sides. It reads **one table**, in
**one file**, against **one enumeration the same repository owns**, and it
compares sets rather than judging language. There is no population of legitimate
exceptions for it to accumulate: a check either runs or it does not, and if it
runs it is part of the contract.

It is also written as an **equality**, not as a subtraction of known offenders,
so it fails in both directions — a documented row for a check that no longer
exists is as much a lie as a check nobody documented.
"""

from __future__ import annotations

import pathlib
import re

from newsroom.validator import CHECK_NAMES

#: The table lives directly under this heading in ``newsroom/README.md``.
_README = pathlib.Path(__file__).resolve().parents[1] / "README.md"

#: A row of that table: a check name in backticks in the first column.
_ROW = re.compile(r"^\| `(\w+)` \| ", re.MULTILINE)


def _documented() -> set[str]:
    return set(_ROW.findall(_README.read_text(encoding="utf-8")))


def test_the_readme_is_where_this_test_thinks_it_is() -> None:
    """The instrument before the finding.

    Every assertion below is a set difference, and a file that failed to load
    would make both sides empty and every one of them pass. An absent reading
    is a claim about the probe before it is a claim about the code.
    """
    assert _README.is_file(), f"the contract is not at {_README}"

    documented = _documented()

    assert documented, "the row pattern matched nothing; the table shape changed"
    assert CHECK_NAMES, "an empty contract would satisfy every assertion here"


def test_every_check_that_runs_is_in_the_documented_contract() -> None:
    """A check nobody documented is a check nobody can review.

    ``no_unsupported_mechanism`` rejected more articles than any other check
    while absent from the table that claims to list them all.
    """
    undocumented = sorted(set(CHECK_NAMES) - _documented())

    assert not undocumented, (
        "these checks run against every article and are not in the validator "
        f"table in newsroom/README.md, so the contract understates itself: "
        f"{undocumented}"
    )


def test_every_documented_check_is_one_that_runs() -> None:
    """The other direction, which is why this is an equality and not a filter.

    A row for a check that was renamed or removed reads as coverage and is not.
    """
    phantom = sorted(_documented() - set(CHECK_NAMES))

    assert not phantom, (
        "the validator table in newsroom/README.md documents checks that are "
        f"not in CHECK_NAMES, so the contract overstates itself: {phantom}"
    )


def test_the_two_sets_are_the_same_size() -> None:
    """The count, because that is the form the drift was actually read in.

    A session consulted the table, counted its rows, and reported that number
    as the number of checks. It was nine against eleven.
    """
    assert len(_documented()) == len(CHECK_NAMES)
