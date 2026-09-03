"""A quantity must reach the reader at a scale the reader can hold.

THE ARTICLE THAT PUBLISHED
--------------------------
::

    Latvia recorded 4653 thousand rail passengers in 2026-Q1, an increase of
    998.44 thousand passengers compared with the nine-year average of 3654.56
    thousand passengers for the same point in the year.

Every figure in it is correct. ``rail_pa_quartal`` really does put Latvia at
4653 in ``THS_PAS`` for 2026-Q1, ``figures_traceable`` matched each one against
the signal payload, ``no_invented_numbers`` traced every token, and the desk
passed it.

It is still unpublishable prose, in two separate ways:

**The scale is one the reader has to convert.** "4653 thousand" is 4.65
million. The first reader to see it did that arithmetic, landed above Latvia's
population of 1.9 million, and read the piece as a data fault rather than as a
count of journeys.

**The precision is false.** Two decimals of a thousand is a claim to the
nearest ten passengers, on a seasonal average of three and a half million.

WHY NOTHING CAUGHT IT
---------------------
Every numeric gate in the newsroom protects *figures* — that a number is real,
that it traces to its field, that it is written at a precision the source
supports. None of them has anything to say about how a true number *reads*, so
a rendering fault passes every one of them by construction.

And the correct version was already in the repository, twice over. The
dashboard's ``formatValue`` renders the identical figure as ``4.65m
passengers``; its docstring makes this exact argument about ``M EUR``, in
almost these words. ``detect_seasonal_deviation`` was the one detector already
routing its basis through ``units`` — so a reader who checked found the right
pattern and stopped looking, while ``units`` had nothing to say about
magnitude and the other five bases interpolated ``{value:g}`` raw.

WHAT IS ASSERTED HERE
---------------------
The renderer, the six comparison bases that feed it to the writer, the shared
figure table, the traceability that has to survive the rescaling, and the
editor-side backstop. Rendering and traceability are asserted together on
purpose: a readable rendering the validator then rejects is not an improvement,
it is a wire that publishes nothing.
"""

from __future__ import annotations

import pytest

from newsroom import numeric_scan
from newsroom.pipeline import field_meanings, house_style, units
from newsroom.pipeline.detect import detect_seasonal_deviation
from newsroom.tests.pipeline.conftest import series_from

#: Latvia's real first-quarter rail readings, 2018 to 2026, in THS_PAS. Read
#: from Eurostat rather than invented, so the numbers this file argues about
#: are the numbers that published.
LV_Q1 = [4100.0, 4260.0, 3400.0, 2100.0, 3300.0, 3800.0, 4025.0, 4772.0, 4653.0]

PUBLISHED = (
    "Latvia recorded 4653 thousand rail passengers in 2026-Q1, an increase of "
    "998.44 thousand passengers compared with the nine-year average of 3654.56 "
    "thousand passengers for the same point in the year."
)


def rail_series():
    return series_from(
        LV_Q1,
        periods=[f"{year}-Q1" for year in range(2018, 2027)],
        metric="rail_passengers",
        metric_label="rail passenger journeys",
        unit="thousand passengers",
        section="trade",
        frequency="quarterly",
        geography="LV",
    )


