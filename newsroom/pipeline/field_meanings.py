"""What each verified field MEANS, in the words a reader would need.

WHY THIS EXISTS
---------------
The figure table used to give a name, a number and a unit, and nothing else::

    - gap = 25605          (thousand tonnes)
    - early_gap = 9625     (thousand tonnes)
    - recent_gap = 27471.1 (thousand tonnes)

Three different quantities, three identical descriptions, so whoever reads it
has to invent English for each. One published article told a reader the gap was
25,605 and, three paragraphs later, that the recent gap was 27,471.1. Both
figures were true of their own field and every check passed, because
``figures_traceable`` and ``no_invented_numbers`` protect figures, not subjects:
a number can trace perfectly to a field whose *name in English* the prose then
reuses for a different field.

WHY IT LIVES HERE RATHER THAN IN THE WRITER'S PROMPT
----------------------------------------------------
It was written in ``write/prompts.py`` and wired into the writer alone. Three
stages build the same table from ``signal.fields``, and the other two were left
with the bare name and unit:

===================  ==============================================
``write/prompts.py`` the writer          — had the meanings
``analyst.py``       the analysis desk   — did not
``hypothesis.py``    the causal panel    — did not
===================  ==============================================

The two that missed it run **first**, and the analyst's own prompt says the
correspondent "quotes your claims almost verbatim". So a brief that had already
converted a spread into a level arrived at a correctly-informed writer, which is
how a consumer-confidence piece came to report a *rise in optimism* from a
widening gap between two countries that were both deeply negative. Measured:
the analyst saw ``latest_gap = 27.15 (balance of responses)``, which is
indistinguishable from a reading of consumer confidence.

Fixing one consumer of a shared input and leaving its siblings is the shape this
repo keeps finding: the correct version is present, so a reader who checks finds
it and stops looking.

``hypothesis.py`` is not wired up here because it is owned by another
workstream; it should be, and the same one-line change does it.
"""

from __future__ import annotations

from newsroom.pipeline.detect.series import reading_word
from newsroom.pipeline.models import Signal

