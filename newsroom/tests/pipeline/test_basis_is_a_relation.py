"""A basis is a relation between two quantities, not a vocabulary for one.

WHY THIS EXISTS
---------------
``comparison_basis_stated`` was a list of 24 phrases accumulated one rejection
at a time, and its own comments record three prior patch events. Measured
against 13 sentences — each verbatim from a generated draft or the minimal form
of one — it refused **8 that a reader would accept**, and 0 that a reader
would not:

===================================================  ==========
case                                                  refused?
===================================================  ==========
"rose from 52.8% to 61.2%"                            yes
"widened between 52.8% and 61.2%"                     yes
"an increase from the early average"                  yes
"rose to 21.1, up from 20.4"                          yes
"In comparison, Lithuania's rose to 2,435 …"          yes
"grew from 52.8% in 2024 to a new high"               yes
"Lithuania's stood at 2,435 … while Latvia's at 484"  yes
"an increase, sustained over 22 consecutive quarters" yes
===================================================  ==========

FOUR DEFECTS, AND ONLY ONE OF THEM IS VOCABULARY
------------------------------------------------
**A decimal point is not a full stop.** ``\\bfrom\\b[^.]{1,60}?\\bto\\b`` stops
at the "." in "52.8%", so ``from 52 to 61`` matched and ``from 52.8% to 61.2%``
did not — the same construction, and the decimal version is what an economic
series almost always produces. ``house_style._GAP`` and ``weekly._GAP`` are the
repaired expression, each carrying a comment saying exactly this, while the
*gate* kept the broken form. A shared fix applied to some consumers and not
others, in the one place it costs an article.

**A duration is not a magnitude.** "sustained over 22 consecutive quarters"
says how long, not how much, and the check treated the 22 as quantifying the
change — then demanded a basis for a claim that was never made.

**A period label is a reference point.** ``numeric_scan`` masks bare years by
design, so "grew from 52.8% in 2024" carried a reference the check could not
see.

**A cross-sectional comparison has no marker phrase at all.** "Lithuania's
stood at 2,435 thousand tonnes, while Latvia's was much lower at 484" states
its basis completely and contains no phrase any list could hold. This is the
one that proves the shape was wrong rather than incomplete.

WHY IT IS NOT "TWO NUMBERS MEANS A RELATION"
--------------------------------------------
That was the obvious structural rule and it is **worse than the check it would
replace**. Measured against four adversarial controls, it trades the 8 false
positives for 3 false negatives:

    "Electricity prices rose 12% in June, and unemployment stood at 6.6%."

Two figures, no basis. On a truth gate that is the worse trade. Co-occurrence
is not relation: the two magnitudes must be in **one sentence** and joined by a
connective that links two **subjects**.

And the connective set must not include a bare comparative adjective. An
earlier version did, and the existing suite caught it immediately —

    "settled at 142.5 euros per megawatt-hour, 12.0% higher"

carries two magnitudes and the word "higher" and is higher than *nothing*.
Those two figures are a level and its own delta. That case is in
``ADVERSARIAL`` below, because a rule that admits it is not usable.

MEASURED AFTER: 0 false positives and 0 false negatives across all 18 cases,
and every one of the 1889 pre-existing tests still passes.
"""

from __future__ import annotations

import pytest

from newsroom.validator import ValidationContext, check_comparison_basis_stated

#: A lead that states a basis, so each case is judged as a paragraph inside a
#: real article rather than as a one-paragraph fixture. Without it the
#: article-wide qualitative rule fires and every case looks refused — which is
#: correct behaviour for such an article and an artefact of the fixture.
LEAD = (
    "Road freight reached 1,951 thousand tonnes in 2016-Q4, compared with "
    "254.5 thousand tonnes a year earlier."
)


def verdict(*paragraphs, headline="A heading", dek=""):
    article = {
        "id": "01J0000000000000000000TEST",
        "tier": "A",
        "headline": headline,
        "dek": dek,
        "body": [{"type": "paragraph", "text": t, "figures": []} for t in paragraphs],
    }
    return check_comparison_basis_stated(
        ValidationContext(article=article, registry=None, personas=None)
    )


#: Each states a basis a reader would accept. Each was refused before this
#: change; every one is verbatim from a draft or the minimal form of one.
STATES_A_BASIS = [
    ("from/to across a decimal",
     "Prices rose from 52.8% to 61.2%."),
    ("between/and across a decimal",
     "The gap widened between 52.8% and 61.2%."),
    ("an origin without a destination",
     "Hourly labour cost rose to 21.1 EUR per hour, up from 20.4."),
    ("a period label beside a from/to",
     "Output grew from 52.8% in 2024 to a new high."),
    ("cross-sectional, joined by 'while'",
     "Lithuania's road freight level stood at 2,435 thousand tonnes, while "
     "Latvia's was much lower at 484 thousand tonnes."),
    ("'in comparison' with both values",
     "In comparison, Lithuania's road freight rose to 2,435 thousand tonnes "
     "while Latvia's stood at 484."),
    ("a duration is not a quantified change",
     "This marks a significant increase, sustained over 22 consecutive quarters."),
]

