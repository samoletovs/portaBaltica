"""Numeric token scanning for the ``no_invented_numbers`` check.

An LLM writing prose around data will confidently invent or drift a figure. The
only defence that scales is to read every numeric token back out of the rendered
prose and demand that each one traces to a declared figure.

Two design rules govern everything here:

**Fail closed.** When a token is ambiguous, it is treated as a claim that needs
justification. A false rejection is an article that does not publish; a false
acceptance is a fabricated number on a portal whose entire claim is traceability.

**Exclude calendar references, nothing else.** Dates and clock times are the one
category that genuinely is not a data claim, so they are masked out before
scanning. Durations are *not* excluded: "over the past 12 months" states the
range the analysis covers, the pipeline knows that range, and so it must declare
it. That keeps the exclusion list short enough to reason about.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Final, Iterable, Mapping, Sequence

logger = logging.getLogger(__name__)

#: Thousands separators accepted in prose. Plain space is included because
#: "1 234 567" is ordinary Baltic English rendering; the ambiguity it creates is
#: handled by :attr:`NumericToken.components`.
_THOUSANDS_SEPARATORS: Final[str] = ",\u00a0\u202f "

_MONTHS: Final[str] = (
    r"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|"
    r"Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?"
)

#: Words that put a bare four-digit number in a calendar context. Without one of
#: these, "1990" is treated as a number that needs a figure — the fail-closed
#: direction.
_YEAR_CONTEXT: Final[str] = (
    r"in|since|from|by|until|till|during|for|of|after|before|between|and|through|to|"
    r"the|year|years|early|late|mid|through"
)

#: Named infrastructure whose name ends in a numeral.
#:
#: "Estlink 1" is a cable, not a quantity, but the identifier rule below only
#: masks digits glued to letters ("COVID-19"), so a space was enough to make
#: the scanner read the name as the figure 1. Articles were then rejected for
#: an "invented number" that was part of a proper noun, which blocked every
#: Baltic power-market story — the interconnectors are the subject.
#:
#: An explicit list rather than a general "capitalised word followed by a
#: small integer" rule, because that rule would also mask "Latvia 500" and
#: hand back a way to launder a real quantity. A name missing from this list
#: fails closed: the article is rejected, exactly as it is today.
_NAMED_ENTITIES: Final[str] = (
    r"Estlink|EstLink|NordBalt|LitPol(?:\s+Link)?|Balticconnector|"
    r"Nord\s+Stream|Baltic\s+Pipe|Rail\s+Baltica|Harmony\s+Link"
)

_SCALE_WORDS: Final[Mapping[str, float]] = {
    "k": 1e3,
    "thousand": 1e3,
    "m": 1e6,
    "mn": 1e6,
    "million": 1e6,
    "bn": 1e9,
    "b": 1e9,
    "billion": 1e9,
    "tn": 1e12,
    "trillion": 1e12,
}

#: Scale words a *unit* can carry, as opposed to a numeral. "thousand
#: passengers" is a unit whose values are already divided by a thousand, so a
#: figure of 4653 in it is 4,653,000 passengers, and prose that writes it "4.65
#: million" is writing the same quantity rather than a new one.
#:
#: Leading or trailing, because the dataset registry uses both — "thousand
#: tonnes" and "EUR million". Never in the middle, and never after "per", which
#: is what keeps "cars per thousand inhabitants" and "per thousand inhabitants"
#: out: there the thousand is a DENOMINATOR, and folding it into the value would
#: multiply a rate by a thousand and call it a count.
_UNIT_SCALE_WORD: Final[str] = r"thousand|million|billion|trillion"

_UNIT_SCALE_LEADING: Final[re.Pattern[str]] = re.compile(
    rf"^({_UNIT_SCALE_WORD})\s+(.+)$", re.IGNORECASE
)
_UNIT_SCALE_TRAILING: Final[re.Pattern[str]] = re.compile(
    rf"^(.+?)\s+({_UNIT_SCALE_WORD})$", re.IGNORECASE
)


def split_unit_scale(unit: str | None) -> tuple[float, str]:
    """Separate a unit's own scale word from the thing it measures.

    ``"thousand passengers"`` → ``(1000.0, "passengers")``;
    ``"EUR million"`` → ``(1e6, "EUR")``;
    ``"cars per thousand inhabitants"`` → ``(1.0, "cars per thousand inhabitants")``.
    """
    text = (unit or "").strip()
    if not text:
        return 1.0, text

    match = _UNIT_SCALE_LEADING.match(text)
    if match:
        return _SCALE_WORDS[match.group(1).lower()], match.group(2).strip()

    match = _UNIT_SCALE_TRAILING.match(text)
    if match and not match.group(1).strip().lower().endswith(" per"):
        return _SCALE_WORDS[match.group(2).lower()], match.group(1).strip()

    return 1.0, text


def unit_scale(unit: str | None) -> float:
    """How much a unit's own scale word multiplies the values written in it."""
    return split_unit_scale(unit)[0]


