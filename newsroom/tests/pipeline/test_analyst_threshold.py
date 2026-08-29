"""The desk may not name a threshold the correspondent cannot publish.

WHY THIS FILE
-------------
House style asks every piece to close on what the next release would have to
show, and the analyst prompt says outright that "the correspondent quotes your
claims almost verbatim". Measured on the run of 2026-08-28, it does — the
closing paragraph is the desk's ``what_to_watch`` with a clause bolted on.

``_ground`` has always validated the field *names* a mechanism cites. Nothing
validated the *numbers* in the desk's own prose, and those are the ones that
reach the page as numerals. Four of that run's eight briefs named a threshold
that is not a figure the newsroom retrieved:

    desk    "A reading below 4000 thousand passengers in the next quarter"
    writer  the same sentence, 4000 declared against baseline_years = 9.0
    gate    figures_traceable: refused -- AND IT WAS THE ARTICLE'S ONLY FAULT

Three of the four damaged the draft at exactly that paragraph; the fourth
survived only because the writer quietly swapped the desk's ``500 GWh`` for the
real ``529``. The writer is not the culprit and hardening it would not help:
handed an untraceable threshold its options are to print it (refused by
``figures_traceable``), to leave it undeclared (refused by
``no_invented_numbers``), or to throw the closing away.

WHAT EACH TEST DEFENDS
----------------------
Every test here was written against a specific mutation of
``newsroom/pipeline/analyst.py`` that leaves the module importable and the rest
of the suite green. Each names the mutation it catches. The negative tests
matter more than the positive ones: a guard that drops every threshold would
satisfy "the bad one is gone" while destroying the ten that were correct.
"""

from __future__ import annotations

from newsroom.pipeline.analyst import AnalystBrief, _untraceable_threshold

#: The rail signal's real fields, from the draft this check was built on.
RAIL_FIELDS = {
    "latest_value": 4449.0,
    "previous_value": 3980.0,
    "baseline_years": 9.0,
    "change_pct": 11.8,
}


class TestAnUntraceableThresholdIsFound:
    def test_finds_the_number_that_cost_a_whole_article(self):
        """The real sentence, the real fields, the real outcome.

        MUTATION THIS CATCHES: returning ``()`` unconditionally — a guard that
        cannot fire, which is this repo's most-repeated defect and passes every
        other test in the file that only checks the good cases.
        """
        unresolved = _untraceable_threshold(
            "A reading below 4000 thousand passengers in the next quarter would "
            "suggest a potential shift in this trend.",
            RAIL_FIELDS,
        )

        assert unresolved, "4000 is not among the retrieved figures"
        assert any("4000" in token for token in unresolved)

    def test_finds_a_rounded_version_of_a_real_figure(self):
        """``400000`` against a true ``411149``.

        The dangerous shape, because it looks careful. The desk rounded a real
        number and the writer declared the rounding against the field it came
        from, which ``figures_traceable`` refused at a tolerance of 0.5.
        """
        unresolved = _untraceable_threshold(
            "A reading above 400000 nights in the next June would indicate "
            "sustained growth in foreign tourism.",
            {"latest_value": 411149.0, "previous_value": 388020.0},
        )

        assert unresolved

    def test_finds_a_percentage_the_desk_rounded_up(self):
        """``2.00%`` from a true ``1.99``. Refused by ``no_invented_numbers``
        when the writer left it undeclared, which is the other exit from the
        same trap."""
        unresolved = _untraceable_threshold(
            "A further increase above 2.00% of GDP in the next annual reading "
            "would indicate a sustained commitment to R&D investment.",
            {"latest_value": 1.99, "seasonal_mean": 1.22},
        )

        assert unresolved


