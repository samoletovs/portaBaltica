"""A threshold must be stated in the quantity it is a threshold on.

WHY THIS EXISTS
---------------
The 14:00Z edition of 2026-08-28 published a structural-divergence piece that
closed::

    "A sustained consumer confidence balance above 29.6 in the coming months
     would reinforce this positive trend"

29.6 is ``latest_gap`` — the spread between the highest and lowest country,
``-2.9 − (-32.5)``. A country *balance* above 29.6 is a different quantity, and
all three countries were deeply negative, so the sentence proposes a test that
essentially cannot occur. It reads as a falsifiable prediction and is not one.

Every check passed and was right to: ``no_invented_numbers`` traced 29.6 to a
declared figure. The figure is real; its subject changed. This is the
``gap``/``recent_gap`` class — one number, two meanings — arriving in the
sentence nobody guarded.

WHAT THE MEASUREMENT OVERTURNED
-------------------------------
The obvious reading is that the writer was never told what a threshold may be
stated in. It was: prompt item 6 said **"Carry no digits here either."**

That instruction is contradicted by the rule that is actually enforced.
``closing_problems`` whitelists a closing that names a reading, and
``_NAMES_A_READING`` requires a **digit** to match. So across the 27 published
tier A originals:

===================  =========  ==============
closing               n          flagged empty
===================  =========  ==============
carries a digit       6          0
carries none         21         17
===================  =========  ==============

Carrying a digit is a complete defence, and on the final attempt a flagged
closing is **cut**. Stripping the digit from four sound closings flags all four.
So obeying the prompt destroyed the paragraph, and the six drafts that ignored
it are the six that survived — five of them good journalism, naming a specific
falsifiable threshold.

The contradiction was introduced by ``c913dc1`` (#99), which added the
digit-requiring whitelist without touching the prompt that forbids digits.
Nobody noticed because the drafts that disobeyed were the ones that lived.

So the fix is **not** to enforce "no digits" — that would delete five good
closings and trip the empty-closing cut on every one. The prompt was wrong, and
the real fault is narrow: one article in twenty-seven, one in seven of the
gap/spread articles where the shape is possible at all.
"""

from __future__ import annotations

import types

import pytest

from newsroom.pipeline import house_style as hs
from newsroom.pipeline.safety import persona_for_section
from newsroom.pipeline.write.prompts import build_system_prompt
from newsroom.tests.pipeline.conftest import make_signal


#: Verbatim from the published article. The artefact, not a reconstruction.
PUBLISHED = (
    "A sustained consumer confidence balance above 29.6 in the coming months "
    "would reinforce this positive trend and further clarify the consumer "
    "sentiment landscape in the Baltic states."
)

#: Also verbatim, from articles published the same day and the days before.
#: These are the reason the rule may not simply ban a repeated figure.
SOUND_CLOSINGS = [
    ("A reading above 25.35% in the next year would indicate a return to "
     "higher inflation levels for home energy.", "seasonal_mean"),
    ("Any future reading above -0.4% would indicate a reversal from this "
     "record low.", "previous_record_value"),
    ("Any future reading below 6.1 per thousand inhabitants would indicate a "
     "continuation of this downward trend in the birth rate.", "latest_value"),
    ("Future readings above the current level of 529 GWh would suggest a "
     "sustained trend in renewable generation.", "latest_value"),
    ("Future quarterly reports on seaborne containerised cargo would need to "
     "show a sustained volume above 1,175 thousand tonnes to confirm this "
     "upward trend as a new norm.", "latest_value"),
]

#: Present-tense descriptions, also verbatim. A deviation IS a distance below a
#: norm and a margin IS an excess over a record, so these are what those fields
#: are for. Without the forward-looking condition the rule fires on all of them.
DESCRIBING_THE_PRESENT = [
    ("This reading is 16.35 percentage points below the seasonal norm, marking "
     "a significant deviation from the average.", "deviation"),
    ("This is the highest reading anywhere in the series, exceeding the "
     "previous record by 542 thousand tonnes.", "margin"),
]


def figures(field, value=29.6):
    return [{"signal_field": field, "value": value}]