#: Each states NO basis. The check must keep refusing all of them, or the
#: repair has traded false positives for the failure that actually matters.
ADVERSARIAL = [
    ("a bare quantified change",
     "Electricity prices rose 12% in June."),
    ("two figures that relate to nothing",
     "Electricity prices rose 12% in June, and unemployment stood at 6.6%."),
    ("a change and a peer level, different sentences",
     "Latvian output increased 8.1%. Estonia's index stood at 130.9."),
    ("a change and a count",
     "Prices rose 12% across 40 observations."),
    ("two magnitudes, no comparison",
     "Output rose 12% and then 3%."),
    # The one the existing suite caught. Two magnitudes and the word "higher",
    # and higher than nothing: a level and its own delta.
    ("a level and its own delta",
     "Latvian day-ahead electricity settled at 142.5 euros per megawatt-hour, "
     "12.0% higher."),
    # A period label says WHEN a reading was taken, never what it is measured
    # against. A clause treating one as a basis was written for this change and
    # removed after measuring it: it was load-bearing for nothing true and
    # admitted all three of these.
    ("a bare year", "Output rose 12% in 2024."),
    ("a month and a year", "Electricity prices rose 12% in June 2026."),
    ("a year with 'during'", "Prices increased 8.1% during 2025."),
]


class TestAPeriodLabelIsNotABasis:
    """The clause I wrote, and then deleted on measurement.

    Dropping it changed no test — which is what an untested clause looks like,
    and is how a planted fault found it. Checking what it was actually doing
    showed it was admitting exactly the class this check exists to refuse.
    """

    def test_the_sentence_it_was_written_for_needs_something_else(self):
        # "grew from 52.8% in 2024 to a new high" is caught by `from … to`, so
        # the clause was never required for it.
        from newsroom.validator import _BASIS_PATTERNS

        text = "Output grew from 52.8% in 2024 to a new high."

        assert any(p.search(text) for p in _BASIS_PATTERNS)

    def test_a_bare_year_is_not_accepted_as_a_basis(self):
        # The behavioural guard, replacing an assertion that the symbol
        # ``_PERIOD_LABEL`` no longer exists. That one tested a NAME: a planted
        # clause written inline, with no such symbol, left it green while the
        # defect was fully restored. What matters is that the sentence is
        # refused, however the clause would be spelled.
        assert not verdict(LEAD, "Output rose 12% in 2024.").passed
        assert not verdict(LEAD, "Prices increased 8.1% during 2025.").passed


class TestItAcceptsABasisAReaderWouldAccept:
    @pytest.mark.parametrize("label,text", STATES_A_BASIS, ids=[c[0] for c in STATES_A_BASIS])
    def test_it_is_not_refused(self, label, text):
        assert verdict(LEAD, text).passed, label


class TestItStillRefusesWhatItMust:
    @pytest.mark.parametrize("label,text", ADVERSARIAL, ids=[c[0] for c in ADVERSARIAL])
    def test_a_baseless_change_is_refused_even_after_a_good_lead(self, label, text):
        # The lead is impeccable, so this cannot pass by the article-wide rule.
        # It is the paragraph's own claim that has no basis.
        result = verdict(LEAD, text)

        assert not result.passed, label
        assert "comparison basis" in result.detail

    def test_the_control_can_distinguish(self):
        # Companion to the two classes above: the check must be capable of both
        # answers on this fixture shape, or neither class proves anything.
        assert verdict(LEAD, "Unemployment fell to 6.6%, compared with 7.1% a "
                             "year earlier.").passed
        assert not verdict(LEAD, "Electricity prices rose 12% in June.").passed


class TestTheDecimalPointRepair:
    def test_the_same_construction_passes_with_and_without_a_decimal(self):
        # The defect in one line: only the decimal point differed.
        assert verdict(LEAD, "Prices rose from 52 to 61.").passed
        assert verdict(LEAD, "Prices rose from 52.8% to 61.2%.").passed

    def test_the_gate_uses_the_repaired_expression(self):
        # The repo held the fix twice and the gate held the bug. Asserted
        # against the pattern text so a regression to `[^.]` is caught here
        # rather than by an article dying in production.
        from newsroom.validator import _BASIS_PATTERNS

        spanning = [p.pattern for p in _BASIS_PATTERNS if "from" in p.pattern or "between" in p.pattern]
        assert spanning, "the spanning patterns disappeared"
        for pattern in spanning:
            if "{1,60}" in pattern:
                assert r"\.(?=\d)" in pattern, pattern


class TestTheCrossSectionalRule:
    def test_two_subjects_joined_by_a_connective_is_a_comparison(self):
        assert verdict(
            LEAD,
            "Lithuania's road freight stood at 2,435 thousand tonnes, while "
            "Latvia's was much lower at 484 thousand tonnes.",
        ).passed

    def test_the_same_two_figures_in_two_sentences_are_not(self):
        # One sentence is load-bearing. Split apart, these are two readings
        # reported side by side and nothing says one measures the other.
        assert not verdict(
            LEAD,
            "Latvian output increased 8.1%. Estonia's index stood at 130.9.",
        ).passed

    def test_a_bare_conjunction_is_not_a_comparison(self):
        assert not verdict(
            LEAD,
            "Electricity prices rose 12% in June, and unemployment stood at 6.6%.",
        ).passed
