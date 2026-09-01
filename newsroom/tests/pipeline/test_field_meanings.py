"""Every figure the writer is handed must say what it MEANS, not just what it is.

WHY THIS EXISTS
---------------
Measured against all 25 published tier A originals: four of them use one bare
English word for two or three different quantities. All four come from
``structural_divergence``, and there are exactly four ``structural_divergence``
articles — so the rate is 4 of 4, not 4 in 25. The live example::

    body[0]  "The gap ... has widened to 25,605 thousand tonnes"   signal_field: gap
    body[3]  "The recent gap of 27,471.1 thousand tonnes"          signal_field: recent_gap

A reader is told the gap is 25,605 and, three paragraphs later, that the recent
gap is 27,471.1. Both are true of their own field. Nothing in the prose says
what distinguishes them, and ``gap`` is the *latest quarter alone* while
``recent_gap`` is the *mean of the last eight*.

Every validator check passed, and correctly: ``figures_traceable`` reported
"8 figure(s) traced to the signal payload" and ``no_invented_numbers`` reported
"8 numeric token(s) all traced to declared figures". Both are true. The contract
protects figures, not subjects — a number can trace perfectly to a field whose
name in English the prose then reuses for a different field.

THE CAUSE, MEASURED RATHER THAN GUESSED
---------------------------------------
The writer's figure table gave a name, a number and a unit and nothing else, so
three different quantities arrived with three identical descriptions and the
writer had to invent English for each.

``detect_divergence`` emits the same shape of near-synonym pair — ``spread``
beside ``typical_spread`` — and *both* its published articles render it
correctly, because its comparison basis describes ``typical_spread`` as "the
median spread" and the writer copies that. The fields that go wrong are exactly
the ones no prose anywhere describes. So this is a missing input rather than a
discipline problem, and the remedy is an input, not a gate.

THE INVARIANT
-------------
Every field a detector emits carries a meaning, and no two fields of one signal
carry the same meaning. A check on the prose was considered and rejected: see
``test_a_sub_name_rule_would_reject_correct_work`` below, which measures why.
"""

from __future__ import annotations

import re

from newsroom.pipeline import units
from newsroom.pipeline.detect.detectors import (
    detect_seasonal_deviation,
    detect_sharp_move,
)
from newsroom.pipeline.field_meanings import FIELD_MEANINGS
from newsroom.pipeline.write.prompts import (
    FIELD_MEANINGS,
    _format_figures,
    meaning_for_field,
)
from newsroom.tests.pipeline.conftest import make_signal, monthly_periods, series_from
from newsroom.tests.pipeline.test_basis_declarable import (
    DETECTORS_UNDER_CONTRACT,
    all_detector_signals,
)


def _described_fields(signal):
    """The fields the writer is actually shown, in the order it sees them."""
    return [n for n in signal.fields if n not in units.INTERNAL_ONLY_FIELDS]