_WORD_NUMBERS: Final[Mapping[str, float]] = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
    "hundred": 100,
}

#: Units that make a spelled-out numeral a quantitative claim rather than
#: ordinary prose. "three ports" is prose; "three percent" is a figure.
_WORD_NUMBER_UNITS: Final[str] = (
    r"percent|per\s+cent|pct|percentage\s+points?|"
    r"thousand|million|billion|trillion|"
    r"euros?|cents?|dollars?|"
    r"megawatts?|gigawatts?|kilowatt-?hours?|megawatt-?hours?|MWh|GWh|kWh|"
    r"tonnes?|tons?|TEU|vessels?|calls?|basis\s+points?"
)


# ── Exclusion masking ───────────────────────────────────────────────────

_EXCLUSION_PATTERNS: Final[tuple[re.Pattern[str], ...]] = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        # URLs — a path can contain arbitrary digits.
        r"https?://\S+|www\.\S+",
        # ISO 8601 date and datetime.
        r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b",
        # 24.08.2026, 24/08/2026, 2026/08/24
        r"\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b",
        r"\b\d{4}/\d{1,2}/\d{1,2}\b",
        # 24 August 2026 / 24th of August / 1 May
        rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:{_MONTHS})\.?(?:,?\s+\d{{4}})?\b",
        # August 24, 2026 / Aug 2026
        rf"\b(?:{_MONTHS})\.?\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s*\d{{4}})?\b",
        rf"\b(?:{_MONTHS})\.?\s+\d{{4}}\b",
        # Q1 2026, H2 2026, Q3
        r"\b[QH][1-4](?:\s*(?:of\s*)?\d{4})?\b",
        # Financial/academic year spans: 2025-26, 2025–2026
        r"\b(?:19|20)\d{2}\s*[-–/]\s*\d{2,4}\b",
        # Decades: 1990s, the 2020s
        r"\b(?:19|20)\d0s\b",
        # Clock times, with or without a zone.
        r"\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?"
        r"(?:\s*(?:CET|CEST|EET|EEST|UTC|GMT))?\b",
        # A bare year, only in an explicit calendar context.
        rf"\b(?:{_YEAR_CONTEXT})\s+(?:early\s+|late\s+|mid-?\s*)?(?:19|20)\d{{2}}\b",
        # Named infrastructure ending in a numeral: Estlink 1, Nord Stream 2.
        # Bounded to two digits, and refused when a unit follows, so that
        # "Estlink 2 GW of capacity" stays a measurable claim rather than
        # becoming a way to launder one behind a name.
        rf"\b(?:{_NAMED_ENTITIES})\s?\d{{1,2}}\b"
        r"(?!\s*(?:%|percent|per\s+cent|pct|"
        r"[kKmMgGtT]?[WwJj]h?\b|"
        r"EUR|USD|GBP|million|billion|thousand|tonnes?|tons?|km|MWh|GWh|TWh))",
        # Identifiers that glue letters to digits: COVID-19, gpt-4o-mini, A1.
        # Currency codes are excused so "EUR500m" stays a checkable figure.
        r"\b(?!(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN)(?=\s?\d))"
        r"[A-Za-z]+[-–]?\d+[A-Za-z0-9]*(?:[-–][A-Za-z0-9]+)*\b",
    )
)


