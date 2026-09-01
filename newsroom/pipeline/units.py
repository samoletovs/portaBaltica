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

from typing import Final, Mapping

from newsroom.numeric_scan import split_unit_scale, unit_scale

#: Fields that exist for ranking and mean nothing to a reader.
INTERNAL_ONLY_FIELDS: Final[frozenset[str]] = frozenset({"z_score"})

#: Counted, not measured. ``readings_in_series`` is how long a series is; it is
#: not 18 EUR per hour, and the context pack emits it on every enriched signal.
_COUNT_FIELDS: Final[frozenset[str]] = frozenset(
    {"periods_compared", "baseline_years", "observations", "sample_size", "readings_in_series"}
)

#: Suffixes that make a field a count whatever it is called.
#:
#: The explicit set above is a list two places have to agree on, and they did
#: not: ``observation_count`` (record_extreme) and ``streak_length`` (streak)
#: are both counts, both quoted in their detector's comparison basis, and both
#: missing from it — so the writer's figure table offered "observation_count =
#: 40 EUR/MWh", which is the exact false unit this module was written to stop,
#: on the two most frequently firing detectors in the wire.
#:
#: A suffix rule closes the class rather than the two instances, so the next
#: detector to emit a count is right by default instead of right if someone
#: remembers.
_COUNT_SUFFIXES: Final[tuple[str, ...]] = ("_count", "_length")

#: Ratios: "x times the usual", not a quantity in the series' unit.
_RATIO_FIELDS: Final[frozenset[str]] = frozenset({"spread_vs_typical", "ratio_vs_typical"})

#: Fields holding a DIFFERENCE between two things rather than a level of one.
#:
#: A threshold is only meaningful against the quantity it is a threshold on, so
#: one of these can bound another difference and never a single reading. The
#: distinction is not visible in the prose — both render as a bare number — so
#: it has to be read off the field the figure was declared against.
#:
#: Named per detector family rather than guessed from the name: ``margin`` and
#: ``deviation`` carry no suffix that marks them out, and ``latest_value`` is a
#: level despite sitting beside them in the same figure table.
#:
#: THIS LIVES HERE, not in ``house_style``, where it was written. Two consumers
#: now need it — that rule and :func:`unit_for_field` below — and ``house_style``
#: already imports this module, so the set cannot travel the other way without a
#: cycle. One enumeration; a second would drift, which is the failure this file
#: exists to prevent.
DIFFERENCE_FIELDS: Final[frozenset[str]] = frozenset({
    "gap", "latest_gap", "early_gap", "recent_gap", "gap_pct",
    "spread", "typical_spread", "spread_pct", "spread_vs_typical",
    "margin", "margin_pct",
    "deviation", "deviation_pct",
    "change", "change_pct", "cumulative_change", "cumulative_change_pct",
    "distance_from_threshold", "widening_ratio",
    "typical_move", "move_vs_typical",
})

#: The members of the above that are distances IN THE SERIES' OWN UNIT.
#:
#: DERIVED rather than listed, so adding a member to ``DIFFERENCE_FIELDS``
#: classifies it instead of silently omitting it. The rest of that set is the
#: same distance re-expressed — as a percentage (``_pct``) or as a multiple
#: (``_ratio``, ``_vs_typical``) — and so was never in the series' unit to
#: begin with. ``widening_ratio`` is the one that makes the suffix rule worth
#: having: it is a difference and it is dimensionless, and a hand-written list
#: would have to remember that.
ABSOLUTE_DIFFERENCE_FIELDS: Final[frozenset[str]] = frozenset(
    name
    for name in DIFFERENCE_FIELDS
    if "pct" not in name and not name.endswith(("_ratio", "_vs_typical"))
)


#: The unit a distance across a rate series is in. Named once, here, and read
#: by ``house_style`` rather than respelled there: the check that a figure was
#: written correctly and the label that told the writer how to write it must be
#: the same string, or the guard tests a vocabulary of its own.
PERCENTAGE_POINTS: Final[str] = "percentage points"


def is_rate_unit(unit: str | None) -> bool:
    """Is this series measured in percent — so that a distance across it is not?

    Matched on the leading ``%`` rather than on a list of the qualifiers that
    may follow it. Measured across the 38 distinct units in
    ``collect/opendata.py``: 14 are rate-like, ``%`` never appears anywhere but
    the first character, and the qualifier varies freely — "% of GDP", "% year
    on year", "% of the young labour force". A list of those would be a word
    list encoding today's registry, and the next indicator would be added with
    a qualifier nobody had written down.

    The raw Eurostat codes that also mean percent — ``PC_GDP``, ``RCH_A``,
    ``PCH_PRE``, ``PC_ACT`` — are query PARAMETERS in that file, never a
    ``Series.unit``, which is always the human label beside them. Checked
    rather than assumed, because a code reaching here would be a rate this
    misses.
    """
    return bool(unit) and unit.strip().startswith("%")