class TestTheRenderer:
    @pytest.mark.parametrize(
        "value,unit,expected",
        [
            # The published sentence's three figures.
            (4653.0, "thousand passengers", "4.65 million passengers"),
            (3654.56, "thousand passengers", "3.65 million passengers"),
            (998.44, "thousand passengers", "998 thousand passengers"),
            # The other scaled units in the registry.
            (25605.0, "thousand tonnes", "25.6 million tonnes"),
            (2280.5, "million EUR", "2.28 billion EUR"),
            (1857000.0, "people", "1.86 million people"),
            (12500.0, "thousand tonnes of carbon dioxide equivalent",
             "12.5 million tonnes of carbon dioxide equivalent"),
        ],
    )
    def test_a_scaled_quantity_is_restated(self, value, unit, expected):
        assert units.quantity(value, unit) == expected

    @pytest.mark.parametrize(
        "value,unit",
        [
            (49.64, "EUR/MWh"),
            (6.6, "% of the labour force"),
            (18.1, "index points"),
            (3.2, "thousand tonnes"),
            (300.0, "million EUR"),
        ],
    )
    def test_a_quantity_a_reader_can_already_hold_is_left_alone(self, value, unit):
        """The negative control.

        Without it a renderer that mangled everything would pass every case
        above. It also pins the cost of the rule: restating a number that was
        already readable can only lose precision the writer may want.
        """
        number, _ = units.humanise(value, unit)

        assert float(number.split()[0]) == pytest.approx(value)

    @pytest.mark.parametrize(
        "unit", ["thousand passengers", "million EUR", "thousand tonnes", "people", "EUR/MWh"]
    )
    @pytest.mark.parametrize("value", [0.0, 0.5, 3.7, 49.64, 998.44, 4653.0, 25605.0, -2280.5])
    def test_the_rendering_preserves_the_quantity(self, value, unit):
        """The invariant the whole change rests on, over the grid rather than at
        chosen points.

        A rendering may move where the decimal point sits and may drop
        precision the reader cannot use. It may not change what the number
        MEANS. Read the rendered string back through the scanner — the same
        code the validator uses — and it must come out as the same quantity,
        to the precision the rendering itself committed to.

        This is what makes the readable form traceable: if it ever stopped
        holding, the pipeline would be handing the writer prose its own
        validator rejects, and every article on a scaled series would die.

        It is a claim about TRACEABILITY and not about readability, and the two
        need separate tests. Mutating the renderer to "46.5 million" fails
        this; mutating it to "5 million" does not, because that genuinely is a
        legal rounding at the precision it commits to. Readability is asserted
        by ``test_the_mantissa_always_lands_below_the_next_scale_word``.
        """
        rendered = units.quantity(value, unit)
        token = numeric_scan.scan(rendered)[0]

        assert numeric_scan.value_justifies(
            token, value, scale=numeric_scan.unit_scale(unit)
        ), rendered

    def test_a_denominator_is_not_a_scale(self):
        """"per thousand inhabitants" is a rate, not a value in thousands.

        Folding that thousand into the value would multiply a rate by a
        thousand and call it a count — a number a thousand times too large,
        well-formed, and traceable to its field.
        """
        assert units.quantity(-3.4, "per thousand inhabitants") == (
            "-3.4 per thousand inhabitants"
        )
        assert units.quantity(612.0, "cars per thousand inhabitants") == (
            "612 cars per thousand inhabitants"
        )

    def test_the_mantissa_always_lands_below_the_next_scale_word(self):
        """The property, over the whole range rather than at chosen points.

        This is the rule the published sentence broke, stated directly: if the
        digits in front of a scale word reach four, the next word up says the
        same thing in fewer, so no correct rendering ever leaves them there.
        """
        for exponent in range(0, 13):
            for lead in (1.0, 3.7, 9.99):
                rendered = units.quantity(lead * (10.0**exponent), "tonnes")
                assert house_style.unreadable_scale_phrase(rendered) is None, rendered

    def test_display_value_never_reaches_for_scientific_notation(self):
        """What the writer must COPY stays copyable.

        ``{:g}`` switched to exponent form above a million, so a population of
        1,857,000 was handed to the writer as ``1.857e+06`` — in the one field
        it is told to reproduce digit for digit.
        """
        assert units.display_value("latest_value", 1857000.0) == "1857000"
        assert "e" not in units.display_value("latest_value", 1234567.0)


class TestTheScaleVocabularyIsOneEnumeration:
    """Three places name scale words; a member missing from one is silent.

    This is not hypothetical. The renderer's ladder was written stopping at
    "billion" while ``numeric_scan`` already knew "trillion", so 1e12 tonnes
    rendered as "1000 billion" — the exact shape the whole change exists to
    remove, produced by the code removing it. The property test above found it;
    these assert the vocabularies rather than one consequence of them.
    """

    def test_the_renderer_knows_every_word_the_scanner_does(self):
        assert {word for word, _ in units.MAGNITUDES} == set(
            numeric_scan._SCALE_WORDS
        ) - {"k", "m", "b", "bn", "mn", "tn"}

    def test_every_rung_names_the_right_factor(self):
        for word, factor in units.MAGNITUDES:
            assert numeric_scan._SCALE_WORDS[word] == factor

    def test_the_editor_check_is_built_from_the_same_ladder(self):
        """Not restated. A guard enumerating a smaller set looks like coverage.

        Every rung but the largest must be refusable — nothing says "1000
        trillion" more briefly, so that one has nowhere to go and is excluded
        by construction rather than by being forgotten.
        """
        from newsroom.pipeline import house_style as hs

        ladder = [word for word, _ in units.MAGNITUDES]

        assert set(hs._NEXT_SCALE_UP) == set(ladder[1:])
        assert all(
            hs._NEXT_SCALE_UP[smaller] == bigger
            for bigger, smaller in zip(ladder, ladder[1:])
        )