class TestEveryDetectorFieldIsDescribed:
    """Run the real detectors and check their real output."""

    def test_coverage_is_asserted_not_assumed(self):
        # Anti-vacuity. Every assertion below iterates whatever these detectors
        # happen to produce, so a fixture that stopped triggering its detector
        # would silently shrink the population while still reporting green —
        # and a guard that walks a smaller set than its subject is unguarded
        # everywhere in the gap.
        produced = all_detector_signals()
        assert {name for name, _ in produced} == DETECTORS_UNDER_CONTRACT
        for name, signal in produced:
            assert _described_fields(signal), f"{name} emitted no visible fields"

    def test_every_field_a_detector_emits_carries_a_meaning(self):
        missing = []
        for name, signal in all_detector_signals():
            for field in _described_fields(signal):
                if meaning_for_field(signal, field) is None:
                    missing.append(f"{name}.{field}")

        assert missing == [], (
            "these fields reach the writer as a bare name and a unit, which is "
            f"what produced the published gap/recent_gap collision: {missing}"
        )

    def test_no_two_fields_of_one_signal_share_a_meaning(self):
        # Distinct quantities described identically are the same defect one
        # step later: the writer still has nothing to tell them apart.
        clashes = []
        for name, signal in all_detector_signals():
            seen: dict[str, str] = {}
            for field in _described_fields(signal):
                meaning = meaning_for_field(signal, field)
                if meaning is None:
                    continue
                if meaning in seen:
                    clashes.append(f"{name}: {seen[meaning]} and {field}")
                seen[meaning] = field

        assert clashes == []

    def test_a_meaning_never_supplies_a_numeral(self):
        # A meaning is prose the writer reads and may quote. Only fields are
        # declarable, so a digit here is a digit the validator will reject the
        # article for — and it would arrive looking like something we told it
        # to say. Period labels are exempt: the prompt already licenses those
        # verbatim, and they are how a window is named at all.
        offenders = []
        for name, signal in all_detector_signals():
            for field in _described_fields(signal):
                meaning = meaning_for_field(signal, field)
                if meaning is None:
                    continue
                stripped = meaning.replace(signal.period, "")
                if re.search(r"\d", stripped):
                    offenders.append(f"{name}.{field}: {meaning}")

        assert offenders == []


class TestTheStructuralDivergenceCollision:
    """The four published articles, at the point where they went wrong."""

    @staticmethod
    def _signal():
        found = [s for n, s in all_detector_signals() if n == "structural_divergence"]
        assert found, "the detector stopped firing, so this proves nothing"
        return found[0]

    def test_the_bare_generic_name_is_gone(self):
        # "gap" is the head noun that early_gap and recent_gap also use, so the
        # unmodified form stops picking out a quantity the moment the modified
        # ones exist. The correct name was already in the detector, as the
        # local variable the field was read from.
        signal = self._signal()

        assert "gap" not in signal.fields
        assert "latest_gap" in signal.fields

    def test_each_gap_states_which_periods_it_covers(self):
        # The names cannot carry this and must not be relied on to: "latest"
        # and "recent" are near-synonyms in ordinary English, which is why the
        # rename alone would not have been enough.
        signal = self._signal()
        period_word = "quarters"

        latest = meaning_for_field(signal, "latest_gap")
        early = meaning_for_field(signal, "early_gap")
        recent = meaning_for_field(signal, "recent_gap")

        assert signal.period in latest and "ALONE" in latest
        assert "AVERAGE" in early and period_word in early
        assert "AVERAGE" in recent and period_word in recent
        assert len({latest, early, recent}) == 3

    def test_a_country_level_is_not_describable_as_a_gap(self):
        # Two published articles rendered a country's own reading as that
        # country's "gap" — "Lithuania's transport services balance gap stands
        # at 1,273.1" is value_lt, a level.
        signal = self._signal()

        for field in ("value_lv", "value_ee", "value_lt", "highest_value"):
            meaning = meaning_for_field(signal, field)
            assert meaning is not None
            assert "NOT a gap" in meaning

    def test_a_count_of_quarters_is_not_a_quantity_of_cargo(self):
        # The figure table offered "window_periods = 8 (thousand tonnes)" and
        # "widening_ratio = 6.47 (thousand tonnes)". units.py exists to stop
        # exactly that and says so in its own docstring; its suffix rule closes
        # the class for _count and _length, and this detector emits neither.
        signal = self._signal()

        assert units.label_for_field(
            "window_periods", signal.unit, overrides=signal.field_units
        ) == "quarters"
        assert units.label_for_field(
            "widening_ratio", signal.unit, overrides=signal.field_units
        ) == "times"
        assert signal.unit not in _format_figures(signal).split("window_periods")[1].split("\n")[0]


