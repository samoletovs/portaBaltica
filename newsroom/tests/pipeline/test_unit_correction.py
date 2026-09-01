"""The sixth correction shape: a right number under the wrong unit.

WHAT THIS GUARDS, AND WHY IT IS NOT THE FIFTH SHAPE'S TESTS AGAIN
------------------------------------------------------------------
``AGENTS.md`` records that each correction shape "is defined less by what it
says than by one sentence it will not say", and that forcing one shape through
another "publishes another shape's truth as this one's, inside a correction
notice, on the one page a reader visits already doubting us".

This shape refuses two sentences that every other builder in
``newsroom/pipeline/revisions.py`` is free to say, and both refusals are
asserted below with a control proving some other shape does say them — an
assertion that something is absent needs a companion proving it could have been
present.

THE POPULATION, MEASURED RATHER THAN TAKEN ON TRUST
----------------------------------------------------
The brief for this pass reported nine mis-united figures across eight articles
and asked for all eight to be corrected. Swept against the served blobs on
2026-09-01, the nine are real *as metadata* and only three are wrong *in the
prose a reader sees*:

    93 index entries · 39 with declared figures · 257 declared figures
      9 flagged  (signal_field in ABSOLUTE_DIFFERENCE_FIELDS under a rate unit)
      5 rendered "N percentage points"  -> correct, all `deviation`, seasonal
      1 not rendered in its paragraph   -> its block states `deviation_pct`
      3 rendered "N%"                   -> WRONG, all `cumulative_change`, streak

Nothing in ``src/`` reads ``block.figures``; ``ArticleView`` renders
``block.text``, so ``unit`` and ``rendered_as`` never reach a reader. That split
independently reproduces the count ``units.py`` already carries in its own
comment — "the seasonal section ... got 5 of 5 right, the streak section ...
got 0 of 3". :class:`TestThePopulationIsTheProse` pins it, so a later sweep of
the metadata cannot re-raise six articles that were never wrong to a reader.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from newsroom.pipeline.corrections import (
    PENDING,
    UNIT_GOODS_INFLATION,
    UNIT_HOUSE_PRICES,
    UNIT_RENEWABLES,
)
from newsroom.pipeline.revisions import append_correction, unit_correction_note
from newsroom.pipeline.units import (
    ABSOLUTE_DIFFERENCE_FIELDS,
    PERCENTAGE_POINTS,
    is_rate_unit,
    unit_for_field,
)

REPO = pathlib.Path(__file__).resolve().parents[3]

#: The subject, as published. Every argument is a reading the article itself
#: declares — `streak_start_value`, `latest_value`, `cumulative_change` — so the
#: fixture states the same numbers the page does.
HOUSE_PRICES = dict(
    claim='that Latvia\'s house prices showed a "cumulative change of 5.5% year on year"',
    start_value=5.4,
    start_period="2025-Q1",
    latest_value=10.9,
    latest_period="2026-Q1",
    change=5.5,
    still_stands="Latvian house price growth did accelerate across those four quarters",
)

#: The series unit each corrected article declares on its own figures, read off
#: the served blob. Not a parameter of the builder — 0 of the 14 rate-like
#: units in ``collect/opendata.py`` contains a digit, so a ``unit`` argument
#: could never carry a figure and would have broken the parameter table's
#: documented claim whichever way it was classified. The check it would have
#: bought is here instead, on the three real subjects.
DECLARED_UNITS = {
    "latvia-s-house-prices-rise-10-9-year-on-year-b069b5": "% year on year",
    "lithuania-s-goods-inflation-reaches-4-8-after-six-consecutive-6e1271": (
        "% change on a year earlier"
    ),
    "lithuania-s-renewable-energy-share-hits-record-38-5-in-bb595c": (
        "% of gross final consumption"
    ),
}

#: The published sentences the three notices are about, copied from the served
#: blobs. Pinned so `test_every_quoted_fragment_is_verbatim` can run the claim
#: against the page rather than against a memory of it — `AGENTS.md` records a
#: session quoting a blockquote that was never written.
PUBLISHED = {
    "latvia-s-house-prices-rise-10-9-year-on-year-b069b5": (
        "The cumulative change of 5.5% year on year indicates a strong upward "
        "trend in the housing market, with house prices rising significantly "
        "over the past year."
    ),
    "lithuania-s-goods-inflation-reaches-4-8-after-six-consecutive-6e1271": (
        "This latest figure represents a cumulative change of 3.2% across the "
        "six-month streak, reflecting a significant shift in price dynamics "
        "since the series began in January 1997."
    ),
    "lithuania-s-renewable-energy-share-hits-record-38-5-in-bb595c": (
        "Lithuania's renewable energy share reached 38.5% of gross final "
        "consumption in 2025, compared with 24.7% in 2018. This marks seven "
        "consecutive annual increases since the series began, with a "
        "cumulative change of 13.8%."
    ),
}

UNIT_NOTICES = (UNIT_HOUSE_PRICES, UNIT_GOODS_INFLATION, UNIT_RENEWABLES)


def _text(**overrides) -> str:
    return unit_correction_note(**{**HOUSE_PRICES, **overrides})["description"]


class TestItSaysWhatIsActuallyWrong:
    def test_it_names_percentage_points(self):
        assert "5.5 percentage points" in _text()

    def test_it_gives_the_reading_the_percent_sign_invited(self):
        """The whole point: 5.5% and 101.9% are not the same claim."""
        text = _text()
        assert "reads as a change of 5.5%" in text
        assert "is 101.9%" in text

    def test_it_says_the_readings_are_percentages_without_a_unit_argument(self):
        """The `%` on each reading is what tells a reader the series is a rate.

        The builder takes no `unit`; see its docstring, and
        `TestTheThreeFiledNotices.test_every_corrected_series_is_a_rate` for
        where that check went instead.
        """
        assert "5.4% in 2025-Q1 and 10.9% in 2026-Q1" in _text()

    def test_the_relative_change_is_derived_not_declared(self):
        """Change the readings and the stated percentage must follow them.

        MUTATION THIS CATCHES: a builder that took the relative change as an
        argument, which is the form `AGENTS.md` records shipping a two-year
        error inside a correction about a misattributed span.
        """
        moved = _text(start_value=1.6, latest_value=4.8, change=3.2)
        assert "is 200%" in moved
        assert "101.9" not in moved

    def test_the_factor_is_derived_and_is_one_hundred_over_the_base(self):
        assert "18.5 times as large" in _text()
        assert "62.5 times as large" in _text(
            start_value=1.6, latest_value=4.8, change=3.2
        )
        assert "4 times as large" in _text(
            start_value=24.7, latest_value=38.5, change=13.8
        )

    def test_a_fall_is_described_as_a_fall(self):
        """The direction is read off the numbers, never assumed."""
        assert "the figure rose as reported" in _text()
        fell = _text(start_value=10.9, latest_value=5.4, change=-5.5)
        assert "the figure fell as reported" in fell
        assert "5.5 percentage points" in fell, "the magnitude stays unsigned"
        assert "is -50.5%" in fell, "the relative change keeps its sign"


class TestWhatThisShapeRefusesToSay:
    """Each refusal, with a control proving another shape does say it."""

    @staticmethod
    def _others() -> dict[str, str]:
        from newsroom.tests.pipeline.test_scope_correction import (
            CARS,
            CONSTRUCTION,
            CORE_INFLATION,
            ELECTRICITY,
            FOOD,
            RAIL,
        )
        from newsroom.pipeline.revisions import (
            comparison_correction_note,
            origin_correction_note,
            record_correction_note,
            span_correction_note,
        )

        return {
            "record scope": record_correction_note(**FOOD)["description"],
            "record beaten": record_correction_note(**RAIL)["description"],
            "record rank": record_correction_note(**CONSTRUCTION)["description"],
            "origin": origin_correction_note(**CARS)["description"],
            "span": span_correction_note(**ELECTRICITY)["description"],
            "comparison": comparison_correction_note(**CORE_INFLATION)["description"],
        }

    def test_it_refuses_the_figures_are_unchanged(self):
        """True of the number 5.5 and false of the published "5.5%".

        A notice read by someone already doubting us must not rest on which of
        those two the reader has in mind.

        Case-folded, and that is not tidiness. A refused phrase reaches a
        notice most naturally at the START of a sentence, where it is
        capitalised -- so a case-sensitive `not in` misses the single likeliest
        way the fault would actually appear. Verified by planting
        "The figures are unchanged and correct." into the builder: the
        lower-case form of this check passed it, 32 of 32 green. The sibling
        four assertions below already folds case; this one did not, which is
        why nobody looked.
        """
        phrase = "the figures are unchanged"
        assert phrase not in _text().lower()
        # CONTROL: some other shape does say it, or this asserts nothing.
        said_by = {n for n, t in self._others().items() if phrase in t.lower()}
        assert said_by, "no shape says it — the phrase is wrong, not the code"

    def test_it_refuses_the_figure_itself_is_unchanged_and_correct(self):
        phrase = "the figure itself is unchanged and correct"
        assert phrase not in _text().lower()
        said_by = {n for n, t in self._others().items() if phrase in t.lower()}
        assert said_by, "no shape says it — the phrase is wrong, not the code"

    def test_it_refuses_the_opposite_direction_sentence_span_owns(self):
        """All three subjects rose. `span_correction_note` hardcodes an
        inversion, and publishing it here would be a fresh falsehood inside a
        correction — the fault that builder exists to avoid, from the other
        side."""
        phrase = "the opposite direction to the"
        assert phrase not in _text().lower()
        said_by = {n for n, t in self._others().items() if phrase in t.lower()}
        assert said_by == {"span"}, said_by

    def test_it_claims_no_record_and_no_placing(self):
        text = _text()
        for phrase in ("lowest", "highest", "record", "superlative"):
            assert phrase not in text.lower(), phrase

    def test_it_says_something_no_other_shape_says(self):
        phrase = "on a rate series the unit is what carries the size"
        assert phrase in _text()
        assert not {n for n, t in self._others().items() if phrase in t}
        # CONTROL: a phrase no shape says, so "exactly none" is a reading.
        assert not {
            n for n, t in self._others().items() if "no shape says this" in t
        }

    def test_it_is_distinguishable_from_every_other_shape(self):
        """MUTATION THIS CATCHES: a sixth shape that is a copy of a fifth."""
        texts = list(self._others().values()) + [_text()]
        assert len(set(texts)) == len(texts), "two shapes render identically"


class TestItRefusesFiguresItCannotMean:
    def test_it_refuses_three_figures_two_of_which_disagree(self):
        with pytest.raises(ValueError, match="two of which disagree"):
            _text(change=4.0)

    def test_it_accepts_ordinary_float_noise(self):
        """10.9 - 5.4 is 5.500000000000001, and a tolerance is not a licence."""
        assert _text(change=10.9 - 5.4)
        with pytest.raises(ValueError):
            _text(change=5.5 + 1e-6)

    def test_a_non_positive_base_is_refused_rather_than_rendered(self):
        """-1.38 to 4.8 gives -448%, which is arithmetic and not a fact."""
        with pytest.raises(ValueError, match="meaningless"):
            _text(start_value=0.0, change=10.9)
        with pytest.raises(ValueError, match="meaningless"):
            _text(start_value=-1.38, change=12.28)

    def test_a_distance_of_zero_has_no_unit_worth_correcting(self):
        with pytest.raises(ValueError, match="no unit worth correcting"):
            _text(latest_value=5.4, change=0.0)

    def test_still_stands_is_required(self):
        """This shape exists because the reading, the distance and the
        direction all stand. A notice that only denies reads as a retraction."""
        with pytest.raises(ValueError, match="say what stands"):
            _text(still_stands="   ")


class TestTheThreeFiledNotices:
    def test_all_three_are_in_the_register_the_run_applies(self):
        for notice in UNIT_NOTICES:
            assert notice in PENDING

    def test_every_corrected_series_is_a_rate(self):
        """Asks `units.is_rate_unit`, the function `#344` fixed, rather than a
        second copy of the rule — and asks it of the three real subjects.

        A distance across a series that is *not* a rate is already in the
        series' own unit, and "down 0.1 EUR per kWh" is correct as written. So
        a notice filed on one would be correcting something that was right.
        """
        for notice in UNIT_NOTICES:
            unit = DECLARED_UNITS[notice.slug]
            assert is_rate_unit(unit), f"{notice.slug}: {unit!r} is not a rate"
            assert unit_for_field("cumulative_change", unit) == PERCENTAGE_POINTS
        # CONTROL: the same two calls on a level series must answer the other
        # way, or this asserts nothing about either.
        assert not is_rate_unit("EUR per kWh")
        assert unit_for_field("cumulative_change", "EUR per kWh") == "EUR per kWh"

    def test_every_quoted_fragment_is_verbatim_in_the_published_sentence(self):
        """A claim is a quotation, and a quotation is a claim about the page.

        MUTATION THIS CATCHES: a paraphrase presented in quotation marks —
        `AGENTS.md` records exactly that shipping in a pull request body.
        """
        import re

        for notice in UNIT_NOTICES:
            published = PUBLISHED[notice.slug]
            quoted = re.findall(r'"([^"]+)"', notice.description)
            assert quoted, f"{notice.slug}: the notice quotes nothing"
            for fragment in quoted:
                assert fragment in published, (
                    f"{notice.slug}: {fragment!r} is not in the published "
                    f"sentence {published!r}"
                )

    def test_every_previous_value_is_verbatim(self):
        for notice in UNIT_NOTICES:
            assert notice.previous_value
            assert notice.previous_value in PUBLISHED[notice.slug], (
                f"{notice.slug}: previous_value is not on the page"
            )

    def test_each_states_its_own_figures(self):
        pairs = {
            UNIT_HOUSE_PRICES: ("5.5 percentage points", "is 101.9%", "18.5 times"),
            UNIT_GOODS_INFLATION: ("3.2 percentage points", "is 200%", "62.5 times"),
            UNIT_RENEWABLES: ("13.8 percentage points", "is 55.9%", "4 times"),
        }
        for notice, expected in pairs.items():
            for phrase in expected:
                assert phrase in notice.description, (notice.slug, phrase)

    def test_no_two_notices_share_a_description(self):
        """`append_correction` de-duplicates on the description, so two
        identical notices would silently file one."""
        descriptions = [n.description for n in PENDING]
        assert len(set(descriptions)) == len(descriptions)

    def test_the_renewables_notice_does_not_contradict_the_one_already_filed(self):
        """`#342`'s notice on that article says the run of seven begins in 2018
        and that 38.5% is the highest of all 22 readings. Both are restated,
        neither is re-derived, so a reader meeting the two together is not told
        two things.
        """
        text = UNIT_RENEWABLES.description
        assert "2018" in text and "2025" in text
        assert "highest of the 22 readings" in text
        assert "since the series began" not in text, (
            "the phrase #342 corrected must not be re-endorsed here"
        )

    def test_applying_the_same_notice_twice_is_a_no_op(self):
        document: dict = {"corrections": []}
        once = append_correction(document, UNIT_HOUSE_PRICES.to_correction())
        assert once is not None and len(once["corrections"]) == 1
        assert append_correction(once, UNIT_HOUSE_PRICES.to_correction()) is None


class TestThePopulationIsTheProse:
    """Six of the nine flagged figures were correctly worded and need no notice.

    Pinned so a later sweep of the *metadata* cannot re-raise articles that
    never told a reader anything false.
    """

    #: Every flagged figure in the corpus, as measured on 2026-09-01, with how
    #: its own paragraph renders it. `deviation` is the seasonal detector's
    #: field and `cumulative_change` the streak detector's.
    FLAGGED = [
        ("estonia-s-home-energy-inflation", "deviation", "POINTS"),
        ("estonia-s-unemployment-rate", "deviation", "POINTS"),
        ("estonia-s-unemployment-rate", "deviation", "NOT RENDERED"),
        ("latvia-s-retail-trade-volume-rises", "deviation", "POINTS"),
        ("latvia-s-retail-trade-volume-rose", "deviation", "POINTS"),
        ("lithuania-s-producer-prices", "deviation", "POINTS"),
        ("latvia-s-house-prices", "cumulative_change", "PERCENT"),
        ("lithuania-s-goods-inflation", "cumulative_change", "PERCENT"),
        ("lithuania-s-renewable-energy-share", "cumulative_change", "PERCENT"),
    ]

    def test_only_the_percent_rendered_figures_were_corrected(self):
        wrong = [row for row in self.FLAGGED if row[2] == "PERCENT"]
        assert len(wrong) == len(UNIT_NOTICES) == 3
        assert {row[1] for row in wrong} == {"cumulative_change"}

    def test_the_correctly_worded_ones_are_the_seasonal_detector(self):
        right = [row for row in self.FLAGGED if row[2] == "POINTS"]
        assert len(right) == 5
        assert {row[1] for row in right} == {"deviation"}

    def test_the_two_detectors_split_exactly_as_units_py_records(self):
        """`units.py` records "the seasonal section ... got 5 of 5 right, the
        streak section ... got 0 of 3", from the pass that produced `#344`.
        This pass measured the corpus independently and agrees.
        """
        source = (REPO / "newsroom" / "pipeline" / "units.py").read_text(
            encoding="utf-8"
        )
        assert "got 5 of 5 right" in source and "got 0 of 3" in source
        seasonal = [r for r in self.FLAGGED if r[1] == "deviation" and r[2] != "NOT RENDERED"]
        streak = [r for r in self.FLAGGED if r[1] == "cumulative_change"]
        assert (len(seasonal), sum(r[2] == "POINTS" for r in seasonal)) == (5, 5)
        assert (len(streak), sum(r[2] == "PERCENT" for r in streak)) == (3, 3)

    def test_the_flagging_rule_is_the_one_that_shipped_in_344(self):
        """The metadata sweep asked `unit_for_field`, so it cannot drift."""
        assert unit_for_field("cumulative_change", "% year on year") == PERCENTAGE_POINTS
        assert unit_for_field("deviation", "% of the labour force") == PERCENTAGE_POINTS
        # CONTROL: a level on a rate series, and a difference on a level series.
        assert unit_for_field("latest_value", "% year on year") == "% year on year"
        assert unit_for_field("cumulative_change", "EUR per kWh") == "EUR per kWh"
        assert {"cumulative_change", "deviation"} <= ABSOLUTE_DIFFERENCE_FIELDS
        assert is_rate_unit("% of gross final consumption")

    def test_no_component_renders_the_stale_metadata(self):
        """Why six needed nothing: `unit`, `rendered_as` and `signal_field`
        reach no reader.

        MUTATION THIS CATCHES: a component starting to render `block.figures`,
        at which point the stale labels *would* become reader-facing and this
        pass would be incomplete.

        A KNOWN BLIND SPOT, STATED RATHER THAN IMPLIED. These are dot-access
        and snake_case tokens. `const { figures } = block` would bind the array
        without matching any of them, exactly as `AGENTS.md` records the seam
        sweep reporting a field read by five files that read nothing. The bare
        word `figures` cannot be used instead: measured, it appears in five
        further files, in an import path (`newsroom/format-figures`) and in
        prose inside string literals, none of which is a read.
        """
        src = REPO / "src"
        offenders = []
        for path in list(src.rglob("*.tsx")) + list(src.rglob("*.ts")):
            if path.name == "news-types.ts":
                continue  # the declaration itself, read by nobody
            code = _strip_comments(path.read_text(encoding="utf-8"))
            for token in ("rendered_as", "signal_field", ".figures"):
                if token in code:
                    offenders.append(f"{path.name}: {token}")
        assert not offenders, offenders
        # CONTROL: the declaration is found when it is not excluded, and the
        # token that IS rendered is found in the component that renders it.
        declaration = _strip_comments(
            (src / "news-types.ts").read_text(encoding="utf-8")
        )
        assert "rendered_as" in declaration, "the probe cannot see anything"
        article_view = _strip_comments(
            (src / "components" / "news" / "ArticleView.tsx").read_text(encoding="utf-8")
        )
        assert "block.text" in article_view


def _strip_comments(text: str) -> str:
    """Comments are not code.

    `AGENTS.md`: a content check that reads the prose explaining a thing
    reports the thing as present, and is least trustworthy on exactly the
    changes a reviewer most wants to verify.
    """
    import re

    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    return re.sub(r"(^|[^:])//.*$", r"\1", text, flags=re.MULTILINE)


class TestTheParameterTableGuardCoversEveryBuilder:
    """`test_agents_parameter_table.py` walks a hardcoded tuple of builders.

    A guard must enumerate the same set as the thing it guards — `AGENTS.md`
    records four instances of that fault, each found only by writing the two
    sets down and comparing them. This is the fifth, caught before it happened:
    adding a sixth builder without adding it there would leave the document's
    table describing five-sixths of the code, silently and in the direction
    nobody re-checks.
    """

    def test_builders_enumerates_every_correction_note_in_the_module(self):
        from newsroom.tests.pipeline.test_agents_parameter_table import BUILDERS

        tree = ast.parse(
            (REPO / "newsroom" / "pipeline" / "revisions.py").read_text(encoding="utf-8")
        )
        defined = {
            node.name
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
            and node.name.endswith("_correction_note")
        }
        assert defined, "the enumeration found nothing — the probe is broken"
        assert set(BUILDERS) == defined, (
            "the AGENTS.md parameter table walks a smaller set than the module\n"
            f"  unguarded: {sorted(defined - set(BUILDERS))}\n"
            f"  stale:     {sorted(set(BUILDERS) - defined)}"
        )

    def test_unit_correction_note_is_among_them(self):
        from newsroom.tests.pipeline.test_agents_parameter_table import BUILDERS

        assert "unit_correction_note" in BUILDERS