def is_count(name: str) -> bool:
    """Is this field a tally of things rather than a measurement of them?"""
    return name in _COUNT_FIELDS or name.endswith(_COUNT_SUFFIXES)


def unit_for_field(
    name: str,
    series_unit: str | None,
    *,
    overrides: Mapping[str, str | None] | None = None,
) -> str | None:
    """The unit ``name`` is really in, or ``None`` when it has none.

    ``overrides`` wins outright. It carries the units of figures merged in from
    *other* series by the context pack, whose unit has nothing to do with this
    signal's — an inflation rate sitting beside a labour cost in EUR per hour.
    Guessing from the field name cannot work there, so the pack states it.
    """
    if overrides is not None and name in overrides:
        return overrides[name]
    if is_count(name):
        return None
    if name in _RATIO_FIELDS or name.endswith("_vs_typical"):
        return None
    if name in {"z_score"}:
        return None
    if "pct" in name or name.endswith("_percent"):
        return "%"
    # A DISTANCE ACROSS A RATE IS NOT A RATE. Two readings of "% year on year"
    # are 5.4 and 10.9; the distance between them is 5.5 PERCENTAGE POINTS, and
    # calling it 5.5% states a change of 5.5 where the true change is 101.9%.
    #
    # Three published articles said exactly that, all on ``cumulative_change``,
    # understating by 18.5x, 62x and 4x. Every check passed and was right to:
    # ``figures_traceable`` traced 5.5 to the field it came from, and the field
    # held 5.5. The unit was the lie, and no gate reads units.
    #
    # It reached print because the writer was TOLD this. Its figure table said
    # "cumulative_change = 5.5 (% year on year)", built from this function, and
    # it copied the label faithfully. So the fix belongs here and not in the
    # prompt: the prompt competes with the table, and which wins is a coin toss
    # the corpus already shows landing both ways — the seasonal section carries
    # a percentage-points example and got 5 of 5 right, the streak section does
    # not and got 0 of 3.
    #
    # A LEVEL is untouched: ``latest_value`` on the same series is a genuine
    # rate reading and keeps its "%", and a distance on a level series keeps
    # the series unit, because "down 0.1 EUR per kWh" is correct.
    if name in ABSOLUTE_DIFFERENCE_FIELDS and is_rate_unit(series_unit):
        return PERCENTAGE_POINTS
    return series_unit


def label_for_field(
    name: str,
    series_unit: str | None,
    *,
    overrides: Mapping[str, str | None] | None = None,
) -> str:
    """How to describe the unit in the writer's figure table."""
    unit = unit_for_field(name, series_unit, overrides=overrides)
    if unit is None:
        if is_count(name):
            return "a count, not a measurement"
        if overrides is not None and name in overrides:
            return "a count, not a measurement"
        return "a ratio, not a measurement — write it as 'x times'"
    return unit


def is_dimensionless(name: str) -> bool:
    """Does this field have no unit of its own?"""
    return is_count(name) or name in _RATIO_FIELDS or name.endswith("_vs_typical") or name == "z_score"


def display_value(name: str, value: float) -> str:
    """The value at a precision a reader can take in.

    ``:g`` printed ``3.18801``, and five decimal places on a derived ratio is
    noise that reads as false precision. The declared figure keeps the exact
    value; the validator permits correct rounding in prose, so this changes
    only what the writer is shown and encouraged to write.

    This is what the writer must DECLARE, so it stays a plain machine-copyable
    number: no thousands separators, and — since ``{:g}`` switches to exponent
    notation above a million — no ``1.857e+06`` either. A population of
    1,857,000 was being handed to the writer in scientific notation. What the
    writer should WRITE is :func:`humanise`, which is a different question.
    """
    if is_count(name):
        return f"{value:.0f}"
    if is_dimensionless(name):
        return f"{value:.2f}"
    return _decimal(round(value, 2))


def _decimal(value: float) -> str:
    """A number in plain decimal notation, with no trailing zeros."""
    if value == 0:
        return "0"
    return f"{value:.10f}".rstrip("0").rstrip(".")