def mask_excluded(text: str) -> str:
    """Blank out spans that are not numeric claims, preserving offsets.

    Replaces each excluded span with spaces so token offsets reported later
    still index into the original string.
    """
    masked = text
    for pattern in _EXCLUSION_PATTERNS:
        masked = pattern.sub(lambda match: " " * (match.end() - match.start()), masked)
    return masked


# ── Tokenising ──────────────────────────────────────────────────────────

_NUMBER_BODY: Final[str] = (
    rf"\d{{1,3}}(?:[{re.escape(_THOUSANDS_SEPARATORS)}]\d{{3}})+(?:\.\d+)?"
    r"|\d+(?:\.\d+)?"
)

_TOKEN_RE: Final[re.Pattern[str]] = re.compile(
    r"""
    (?P<currency>[€$£¥]|(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN)(?=\s?[-−+]?\d))?
    \s?
    (?P<sign>[-−–+])?
    \s?
    (?P<number>""" + _NUMBER_BODY + r""")
    (?:\s?(?P<scale>thousand|million|billion|trillion|bn|tn|mn|k|m|b)\b)?
    (?:\s?(?P<percent>%|(?:percent|per\s+cent|pct|percentage\s+points?)\b))?
    """,
    re.VERBOSE | re.IGNORECASE,
)

