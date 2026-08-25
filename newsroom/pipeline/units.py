"""What unit a signal field is actually in.

Not every number a detector produces is a measure in the series' own unit. A
ratio is dimensionless, a count of observations is a count, and stamping the
series unit onto either produces a claim that is simply false.

This shipped. The first original article published after the pipeline was
unblocked said:

    The spread of 70.2 EUR/MWh is 3.18801 EUR/MWh higher than the typical
    spread

``spread_vs_typical`` is 70.2 / 22.02 = 3.188, a ratio. The actual difference
is 48.18 EUR/MWh. The sentence is wrong in both its unit and its arithmetic,
and it was wrong because two separate places -- the prompt's figure table and
the figure reconciler -- each applied ``signal.unit`` to every field.

Both now ask here instead, so the two cannot drift apart again.
"""

from __future__ import annotations

from typing import Final

#: Fields that exist for ranking and mean nothing to a reader.
INTERNAL_ONLY_FIELDS: Final[frozenset[str]] = frozenset({"z_score"})

#: Ratios: "x times the usual", not a quantity in the series' unit.
_RATIO_FIELDS: Final[frozenset[str]] = frozenset({"spread_vs_typical", "ratio_vs_typical"})

#: Counts of observations. A count of months is not 119 EUR/MWh.
_COUNT_FIELDS: Final[frozenset[str]] = frozenset(
    {"periods_compared", "baseline_years", "observations", "sample_size"}
)


def unit_for_field(name: str, series_unit: str | None) -> str | None:
    """The unit ``name`` is really in, or ``None`` when it has none."""
    if name in _COUNT_FIELDS:
        return None
    if name in _RATIO_FIELDS or name.endswith("_vs_typical"):
        return None
    if name in {"z_score"}:
        return None
    if "pct" in name or name.endswith("_percent"):
        return "%"
    return series_unit


def label_for_field(name: str, series_unit: str | None) -> str:
    """How to describe the unit in the writer's figure table."""
    unit = unit_for_field(name, series_unit)
    if unit is None:
        if name in _COUNT_FIELDS:
            return "a count, not a measurement"
        return "a ratio, not a measurement — write it as 'x times'"
    return unit


def is_dimensionless(name: str) -> bool:
    """Does this field have no unit of its own?"""
    return name in _COUNT_FIELDS or name in _RATIO_FIELDS or name.endswith("_vs_typical") or name == "z_score"


def display_value(name: str, value: float) -> str:
    """The value at a precision a reader can take in.

    ``:g`` printed ``3.18801``, and five decimal places on a derived ratio is
    noise that reads as false precision. The declared figure keeps the exact
    value; the validator permits correct rounding in prose, so this changes
    only what the writer is shown and encouraged to write.
    """
    if name in _COUNT_FIELDS:
        return f"{value:.0f}"
    if is_dimensionless(name):
        return f"{value:.2f}"
    return f"{round(value, 2):g}"
