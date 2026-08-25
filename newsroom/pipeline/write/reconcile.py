"""Bookkeeping the writer keeps getting wrong, done in code instead.

THE PROBLEM
-----------
Every number in a paragraph must be declared in that paragraph's ``figures``
array with the signal field it came from. That is what makes traceability a
property of the output rather than a hope, and it is not negotiable.

It is also clerical work, and the model is bad at it. Three production runs on
2026-08-25 rejected every original article, and after two prompt revisions the
surviving failures were all the same shape:

    no_invented_numbers: body[0]: '119' not in figures
    no_invented_numbers: body[3]: '1' not in figures
    no_invented_numbers: body[0]: '9' not in figures

The prose was not inventing anything. The model wrote a figure it had been
given and then failed to repeat it into the right block's array — the same
mistake, in run after run, through increasingly explicit instructions.

WHAT THIS DOES
--------------
For each numeric token in a block's prose that the block does not already
declare, look for a **verified signal field whose value justifies it** under the
validator's own rounding rule. If exactly one is found, declare it.

WHAT THIS IS NOT
----------------
It is not a way to get an unverified number published, and it cannot become
one. The only values it will ever attach come from ``signal.fields``, which is
the deterministic payload the detector produced — the same source the model was
given and the same one the validator checks against. A numeral with no matching
verified field is left exactly as it is, the validator sees an undeclared
number, and the article is rejected.

So the set of publishable articles either stays the same or grows by articles
whose numbers were verifiable all along and merely mis-filed. Nothing that was
unsafe becomes safe.

An ambiguous token — one that two different fields could justify — is also left
alone. Guessing which field a number came from is exactly the sort of plausible
invention this pipeline exists to prevent.
"""

from __future__ import annotations

import logging
from typing import Mapping, Sequence

from newsroom import numeric_scan
from newsroom.pipeline.models import Block, Figure

log = logging.getLogger(__name__)


def _already_declared(token: numeric_scan.NumericToken, figures: Sequence[Figure]) -> bool:
    return any(numeric_scan.value_justifies(token, figure.value) for figure in figures)


def _matching_fields(
    token: numeric_scan.NumericToken, fields: Mapping[str, float]
) -> list[tuple[str, float]]:
    matches: list[tuple[str, float]] = []
    for name, value in fields.items():
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        if numeric_scan.value_justifies(token, numeric):
            matches.append((name, numeric))
    return matches


def reconcile_block(
    block: Block, fields: Mapping[str, float], *, unit: str | None = None
) -> list[str]:
    """Declare figures the prose uses and the block forgot. Returns what it did."""
    if not block.text:
        return []

    notes: list[str] = []
    for token in numeric_scan.scan(block.text):
        if _already_declared(token, block.figures):
            continue

        matches = _matching_fields(token, fields)
        if len(matches) != 1:
            # Zero matches: the number is not in the verified payload, so it is
            # genuinely undeclarable and the validator must reject it.
            # More than one: we would be guessing which field it came from.
            continue

        name, value = matches[0]
        block.figures.append(
            Figure(
                value=value,
                signal_field=name,
                unit=unit,
                rendered_as=token.text,
            )
        )
        notes.append(f"declared {token.text!r} as {name}={value}")

    return notes


def reconcile_figures(
    blocks: Sequence[Block], fields: Mapping[str, float], *, unit: str | None = None
) -> list[str]:
    """Reconcile every block. Returns one note per figure declared."""
    notes: list[str] = []
    for index, block in enumerate(blocks):
        for note in reconcile_block(block, fields, unit=unit):
            notes.append(f"body[{index}]: {note}")
    return notes