class TestTheGuardCanFail:
    """An assertion that something is absent needs a companion proving it
    could have been present. Otherwise it passes on a subject that never had
    the thing at all."""

    def test_an_undescribed_field_is_reported_as_undescribed(self):
        signal = make_signal(
            detector="record_extreme",
            fields={"latest_value": 6.8, "invented_field": 1.0},
        )

        assert meaning_for_field(signal, "latest_value") is not None
        assert meaning_for_field(signal, "invented_field") is None

    def test_a_meaning_does_not_leak_across_detectors(self):
        # Keyed by detector as well as field. Two detectors may use one name
        # for different quantities, and a name-only registry would quietly
        # describe one of them with the other's meaning.
        record = make_signal(detector="record_extreme", fields={"margin": 0.3})
        streak = make_signal(detector="streak", fields={"margin": 0.3})

        assert meaning_for_field(record, "margin") is not None
        assert meaning_for_field(streak, "margin") is None

    def test_the_meaning_reaches_the_writer_verbatim(self):
        # The registry is only worth anything if _format_figures prints it.
        # Asserting the registry alone would pass with the call site deleted.
        signal = make_signal(detector="record_extreme", fields={"latest_value": 6.8})

        rendered = _format_figures(signal)

        assert meaning_for_field(signal, "latest_value") in rendered

    def test_a_sub_name_rule_would_reject_correct_work(self):
        """Why there is no prose check here, measured rather than asserted.

        The tempting structural rule is: no field name may be a word-boundary
        sub-name of another field in the same unit. It catches the real defect
        — ``gap`` inside ``early_gap`` and ``recent_gap``. It also fires on
        ``divergence``, whose published articles are correct. A check that
        rejects true work is a worse defect than the one it was built to catch,
        so the fix is the meaning, not a gate.

        THE UNIT ARTEFACT, AND ITS DISAPPEARANCE. This test used to record two
        more flags — ``("spread", "spread_pct")`` on ``divergence`` and
        ``("margin", "margin_pct")`` on ``record_extreme`` — and argued they
        were "an artefact of the series' own unit rather than of the field
        names", because ``spread_pct`` is "%" whatever the series is and so
        collided with ``spread`` only when the series was itself in "%", as
        both those fixtures are. The closing line was that a rule firing on one
        series and not another for the same field names "is not describing a
        property of the code".

        That reasoning was right and it is now enforced rather than believed.
        ``unit_for_field`` gives an absolute difference across a rate series its
        own unit — ``spread`` is "percentage points", ``spread_pct`` is "%" —
        so the two no longer share one and the artefact cannot arise. Both
        flags went of their own accord; neither was excepted.

        What is left on ``divergence`` is the genuine article: ``spread`` and
        ``typical_spread`` are BOTH absolute differences, so they share a unit
        on every series, in "%" and in tonnes alike. It is a property of the
        names, which is exactly the case the docstring above says a rule may
        not distinguish from the real defect.

        The exact figures below are the measurement, and the first draft of
        this test asserted one pair for ``divergence`` where there were two.
        Running it is what corrected that, which is the whole argument for
        executing an example rather than writing one down.
        """

        def sub_names(signal):
            out = []
            for a in signal.fields:
                for b in signal.fields:
                    ta, tb = a.split("_"), b.split("_")
                    if a == b or ta == tb or len(ta) >= len(tb):
                        continue
                    if not any(tb[i:i + len(ta)] == ta for i in range(len(tb) - len(ta) + 1)):
                        continue
                    ua = units.unit_for_field(a, signal.unit, overrides=signal.field_units)
                    ub = units.unit_for_field(b, signal.unit, overrides=signal.field_units)
                    if ua == ub:
                        out.append((a, b))
            return out

        by_detector = {n: sub_names(s) for n, s in all_detector_signals()}

        # The detector the rule would still flag, whose published articles are
        # correct: two absolute differences, colliding on any series.
        assert by_detector["divergence"] == [("spread", "typical_spread")]
        # Was [("margin", "margin_pct")] while a difference across a rate series
        # was labelled "%". Both fields are on a "%" fixture, so this is the
        # controlled half: the flag went because the units diverged, not because
        # anything about the names changed.
        assert by_detector["record_extreme"] == []
        # And the one it was aimed at, clean because the bare name is gone.
        assert by_detector["structural_divergence"] == []