#: Scale words a reader holds without arithmetic, largest first. A quantity is
#: rendered against the largest of these it exceeds, so its mantissa always
#: lands in [1, 1000) — which is the property that makes "4.65 million"
#: readable and "4653 thousand" not.
#:
#: Public, and the ONE ladder. ``house_style`` builds its editor-side check
#: from this rather than restating it: a rendering that leaves four digits in
#: front of a scale word is exactly what that check refuses, and two
#: enumerations of the same vocabulary always drift. This one already did —
#: the ladder stopped at "billion" while ``numeric_scan`` knew "trillion", so
#: 1e12 tonnes rendered as "1000 billion", which is the very shape being
#: fixed. ``test_readable_magnitude`` asserts the two agree.
MAGNITUDES: Final[tuple[tuple[str, float], ...]] = (
    ("trillion", 1e12),
    ("billion", 1e9),
    ("million", 1e6),
    ("thousand", 1e3),
)


def _magnitude_for(quantity: float) -> tuple[str, float]:
    size = abs(quantity)
    for word, factor in MAGNITUDES:
        if size >= factor:
            return word, factor
    return "", 1.0


def _decimals_for(mantissa: float) -> int:
    """Three significant figures, expressed as DECIMAL places.

    Decimal places rather than significant figures because the tolerance the
    validator allows is half a unit in the last decimal place the prose
    committed to. A rendering rounded to a fixed number of decimals is
    therefore accepted by construction — the same argument
    ``detect_seasonal_deviation`` makes about using ``round()`` rather than
    ``:.2f`` — whereas one rounded to significant figures is not, and would be
    rejected as an invented number.
    """
    size = abs(mantissa)
    if size < 10:
        return 2
    if size < 100:
        return 1
    return 0


def humanise(value: float, unit: str | None) -> tuple[str, str]:
    """The quantity at a scale a reader can hold, and the unit it is then in.

    ::

        (4653, "thousand passengers")   -> ("4.65 million", "passengers")
        (998.44, "thousand passengers") -> ("998 thousand", "passengers")
        (1857000, "people")             -> ("1.86 million", "people")
        (49.64, "EUR/MWh")              -> ("49.64", "EUR/MWh")

    THE FAILURE THIS FIXES
    ----------------------
    A published article read::

        Latvia recorded 4653 thousand rail passengers in 2026-Q1, an increase
        of 998.44 thousand passengers compared with the nine-year average of
        3654.56 thousand passengers for the same point in the year.

    Every figure in it is correct and traces to Eurostat ``rail_pa_quartal``.
    It is still unreadable, in two separate ways, and the first reader to see
    it took it for a data fault rather than a rendering one:

    * **The scale is one the reader has to convert.** "4653 thousand" is 4.65
      million. Latvia has 1.9 million people, so a reader who does the
      arithmetic lands on a number that looks impossible and stops trusting
      the piece — the quantity is journeys, not persons, but a figure nobody
      can hold cannot make that argument for itself.
    * **The precision is false.** Two decimals of a thousand is a claim to the
      nearest ten passengers on a seasonal average of three and a half million.

    Both are properties of the RENDERING, and both are invisible to every gate
    the newsroom has, because every gate protects figures rather than how they
    read. So they are fixed where the number is turned into text, once, and the
    six comparison bases and the shared figure table all ask here.

    An unscaled unit whose value is already small is returned untouched: there
    is nothing to restate about 49.64 EUR/MWh, and restating it would only cost
    precision the writer may legitimately want.
    """
    scale, base = split_unit_scale(unit)
    quantity = float(value) * scale
    word, factor = _magnitude_for(quantity)

    if scale == 1.0 and factor == 1.0:
        return _decimal(round(float(value), 2)), (unit or "")

    mantissa = round(quantity / factor, _decimals_for(quantity / factor))
    if abs(mantissa) >= 1000.0:
        # Rounding pushed it up a rung: 999.7 thousand is a million.
        word, factor = _magnitude_for(mantissa * factor)
        mantissa = round(quantity / factor, _decimals_for(quantity / factor))

    number = _decimal(mantissa)
    return (f"{number} {word}".strip(), base)


def quantity(value: float, unit: str | None) -> str:
    """:func:`humanise`, as one string: ``"4.65 million passengers"``."""
    number, base = humanise(value, unit)
    return f"{number} {base}".strip()


def display_quantity(
    name: str,
    value: float,
    series_unit: str | None,
    *,
    overrides: Mapping[str, str | None] | None = None,
) -> str:
    """How a reader should meet field ``name`` — the number and its unit.

    Counts and ratios keep :func:`display_value`'s answer, because neither has
    a magnitude to restate; everything else goes through :func:`humanise`.
    """
    unit = unit_for_field(name, series_unit, overrides=overrides)
    if is_dimensionless(name):
        return display_value(name, value)
    return quantity(value, unit)
