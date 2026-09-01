"""The placement rule the prompt teaches must be the rule the gate applies.

An example in guidance is a claim about behaviour. This file executes every one
of the prompt's placement examples through ``check_record_claim_holds``, and
executes the four deterministic observations it quotes through the code that
emits them.

The second half is the one that decays quietly. The prompt now tells the writer
that four specific sentences are its only licence for a superlative over the
series. Reword one of them in ``context.py`` and the writer is looking for a
sentence the pack no longer produces — silently, with no failing test and no
artefact anywhere saying the licence went missing. So the sentences are not
retyped here: they are produced by ``_placement`` and asserted to appear in the
prompt.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.context import _placement
from newsroom.pipeline.write import prompts
from newsroom.validator import ValidationContext, check_record_claim_holds

from .conftest import make_signal, series_from


def _flat(text: str) -> str:
    """Prompt text with line wrapping removed, so a reflow is not a failure."""
    return " ".join(text.split())


SYSTEM = _flat(prompts._SYSTEM_TEMPLATE)


def _judge(text: str, placement: dict | None):
    context: dict = {
        "method": "collected_series",
        "series_considered": 1,
        "facts": [],
        "observations": [],
    }
    if placement is not None:
        context["placement"] = {
            "first_period": "2001-12",
            "latest_period": "2026-07",
            **placement,
        }
    return check_record_claim_holds(
        ValidationContext(
            article={
                "tier": "A",
                "headline": "A headline that claims nothing",
                "body": [{"type": "paragraph", "text": text, "figures": []}],
                "provenance": {"context": context},
            },
            registry=None,  # type: ignore[arg-type]
            personas=None,  # type: ignore[arg-type]
        )
    )


#: The published falsehood, and the counts that make it one.
CLAIMED_BAD = "the lowest in the 296 observations since the series began"
BAD_PLACEMENT = {"readings_in_series": 296, "higher": 224, "lower": 71}

#: What the prompt offers instead. Both must pass under the same data, or the
#: prompt is steering the writer into a rejection.
CLAIMED_GOOD = (
    "This is neither the highest nor the lowest reading in the series, which "
    "runs to 296 observations from December 2001.",
    "The reading is 6.48 percentage points below the four-year average for the "
    "same point in the year.",
)


class TestThePromptsPlacementExamplesAreTrue:
    def test_the_prompt_still_contains_the_bad_example(self) -> None:
        """Ties this table to the prompt.

        Without it the table becomes a second copy of the guidance, free to
        agree with a version of the prompt that no longer exists.
        """
        assert CLAIMED_BAD in SYSTEM

    def test_what_the_prompt_calls_bad_really_is_rejected(self) -> None:
        result = _judge(f"This reading is {CLAIMED_BAD}.", BAD_PLACEMENT)

        assert not result.passed, (
            "the prompt tells the writer this sentence is false and the gate "
            "lets it through; one of the two is wrong"
        )

    @pytest.mark.parametrize("example", CLAIMED_GOOD)
    def test_the_prompt_still_contains_each_good_example(self, example: str) -> None:
        assert _flat(example) in SYSTEM, f"the prompt no longer contains {example!r}"

    @pytest.mark.parametrize("example", CLAIMED_GOOD)
    def test_what_the_prompt_calls_good_really_passes(self, example: str) -> None:
        result = _judge(example, BAD_PLACEMENT)

        assert result.passed, (
            f"the prompt offers {example!r} as the correct alternative and the "
            f"gate rejects it: {result.detail}"
        )


class TestTheLicenceSentencesAreTheOnesTheCodeEmits:
    """Produced by ``_placement``, not retyped, then found in the prompt.

    Two enumerations of one fact drift, and this pair would drift silently: a
    reworded note leaves the prompt naming a licence the pack never issues, and
    every test stays green because neither side is wrong on its own.
    """

    @staticmethod
    def _note(values: list[float]) -> str:
        series = series_from(values, periods=[f"20{n:02d}-01" for n in range(len(values))])
        _, notes, _ = _placement(make_signal(), series)
        assert len(notes) == 1, f"expected exactly one placement note, got {notes}"
        return notes[0]

    @pytest.mark.parametrize(
        "values,expected_fragment,quoted",
        [
            (
                [1.0, 2.0, 3.0, 9.0],
                "highest reading anywhere",
                "This is the highest reading anywhere in the series.",
            ),
            (
                [9.0, 3.0, 2.0, 1.0],
                "lowest reading anywhere",
                "This is the lowest reading anywhere in the series.",
            ),
            (
                [9.0, 8.0, 1.0, 5.0],
                "third-highest on record",
                # The ordinal varies across the branch, so what the prompt can
                # quote is the invariant half. Asserting the whole sentence
                # would force the prompt to carry all four spellings, three of
                # which no reader needs.
                "Only a handful of readings in the series have ever been higher;",
            ),
            (
                [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 5.5],
                "neither the highest",
                "This is neither the highest nor the lowest reading in the series.",
            ),
        ],
    )
    def test_the_note_the_code_emits_is_quoted_in_the_prompt(
        self, values: list[float], expected_fragment: str, quoted: str
    ) -> None:
        note = self._note(values)

        assert expected_fragment in note, (
            f"the fixture no longer produces the branch it names: {note!r}"
        )
        assert quoted in note, "the quoted fragment must come from the note itself"
        assert _flat(quoted) in SYSTEM, (
            f"`_placement` emits {note!r} and the prompt does not quote it, so "
            "the writer is being told to look for a licence that never arrives"
        )

    def test_the_control_a_sentence_the_code_does_not_emit(self) -> None:
        """Or the assertions above would pass on a prompt containing anything."""
        assert "This is the median reading in the series." not in SYSTEM


class TestTheOrdinaryReadingIsGivenSomethingToSay:
    """The branch that used to be silent.

    Six of the six false superlatives that name their window correctly came
    from a reading with history on both sides — the one case where the pack
    said nothing at all while still handing over `readings_in_series` and
    asking for a placement paragraph.
    """

    #: Latest 5.5 with four readings above and five below, so every other
    #: branch is excluded and this one is definitely the one under test.
    MID_SERIES = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 5.5]

    def _series(self):
        return series_from(
            self.MID_SERIES, periods=[f"20{n:02d}-01" for n in range(len(self.MID_SERIES))]
        )

    def test_a_mid_series_reading_now_carries_a_note(self) -> None:
        facts, notes, placement = _placement(make_signal(), self._series())

        assert notes == ["This is neither the highest nor the lowest reading in the series."]
        assert placement is not None
        assert (placement.higher, placement.lower) == (4, 5), (
            "control: the fixture must actually land in the silent branch, "
            "which needs readings on both sides"
        )

    def test_the_note_carries_no_digits(self) -> None:
        """The whole family is exempt from every numeric gate on that basis.

        A numeral here would need a declared figure and would be rejected, so
        the exemption and the wording are one decision rather than two.
        """
        from newsroom import numeric_scan

        _, notes, _ = _placement(make_signal(), self._series())

        assert not numeric_scan.scan(notes[0])

    def test_silence_returns_when_the_series_extent_is_unknown(self) -> None:
        """Elering is a rolling 120 days. The negative note is a claim about
        the series too, so it may not be made either."""
        series = series_from([5.0, 6.0, 7.0, 4.0], origin=None)

        facts, notes, placement = _placement(make_signal(), series)

        assert notes == []
        assert facts == []
        assert placement is None


class TestThePlacementReachesTheStoredArticle:
    """A record nothing serialises is a record the gate cannot read."""

    def test_the_counts_land_in_provenance(self) -> None:
        from newsroom.pipeline.context import build_context

        series = series_from(
            [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 5.5],
            periods=[f"20{n:02d}-01" for n in range(10)],
        )
        signal = make_signal(metric=series.metric, geography=series.geography)

        provenance = build_context(signal, [series]).to_provenance()

        assert provenance["placement"]["higher"] == 4
        assert provenance["placement"]["lower"] == 5
        assert provenance["placement"]["readings_in_series"] == 10

    def test_it_is_absent_rather_than_zero_when_unknown(self) -> None:
        """Absence must stay absent. Zeros here would read as "this reading
        leads and trails the series at once", which the gate would then treat
        as licensing a record in either direction."""
        from newsroom.pipeline.context import build_context

        series = series_from([5.0, 6.0, 7.0, 4.0], origin=None)
        signal = make_signal(metric=series.metric, geography=series.geography)

        provenance = build_context(signal, [series]).to_provenance()

        assert "placement" not in provenance

    def test_it_survives_the_collision_filter(self) -> None:
        """``_without_collisions`` drops ``readings_in_series`` whenever the
        detector already published the same count under another name, which
        ``record_extreme`` does as ``observation_count``. A placement rebuilt
        from the surviving facts would be missing for exactly the articles that
        claim records."""
        from newsroom.pipeline.context import build_context

        series = series_from(
            [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 5.5],
            periods=[f"20{n:02d}-01" for n in range(10)],
        )
        signal = make_signal(
            detector="record_extreme",
            metric=series.metric,
            geography=series.geography,
            fields={"latest_value": 5.5, "observation_count": 10.0},
        )

        pack = build_context(signal, [series])

        assert "readings_in_series" not in {fact.field for fact in pack.facts}, (
            "control: the collision filter must actually have dropped the fact, "
            "or this proves nothing"
        )
        assert pack.to_provenance()["placement"]["readings_in_series"] == 10