class TestTheRescalingStaysTraceable:
    """A readable rendering the validator rejects is not an improvement."""

    FIGURES = [
        {"value": 4653.0, "signal_field": "latest_value", "unit": "thousand passengers"},
        {"value": 3654.56, "signal_field": "seasonal_mean", "unit": "thousand passengers"},
    ]

    def test_the_readable_form_traces_to_the_declared_figure(self):
        prose = (
            "Latvia recorded 4.65 million rail passenger journeys in 2026-Q1, "
            "against a nine-year average of 3.65 million."
        )

        assert numeric_scan.unjustified_tokens(prose, self.FIGURES) == ()

    def test_the_source_form_still_traces_too(self):
        """Widening must not narrow. The raw rendering stays legal."""
        assert numeric_scan.unjustified_tokens("4653 thousand passengers", self.FIGURES) == ()

    @pytest.mark.parametrize(
        "prose",
        [
            "Latvia recorded 9.9 million journeys.",   # invented outright
            "Latvia recorded 4.65 billion journeys.",  # right digits, wrong scale
            "Latvia recorded 4.72 million journeys.",  # drifted past the rounding
            "Latvia recorded 465 million journeys.",   # decimal point moved
        ],
    )
    def test_it_does_not_launder_a_number(self, prose):
        """The companion, and the reason the widening is safe to make.

        A unit's scale is a fixed factor the pipeline supplies, not the model,
        so it admits one alternative reading of the same quantity and nothing
        else. Every one of these is still rejected.
        """
        assert numeric_scan.unjustified_tokens(prose, self.FIGURES)

    def test_a_figure_with_no_scaled_unit_gains_nothing(self):
        """The negative control for the widening itself."""
        figures = [{"value": 4653.0, "signal_field": "latest_value", "unit": "passengers"}]

        assert numeric_scan.unjustified_tokens("4.65 million passengers", figures)


class TestThePipelineHandsOverTheReadableForm:
    def test_the_seasonal_basis_the_writer_must_restate(self):
        """The basis is quoted verbatim, so it is where the fault entered."""
        signal = detect_seasonal_deviation(rail_series(), z_threshold=0.5)

        assert signal is not None
        assert "million passengers" in signal.comparison_basis
        assert house_style.unreadable_scale_phrase(signal.comparison_basis) is None

    def test_every_detector_hands_over_a_readable_basis(self):
        """The class, not the instance.

        Five of the six bases interpolated ``{value:g}`` and the series unit
        directly. The seasonal one did not — it already asked ``units`` — which
        is exactly why the fault survived review: the correct sibling was in
        the same file.
        """
        from newsroom.tests.pipeline.test_basis_declarable import all_detector_signals

        offenders = {
            name: phrase
            for name, signal in all_detector_signals()
            if (phrase := house_style.unreadable_scale_phrase(signal.comparison_basis))
        }

        assert not offenders

    def test_the_figure_table_gives_both_answers(self):
        """What to declare and what to write are different questions."""
        signal = detect_seasonal_deviation(rail_series(), z_threshold=0.5)

        table = "\n".join(
            field_meanings.figure_table(signal, internal_only=units.INTERNAL_ONLY_FIELDS)
        )

        assert "latest_value = 4653" in table
        assert "write this as 4.65 million passengers" in table
        assert "declare the value as 4653" in table

    def test_it_stays_quiet_when_there_is_nothing_to_restate(self):
        """The table must not double in length for every ordinary series."""
        from newsroom.tests.pipeline.conftest import series_from as build

        signal = detect_seasonal_deviation(
            build(
                [18.0, 18.4, 17.8, 18.2, 18.1, 23.5],
                periods=[f"{year}-08" for year in range(2021, 2027)],
                metric="mean_air_temperature",
                metric_label="mean air temperature",
                unit="\u00b0C",
                section="environment",
            )
        )
        table = "\n".join(
            field_meanings.figure_table(signal, internal_only=units.INTERNAL_ONLY_FIELDS)
        )

        assert "write this as" not in table


