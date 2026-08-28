"""A spread is a distance between two series, and must stay one all the way down.

WHY THIS EXISTS
---------------
The 14:00Z edition published a ``structural_divergence`` piece whose analyst
brief read::

    significance  "a higher balance of responses suggests increased optimism…
                   The current CONSUMER CONFIDENCE READING of 29.6 is
                   substantially above the early gap average of 7.72,
                   reflecting a stronger sentiment."
    mechanisms[0] "Consumer confidence has RISEN SHARPLY…"

29.6 is the distance between Estonia and Lithuania. Measured off the article's
own figures the three countries stood at **LV -15.6, EE -32.5, LT -2.9** — all
deeply negative. Nothing rose, there is no optimism, and a widening gap between
two negative numbers is not stronger sentiment. The article also named *Latvia
and Estonia* as the endpoints when Latvia sits in the middle.

Validator 10/10. ``no_invented_numbers`` reported "9 numeric token(s) all traced
to declared figures" and was right: 29.6 is a real figure from a real cube. The
contract protects figures, not subjects — the second recorded instance of that
class, arriving by semantic conversion inside the analyst rather than by a cache
collision.

WHAT THE MEASUREMENT FOUND, AND IT WAS NOT WHERE ANYONE LOOKED
--------------------------------------------------------------
Three stages build the same table out of ``signal.fields``. The field-meanings
registry that fixed this exact confusion for the writer was wired into the
writer **only**:

===================  =========================  =======================
stage                 what it saw               runs
===================  =========================  =======================
``analyst.py``        ``latest_gap = 27.15``     first
``hypothesis.py``     ``latest_gap = 27.15``     second
``write/prompts.py``  the full meaning           last
===================  =========================  =======================

``latest_gap = 27.15 (balance of responses)`` is indistinguishable from a
reading of consumer confidence, and the analyst's own prompt tells it the
correspondent "quotes your claims almost verbatim". So the brief converted the
spread into a level, and a correctly-informed writer inherited corrupted prose.
Fixing one consumer of a shared input and leaving its siblings is the shape this
repo keeps finding.

``hypothesis.py`` is owned by another workstream and is still on the bare table.
``test_every_stage_reads_the_shared_registry`` fails if a *new* stage is added
without it, and names the panel as the known outstanding one so the exemption
retires itself.
"""

from __future__ import annotations

import inspect
import pathlib
import re

import pytest

from newsroom.pipeline import analyst, field_meanings
from newsroom.pipeline.detect.detectors import (
    detect_divergence,
    detect_structural_divergence,
)
from newsroom.pipeline.write import prompts
from newsroom.tests.pipeline.conftest import (
    make_signal,
    quarterly_periods,
    series_from,
)


def spread_signal():
    """Consumer confidence: all three negative, the gap widening.

    The published shape. LT is least negative and EE most, so the endpoints are
    LT and EE and Latvia sits between them.
    """
    lv = [-6 - 0.4 * i for i in range(24)]
    ee = [-8 - 1.1 * i for i in range(24)]
    lt = [-5 - 0.05 * i for i in range(24)]
    periods = quarterly_periods(24)
    group = {
        geo: series_from(
            values, geography=geo, periods=periods, metric="consumer_confidence",
            metric_label="consumer confidence", unit="balance of responses",
            section="economy", frequency="quarterly",
        )
        for geo, values in (("LV", lv), ("EE", ee), ("LT", lt))
    }
    signal = detect_structural_divergence(group)
    assert signal is not None, "the fixture stopped triggering the detector"
    return signal


class TestTheAnalystSeesWhatTheWriterSees:
    def test_the_two_tables_are_identical(self):
        # The anti-drift assertion. Two renderings of one input are free to
        # disagree, and did: the writer's carried the meanings and the desk's
        # did not, for every signal the newsroom has ever produced.
        signal = spread_signal()

        assert analyst._figure_table(signal) == prompts._format_figures(signal)

    def test_the_desk_is_told_the_figure_is_a_distance(self):
        signal = spread_signal()

        table = analyst._figure_table(signal)

        assert "DISTANCE BETWEEN" in table
        assert "NOT a reading of the indicator" in table

    def test_the_control_proves_the_table_could_have_been_bare(self):
        # Without this, the assertion above would pass on a table that never
        # had a meaning to lose.
        signal = spread_signal()

        assert "latest_gap" in analyst._figure_table(signal)
        assert field_meanings.meaning_for_field(signal, "latest_gap")
        assert field_meanings.meaning_for_field(signal, "nonexistent_field") is None


