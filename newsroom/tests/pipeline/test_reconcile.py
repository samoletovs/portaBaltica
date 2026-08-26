"""Reconciliation may only ever declare a number the detector already verified.

The safety argument for this module is narrow and load-bearing: it attaches
figures drawn from ``signal.fields`` and from nowhere else. If that ever stops
being true, the pipeline gains a way to launder an invented number into a
published article, which is the single failure this whole project is built to
prevent.

The tests below are therefore weighted towards what it must refuse.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.models import Block, Figure
from newsroom.pipeline.write.reconcile import (
    drop_unusable_figures,
    reconcile_block,
    reconcile_figures,
)

FIELDS = {
    "latest": 119.4,
    "year_ago": 112.0,
    "change_pct": 6.6,
}


class TestWhatItFixes:
    def test_declares_a_verified_number_the_writer_forgot(self) -> None:
        # The exact failure from production: '119' in the prose, nothing in
        # the block's figures array.
        block = Block(type="paragraph", text="The index stood at 119 in June.", figures=[])

        notes = reconcile_block(block, FIELDS)

        assert len(block.figures) == 1
        assert block.figures[0].signal_field == "latest"
        assert block.figures[0].value == 119.4
        assert notes

    def test_records_what_it_declared(self) -> None:
        block = Block(type="paragraph", text="The index stood at 119.", figures=[])

        notes = reconcile_block(block, FIELDS)

        assert "latest" in notes[0]

    def test_leaves_a_correctly_declared_block_alone(self) -> None:
        block = Block(
            type="paragraph",
            text="The index stood at 119.",
            figures=[Figure(value=119.4, signal_field="latest")],
        )

        notes = reconcile_block(block, FIELDS)

        assert len(block.figures) == 1
        assert notes == []

    def test_reconciles_every_block_and_labels_them(self) -> None:
        blocks = [
            Block(type="paragraph", text="No numbers here.", figures=[]),
            Block(type="paragraph", text="It stood at 119.", figures=[]),
        ]

        notes = reconcile_figures(blocks, FIELDS)

        assert blocks[0].figures == []
        assert len(blocks[1].figures) == 1
        assert notes[0].startswith("body[1]:")


class TestWhatItMustRefuse:
    def test_never_declares_a_number_the_detector_did_not_verify(self) -> None:
        # The load-bearing test. 47.2 is in no field, so it must remain
        # undeclared and the validator must go on rejecting the article.
        block = Block(type="paragraph", text="Exports rose 47.2% last quarter.", figures=[])

        reconcile_block(block, FIELDS)

        assert block.figures == [], "an unverified number was declared"

    def test_refuses_an_ambiguous_token(self) -> None:
        # Two fields could justify '100'. Choosing one would be a guess about
        # provenance, which is precisely the kind of plausible invention the
        # pipeline exists to stop.
        block = Block(type="paragraph", text="The reading was 100.", figures=[])

        reconcile_block(block, {"a": 100.0, "b": 100.4})

        assert block.figures == []

    def test_never_invents_a_field_name(self) -> None:
        block = Block(type="paragraph", text="It stood at 119.", figures=[])

        reconcile_block(block, FIELDS)

        assert all(f.signal_field in FIELDS for f in block.figures)

    def test_never_alters_a_value_to_make_it_fit(self) -> None:
        block = Block(type="paragraph", text="It stood at 119.", figures=[])

        reconcile_block(block, FIELDS)

        # The declared value is the verified one, not the rounded one the prose
        # used. Rounding is a rendering concern; the figure must stay exact.
        assert block.figures[0].value == 119.4

    def test_ignores_a_block_with_no_text(self) -> None:
        block = Block(type="chart", chart_ref="unemployment", figures=[])

        assert reconcile_block(block, FIELDS) == []
        assert block.figures == []

    def test_handles_a_field_map_that_is_not_numeric(self) -> None:
        block = Block(type="paragraph", text="It stood at 119.", figures=[])

        reconcile_block(block, {"broken": "not a number"})  # type: ignore[arg-type]

        assert block.figures == []

    @pytest.mark.parametrize("text", ["", "Nothing numeric at all."])
    def test_no_numbers_means_no_figures(self, text: str) -> None:
        block = Block(type="paragraph", text=text, figures=[])

        assert reconcile_block(block, FIELDS) == []
        assert block.figures == []


class TestRounding:
    def test_accepts_the_prose_rounding_the_prompt_permits(self) -> None:
        # The writer is told it may render 119.4 as "119". Reconciliation has
        # to use the same rule the validator does, or the two disagree.
        block = Block(type="paragraph", text="It stood at 119.", figures=[])

        reconcile_block(block, {"latest": 119.4})

        assert len(block.figures) == 1

    def test_rejects_a_rounding_that_is_too_loose(self) -> None:
        block = Block(type="paragraph", text="It stood at 119.", figures=[])

        reconcile_block(block, {"latest": 122.0})

        assert block.figures == []


class TestTheUnitItAttaches:
    """A reconciled figure must carry the field's own unit, not the series'.

    Blanket-applying signal.unit published "3.18801 EUR/MWh higher than the
    typical spread", where spread_vs_typical is a ratio and the real
    difference was 48.18. Nothing in this file asserted the unit, so a
    mutation restoring the blanket unit survived.
    """

    def test_a_ratio_field_is_declared_without_a_unit(self):
        block = Block(type="paragraph", text="The spread is 3.19 times the usual.", figures=[])

        reconcile_block(block, {"spread_vs_typical": 3.18801}, unit="EUR/MWh")

        assert len(block.figures) == 1
        assert block.figures[0].signal_field == "spread_vs_typical"
        assert block.figures[0].unit is None, "a ratio is not a quantity in EUR/MWh"

    def test_a_count_field_is_declared_without_a_unit(self):
        block = Block(type="paragraph", text="across 119 earlier daily readings", figures=[])

        reconcile_block(block, {"periods_compared": 119.0}, unit="EUR/MWh")

        assert block.figures[0].unit is None

    def test_a_real_measure_keeps_the_series_unit(self):
        block = Block(type="paragraph", text="The spread reached 70.2 on the day.", figures=[])

        reconcile_block(block, {"spread": 70.2}, unit="EUR/MWh")

        assert block.figures[0].unit == "EUR/MWh"

class TestDroppingStrayFigures:
    """A declared figure that is wrong AND justifies nothing is clerical litter.

    A live article was discarded for::

        figures_traceable: body[1]: figure 4.0 does not match
                           readings_in_series=40.0 (tolerance 0.0)

    The paragraph said "this reading is the fourth-highest on record". There is
    no numeral in that sentence. The model declared a figure for a word,
    guessed the field, got the value wrong, and a correct piece died over an
    entry no claim in it rested on.
    """

    def test_a_wrong_figure_that_justifies_nothing_is_dropped(self):
        block = Block(
            type="paragraph",
            text="This reading is the fourth-highest on record.",
            figures=[Figure(value=4.0, signal_field="readings_in_series")],
        )

        notes = drop_unusable_figures([block], {"readings_in_series": 40.0})

        assert block.figures == []
        assert "dropped unused figure 4.0" in notes[0]

    def test_a_correct_figure_is_never_dropped(self):
        block = Block(
            type="paragraph",
            text="The series holds 40 quarterly readings.",
            figures=[Figure(value=40.0, signal_field="readings_in_series")],
        )

        assert drop_unusable_figures([block], {"readings_in_series": 40.0}) == []
        assert len(block.figures) == 1

    def test_a_wrong_figure_the_prose_actually_uses_is_kept(self):
        """The load-bearing case. Keeping it means the article is rejected,
        which is right: the prose asserts a number the data does not support,
        and dropping the figure would hand that job to no one."""
        block = Block(
            type="paragraph",
            text="Output reached 4 index points.",
            figures=[Figure(value=4.0, signal_field="readings_in_series")],
        )

        assert drop_unusable_figures([block], {"readings_in_series": 40.0}) == []
        assert len(block.figures) == 1

    def test_a_figure_naming_a_field_that_does_not_exist_is_dropped_when_unused(self):
        block = Block(
            type="paragraph",
            text="Costs rose for an eighth year.",
            figures=[Figure(value=8.0, signal_field="invented_field")],
        )

        notes = drop_unusable_figures([block], {"latest_value": 16.3})

        assert block.figures == []
        assert "no such field" in notes[0]

    def test_a_block_with_no_text_is_left_alone(self):
        block = Block(type="chart", chart_ref="salary")

        assert drop_unusable_figures([block], {"latest_value": 1.0}) == []

    def test_dropping_cannot_launder_a_number_in_the_dek(self):
        """The subtle case, because the dek is checked against ALL figures.

        `check_no_invented_numbers` validates the headline and standfirst
        against the union of every block's figures, not against one block. So a
        bogus figure could in principle be the only thing justifying a numeral
        in the dek, and dropping it might look like it removes the evidence
        that the dek is unsupported.

        It does the opposite. Dropping moves the article from "rejected by
        figures_traceable" to "rejected by no_invented_numbers": the numeral
        was never verified either way, and it still cannot publish. This test
        exists so that reasoning is checked rather than asserted.
        """
        from newsroom import numeric_scan

        block = Block(
            type="paragraph",
            text="Output reached a fourth-quarter peak.",
            figures=[Figure(value=4.0, signal_field="readings_in_series")],
        )
        dek = "Output rose 4% on the quarter."

        drop_unusable_figures([block], {"readings_in_series": 40.0})

        # The figure is gone, so nothing in the article justifies the dek's "4".
        assert block.figures == []
        tokens = numeric_scan.scan(dek)
        assert tokens, "the dek must contain a numeral for this test to mean anything"
        assert not numeric_scan.is_justified(tokens[0], [f.to_json() for f in block.figures])

    def test_a_borrowed_figure_keeps_its_own_unit(self):
        """`units.py` exists to stop exactly this, one namespace further out.

        Before the context pack, every field in `signal.fields` belonged to the
        signal's own series, so `signal.unit` was always right here. Merging
        figures from OTHER series broke that assumption, and the reconciler was
        the one of three call sites that still guessed: it stamped an inflation
        rate as "EUR per hour".
        """
        block = Block(
            type="paragraph",
            text="Inflation ran at 3.4% in the same period.",
        )

        reconcile_block(
            block,
            {"latest_value": 16.3, "companion_hicp_annual_rate": 3.4},
            unit="EUR per hour",
            field_units={"companion_hicp_annual_rate": "%"},
        )

        declared = block.figures[0]
        assert declared.signal_field == "companion_hicp_annual_rate"
        assert declared.unit == "%"

    def test_the_series_unit_still_applies_to_the_signals_own_fields(self):
        block = Block(type="paragraph", text="Costs reached 16.3 EUR per hour.")

        reconcile_block(
            block,
            {"latest_value": 16.3},
            unit="EUR per hour",
            field_units={"companion_hicp_annual_rate": "%"},
        )

        assert block.figures[0].unit == "EUR per hour"