class TestThePublishedSentence:
    def test_it_is_flagged(self):
        problems = hs.threshold_subject_problems(PUBLISHED, figures("latest_gap"))

        assert problems
        assert "latest_gap" in problems[0]
        assert "difference between two things" in problems[0]

    def test_the_same_threshold_on_the_gap_itself_is_fine(self):
        # The honest repair, and the prompt now names it: put the threshold on
        # the quantity you are watching.
        text = (
            "A gap above 29.6 in the coming months would show the divergence "
            "widening further."
        )

        assert hs.threshold_subject_problems(text, figures("latest_gap")) == []

    def test_it_reaches_the_report(self):
        # The check is only worth anything if apply_house_style runs it.
        # Asserting the function alone would pass with the call site deleted.
        article = types.SimpleNamespace(
            headline="Consumer confidence gap in the Baltic states widens",
            dek=None,
            body=[
                types.SimpleNamespace(
                    type="paragraph",
                    text="Confidence reached a gap of 29.6, compared with 7.7 earlier.",
                    figures=[], chart_ref=None,
                ),
                types.SimpleNamespace(
                    type="paragraph", text=PUBLISHED,
                    figures=figures("latest_gap"), chart_ref=None,
                ),
            ],
        )

        report = hs.apply_house_style(article)

        assert any("difference between two things" in v for v in report.violations)


class TestWhatItMustNotFlag:
    """The false positives are the whole risk. A rule that rejects true work
    costs more than the fault it catches."""

    @pytest.mark.parametrize("text,field", SOUND_CLOSINGS)
    def test_a_threshold_from_a_level_field_is_left_alone(self, text, field):
        assert hs.threshold_subject_problems(text, figures(field)) == []

    @pytest.mark.parametrize("text,field", DESCRIBING_THE_PRESENT)
    def test_describing_the_present_reading_is_left_alone(self, text, field):
        # Measured over all 144 published paragraphs: without the
        # forward-looking condition this rule fires 5 times and 4 are wrong.
        assert hs.threshold_subject_problems(text, figures(field)) == []

    def test_the_forward_looking_condition_is_what_saves_them(self):
        # The control proving the previous test is not passing for some other
        # reason: make one of those sentences forward-looking and it IS caught.
        present, field = DESCRIBING_THE_PRESENT[0]
        future = "A future reading below 16.35 percentage points would confirm it."

        assert hs.threshold_subject_problems(present, figures(field)) == []
        assert hs.threshold_subject_problems(future, figures(field))

    def test_a_threshold_governed_by_a_distance_word_is_left_alone(self):
        """The proximity rule, and why presence was not enough.

        Once the writer was fixed it started producing the correct form, and an
        earlier version of this check flagged **five of five** of them: "a
        future reading that narrows the gap below 23.48" contains "reading",
        and the threshold is plainly on the gap. Asking whether a level word
        appears anywhere in the sentence tests the vocabulary; the noun
        governing the comparison is the property.

        Every sentence here is verbatim from a generated draft.
        """
        gap = [{"signal_field": "recent_gap", "value": 23.48}]
        corrected = [
            "A future release showing a gap above 23.48 would indicate a further "
            "widening of the distance between Lithuania and Estonia.",
            "The next release would need to show a gap below 23.48 balance of "
            "responses to suggest a potential narrowing of this divergence.",
            "A future reading that narrows the gap below 23.48 would indicate a "
            "shift in the structural divergence in consumer confidence.",
            "A future gap below 23.48 would indicate a narrowing of the distance "
            "between Lithuania and Estonia's consumer confidence.",
        ]

        for text in corrected:
            assert hs.threshold_subject_problems(text, gap) == [], text

    def test_the_published_fault_is_still_caught(self):
        # The companion. Without it the test above could pass by the check
        # having been disabled rather than sharpened.
        assert hs.threshold_subject_problems(PUBLISHED, figures("latest_gap"))

    def test_the_nearer_noun_governs(self):
        # Both words in the window, so presence cannot decide it.
        gap = [{"signal_field": "recent_gap", "value": 23.48}]

        assert hs._governing_subject("a reading that narrows the gap below 23.48") == "distance"
        assert hs._governing_subject("a gap that widened the balance above 23.48") == "level"
        assert hs.threshold_subject_problems(
            "A future reading that narrows the gap below 23.48 would confirm it.", gap
        ) == []

    def test_a_closing_with_no_figures_is_left_alone(self):
        text = "The next release of the index would settle whether this holds."

        assert hs.threshold_subject_problems(text, []) == []
        assert hs.threshold_subject_problems(text, None) == []