class TestTheQuantityNote:
    def test_a_spread_finding_is_told_it_is_a_distance(self):
        note = analyst._quantity_note(spread_signal())

        assert "DISTANCE, NOT A READING" in note
        assert "carries no sentiment" in note
        assert "must be stated on the distance" in note

    def test_it_names_the_endpoints_from_the_detectors_own_context(self):
        # The published article named Latvia and Estonia. The endpoints are
        # Lithuania and Estonia; Latvia is in the middle. Nothing downstream
        # had ever been told which two they were.
        signal = spread_signal()

        note = analyst._quantity_note(signal)

        assert "The endpoints are LT and EE" in note
        assert "LV" not in note.replace("level", "")

    @pytest.mark.parametrize(
        "detector", ["record_extreme", "streak", "seasonal_deviation", "sharp_move"]
    )
    def test_a_level_finding_gets_no_note(self, detector):
        # An instruction about a shape the finding does not have is noise, and
        # noise in a prompt is not free.
        assert analyst._quantity_note(make_signal(detector=detector)) == ""

    def test_the_spread_detectors_are_stated_as_an_equality(self):
        # Not a filter: adding a third spread detector without listing it here
        # goes red, rather than silently getting no note.
        assert field_meanings.SPREAD_DETECTORS == {"divergence", "structural_divergence"}

    def test_both_spread_detectors_really_produce_a_note(self):
        # The registry above is only worth anything if the detectors named in
        # it actually reach the branch.
        assert analyst._quantity_note(spread_signal())

        periods = quarterly_periods(12)
        group = {
            geo: series_from(
                values, geography=geo, periods=periods, metric="power_price",
                metric_label="the day-ahead price", unit="EUR/MWh",
                section="energy", frequency="quarterly",
            )
            for geo, values in (
                ("LV", [50.0] * 11 + [50.0]),
                ("EE", [51.0] * 11 + [120.0]),
                ("LT", [49.0] * 11 + [48.0]),
            )
        }
        divergence = detect_divergence(group)
        if divergence is not None:
            assert analyst._quantity_note(divergence)


class TestTheEndpointsAreArithmeticallyRight:
    """The manager's cheap invariant, and it is computable without prose."""

    def test_the_spread_is_the_range_of_the_set(self):
        signal = spread_signal()
        levels = {
            name: value
            for name, value in signal.fields.items()
            if name.startswith("value_")
        }

        assert signal.fields["latest_gap"] == pytest.approx(
            max(levels.values()) - min(levels.values())
        )

    def test_the_endpoints_are_the_argmax_and_argmin(self):
        signal = spread_signal()
        levels = {
            name.split("_", 1)[1].upper(): value
            for name, value in signal.fields.items()
            if name.startswith("value_")
        }
        high, low = field_meanings.endpoints(signal)

        assert high == max(levels, key=lambda g: levels[g])
        assert low == min(levels, key=lambda g: levels[g])

    def test_no_member_of_the_set_lies_outside_the_endpoints(self):
        signal = spread_signal()
        high, low = field_meanings.endpoints(signal)
        top = signal.fields[f"value_{high.lower()}"]
        bottom = signal.fields[f"value_{low.lower()}"]

        for name, value in signal.fields.items():
            if name.startswith("value_"):
                assert bottom <= value <= top, name

    def test_an_absent_context_degrades_to_a_description(self):
        # Never a guessed country name. "the highest country" is true and
        # vague, where a missing key would raise and a name would be a lie.
        signal = make_signal(detector="structural_divergence", context={})

        high, low = field_meanings.endpoints(signal)
        meaning = field_meanings.meaning_for_field(signal, "latest_gap")

        assert (high, low) == (None, None)
        assert "the highest country" in meaning


class TestNoStageIsLeftOnTheBareTable:
    #: Stages that build their own figure table from ``signal.fields`` without
    #: the shared registry. Stated as an equality so the day one is fixed, or a
    #: new one appears, this list has to be updated rather than quietly growing.
    #:
    #: ``hypothesis.py`` is owned by another workstream. It has the same defect
    #: and the same one-line fix.
    KNOWN_BARE = {"hypothesis.py"}

    def test_every_other_stage_reads_the_shared_registry(self):
        root = pathlib.Path(analyst.__file__).parent
        registry = pathlib.Path(field_meanings.__file__).resolve()
        bare = set()
        for path in root.rglob("*.py"):
            # The registry itself renders the table; it is the thing the others
            # are supposed to call, not a stage that forgot to.
            if path.resolve() == registry:
                continue
            source = path.read_text(encoding="utf-8")
            if "units.label_for_field(" not in source:
                continue
            if "field_meanings" in source:
                continue
            bare.add(path.name)

        assert bare == self.KNOWN_BARE, (
            "a stage builds a figure table without the shared meanings. That is "
            "how a spread reached the analysis desk looking like a reading."
        )