class TestTheEditorCatchesIt:
    """The backstop, for the case where the writer ignores all of the above."""

    def test_the_published_sentence_is_refused(self):
        problems = house_style.check_prose(PUBLISHED)

        assert any("makes the reader do the arithmetic" in p for p in problems)

    def test_the_message_names_the_scale_to_use(self):
        """A violation the writer cannot act on costs an attempt and fixes nothing."""
        _, smaller = house_style.unreadable_scale_phrase(PUBLISHED)

        assert smaller == "million"

    def test_the_rewrite_is_clean(self):
        """The positive control's other half.

        Without it, a check that fired on all prose would pass the test above.
        """
        rewritten = (
            "Latvia recorded 4.65 million rail passenger journeys in 2026-Q1, up "
            "998 thousand on the nine-year average of 3.65 million for the same "
            "point in the year."
        )

        assert house_style.check_prose(rewritten) == []

    @pytest.mark.parametrize(
        "text",
        [
            "Trade was worth 1500 million euro.",
            "Ports handled 25,605 thousand tonnes.",
            "The package was worth 2000 million euro.",
        ],
    )
    def test_it_generalises_past_the_one_unit(self, text):
        assert house_style.check_prose(text)

    @pytest.mark.parametrize(
        "text",
        [
            "Prices have not been this high since 2019.",
            "Ports handled 25.6 million tonnes.",
            "The spread reached 49.64 EUR/MWh in the same quarter.",
            "Roughly a third of the 900 thousand journeys were commuter trips.",
        ],
    )
    def test_it_leaves_correct_prose_alone(self, text):
        assert house_style.check_prose(text) == []

    def test_the_check_reaches_a_whole_article(self):
        """Firing in isolation is not enough — a check nothing calls is invisible."""
        import types

        article = types.SimpleNamespace(
            headline="Latvian rail traffic rose in the first quarter",
            dek=None,
            body=[
                types.SimpleNamespace(
                    type="paragraph", text=PUBLISHED, figures=[], chart_ref=None
                )
            ],
        )

        report = house_style.apply_house_style(article)

        assert any("makes the reader do the arithmetic" in v for v in report.violations)


class TestThePromptTellsTheTruthAboutIt:
    """An example in guidance is a claim about behaviour — execute it.

    The system prompt teaches this rule with a worked figure. If the renderer
    ever disagrees with it the writer is being taught a conversion the pipeline
    will not accept, and nothing else would report the loss.
    """

    def test_the_prompt_states_the_rule(self):
        from newsroom.pipeline.write import prompts

        flat = " ".join(prompts._SYSTEM_TEMPLATE.split())

        assert "WRITE A QUANTITY AT THE SCALE A READER READS IT AT" in flat
        assert "a figure of 4653 in thousand passengers is 4.65 million passengers" in flat

    def test_the_worked_figure_is_what_the_renderer_produces(self):
        assert units.quantity(4653.0, "thousand passengers") == "4.65 million passengers"

    def test_the_form_the_prompt_forbids_is_the_form_the_editor_refuses(self):
        assert house_style.unreadable_scale_phrase("4653 thousand passengers") is not None