_WORD_TOKEN_RE: Final[re.Pattern[str]] = re.compile(
    r"\b(?P<word>" + "|".join(sorted(_WORD_NUMBERS, key=len, reverse=True)) + r")"
    r"\s+(?P<unit>" + _WORD_NUMBER_UNITS + r")\b",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class NumericToken:
    """A number found in rendered prose, with everything needed to justify it."""

    text: str
    """The token exactly as it appears in the prose."""

    value: float
    """The number as written, before any scale word is applied."""

    start: int
    end: int
    decimals: int
    """Digits after the decimal point — the precision the prose commits to."""

    scale: float = 1.0
    """Multiplier from a trailing scale word: 'm' → 1e6."""

    is_percentage: bool = False
    is_currency: bool = False

    components: tuple[float, ...] = ()
    """Alternative reading of a space-grouped run.

    "5 275" is almost always 5275, but it could be the two numbers 5 and 275.
    The primary reading is the grouped one; if that cannot be justified, the
    components are tried, and every one of them must then be justified.
    """

    @property
    def scaled_value(self) -> float:
        return self.value * self.scale

    def candidate_values(self) -> tuple[float, ...]:
        """Readings of this token that a figure may legitimately match."""
        if self.scale == 1.0:
            return (self.value,)
        return (self.value, self.scaled_value)

    def __str__(self) -> str:
        return self.text


def _strip_separators(number: str) -> str:
    for separator in _THOUSANDS_SEPARATORS:
        number = number.replace(separator, "")
    return number


def _decimals_of(number: str) -> int:
    _, _, fraction = number.partition(".")
    return len(fraction)


def _sign_multiplier(match: re.Match[str], text: str) -> float:
    """Decide whether a leading dash is a minus sign or a range separator.

    "4-6%" is a range whose endpoints are both positive; "a fall of -3.2%" is a
    negative number. The difference is whether a digit precedes the dash. An en
    dash is never read as a minus, because prose uses it only for ranges.
    """
    sign = match.group("sign")
    if sign is None or sign == "+":
        return 1.0
    if sign == "–":
        return 1.0
    preceding = text[: match.start("sign")].rstrip()
    if preceding and preceding[-1].isdigit():
        return 1.0
    return -1.0


def _components_of(number: str) -> tuple[float, ...]:
    if " " not in number:
        return ()
    parts = [part for part in number.split(" ") if part]
    if len(parts) < 2:
        return ()
    try:
        return tuple(float(part) for part in parts)
    except ValueError:  # pragma: no cover — regex guarantees digits
        return ()


def scan(text: str) -> tuple[NumericToken, ...]:
    """Extract every numeric claim from rendered prose.

    Calendar dates, clock times, URLs and alphanumeric identifiers are masked
    out first. Everything else that looks like a number is returned.
    """
    if not text:
        return ()

    masked = mask_excluded(text)
    tokens: list[NumericToken] = []

    for match in _TOKEN_RE.finditer(masked):
        number = match.group("number")
        magnitude = float(_strip_separators(number))
        multiplier = _sign_multiplier(match, masked)
        scale_word = match.group("scale")
        scale = _SCALE_WORDS[scale_word.lower()] if scale_word else 1.0

        tokens.append(
            NumericToken(
                text=text[match.start() : match.end()].strip(),
                value=multiplier * magnitude,
                start=match.start(),
                end=match.end(),
                decimals=_decimals_of(number),
                scale=scale,
                is_percentage=match.group("percent") is not None,
                is_currency=match.group("currency") is not None,
                components=tuple(multiplier * part for part in _components_of(number)),
            )
        )

    tokens.extend(_scan_word_numbers(text, masked))
    return tuple(sorted(tokens, key=lambda token: token.start))


def _scan_word_numbers(text: str, masked: str) -> list[NumericToken]:
    """Catch spelled-out numerals attached to a unit.

    Without this, "prices rose by three percent" walks straight past a
    digit-only scanner — the cheapest possible way to launder an invented
    figure.
    """
    tokens: list[NumericToken] = []
    for match in _WORD_TOKEN_RE.finditer(masked):
        word = match.group("word").lower()
        unit = match.group("unit").lower().replace("\u00a0", " ")
        value = _WORD_NUMBERS[word]
        scale = _SCALE_WORDS.get(re.sub(r"\s+", " ", unit), 1.0)
        tokens.append(
            NumericToken(
                text=text[match.start() : match.end()].strip(),
                value=value,
                start=match.start(),
                end=match.end(),
                decimals=0,
                scale=scale,
                is_percentage=unit.startswith(("percent", "per cent", "pct", "percentage")),
                is_currency=unit.startswith(("euro", "cent", "dollar")),
            )
        )
    return tokens


# ── Justification ───────────────────────────────────────────────────────

#: Floating-point slack, not editorial slack. Guards against 0.1 + 0.2 style
#: representation error when comparing a rounding boundary.
_FLOAT_EPSILON: Final[float] = 1e-9


def rendering_tolerance(decimals: int) -> float:
    """Half a unit in the last place the writer committed to.

    A figure of 4.23 may legitimately be written "4.2"; it may not be written
    "4.3". The tolerance is exactly what correct rounding permits, at the
    precision the writing itself chose.

    Public because the validator applies the identical rule one link further up
    the chain: ``no_invented_numbers`` compares prose against declared figures,
    ``figures_traceable`` compares declared figures against the source. Both are
    the same question — "is this the source number, written at this precision?"
    — and they must not answer it two different ways.
    """
    return 0.5 * (10.0**-decimals) + _FLOAT_EPSILON


def decimals_written(value: object) -> int:
    """How many decimal places a declared value committed to.

    ``277.78`` committed to two, ``4.0`` and ``100`` to none. Read off the
    shortest exact representation rather than the binary float, so a value that
    arrived as JSON is measured by what was written, not by what IEEE-754 made
    of it.
    """
    try:
        exponent = Decimal(str(value)).normalize().as_tuple().exponent
    except (ArithmeticError, ValueError, TypeError):
        return 0
    return max(0, -exponent) if isinstance(exponent, int) else 0


def value_justifies(token: NumericToken, figure_value: float, *, scale: float = 1.0) -> bool:
    """Is ``figure_value`` a legitimate origin for this prose token?

    Accepts an exact match, a match after applying the token's scale word, and
    a correct rounding to the precision the token used. Magnitude is compared
    without sign, because prose writes "fell 3.2%" for a delta of -3.2 — the
    magnitude must still exist in the declared figures, so nothing is invented.

    ``scale`` is the multiplier the figure's own UNIT carries, from
    :func:`unit_scale`. A figure of 4653 in "thousand passengers" is 4,653,000
    passengers, so "4.65 million passengers" is that figure written at the scale
    a reader reads. This widens by exactly the declared unit's factor and by
    nothing else: the quantity is unchanged, the factor is the pipeline's own
    rather than the model's, and every reading still has to round back to the
    source number. It is the same allowance the token side already has — the
    two sides of one equality, which is why they belong in one function.
    """
    tolerance = rendering_tolerance(token.decimals)
    magnitudes = [abs(figure_value)]
    if scale != 1.0:
        magnitudes.append(abs(figure_value * scale))

    for magnitude in magnitudes:
        for candidate in token.candidate_values():
            if abs(abs(candidate) - magnitude) <= tolerance:
                return True
            # A scaled token rounds at the scaled precision too: "€1.2bn" from
            # 1_234_000_000 is correct to one decimal place of a billion.
            if token.scale != 1.0 and magnitude != 0:
                if abs(magnitude / token.scale - abs(token.value)) <= tolerance:
                    return True
    return False


def _rendered_as_values(rendered_as: str | None) -> tuple[float, ...]:
    if not rendered_as:
        return ()
    return tuple(token.value for token in scan(rendered_as))


def is_justified(token: NumericToken, figures: Sequence[Mapping[str, object]]) -> bool:
    """True when some declared figure accounts for this prose token."""
    # (magnitude, scale) pairs. The scale is the figure's own unit's, so a
    # figure declared in "thousand passengers" justifies the prose that writes
    # it in millions. ``rendered_as`` carries no unit of its own, so it is
    # matched at face value.
    figure_values: list[tuple[float, float]] = []
    for figure in figures:
        value = figure.get("value")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        figure_values.append((float(value), unit_scale(_as_optional_str(figure.get("unit")))))
        figure_values.extend(
            (rendered, 1.0)
            for rendered in _rendered_as_values(_as_optional_str(figure.get("rendered_as")))
        )

    if any(value_justifies(token, value, scale=scale) for value, scale in figure_values):
        return True

    # Fall back to the split reading of a space-grouped run; every part must
    # then be accounted for, so this cannot launder an unjustified number.
    if token.components:
        return all(
            any(
                value_justifies(
                    NumericToken(
                        text=str(component),
                        value=component,
                        start=token.start,
                        end=token.end,
                        decimals=0,
                    ),
                    value,
                    scale=scale,
                )
                for value, scale in figure_values
            )
            for component in token.components
        )

    return False


def unjustified_tokens(
    text: str, figures: Sequence[Mapping[str, object]]
) -> tuple[NumericToken, ...]:
    """Every numeric token in ``text`` that no declared figure accounts for."""
    return tuple(token for token in scan(text) if not is_justified(token, figures))


def _as_optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def describe(tokens: Iterable[NumericToken]) -> str:
    """Render tokens for a rejection detail string."""
    return ", ".join(repr(token.text) for token in tokens)


__all__ = [
    "NumericToken",
    "decimals_written",
    "describe",
    "is_justified",
    "mask_excluded",
    "rendering_tolerance",
    "scan",
    "split_unit_scale",
    "unit_scale",
    "unjustified_tokens",
    "value_justifies",
]
