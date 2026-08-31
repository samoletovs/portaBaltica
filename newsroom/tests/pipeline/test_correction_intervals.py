"""An interval stated in a correction must equal the one its own periods give.

WHY THIS FILE EXISTS
--------------------
A correction is read by someone who already believes we got something wrong,
on the one surface that exists to earn that trust back. A wrong figure *inside*
a correction is therefore the most expensive kind there is — and it is beyond
every gate the newsroom has. The validator does not read ``PENDING``,
``numeric_scan`` never sees these strings, and the note tests assert that a
notice **names** the faults rather than that its arithmetic is right.

It has now happened twice, from one inherited phrase, with two different wrong
numbers:

    published, live on the daily article
      "it is the change since 2022-S2, four and a half years LATER"
      later than `named_span` = 2016-S1, so the true interval is 6.5 years

    caught in review, before merge
      "is 2022-S2, four and a half years EARLIER"
      earlier than the 2025-S2 reading, so the true interval is 3.0 years

The second was copied from the first — from the ``ELECTRICITY`` fixture that
pins the published text — which is why one phrase produced two errors. Neither
is reachable from any test of a figure, because there is no figure: an interval
in prose binds to no signal field.

WHAT THIS CHECKS, AND WHY IT IS NOT A WORD LIST
------------------------------------------------
Every interval a correction states is derived from **two periods that are
already in the note**. So the check computes the interval from those two labels
and asserts the note says it. Nothing is parsed out of the prose and no
vocabulary of time-words is maintained; the arithmetic is the rule.

``_years_between`` abstains — returns ``None`` — on labels whose shapes differ
or which it does not recognise, so an unknown cadence is silence rather than a
confident zero.
"""

from __future__ import annotations

import re

import pytest

from newsroom.pipeline.corrections import WEEKLY_WRAP_BASIS
from newsroom.tests.pipeline.test_scope_correction import ELECTRICITY

#: How many periods make a year, by label shape. A label whose shape is not
#: here yields ``None`` rather than a guess.
_PER_YEAR = {
    "S": 2,
    "Q": 4,
    "M": 12,
    "A": 1,
}


def _shape_and_index(period: str) -> tuple[str, int] | None:
    """``("S", n)`` for 2022-S2, ``("Q", n)`` for 2026-Q2, and so on."""
    text = period.strip().upper()
    for shape, pattern in (
        ("S", r"^(\d{4})-S([12])$"),
        ("Q", r"^(\d{4})-Q([1-4])$"),
        ("M", r"^(\d{4})-(0[1-9]|1[0-2])$"),
        ("A", r"^(\d{4})$"),
    ):
        match = re.match(pattern, text)
        if match:
            year = int(match.group(1))
            step = int(match.group(2)) - 1 if match.lastindex and match.lastindex > 1 else 0
            return shape, year * _PER_YEAR[shape] + step
    return None


def _years_between(a: str, b: str) -> float | None:
    """Years between two period labels, or ``None`` when it cannot be said.

    Both labels must be the same shape: the distance between ``2022-S2`` and
    ``2026-Q2`` is a question about two different calendars, and answering it
    with a number would be exactly the confident guess this file exists to
    stop.
    """
    first, second = _shape_and_index(a), _shape_and_index(b)
    if first is None or second is None or first[0] != second[0]:
        return None
    return abs(second[1] - first[1]) / _PER_YEAR[first[0]]


#: The English this newsroom writes for a whole or half-year interval. Small and
#: closed because a correction only ever states short, round intervals; anything
#: outside it is a number the note should not be phrasing in words at all.
_WORDS = {
    0.5: "half a year",
    1.0: "one year",
    1.5: "one and a half years",
    2.0: "two years",
    2.5: "two and a half years",
    3.0: "three years",
    3.5: "three and a half years",
    4.0: "four years",
    4.5: "four and a half years",
    5.0: "five years",
    5.5: "five and a half years",
    6.0: "six years",
    6.5: "six and a half years",
    7.0: "seven years",
    7.5: "seven and a half years",
    8.0: "eight years",
    9.5: "nine and a half years",
    18.0: "eighteen years",
}


