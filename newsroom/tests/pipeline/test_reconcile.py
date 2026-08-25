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
from newsroom.pipeline.write.reconcile import reconcile_block, reconcile_figures

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