class TestASignIsTheSameQuestionAsAScale:
    """A negative distance is DECLARED signed and WRITTEN as a magnitude.

    THE REJECTIONS THAT PRODUCED THIS
    ---------------------------------
    Read from the published run history, ``runs/<date>/<HHMMSS>.json``, deduped
    on each report's own ``finished_at`` -- 22 dated reports, 17 rejections::

        2026-08-29  deviation      33.58 vs   -33.5778  tol 0.005
        2026-08-30  deviation     130.97 vs  -130.969   tol 0.005
        2026-08-31  deviation     130.97 vs  -130.969   tol 0.005
        2026-09-01  deviation        6.9 vs      -6.9   tol 0.05
        2026-09-01  deviation     130.97 vs  -130.969   tol 0.005

    **5 of the 17 rejections**, every one with the magnitude correct to within
    the check's own tolerance and only the sign wrong -- and three of them the
    same signal (slug suffix ``14b009``, which is ``signal.id[:6]`` and so
    fixes detector, metric, geography, period and value) regenerated and
    rejected again on three consecutive days.

    WHY THE FIX IS NOT IN THE GATE
    ------------------------------
    ``figures_traceable`` is right to compare signed, and both declarations
    were executed rather than argued::

        declare  130.97   figures_traceable False  no_invented_numbers True
        declare -130.969  figures_traceable True   no_invented_numbers True

    So the writer can already satisfy both; it was simply never told which form
    goes where. ``value_justifies`` compares magnitude without sign by design,
    which is what makes "132 GWh below" publishable against a declared -132.
    Weakening the gate would have cost the 3 genuine magnitude faults it caught
    over the same window.
    """

    @staticmethod
    def _table(signal) -> str:
        return "\n".join(
            field_meanings.figure_table(signal, internal_only=units.INTERNAL_ONLY_FIELDS)
        )

    @staticmethod
    def _junes(final: float):
        return series_from(
            [1000.0, 1004.0, 998.0, 1002.0, 1001.0, final],
            periods=[f"{year}-06" for year in range(2021, 2027)],
            metric="electricity_production",
            metric_label="electricity production",
            unit="GWh",
            section="energy",
        )

    def test_the_writer_is_told_both_forms_of_a_negative_distance(self):
        """Fails without the change: the table showed -132 and stopped."""
        signal = detect_seasonal_deviation(self._junes(869.0))
        assert signal.fields["deviation"] == pytest.approx(-132.0)

        table = self._table(signal)

        assert "deviation = -132" in table
        assert "write this as 132 GWh — declare the value as -132" in table

    def test_the_pair_it_names_passes_both_numeric_checks(self):
        """The requirement, not the wording: an article written to this table
        must survive the gate that was rejecting it."""
        signal = detect_seasonal_deviation(self._junes(869.0))
        declared = signal.fields["deviation"]

        token = numeric_scan.scan("Production ran 132 GWh below the seasonal average.")
        figure = {"value": declared, "signal_field": "deviation", "unit": "GWh"}

        assert token, "the probe must be able to see a numeral at all"
        assert all(numeric_scan.is_justified(t, [figure]) for t in token)
        assert abs(declared - signal.fields["deviation"]) <= 0.005

    def test_a_negative_LEVEL_keeps_its_sign(self):
        """CONTROL. -2 °C is written -2 °C; dropping that sign invents a
        reading four degrees from the truth. Only a distance may lose it."""
        signal = detect_seasonal_deviation(
            series_from(
                [-8.0, -7.6, -8.2, -7.8, -7.9, -2.0],
                periods=[f"{year}-02" for year in range(2021, 2027)],
                metric="mean_air_temperature",
                metric_label="mean air temperature",
                unit="\u00b0C",
                section="environment",
            )
        )
        table = self._table(signal)

        assert "latest_value = -2" in table
        assert "seasonal_mean = -7.9" in table
        assert "write this as" not in table

    def test_a_positive_distance_says_nothing_extra(self):
        """CONTROL. The line is emitted only where the two forms differ.

        Kept under a thousand so the pre-existing SCALE line cannot fire and be
        mistaken for this one -- and asserted on the deviation's own line
        rather than on the whole table, so the two mechanisms stay separable.
        """
        signal = detect_seasonal_deviation(
            series_from(
                [500.0, 504.0, 498.0, 502.0, 501.0, 632.0],
                periods=[f"{year}-06" for year in range(2021, 2027)],
                metric="electricity_production",
                metric_label="electricity production",
                unit="GWh",
                section="energy",
            )
        )
        assert signal.fields["deviation"] > 0

        lines = field_meanings.figure_table(
            signal, internal_only=units.INTERNAL_ONLY_FIELDS
        )
        after_deviation = self._line_after(lines, "- deviation =")

        assert after_deviation is not None, "the probe must have found the row"
        assert "write this as" not in after_deviation

    @staticmethod
    def _line_after(lines: list[str], prefix: str) -> str | None:
        """The continuation line for a field, or '' when it has none."""
        for index, line in enumerate(lines):
            if line.strip().startswith(prefix):
                following = lines[index + 1] if index + 1 < len(lines) else ""
                return "" if following.strip().startswith("- ") else following
        return None

    def test_the_negative_row_is_the_one_carrying_the_line(self):
        """The positive control's other half, read the same way: it is the
        DEVIATION's own continuation that changed, not some neighbouring row."""
        signal = detect_seasonal_deviation(self._junes(869.0))

        lines = field_meanings.figure_table(
            signal, internal_only=units.INTERNAL_ONLY_FIELDS
        )
        after_deviation = self._line_after(lines, "- deviation =")

        assert after_deviation is not None
        assert "write this as 132 GWh — declare the value as -132" in after_deviation

    def test_the_classification_is_the_shared_one(self):
        """A second copy of DIFFERENCE_FIELDS would drift from the first, which
        is the failure ``units`` says in its own comment it exists to prevent.
        Asserted over the whole set, with a name outside it as the control."""
        assert units.DIFFERENCE_FIELDS, "an empty set would pass this vacuously"

        assert all(
            field_meanings.writes_magnitude(name, -1.0)
            for name in units.DIFFERENCE_FIELDS
        )
        assert not any(
            field_meanings.writes_magnitude(name, 1.0)
            for name in units.DIFFERENCE_FIELDS
        )
        for level in ("latest_value", "seasonal_mean", "previous_value"):
            assert not field_meanings.writes_magnitude(level, -1.0)