class TestTheArithmeticItself:
    """A guard whose own maths is wrong reports the code as broken and the
    prose as fine, so the maths is measured first."""

    @pytest.mark.parametrize(
        "a,b,expected",
        [
            ("2022-S2", "2025-S2", 3.0),
            ("2016-S1", "2022-S2", 6.5),
            ("2016-S1", "2025-S2", 9.5),
            ("2007-S2", "2025-S2", 18.0),
            ("2018", "2025", 7.0),
            ("2025-Q1", "2026-Q2", 1.25),
            ("2021-08", "2022-08", 1.0),
        ],
    )
    def test_it_counts_periods_not_calendar_years(self, a, b, expected):
        assert _years_between(a, b) == expected

    def test_it_is_symmetric(self):
        assert _years_between("2022-S2", "2025-S2") == _years_between("2025-S2", "2022-S2")

    @pytest.mark.parametrize(
        "a,b",
        [
            ("2022-S2", "2026-Q2"),  # two different calendars
            ("2022-S2", "2025"),  # semi-annual against annual
            ("2022-S2", "nonsense"),
            ("", "2025-S2"),
        ],
    )
    def test_it_abstains_rather_than_guessing(self, a, b):
        """Absence resolves to silence. A number here would be the confident
        guess the file exists to stop."""
        assert _years_between(a, b) is None


class TestTheWeeklyWrapNoteStatesIntervalsItsOwnPeriodsSupport:
    """The note under review. Both intervals are computed, not recalled."""

    @pytest.mark.parametrize(
        "basis,reading,why",
        [
            ("2022-S2", "2025-S2", "the electricity basis against the reading"),
            ("2018", "2025", "the renewables basis against the reading"),
        ],
    )
    def test_each_stated_interval_equals_the_computed_one(self, basis, reading, why):
        years = _years_between(basis, reading)

        assert years is not None, why
        assert _WORDS[years] in WEEKLY_WRAP_BASIS.description, (
            f"{why}: the note should say {_WORDS[years]!r} for {basis}..{reading}"
        )

    def test_it_does_not_carry_the_inherited_wrong_phrase(self):
        """MUTATION THIS CATCHES: copying `four and a half years` from the
        published note, which is how this note acquired it in the first place.
        """
        assert "four and a half" not in WEEKLY_WRAP_BASIS.description


class TestThePublishedNoteIsWrongAndThisRecordsIt:
    """`span_correction_note(**ELECTRICITY)` is LIVE and states an interval its
    own periods do not support.

    Written as an EQUALITY against the wrong value rather than as a skip, per
    ``AGENTS.md``: an exemption stated as a subtraction cannot notice that it
    has stopped matching, and this one must retire itself the moment the
    published note is put right. Correct the note and this test goes red, which
    is the only version of this that cannot be forgotten.

    Not corrected here. The apparatus is append-only and that note is already
    on a live article and in the public log, so changing the fixture would
    append a SECOND notice rather than repair the first. What to do about it is
    an editorial decision, not a test fixture edit.
    """

    #: ``actual_span`` is measured from ``named_span``, which is what the
    #: builder's "later" refers to.
    NAMED_SPAN = "2016-S1"
    ACTUAL_SPAN = "2022-S2"

    def test_the_true_interval_is_six_and_a_half_years(self):
        assert _years_between(self.NAMED_SPAN, self.ACTUAL_SPAN) == 6.5

    def test_the_fixture_still_states_the_wrong_one(self):
        """Pinned so that fixing it fails here and forces this class to go."""
        assert ELECTRICITY["actual_span"] == "2022-S2, four and a half years later"

    def test_and_the_right_phrase_is_absent(self):
        years = _years_between(self.NAMED_SPAN, self.ACTUAL_SPAN)

        assert _WORDS[years] not in ELECTRICITY["actual_span"], (
            "the published note now states the correct interval — delete this "
            "class, it has done its job"
        )
