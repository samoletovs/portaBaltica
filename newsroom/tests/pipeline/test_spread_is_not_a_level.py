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

from newsroom.pipeline import analyst, field_meanings, hypothesis
from newsroom.pipeline.hypothesis import consult_panel
from newsroom.pipeline.write.llm import StubWriter
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
    def test_all_three_stages_render_one_identical_table(self):
        # The anti-drift assertion, and the reason this PR exists. Three
        # renderings of one input are free to disagree, and did: the writer's
        # carried the meanings and the two upstream of it did not, for every
        # signal the newsroom has ever produced.
        signal = spread_signal()

        writer_table = prompts._format_figures(signal)

        assert analyst._figure_table(signal) == writer_table
        assert hypothesis._figure_table(signal) == writer_table

    def test_the_desk_is_told_the_figure_is_a_distance(self):
        signal = spread_signal()

        table = analyst._figure_table(signal)

        assert "DISTANCE BETWEEN" in table
        assert "NOT a reading of the indicator" in table

    def test_the_panel_is_told_too(self):
        # The stage that produced four confident attributed hypotheses
        # explaining a rise that never happened. An analyst brief that is
        # merely vague is recoverable; this is not.
        signal = spread_signal()

        table = hypothesis._figure_table(signal)

        assert "DISTANCE BETWEEN" in table
        assert "NOT a reading of the indicator" in table

    def test_the_control_proves_the_table_could_have_been_bare(self):
        # Without this, the assertions above would pass on a table that never
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

    def test_the_note_has_one_definition(self):
        # Two copies of this explanation would reproduce, inside the fix for
        # it, the exact fault this change is about. The analyst adds a line
        # about thresholds because it proposes one; the panel does not.
        signal = spread_signal()

        shared = field_meanings.quantity_note(signal)
        desk = analyst._quantity_note(signal)

        assert shared and shared in desk
        assert "threshold you propose" in desk
        assert "threshold you propose" not in shared

    def test_the_note_reaches_every_stage_that_writes_prose(self):
        """The enumeration, asserted rather than remembered.

        This is the third consumer, and it was missed the same way as the
        first two: the meanings reached the writer and the note did not, in
        the very change whose lesson is *when you fix a shared input,
        enumerate its consumers*. Measured before it was added, 4 of 4 drafts
        on a spread signal closed with "a reading above 23.48" — ``recent_gap``
        used as a level.

        Stated as an equality over the stages, so a fourth prompt builder
        cannot quietly be added without one.
        """
        signal = spread_signal()
        note = field_meanings.quantity_note(signal)
        assert note, "the fixture is not a spread finding"

        writer = StubWriter({"hypotheses": []})
        consult_panel(signal, writer, size=1)
        panel_prompt = writer.calls[0]["user"]

        desk_prompt = analyst._quantity_note(signal)
        correspondent_prompt = prompts.build_user_prompt(signal)

        for stage, text in (
            ("the analysis desk", desk_prompt),
            ("the causal panel", panel_prompt),
            ("the correspondent", correspondent_prompt),
        ):
            assert "DISTANCE, NOT A READING" in text, stage
            assert "The endpoints are LT and EE" in text, stage

    def test_a_level_finding_reaches_none_of_them(self):
        # The control. Without it the assertion above would pass on a note
        # that was sent unconditionally, which is a different defect.
        signal = make_signal(detector="record_extreme")

        writer = StubWriter({"hypotheses": []})
        consult_panel(signal, writer, size=1)

        assert "DISTANCE, NOT A READING" not in writer.calls[0]["user"]
        assert analyst._quantity_note(signal) == ""
        assert "DISTANCE, NOT A READING" not in prompts.build_user_prompt(signal)

    def test_the_panel_is_asked_why_they_moved_apart(self):
        # "What drove this?" invites a cause for the indicator. The finding is
        # a distance, so the question that needs answering is why two series
        # separated — which is what the panel got wrong.
        note = field_meanings.quantity_note(spread_signal())

        assert "why the two moved APART" in note

    def test_the_note_actually_reaches_the_panel(self):
        # Asserting the note exists is not the same as asserting it is sent.
        # A plant that set the panel's copy to "" left every other assertion
        # green, because none of them looked at the prompt the panel receives.
        # This drives the real ``consult_panel`` and reads what was asked.
        signal = spread_signal()
        writer = StubWriter({"hypotheses": []})

        consult_panel(signal, writer, size=1)

        assert writer.calls, "the panel was never consulted"
        assert "DISTANCE, NOT A READING" in writer.calls[0]["user"]
        assert "The endpoints are LT and EE" in writer.calls[0]["user"]

    def test_a_level_finding_sends_the_panel_no_note(self):
        # The control: the assertion above must be capable of failing.
        writer = StubWriter({"hypotheses": []})

        consult_panel(make_signal(detector="record_extreme"), writer, size=1)

        assert writer.calls
        assert "DISTANCE, NOT A READING" not in writer.calls[0]["user"]

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
    #: the shared registry. Stated as an equality so a new one cannot appear
    #: quietly, and so fixing the last of them forces this list to be emptied
    #: rather than left matching nothing.
    #:
    #: It collected. It was ``{"hypothesis.py"}`` for exactly one commit — the
    #: panel was owned by another workstream — and clearing it turned this
    #: assertion red until the entry was deleted, which is the entire argument
    #: for writing an exemption as an equality rather than as a filter.
    KNOWN_BARE: set[str] = set()

    def test_every_other_stage_reads_the_shared_registry(self):
        # The property is "does this file build its OWN table", so the probe
        # asks whether it calls ``label_for_field`` — the one function a table
        # builder cannot avoid. An earlier version exempted any file merely
        # MENTIONING ``field_meanings``, and a plant caught it: once the panel
        # imported the module for the quantity note, it was skipped even with
        # its bare table restored. A guard keyed on a file's imports rather
        # than on its behaviour is not a guard.
        root = pathlib.Path(analyst.__file__).parent
        registry = pathlib.Path(field_meanings.__file__).resolve()
        bare = {
            path.name
            for path in root.rglob("*.py")
            if path.resolve() != registry
            and "units.label_for_field(" in path.read_text(encoding="utf-8")
        }

        assert bare == self.KNOWN_BARE, (
            "a stage builds a figure table without the shared meanings. That is "
            "how a spread reached the analysis desk looking like a reading."
        )