class TestTheRegistryIsNotAWordList:
    def test_meanings_are_keyed_by_detector(self):
        # A registry keyed on field name alone is a word list wearing a
        # dictionary's clothes: it encodes the examples its author thought of
        # and silently mis-describes the next detector to reuse a name.
        assert set(FIELD_MEANINGS) <= DETECTORS_UNDER_CONTRACT
        assert "structural_divergence" in FIELD_MEANINGS

    def test_per_geography_fields_are_matched_by_shape(self):
        # value_lv, value_ee, value_lt are emitted per geography and cannot be
        # enumerated. A signal for a country the registry never heard of must
        # still describe its level.
        signal = make_signal(
            detector="divergence",
            fields={"value_pl": 1.0},
            context={"frequency": "quarterly"},
        )

        meaning = meaning_for_field(signal, "value_pl")

        assert meaning is not None
        assert "PL" in meaning


class TestThePercentFieldsSayTheyAreMagnitudes:
    """A ``*_pct`` field is always positive; its base field carries the sign.

    That convention is real, exceptionless and was undocumented, and the writer
    is the party that has to know it. Two live consequences, one each way:

    - ``estonia-s-june-2026-electricity-production...`` declared ``deviation``
      as ``130.97`` when the field is ``-130.969``, tripped ``figures_traceable``
      and was **spiked** -- the writer treating a signed field like a ``_pct``
      one.
    - ``estonia-s-unemployment-rate-declines...`` published prose reading
      "a deviation of -6.71378%" against ``deviation_pct = +6.71378`` -- the
      writer re-signing an unsigned field. True, as it happens, and the figure
      and the prose disagree in sign regardless.

    The brief said "that same distance as a percentage", which actively implies
    the base field's sign convention carries over. It does not.

    This is the same argument ``field_meanings``' own ``divergence`` block makes
    for a different distinction: it "is invisible in the number and is the one
    the pipeline keeps losing".
    """

    def test_a_falling_series_yields_a_negative_base_and_a_positive_percentage(self):
        base = [
            10.0 + (month % 3) * 0.5 + (year % 2) * 0.2
            for year in range(4)
            for month in range(12)
        ]
        values = base + [3.0]
        signal = detect_seasonal_deviation(
            series_from(values, periods=monthly_periods(len(values)))
        )

        assert signal is not None, "the fixture stopped tripping the detector"
        assert signal.fields["deviation"] < 0, "the base field must carry the sign"
        assert signal.fields["deviation_pct"] > 0, (
            "deviation_pct is documented to readers and to the writer as a "
            "magnitude; a signed value here makes the brief wrong"
        )
        assert signal.context["direction"] == "below"

    def test_the_same_holds_for_a_sharp_move_down(self):
        values = [10.0, 10.2, 9.9, 10.1, 10.0, 9.8, 10.3, 10.0, 9.9, 10.1, 10.0, 4.0]
        signal = detect_sharp_move(
            series_from(values, periods=monthly_periods(len(values)))
        )

        assert signal is not None, "the fixture stopped tripping the detector"
        assert signal.fields["change"] < 0
        assert signal.fields["change_pct"] > 0

    def test_every_percentage_field_the_brief_describes_says_it_is_positive(self):
        """The population is every ``*_pct`` in FIELD_MEANINGS, not the four I
        happened to look at. A new one added without the note fails here rather
        than in an article."""
        described = {
            f"{detector}.{field}": text
            for detector, fields in FIELD_MEANINGS.items()
            for field, text in fields.items()
            if field.endswith("_pct")
        }
        silent = sorted(k for k, text in described.items() if "positive" not in text.lower())

        assert described, "no _pct fields found; this assertion would pass vacuously"
        assert silent == [], (
            "a percentage field is described without saying it is a magnitude, "
            "which is what sent a writer to declare a signed field's absolute "
            f"value and lose the article: {silent}"
        )