class TestAGoodThresholdIsLeftAlone:
    """The half that matters more. Every one of these published."""

    def test_an_exact_field_value_resolves(self):
        """``25.35`` quoted from ``seasonal_mean``. This is the behaviour the
        prompt asks for and the guard must never touch it.

        MUTATION THIS CATCHES: comparing against the wrong collection — the
        field *names* rather than the values — which makes every threshold
        untraceable and silently removes the closing from every article.
        """
        assert (
            _untraceable_threshold(
                "A reading above 25.35% in the next year would indicate a return "
                "to higher inflation levels for home energy.",
                {"latest_value": 9.0, "seasonal_mean": 25.35, "deviation": -16.35},
            )
            == ()
        )

    def test_a_correctly_rounded_figure_resolves(self):
        """``104.78`` written for a true ``104.778``.

        Correct rounding at the precision the prose chose, which
        ``numeric_scan.rendering_tolerance`` permits and a naive equality test
        would not. This draft was published on that paragraph.
        """
        assert (
            _untraceable_threshold(
                "A future reading above 104.78 index points would indicate a "
                "recovery towards the seasonal average.",
                {"seasonal_mean": 104.778, "latest_value": 61.5},
            )
            == ()
        )

    def test_a_threshold_with_no_numeral_resolves(self):
        """"above the nine-year average" names a reading without naming a
        number, which house style accepts and nothing here should refuse."""
        assert (
            _untraceable_threshold(
                "A sustained level above the nine-year average in future quarters "
                "would suggest a continued strong construction trend.",
                RAIL_FIELDS,
            )
            == ()
        )

    def test_a_period_label_is_not_a_threshold(self):
        """``June 2027`` and ``2026-Q2`` are when, not how much.

        Free from ``numeric_scan``, which excludes years and dates by design —
        and the reason this reuses it rather than scanning for digits. A guard
        that read ``2027`` as a magnitude would drop a correct threshold on
        every forward-looking sentence the desk writes.

        MUTATION THIS CATCHES: replacing the scan with a bare ``\\d+`` regex.
        """
        assert (
            _untraceable_threshold(
                "A reading above 4449 thousand passengers in June 2027, or in "
                "2026-Q2, would confirm it.",
                RAIL_FIELDS,
            )
            == ()
        )

    def test_an_empty_threshold_is_not_a_fault(self):
        assert _untraceable_threshold("", RAIL_FIELDS) == ()
        assert _untraceable_threshold("The next release is due in March.", RAIL_FIELDS) == ()


class TestTheBriefRecordsIt:
    def test_the_reason_is_its_own_field_not_a_mechanism_discard(self):
        """``mechanisms_discarded`` counts MECHANISMS.

        Folding a dropped threshold into ``discarded`` would have been the
        one-line change and would have made a published count mean something
        else — the same fault as a rejection with no reason wearing an
        ``errors: 0``.

        MUTATION THIS CATCHES: ``discarded=(*discarded, threshold_reason)``.
        """
        brief = AnalystBrief(
            expert="Dr X",
            discipline="macroeconomist",
            discarded=("a mechanism grounded in nothing",),
            threshold_discarded="the desk named '4000'",
        )

        payload = brief.to_provenance()

        assert payload["mechanisms_discarded"] == 1
        assert payload["threshold_discarded"] == "the desk named '4000'"

    def test_absence_means_it_did_not_fire_rather_than_nobody_looked(self):
        """The key is omitted when clean, so a reader cannot mistake an empty
        string for a checked-and-fine result. Same construction as
        ``revision_unavailable`` and ``gate_unavailable``."""
        clean = AnalystBrief(expert="Dr X", discipline="macroeconomist").to_provenance()

        assert "threshold_discarded" not in clean

    def test_the_provenance_still_satisfies_the_article_schema(self):
        """``provenance.analysis`` sets ``additionalProperties: false``, so an
        undeclared key fails the schema on the way out."""
        import json
        from pathlib import Path

        schema = json.loads(
            (
                Path(__file__).resolve().parents[2] / "schemas" / "article.schema.json"
            ).read_text(encoding="utf-8")
        )
        declared = schema["properties"]["provenance"]["properties"]["analysis"]["properties"]

        payload = AnalystBrief(
            expert="Dr X", discipline="macroeconomist", threshold_discarded="because"
        ).to_provenance()

        assert set(payload) <= set(declared), set(payload) - set(declared)