#: Keyed by detector as well as field, so two detectors may use one name for
#: different quantities without either meaning drifting onto the other.
#:
#: ``{period}``, ``{period_word}``, ``{high_geo}`` and ``{low_geo}`` are
#: substituted per signal. Meanings carry no digits: a numeral here is a numeral
#: the writer may quote, and only fields are declarable.
FIELD_MEANINGS: dict[str, dict[str, str]] = {
    "record_extreme": {
        "latest_value": "the new record reading itself, in {period}",
        "previous_record_value": "the record it beat, set in an earlier {period_word}",
        "margin": "how far the new reading cleared the old record — a difference, not a level",
        "margin_pct": "that same margin as a percentage of the old record — ALWAYS POSITIVE, however the record moved; the direction is in ``margin``",
        "observation_count": "how many readings the series holds in total, the population the record is claimed over",
    },
    "streak": {
        "latest_value": "the reading at the end of the run, in {period}",
        "streak_length": "how many consecutive readings moved the same way — a count of readings, and it is only a count of {period_word} if none are missing",
        "streak_start_value": "the reading the run started from, before any of the moves",
        "cumulative_change": "the total distance travelled across the whole run, start to end — not the size of any single move",
        "cumulative_change_pct": "that same total distance as a percentage of where the run started — ALWAYS POSITIVE, even for a fall; the direction is in ``cumulative_change``",
    },
    "threshold_cross": {
        "latest_value": "the reading that crossed the line, in {period}",
        "previous_value": "the reading immediately before it, on the other side of the line",
        "threshold_value": "the line itself — a level we chose in advance, not something measured",
        "distance_from_threshold": "how far past the line the latest reading sits — a distance, not a level",
    },
    "sharp_move": {
        "latest_value": "the reading after the move, in {period}",
        "previous_value": "the reading immediately before it",
        "change": "the size of this one move, previous to latest — a difference, not a level",
        "change_pct": "that same move as a percentage of where it started — ALWAYS POSITIVE, even for a fall; the direction is in ``change``",
        "typical_move": "how large a move this series usually makes, measured as its own standard deviation — the yardstick, not a reading",
        "move_vs_typical": "how many of those typical moves this one is worth",
        "periods_compared": "how many earlier readings that yardstick was measured over",
    },
    "seasonal_deviation": {
        "latest_value": "the reading itself, in {period}",
        "seasonal_mean": "the long-run average for this same point in the year — the normal this is being judged against, not a reading of its own",
        "deviation": "how far the reading sits from that seasonal normal — a difference, not a level",
        "deviation_pct": "that same distance as a percentage of the seasonal normal — ALWAYS POSITIVE, even when the reading sits below it; the direction is in ``deviation``",
        "baseline_years": "how many earlier years the seasonal normal averages over",
    },
    "divergence": {
        # Every one of these says whether it is a DIFFERENCE BETWEEN COUNTRIES
        # or ONE COUNTRY'S OWN READING, because that distinction is invisible
        # in the number and is the one the pipeline keeps losing.
        "spread": "the DISTANCE BETWEEN {high_geo} and {low_geo} in {period} — a difference between two countries, never a reading of the indicator itself",
        "spread_pct": "that same spread as a percentage of the average level — always positive, as a spread is a distance",
        "typical_spread": "the MEDIAN spread across the earlier readings — a historical norm, not a reading of {period}",
        "spread_vs_typical": "how many times the typical spread the current one is worth",
        "highest_value": "{high_geo}'s own level in {period} — one country's reading, NOT a difference between countries",
        "lowest_value": "{low_geo}'s own level in {period} — one country's reading, NOT a difference between countries",
        "periods_compared": "how many earlier readings the typical spread was measured over",
    },
    "structural_divergence": {
        "latest_gap": "the DISTANCE BETWEEN {high_geo} and {low_geo} in {period} ALONE — a difference between two countries, NOT a reading of the indicator. It cannot rise or fall 'optimistically': both countries may be negative while this widens",
        "early_gap": "the AVERAGE of that same distance over the EARLIEST {period_word} of the series — the historical basis this is measured against, not a recent reading",
        "recent_gap": "the AVERAGE of that distance over the most recent {period_word} — an average over a window, so it will NOT equal the {period} figure and must never be called simply 'the gap'",
        "gap_pct": "the {period} distance as a percentage of the average level of the three countries — always positive, as a distance",
        "window_periods": "how many {period_word} are averaged into each of the early and recent windows",
        "sustained_periods": "how many consecutive {period_word} {high_geo} has been highest and {low_geo} lowest — the duration that makes this structural",
        "widening_ratio": "how many times the early average distance the recent average distance is worth",
        "highest_value": "{high_geo}'s own level in {period} — one country's reading, NOT a gap between countries",
        "lowest_value": "{low_geo}'s own level in {period} — one country's reading, NOT a gap between countries",
    },
}

#: ``value_lv`` and friends are emitted per geography, so they are matched by
#: shape rather than listed. The warning is the point: two published articles
#: rendered a country's own level as that country's "gap".
_PER_GEOGRAPHY_MEANING = (
    "{geo}'s own level in {period} — one country's reading, "
    "NOT a gap, spread or difference"
)

#: Detectors whose headline figure is a distance between two series rather than
#: a reading of one. Stated once, here, so the analyst prompt and the writer
#: prompt cannot disagree about which findings are spreads.
SPREAD_DETECTORS: frozenset[str] = frozenset({"divergence", "structural_divergence"})


def is_spread_finding(signal: Signal) -> bool:
    """Is this signal's headline value a distance between two series?"""
    return signal.detector in SPREAD_DETECTORS


def quantity_note(signal: Signal, *, mention_thresholds: bool = False) -> str:
    """Say plainly when the finding is a distance rather than a reading.

    "metric: consumer confidence / unit: balance of responses" describes the
    *series*, and for a spread detector the finding is not a reading of that
    series at all — it is how far apart two countries are. Nothing said so, and
    a published brief duly reported "a consumer confidence reading of 29.6 ...
    reflecting a stronger sentiment" for three countries whose readings were
    -15.6, -32.5 and -2.9. Every figure was real; the subject had changed.

    ONE DEFINITION, read by every stage that needs it. The registry above
    exists because the same explanation was written for one consumer of three;
    writing this note twice would repeat that mistake inside the fix for it.

    ``mention_thresholds`` is for the stages that propose one. The causal panel
    does not, and an instruction about an output it never produces is noise.
    """
    if not is_spread_finding(signal):
        return ""

    high, low = endpoints(signal)
    between = f"{high} and {low}" if high and low else "two countries"
    note = f"""
THIS FINDING IS A DISTANCE, NOT A READING. The headline figure is how far apart
{between} are — a difference between two series, measured in the same unit as
the series but not a value the indicator ever took. So:

  - It cannot be described as the indicator rising, falling, improving or
    worsening. Every country's own reading may be falling while this widens.
  - It carries no sentiment. A wider gap is not good news or bad news; saying
    which would be an argument, and you do not have the figures for it.
  - The endpoints are {between}. Any other country in the set is BETWEEN them,
    and naming a different pair as the extremes is simply wrong.
  - What needs explaining is why the two moved APART, not why the indicator
    moved.
"""
    if mention_thresholds:
        note += (
            "  - A threshold you propose must be stated on the distance, not on\n"
            "    one country's level.\n"
        )
    return note


