"""A record that was only a record over our window gets a correction, not a retraction.

WHY THIS FILE
-------------
``Revision`` covers the case where the statistical office restated a figure we
printed: our number was right and the source moved. This is the opposite. The
source never moved, the figure is still correct, and what was wrong is the
**characterisation**.

Measured on 2026-08-29 against each article's own recorded source URL, with
only ``lastTimePeriod`` stripped so the dataset, the dimension pins and the
unit are the article's own rather than guessed:

    LV food inflation   prc_hicp_minr, coicop18=FOOD, 355 obs from 1997-01
                        published "record low of -2%"
                        true minimum -3.7% in 2010-02, 3 earlier readings lower
                        -> FALSE

    LT crude birth rate demo_gind,     66 obs from 1960     -> TRUE
    LT ports            mar_go_qm_lt,  89 obs from 2004-Q1  -> TRUE
    LV ports            mar_go_qm_lv,  96 obs from 2002-Q1  -> TRUE
    EE labour cost      lc_lci_lev,     9 obs from 2008     -> TRUE
    LV labour cost      lc_lci_lev,     9 obs from 2008     -> TRUE

**One false, five true.** A blanket retraction would have destroyed five correct
articles, which is why the verdict is per-article and rests on the article's own
source rather than on the metric's name. An earlier pass guessed the cube from
the metric name — ``prc_hicp_manr``/``CP011`` rather than
``prc_hicp_minr``/``FOOD`` — and got a true verdict from a false instrument,
which is the more dangerous of the two outcomes because nothing about it looks
wrong.
"""

from __future__ import annotations

from newsroom.pipeline.revisions import append_correction, scope_correction_note

#: The one article the measurement condemned, with its real numbers.
FOOD = dict(
    claim='Latvia\'s food inflation had dropped to a "record low" of -2% in July 2026',
    window="60 observations since 2021-08",
    true_extreme="-3.7%",
    true_period="2010-02",
    beaten=3,
)


class TestTheNoteSaysWhatAReaderNeeds:
    def test_it_names_the_claim_the_window_and_the_truth(self):
        note = scope_correction_note(**FOOD, corrected_at="2026-08-29T10:00:00Z")

        text = note["description"]
        assert text.startswith("CORRECTED.")
        assert "record low" in text
        assert "60 observations since 2021-08" in text
        assert "-3.7%" in text and "2010-02" in text
        assert note["corrected_at"] == "2026-08-29T10:00:00Z"

    def test_it_says_the_figure_itself_still_stands(self):
        """The -2% is correct and traceable. A notice that left a reader unsure
        whether the number was wrong would be a worse artefact than the
        headline it corrects.
        """
        text = scope_correction_note(**FOOD)["description"]

        assert "figure itself is unchanged and correct" in text

    def test_it_is_not_a_retraction(self):
        """The article should have been published — bounded. Calling it
        retracted would say it should not have been, which is false and would
        also remove it from the feeds."""
        text = scope_correction_note(**FOOD)["description"]

        assert "RETRACTED" not in text
        assert "should not have been published" not in text

    def test_one_earlier_reading_reads_as_singular(self):
        text = scope_correction_note(**{**FOOD, "beaten": 1})["description"]

        assert "1 earlier reading is" in text
        assert "readings are" not in text

    def test_the_note_matches_the_schema(self):
        import json
        from pathlib import Path

        schema = json.loads(
            (
                Path(__file__).resolve().parents[2] / "schemas" / "article.schema.json"
            ).read_text(encoding="utf-8")
        )
        item = schema["properties"]["corrections"]["items"]
        note = scope_correction_note(**FOOD)

        assert set(item["required"]) <= set(note)
        assert set(note) <= set(item["properties"])


class TestAppendingIsIdempotent:
    def test_the_same_note_twice_is_a_no_op(self):
        """A corrections log that repeats itself every run buries the real
        entries and makes the article look chaotically wrong.

        MUTATION THIS CATCHES: dropping the duplicate scan, which appends on
        every invocation and is invisible until someone reads the article.
        """
        note = scope_correction_note(**FOOD, corrected_at="2026-08-29T10:00:00Z")
        document = {"slug": "x", "status": "published"}

        once = append_correction(document, note)
        assert once is not None and len(once["corrections"]) == 1

        again = append_correction(once, note)
        assert again is None, "a second identical note must not be appended"

    def test_a_genuinely_different_note_still_lands(self):
        """The control for the test above: an idempotence guard that refused
        everything would satisfy it while making corrections impossible."""
        first = scope_correction_note(**FOOD, corrected_at="2026-08-29T10:00:00Z")
        second = scope_correction_note(
            **{**FOOD, "true_extreme": "-4.9%"}, corrected_at="2026-08-30T10:00:00Z"
        )

        document = append_correction({"slug": "x"}, first)
        document = append_correction(document, second)

        assert document is not None and len(document["corrections"]) == 2

    def test_it_does_not_mutate_the_document_it_was_given(self):
        """A caller that decides not to write must not already have changed the
        record."""
        document = {"slug": "x", "corrections": []}

        append_correction(document, scope_correction_note(**FOOD))

        assert document["corrections"] == []

    def test_an_empty_note_is_refused(self):
        assert append_correction({"slug": "x"}, {"description": "  "}) is None

    def test_an_existing_correction_is_preserved(self):
        """The log is append-only by policy — a log we can rewrite is not
        evidence of anything."""
        document = {"corrections": [{"corrected_at": "t", "description": "an earlier note"}]}

        updated = append_correction(document, scope_correction_note(**FOOD))

        assert updated is not None
        assert updated["corrections"][0]["description"] == "an earlier note"
        assert len(updated["corrections"]) == 2


class TestCorrectingDoesNotUnpublish:
    def test_status_is_untouched_so_the_page_survives(self):
        """The constraint that makes a corrections policy real.

        Both ``publish.is_servable`` and the frontend's ``isServable`` require
        ``status == "published"``. Setting the schema's ``corrected`` status
        here would be the obvious move and would delete the page the notice
        exists to be read on — an unpublish disguised as a correction.
        """
        from newsroom.validator import is_servable

        checks = [
            {"name": name, "passed": True}
            for name in __import__("newsroom.validator", fromlist=["x"]).CHECK_NAMES
        ]
        document = {
            "status": "published",
            "provenance": {"validator": {"passed": True, "checks": checks}},
        }
        assert is_servable(document)

        updated = append_correction(document, scope_correction_note(**FOOD))

        assert updated is not None
        assert updated["status"] == "published"
        assert is_servable(updated), "correcting an article must not remove it from the site"