class TestTheCheckIsAdvisory:
    def test_it_never_cuts_the_paragraph(self):
        # One occurrence in twenty-seven does not earn a cut, and a named
        # threshold is what makes a closing checkable at all — deleting it
        # would remove the good version along with the bad.
        article = types.SimpleNamespace(
            headline="Consumer confidence gap in the Baltic states widens",
            dek=None,
            body=[
                types.SimpleNamespace(
                    type="paragraph", text="Confidence reached a gap of 29.6.",
                    figures=[], chart_ref=None,
                ),
                types.SimpleNamespace(
                    type="paragraph", text=PUBLISHED,
                    figures=figures("latest_gap"), chart_ref=None,
                ),
            ],
        )

        report = hs.apply_house_style(
            article, cut_empty_closings=True, cut_speculative_impact=True
        )

        assert PUBLISHED in [b.text for b in article.body]
        assert not report.cuts

    def test_it_is_still_reported_after_a_closing_is_cut(self):
        # It runs on whatever paragraph the article ends on, so a cut above it
        # cannot carry it out of scope.
        article = types.SimpleNamespace(
            headline="Consumer confidence gap in the Baltic states widens",
            dek=None,
            body=[
                types.SimpleNamespace(
                    type="paragraph", text="Confidence reached a gap of 29.6.",
                    figures=[], chart_ref=None,
                ),
                types.SimpleNamespace(
                    type="paragraph", text=PUBLISHED,
                    figures=figures("latest_gap"), chart_ref=None,
                ),
            ],
        )

        report = hs.apply_house_style(article, cut_empty_closings=True)

        assert any("difference between two things" in v for v in report.violations)


class TestThePromptNoLongerContradictsTheEnforcedRule:
    """An example in guidance is a claim about behaviour. Execute it."""

    @staticmethod
    def _prompt():
        return build_system_prompt(make_signal(), persona_for_section("economy"))

    @staticmethod
    def _flat(text):
        """Collapse whitespace: the prompt wraps, the example does not."""
        return " ".join(text.split())

    def test_it_no_longer_tells_the_writer_to_omit_the_figure(self):
        # "Carry no digits here either" was the instruction, and obeying it got
        # the paragraph flagged 17 times in 21 and cut on the final attempt.
        assert "Carry no digits here either" not in self._prompt()

    def test_it_asks_for_the_number_instead(self):
        assert "NAME THE NUMBER" in self._prompt()

    def test_the_rejected_example_really_is_rejected(self):
        # The prompt shows this as REJECTED. If the check disagreed, the
        # guidance would be steering the writer with a false claim — the #176
        # failure, where a prompt taught that a construction was caught when it
        # was not.
        example = "a consumer confidence balance above 29.6 would reinforce this"

        assert example in self._flat(self._prompt())
        assert hs.threshold_subject_problems(
            f"A sustained {example} in the coming months.", figures("latest_gap")
        )

    def test_the_allowed_examples_really_are_allowed(self):
        gap = "a gap above 29.6 would show the divergence widening further"
        level = "a reading above 25.35% would show a return to the norm"
        flat = self._flat(self._prompt())

        assert gap in flat
        assert level in flat
        assert hs.threshold_subject_problems(gap, figures("latest_gap")) == []
        assert hs.threshold_subject_problems(level, figures("seasonal_mean")) == []


class TestTheFieldSetIsHonest:
    def test_a_level_field_is_not_listed_as_a_difference(self):
        for field in ("latest_value", "seasonal_mean", "previous_record_value",
                      "highest_value", "lowest_value", "value_lv", "value_ee",
                      "threshold_value", "streak_start_value"):
            assert field not in hs.DIFFERENCE_FIELDS, field

    def test_every_gap_field_the_divergence_detectors_emit_is_listed(self):
        # Named against the detectors rather than guessed from the name:
        # ``margin`` and ``deviation`` carry no suffix marking them out.
        for field in ("latest_gap", "early_gap", "recent_gap", "spread",
                      "typical_spread", "margin", "deviation", "change",
                      "cumulative_change", "widening_ratio"):
            assert field in hs.DIFFERENCE_FIELDS, field
