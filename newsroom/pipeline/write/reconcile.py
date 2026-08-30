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
from newsroom.pipeline.units import is_count, unit_for_field
log = logging.getLogger(__name__)


def _already_declared(token: numeric_scan.NumericToken, figures: Sequence[Figure]) -> bool:
    return any(
        numeric_scan.value_justifies(
            token, figure.value, scale=numeric_scan.unit_scale(figure.unit)
        )
        for figure in figures
    )


def _matching_fields(
    token: numeric_scan.NumericToken,
    fields: Mapping[str, float],
    *,
    unit: str | None = None,
    field_units: Mapping[str, str | None] | None = None,
) -> list[tuple[str, float]]:
    """Verified fields that could account for ``token``.

    "Could account for" is the validator's own rounding rule, so a field is a
    candidate when the token is that number written at the token's precision.
    An ambiguous token — two candidates — is left alone, because guessing which
    field a number came from is the sort of plausible invention this pipeline
    exists to prevent.

    ``unit`` and ``field_units`` are the same pair :func:`reconcile_block`
    takes, and they are here for the same reason the validator reads a figure's
    unit: a field in "thousand passengers" holding 4653 accounts for the prose
    token "4.65 million", and without the unit this cannot see that. It is not
    an optional refinement — the writer is REQUIRED to restate a comparison
    basis that the pipeline now renders at the readable scale, so a reconciler
    blind to the unit strands the pipeline's own prose and the article dies on
    a number nobody invented.

    ONE EXCEPTION, AND ONLY ONE: a count beats a measurement that merely rounds
    to it. The seasonal basis says "the five-year average", the writer renders
    it "the 5-year average", and the token ``5`` has two parents —
    ``baseline_years`` is 5 exactly and ``deviation`` is 5.4, which rounds to 5
    at zero decimals. The reconciler declined, the validator saw an undeclared
    number, and the article died. A forensic pass over three days of rejected
    drafts found this one shape in **8 of 16** ``no_invented_numbers`` kills,
    10% of every tier A rejection.

    It is not the general rule "exact beats rounded", which would be a guess
    dressed as a policy — it is that a count and a measurement are different
    kinds of quantity. A count is ``float(len(...))``: it is a whole number by
    construction and can never be a rounded rendering of anything else. A
    measurement that happens to round to the same integer is a coincidence, not
    a competing explanation. So this narrows what may be chosen rather than
    widening it, only ever fires when a count matches outright, and cannot
    touch a token carrying decimals — "5.0" does not match a ``deviation`` of
    5.4 at all, so there is nothing to disambiguate.
    """
    exact_counts: list[tuple[str, float]] = []
    matches: list[tuple[str, float]] = []
    for name, value in fields.items():
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        scale = numeric_scan.unit_scale(
            unit_for_field(name, unit, overrides=field_units)
        )
        if not numeric_scan.value_justifies(token, numeric, scale=scale):
            continue
        matches.append((name, numeric))
        if is_count(name) and _is_exact(token, numeric):            exact_counts.append((name, numeric))

    if len(exact_counts) == 1 and len(matches) > 1:
        return exact_counts
    return matches


#: Floating-point slack for "the same number", not editorial slack.
_EXACT = 1e-9


def _is_exact(token: numeric_scan.NumericToken, value: float) -> bool:
    return any(
        abs(abs(candidate) - abs(value)) <= _EXACT
        for candidate in token.candidate_values()
    )


def reconcile_block(
    block: Block,
    fields: Mapping[str, float],
    *,
    unit: str | None = None,
    field_units: Mapping[str, str | None] | None = None,
) -> list[str]:
    """Declare figures the prose uses and the block forgot. Returns what it did."""
    if not block.text:
        return []

    notes: list[str] = []
    for token in numeric_scan.scan(block.text):
        if _already_declared(token, block.figures):
            continue

        matches = _matching_fields(token, fields, unit=unit, field_units=field_units)
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
                # The field's own unit, not the series unit. Blanket-applying
                # signal.unit published "3.18801 EUR/MWh higher than the
                # typical spread", where the field is a ratio and the real
                # difference was 48.18. See newsroom/pipeline/units.py.
                #
                # ``field_units`` carries the same correction one namespace
                # further out, for figures the context pack borrowed from
                # *other* series: an inflation rate sitting in a labour-cost
                # story is a percentage, not EUR per hour, and the name alone
                # cannot say so.
                unit=unit_for_field(name, unit, overrides=field_units),
                rendered_as=token.text,
            )
        )
        notes.append(f"declared {token.text!r} as {name}={value}")

    return notes


def reconcile_figures(
    blocks: Sequence[Block],
    fields: Mapping[str, float],
    *,
    unit: str | None = None,
    field_units: Mapping[str, str | None] | None = None,
) -> list[str]:
    """Reconcile every block. Returns one note per figure declared."""
    notes: list[str] = []
    for index, block in enumerate(blocks):
        for note in reconcile_block(block, fields, unit=unit, field_units=field_units):
            notes.append(f"body[{index}]: {note}")
    return notes


def drop_unusable_figures(
    blocks: Sequence[Block], fields: Mapping[str, float]
) -> list[str]:
    """Remove declared figures that are both wrong and unused. Returns what it did.

    THE FAILURE THIS FIXES
    ----------------------
    A live article was rejected for::

        figures_traceable: body[1]: figure 4.0 does not match
                           readings_in_series=40.0 (tolerance 0.0)

    The prose said "this reading is the fourth-highest on record". There is no
    numeral in that sentence — "fourth" is a word — so no figure was needed at
    all. The model declared one anyway, guessed a field, and got the value
    wrong. A correct, publishable paragraph was discarded over an entry that
    justified nothing in it.

    WHY DROPPING IT IS SAFE
    -----------------------
    Two conditions, both required:

    1. The figure **fails** ``figures_traceable`` already — its value does not
       match the field it names. Keeping it guarantees rejection, so removing
       it cannot lose a verdict that was going to pass.
    2. No numeric token in the block's own prose is justified by it. So no
       claim in that paragraph depends on it.

    ``no_invented_numbers`` runs independently and is untouched: if the prose
    did contain a numeral that only this figure could have justified, condition
    2 fails and the figure stays, and the article is rejected exactly as before.
    Nothing unverified becomes publishable — the set of publishable articles
    grows only by ones whose prose was already fully supported.
    """
    notes: list[str] = []
    for index, block in enumerate(blocks):
        if not block.figures:
            continue
        tokens = numeric_scan.scan(block.text or "")
        keep: list[Figure] = []
        for figure in block.figures:
            resolved = fields.get(figure.signal_field)
            traceable = (
                resolved is not None
                and abs(float(resolved) - float(figure.value)) <= 0.0
            )
            used = any(numeric_scan.value_justifies(token, figure.value) for token in tokens)
            if traceable or used:
                keep.append(figure)
                continue
            notes.append(
                f"body[{index}]: dropped unused figure {figure.value} "
                f"declared as {figure.signal_field}"
                + (f"={resolved}" if resolved is not None else " (no such field)")
            )
        block.figures = keep
    return notes