def endpoints(signal: Signal) -> tuple[str | None, str | None]:
    """Which geographies the spread is measured between, high then low.

    Read from the detector's own context rather than recomputed. A published
    article named the wrong pair — "Latvia and Estonia are experiencing a wider
    gap" when the endpoints were Estonia and Lithuania and Latvia sat in the
    middle — because nothing downstream was ever told which two they were, and
    a model comparing three numbers by eye got it wrong.
    """
    context = signal.context or {}
    high = context.get("highest_geography")
    low = context.get("lowest_geography")
    return (str(high) if high else None, str(low) if low else None)


def meaning_for_field(signal: Signal, name: str) -> str | None:
    """What ``name`` means for this signal, or ``None`` when nothing is known.

    ``None`` is the right answer for the namespaced fields the context pack
    merges in — ``peer_ee``, ``companion_hicp_annual_rate`` and the rest — and
    it is not a gap in coverage: the context section prints those with the
    label the pack authored, under a heading that explains what kind of fact
    each one is. Repeating them here would be a second description of one
    field, free to disagree with the first.
    """
    period = signal.period
    high, low = endpoints(signal)

    if name.startswith("value_") and len(name.split("_")) == 2:
        geo = name.split("_", 1)[1].upper()
        return _PER_GEOGRAPHY_MEANING.format(geo=geo, period=period)

    template = FIELD_MEANINGS.get(signal.detector, {}).get(name)
    if template is None:
        return None
    return template.format(
        period=period,
        period_word=period_word(signal),
        # Fall back to a description rather than a name when the detector did
        # not record one: "the highest country" is true and vague, where a
        # missing key would raise and a guessed name would be a lie.
        high_geo=high or "the highest country",
        low_geo=low or "the lowest country",
    )


def period_word(signal: Signal) -> str:
    """The plural reading word for this signal's series, e.g. "quarters".

    Read from the detector's own context rather than re-derived, so it cannot
    disagree with the word the comparison basis already used.
    """
    frequency = str(signal.context.get("frequency", "")) if signal.context else ""
    return reading_word(frequency, 2)


def figure_table(signal: Signal, *, internal_only: frozenset[str]) -> list[str]:
    """The shared rendering: name, value, unit and what it means.

    Returned as lines rather than a string so each caller keeps its own
    surrounding format, and imported by both prompt builders so the two cannot
    drift into describing one field two ways.

    Two different questions get two different answers on the same field, and
    conflating them is what published "4653 thousand rail passengers":

    ``= 4653``
        what to DECLARE, copied digit for digit, so ``figures_traceable``
        matches it against the signal payload.
    ``write this as 4.65 million passengers``
        what to WRITE, at a scale a reader can hold. Emitted only when it
        differs from the declared form, so the ordinary case — a percentage,
        a price — is untouched and the table stays short.

    ``no_invented_numbers`` accepts the second because a figure's unit carries
    its own scale: 4653 in "thousand passengers" *is* 4.65 million passengers.
    See ``numeric_scan.value_justifies``.
    """
    from newsroom.pipeline import units

    lines = []
    for name, value in signal.fields.items():
        if name in internal_only:
            continue
        numeric = float(value)
        shown = units.display_value(name, numeric)
        label = units.label_for_field(name, signal.unit, overrides=signal.field_units)
        meaning = meaning_for_field(signal, name)
        suffix = f" — {meaning}" if meaning else ""
        lines.append(f"  - {name} = {shown}   ({label}){suffix}")

        readable = units.display_quantity(
            name, numeric, signal.unit, overrides=signal.field_units
        )
        if readable != f"{shown} {label}".strip() and readable != shown:
            lines.append(
                f"      write this as {readable} — declare the value as {shown}"
            )
    return lines
