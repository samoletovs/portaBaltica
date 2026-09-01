"""A distance across a rate series is in percentage points, not per cent.

WHAT SHIPPED
------------
Three published articles wrote a distance between two rate readings with a
per-cent sign. Measured against the live corpus of 2026-08-31, 93 articles of
which 39 carry prose::

    latvia-s-house-prices-rise-10-9-year-on-year
        10.9 from 5.4  ->  "a cumulative change of 5.5%"      true change 101.9%
    lithuania-s-goods-inflation-reaches-4-8
        4.8  from 1.6  ->  "a cumulative change of 3.2%"      true change 200.0%
    lithuania-s-renewable-energy-share-hits-record-38-5
        38.5 from 24.7 ->  "a cumulative change of 13.8%"     true change  55.9%

Every figure is real and traces to its field. ``figures_traceable`` matched 5.5
against ``cumulative_change``, which holds 5.5; ``no_invented_numbers`` found
nothing invented. The unit was the lie, and no gate reads units — the third
member of the family this repo keeps finding, after a wrong SUBJECT from a
shared cache key and a wrong RENDERING of "4653 thousand" for 4.65 million.
The contract protects figures, not what surrounds them.

WHY IT WAS THE PIPELINE'S FAULT AND NOT THE WRITER'S
-----------------------------------------------------
The writer's figure table said, in as many words::

    - cumulative_change = 5.5   (% year on year)

built from ``units.unit_for_field``. It copied the label it was handed. So the
fix is there and not in the prompt: prompt guidance competes with the table, and
the corpus shows that contest landing both ways — the seasonal section carries a
percentage-points example and got 5 of 5 right, the streak section did not and
got 0 of 3.

WHAT THE RATE WAS, BY DETECTOR
-------------------------------
Swept structurally rather than lexically: a declared figure whose
``signal_field`` is an absolute difference and whose ``unit`` is rate-like.
``figures_traceable`` guarantees every prose figure is declared, so that set is
complete and no phrasing escapes it. Nine such figures in 8 of the 39::

    streak / cumulative_change          0 of 3 correct
    seasonal_deviation / deviation      5 of 5 correct

A regex over the two phrasings anyone would think of found three of the nine.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from newsroom.pipeline import house_style, units
from newsroom.pipeline.field_meanings import figure_table
from newsroom.pipeline.house_style import (
    apply_house_style,
    percentage_point_problems,
)
from newsroom.pipeline.models import Article, Block, Figure

REPO_ROOT = Path(__file__).resolve().parents[3]


def make_article(text: str, figures: list[Figure]) -> Article:
    return Article(
        id="id",
        slug="slug",
        tier="A",
        status="draft",
        created_at="2026-09-01T00:00:00Z",
        provenance={},
        headline="Latvia's house prices rise",
        section="economy",
        body=[Block(type="paragraph", text=text, figures=figures)],
    )


def figure(field: str, value: float, series_unit: str, rendered: str) -> Figure:
    """A figure carrying the unit the PIPELINE resolves, never a guessed one.

    ``generator.py`` builds figures this way — "the pipeline's own answer, never
    the model's" — so a fixture that spelled the unit by hand would be asserting
    against a value the pipeline never produces.
    """
    return Figure(
        value=value,
        signal_field=field,
        unit=units.unit_for_field(field, series_unit),
        rendered_as=rendered,
    )


class TestTheUnitOfADistance:
    """The five rows that separate a distance from a level and a rate from a price."""

    @pytest.mark.parametrize(
        "field,series_unit,expected",
        [
            # The defect: a distance across a rate.
            ("cumulative_change", "% year on year", "percentage points"),
            ("deviation", "% of the labour force", "percentage points"),
            ("margin", "% of GDP", "percentage points"),
            ("spread", "%", "percentage points"),
            # THE NEGATIVE CONTROL. A distance across a PRICE keeps the series
            # unit: "down 0.1 EUR per kWh" is correct, and an instrument that
            # flags it is worse than the defect it was built for.
            ("cumulative_change", "EUR per kWh", "EUR per kWh"),
            ("deviation", "thousand tonnes", "thousand tonnes"),
            ("spread", "balance of responses", "balance of responses"),
            # A LEVEL on a rate series is a genuine rate reading and keeps "%".
            # This is the row that matters most: 10.9% and 5.5% sit in one
            # sentence and only one of them is wrong.
            ("latest_value", "% year on year", "% year on year"),
            ("seasonal_mean", "% of the labour force", "% of the labour force"),
            ("streak_start_value", "% year on year", "% year on year"),
            # A distance already re-expressed as a percentage IS a percentage.
            ("cumulative_change_pct", "% year on year", "%"),
            ("deviation_pct", "% of the labour force", "%"),
            # And the dimensionless members keep answering nothing.
            ("streak_length", "% year on year", None),
            ("spread_vs_typical", "% year on year", None),
        ],
    )
    def test_unit_for_field(self, field: str, series_unit: str, expected) -> None:
        assert units.unit_for_field(field, series_unit) == expected

    def test_an_override_still_wins(self) -> None:
        # The context pack merges figures from OTHER series, and states their
        # unit because guessing from the field name cannot work there. That has
        # to keep beating the new rule.
        assert (
            units.unit_for_field(
                "deviation", "% year on year", overrides={"deviation": "EUR per hour"}
            )
            == "EUR per hour"
        )


class TestTheAbsoluteSubsetIsDerived:
    def test_it_is_computed_from_difference_fields_not_listed(self) -> None:
        # Derived, so adding a member to DIFFERENCE_FIELDS classifies it rather
        # than silently omitting it. A hand-written list is a second enumeration
        # and would drift from the first.
        assert units.ABSOLUTE_DIFFERENCE_FIELDS <= units.DIFFERENCE_FIELDS
        expected = {
            name
            for name in units.DIFFERENCE_FIELDS
            if "pct" not in name and not name.endswith(("_ratio", "_vs_typical"))
        }
        assert units.ABSOLUTE_DIFFERENCE_FIELDS == expected

    def test_widening_ratio_is_a_difference_and_still_dimensionless(self) -> None:
        # The member that makes the suffix rule worth having. It IS a difference
        # and it is NOT in the series' unit, so a listed subset would have to
        # remember it and a derived one cannot forget.
        assert "widening_ratio" in units.DIFFERENCE_FIELDS
        assert "widening_ratio" not in units.ABSOLUTE_DIFFERENCE_FIELDS
        assert units.unit_for_field("widening_ratio", "% of GDP") == "% of GDP"

    def test_house_style_reads_the_set_rather_than_restating_it(self) -> None:
        # Identity, not equality: two equal frozensets are two enumerations and
        # would drift the first time either is edited.
        #
        # THIS ASSERTION IS WEAKER THAN IT LOOKS, and the mutation harness is
        # what said so. Planting ``frozenset(units.DIFFERENCE_FIELDS)`` in place
        # of the bind left the suite green — because CPython returns the same
        # object when frozenset() is handed a frozenset, so that plant was a
        # no-op rather than a second enumeration. The identity check cannot
        # distinguish a bind from a copy that is not one.
        #
        # The test below is the one with teeth: it catches a second LITERAL
        # definition, which is the shape that can actually drift.
        assert house_style.DIFFERENCE_FIELDS is units.DIFFERENCE_FIELDS

    def test_the_set_is_defined_exactly_once_in_the_package(self) -> None:
        """A second literal definition would be the drift this move prevents."""
        pattern = re.compile(r"^DIFFERENCE_FIELDS[^=]*=\s*frozenset\(\{", re.MULTILINE)
        definitions = [
            path
            for path in (REPO_ROOT / "newsroom").rglob("*.py")
            if "tests" not in path.parts and pattern.search(path.read_text(encoding="utf-8"))
        ]
        assert [p.name for p in definitions] == ["units.py"]


class TestIsRateUnit:
    @pytest.mark.parametrize(
        "unit",
        [
            "%",
            "% year on year",
            "% of GDP",
            "% of the young labour force",
            "% change on a year earlier",
        ],
    )
    def test_rate_units(self, unit: str) -> None:
        assert units.is_rate_unit(unit)

    @pytest.mark.parametrize(
        "unit",
        [
            "EUR per kWh",
            "index points",
            "balance of responses",
            "per thousand inhabitants",
            "Gini coefficient",
            "percentage points",
            None,
            "",
        ],
    )
    def test_not_rate_units(self, unit) -> None:
        assert not units.is_rate_unit(unit)

    def test_the_registry_never_hides_a_percent_mid_string(self) -> None:
        """The measurement the leading-``%`` rule rests on, re-run each time.

        ``is_rate_unit`` matches the first character rather than a list of
        qualifiers, which is only sound while every rate-like unit in the
        registry is written that way. Measured when it was written: 38 distinct
        units, 14 rate-like, and ``%`` never anywhere but the first character.

        Asserted rather than remembered, because the day someone adds "change,
        % year on year" this rule stops holding and nothing else would say so.
        """
        source = (REPO_ROOT / "newsroom/pipeline/collect/opendata.py").read_text(
            encoding="utf-8"
        )
        declared = {m.group(1) for m in re.finditer(r'\bunit\s*=\s*"([^"]*)"', source)}
        assert declared, "found no series units — the probe is broken, not the registry"
        misplaced = [u for u in declared if "%" in u and not u.startswith("%")]
        assert misplaced == []
        # The positive half: the probe can see a rate at all.
        assert any(units.is_rate_unit(u) for u in declared)


class TestTheWriterIsToldTheRightUnit:
    """The figure table is where the wrong label reached the writer."""

    def _table(self, series_unit: str) -> list[str]:
        from newsroom.pipeline.models import Signal

        signal = Signal(
            detector="streak",
            metric="house_prices",
            metric_label="House prices",
            geography="LV",
            period="2026-Q1",
            value=10.9,
            unit=series_unit,
            comparison_basis="four consecutive quarterly moves",
            score=0.9,
            section="economy",
            fields={
                "latest_value": 10.9,
                "streak_length": 4.0,
                "streak_start_value": 5.4,
                "cumulative_change": 5.5,
                "cumulative_change_pct": 101.85,
            },
            sources=["eurostat"],
            context={"frequency": "Q", "direction": "rising"},
        )
        return figure_table(signal, internal_only=units.INTERNAL_ONLY_FIELDS)

    def test_the_published_signal_now_labels_the_distance_correctly(self) -> None:
        # Replays the house-prices signal exactly as it was when the article
        # published. This is the direct link from the measured defect to the fix.
        lines = "\n".join(self._table("% year on year"))
        assert "cumulative_change = 5.5   (percentage points)" in lines
        # And the two that must NOT move, in the same table.
        assert "latest_value = 10.9   (% year on year)" in lines
        assert "cumulative_change_pct = 101.85   (%)" in lines

    def test_a_price_series_is_untouched(self) -> None:
        lines = "\n".join(self._table("EUR per kWh"))
        assert "cumulative_change = 5.5   (EUR per kWh)" in lines

    def test_no_spurious_write_this_as_line_appears(self) -> None:
        """The label and the readable form must still agree.

        ``figure_table`` emits a second "write this as" line only when the two
        differ. Changing the label without checking would have added one to
        every rate-series distance — noise on the table this fix exists to
        clean up.
        """
        lines = self._table("% year on year")
        assert not [line for line in lines if "write this as" in line]


class TestTheAdvisory:
    def test_it_fires_on_the_published_sentence(self) -> None:
        text = (
            "The cumulative change of 5.5% year on year indicates a strong "
            "upward trend in the housing market."
        )
        figures = [figure("cumulative_change", 5.5, "% year on year", "5.5%")]

        problems = percentage_point_problems(text, figures, where="body[0]")

        assert len(problems) == 1
        assert "percentage points" in problems[0].lower()
        assert "cumulative_change" in problems[0]

    def test_it_does_not_fire_on_a_price_series(self) -> None:
        # THE NEGATIVE CONTROL, at the level a reader meets it.
        text = "This is down 0.1 EUR per kWh across six consecutive falls since 2022-S2."
        figures = [figure("cumulative_change", -0.1, "EUR per kWh", "0.1 EUR per kWh")]

        assert percentage_point_problems(text, figures, where="body[0]") == []

    def test_it_does_not_fire_on_a_rate_level(self) -> None:
        text = "Latvia's house prices rose 10.9% year on year in 2026-Q1."
        figures = [figure("latest_value", 10.9, "% year on year", "10.9%")]

        assert percentage_point_problems(text, figures, where="body[0]") == []

    def test_it_does_not_fire_on_a_genuine_percentage(self) -> None:
        text = "That is a rise of 101.85% since the run began."
        figures = [figure("cumulative_change_pct", 101.85, "% year on year", "101.85%")]

        assert percentage_point_problems(text, figures, where="body[0]") == []

    def test_it_does_not_fire_on_prose_that_was_already_right(self) -> None:
        # Five of the six seasonal deviations in the corpus read like this. A
        # rule that flagged them would reject correct work.
        text = "This reading is 16.35 percentage points below the seasonal norm."
        figures = [figure("deviation", -16.35, "% change on a year earlier", "-16.35%")]

        assert percentage_point_problems(text, figures, where="body[0]") == []

    def test_a_figure_is_not_matched_inside_a_larger_number(self) -> None:
        """The lookbehind, which is the whole correctness of the match.

        Without it a figure of 5.5 matches inside 15.5, and the check reports a
        fault in a sentence that never mentioned it.
        """
        text = "Construction costs rose 15.5% over the same period."
        figures = [figure("cumulative_change", 5.5, "% year on year", "5.5")]

        assert percentage_point_problems(text, figures, where="body[0]") == []

    def test_the_word_list_it_replaces_would_have_missed_these(self) -> None:
        """Structural, so a phrasing nobody imagined cannot beat it.

        The regex that found this defect keyed on "cumulative change of", and a
        rule built from it would see none of the sentences below — all of which
        are the same fault.
        """
        figures = [figure("deviation", 7.53, "% year on year", "7.53%")]
        for text in (
            "The gap widened by 7.53% against the seasonal norm.",
            "It sits 7.53% above where it usually would.",
            "A departure of 7.53% from the four-year average.",
        ):
            assert percentage_point_problems(text, figures, where="body[0]"), text


class TestTheRepair:
    def test_it_writes_the_words_in_on_the_final_attempt(self) -> None:
        text = (
            "The cumulative change of 5.5% year on year indicates a strong upward "
            "trend, with house prices rising to 10.9% from 5.4%."
        )
        article = make_article(
            text,
            [
                figure("cumulative_change", 5.5, "% year on year", "5.5%"),
                figure("latest_value", 10.9, "% year on year", "10.9%"),
                figure("streak_start_value", 5.4, "% year on year", "5.4%"),
            ],
        )

        report = apply_house_style(article, repair_percentage_points=True)

        assert "5.5 percentage points" in article.body[0].text
        assert "5.5%" not in article.body[0].text
        # THE CONTROL INSIDE THE SENTENCE. Both of these are genuine rate
        # readings and must survive a rewrite aimed at the figure between them.
        assert "10.9%" in article.body[0].text
        assert "5.4%" in article.body[0].text
        assert report.corrections

    def test_the_declaration_follows_the_prose(self) -> None:
        # ``_after_the_figure`` locates a figure by ``rendered_as``. Leaving
        # "5.5%" there would make it stop finding this figure at all — a check
        # quietly skipping rather than passing.
        article = make_article(
            "A cumulative change of 5.5% across the run.",
            [figure("cumulative_change", 5.5, "% year on year", "5.5%")],
        )

        apply_house_style(article, repair_percentage_points=True)

        assert article.body[0].figures[0].rendered_as == "5.5 percentage points"
        assert article.body[0].figures[0].rendered_as in article.body[0].text

    def test_it_does_nothing_while_the_writer_still_has_an_attempt(self) -> None:
        # ASK FIRST, THEN CORRECT. The advisory is fed back; the prose is left
        # alone so the writer can produce a better sentence than a substitution.
        text = "A cumulative change of 5.5% across the run."
        article = make_article(
            text, [figure("cumulative_change", 5.5, "% year on year", "5.5%")]
        )

        report = apply_house_style(article, repair_percentage_points=False)

        assert article.body[0].text == text
        assert report.corrections == []
        assert any("percentage points" in v.lower() for v in report.violations)

    def test_a_price_series_is_never_rewritten(self) -> None:
        text = "This is down 0.1 EUR per kWh across six consecutive falls."
        article = make_article(
            text, [figure("cumulative_change", -0.1, "EUR per kWh", "0.1 EUR per kWh")]
        )

        report = apply_house_style(article, repair_percentage_points=True)

        assert article.body[0].text == text
        assert report.corrections == []

    def test_an_ambiguous_magnitude_is_reported_but_not_rewritten(self) -> None:
        """Two figures, same digits, one genuinely a per cent.

        The two occurrences of "5.5%" cannot be told apart by their text, so
        rewriting risks moving the correct one. The advisory still fires, which
        is the difference between declining to act and failing to notice.
        """
        text = "A cumulative change of 5.5%, against a 5.5% rise since the run began."
        article = make_article(
            text,
            [
                figure("cumulative_change", 5.5, "% year on year", "5.5%"),
                figure("cumulative_change_pct", 5.5, "% year on year", "5.5%"),
            ],
        )

        report = apply_house_style(article, repair_percentage_points=True)

        assert article.body[0].text == text
        assert report.corrections == []
        assert any("percentage points" in v.lower() for v in report.violations)

    def test_a_repaired_sentence_is_not_also_reported(self) -> None:
        # The repair runs before the scan, so the advisory describes the prose
        # as it now stands. A corrected sentence reported as faulty would send
        # the desk after prose that no longer exists.
        article = make_article(
            "A cumulative change of 5.5% across the run.",
            [figure("cumulative_change", 5.5, "% year on year", "5.5%")],
        )

        report = apply_house_style(article, repair_percentage_points=True)

        assert report.corrections
        assert not [v for v in report.violations if "percentage points" in v.lower()]


class TestItIsWiredIn:
    """Asserting the function alone would pass with every call site deleted."""

    def test_apply_house_style_calls_the_check(self) -> None:
        article = make_article(
            "A cumulative change of 5.5% across the run.",
            [figure("cumulative_change", 5.5, "% year on year", "5.5%")],
        )

        report = apply_house_style(article)

        assert any("percentage points" in v.lower() for v in report.violations)

    def test_the_generator_repairs_on_the_final_attempt_only(self) -> None:
        source = (REPO_ROOT / "newsroom/pipeline/write/generator.py").read_text(
            encoding="utf-8"
        )
        assert "repair_percentage_points=last_attempt" in source

    def test_the_generator_revalidates_after_a_correction(self) -> None:
        """A repair rewrites prose the verdict was computed against.

        Unlike a cut, it ADDS words rather than withdrawing claims, so the
        argument that traceability cannot break does not carry and re-running
        the verdict is necessary rather than merely cheap.
        """
        source = (REPO_ROOT / "newsroom/pipeline/write/generator.py").read_text(
            encoding="utf-8"
        )
        assert "if style.cuts or style.corrections:" in source

    @pytest.mark.parametrize(
        "call",
        [
            "units.display_quantity('typical_spread', typical, sample.unit)",
            "units.display_quantity('early_gap', early_gap, sample.unit)",
            "units.display_quantity('typical_move', sigma, series.unit)",
        ],
    )
    def test_the_comparison_bases_ask_for_the_field_unit(self, call: str) -> None:
        """The three bases that stamped the series unit onto a distance.

        Latent rather than shipped — no published article carries one, because
        those detectors have not yet fired on a rate series with these bases.
        Left bypassing a corrected function they would be the concealing sibling
        this repo keeps finding: the right version present, so a reader who
        checks finds it and stops looking.
        """
        source = (REPO_ROOT / "newsroom/pipeline/detect/detectors.py").read_text(
            encoding="utf-8"
        )
        assert call in source


class TestThePromptTellsTheTruth:
    """An example in guidance is a claim about behaviour — resolve it.

    The prompt names a construction and says it is wrong. If ``unit_for_field``
    disagrees, the guidance is steering the writer by a rule the pipeline does
    not apply, and nothing anywhere would report the loss.
    """

    @property
    def _system(self) -> str:
        from newsroom.pipeline.write import prompts

        return " ".join(prompts._SYSTEM_TEMPLATE.split())

    def test_the_bad_example_is_the_unit_the_pipeline_refuses(self) -> None:
        assert "a cumulative change of 5.5% year on year" in self._system
        assert units.unit_for_field("cumulative_change", "% year on year") != "%"

    def test_the_good_example_is_the_unit_the_pipeline_supplies(self) -> None:
        assert "5.5 percentage points, from 5.4% to 10.9%" in self._system
        assert (
            units.unit_for_field("cumulative_change", "% year on year")
            == units.PERCENTAGE_POINTS
        )
        # And the "%" the same GOOD line keeps is genuinely correct: those two
        # figures are LEVELS, which the prompt must not teach anyone to change.
        assert units.unit_for_field("latest_value", "% year on year") == "% year on year"

    def test_the_price_examples_it_keeps_are_still_right(self) -> None:
        # The prompt still holds up "down 0.1 EUR per kWh" as GOOD. It is, and
        # the pipeline agrees — an example that had quietly become false would
        # be guidance against correct writing.
        assert "down 0.1 EUR per kWh across six consecutive falls" in self._system
        assert units.unit_for_field("cumulative_change", "EUR per kWh") == "EUR per kWh"

    def test_it_names_the_sibling_detectors(self) -> None:
        # The fault is not the streak's. Naming only ``cumulative_change`` would
        # encode the three articles that happened to ship it.
        assert "deviation" in self._system
        assert "margin" in self._system
        assert "spread" in self._system
