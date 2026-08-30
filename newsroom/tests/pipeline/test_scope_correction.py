"""A record claim the data does not support gets a correction, not a retraction.

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

AND THEN THE SWEEP ASKED ONLY HALF THE QUESTION
-----------------------------------------------
Every verdict above answers "is the claim true over the whole series?". None of
them asks "is it true over the window we actually retrieved?", because the note
builder assumed it was — its central sentence said the figure "was the lowest
only in the N observations that the newsroom had retrieved".

That assumption is a claim about the window, and it was never measured. For the
rail article, measured 2026-08-30T08:54Z, it is **false**: 4,653 thousand
passengers was called the highest of the 39 observations we held, and 15 of
those 39 are higher. The correction drafted from the old builder would have
published a fresh falsehood inside a correction notice.

So the builder now takes both counts and neither has a default. The two shapes:

    beaten_in_window == 0   a scope error. True over what we held, false over
                            what exists. `FOOD`.
    beaten_in_window > 0    not a scope error. False over both, so the notice
                            names what actually was the extreme in the very
                            observations the article cited. `RAIL`.
"""

from __future__ import annotations

from newsroom.pipeline.revisions import append_correction, record_correction_note

#: The one article the measurement condemned, with its real numbers. Measured
#: 2026-08-29T10:23Z against `prc_hicp_minr?coicop18=FOOD&unit=RCH_A&geo=LV`,
#: the URL recorded in the article's own provenance, with `lastTimePeriod`
#: stripped: 355 observations from 1997-01, minimum -3.7% at 2010-02, and
#: exactly three readings below the -2.0 the headline called a record —
#: 2010-01 (-2.3), 2010-02 (-3.7), 2010-03 (-2.2).
FOOD = dict(
    claim='Latvia\'s food inflation had dropped to a "record low" of -2% in July 2026',
    window="60 observations since 2021-08",
    window_start="2021-08",
    series_start="1997-01",
    true_extreme="-3.7%",
    true_period="2010-02",
    beaten_in_window=0,
    beaten_in_series=3,
    claims_low=True,
)

#: The second condemned article, and a DIFFERENT SHAPE of wrong. Measured
#: 2026-08-30T08:54Z against `rail_pa_quartal?unit=THS_PAS&geo=LV`, the URL in
#: the article's own provenance, with `lastTimePeriod=40` stripped.
#:
#: The article said 4,653 thousand passengers was "the highest number of rail
#: passengers recorded in the 39 observations since the series began in
#: 2016-Q3". Three separate things are wrong with that:
#:
#:   * **15 of those 39 observations are higher** — the highest 6,074 in
#:     2025-Q3, and both immediately preceding quarters beat it.
#:   * the series does not begin in 2016-Q3; that is where `lastTimePeriod=40`
#:     put our window. It begins 2004-Q1, 89 observations.
#:   * over that series 55 readings are higher, the highest 7,781 in 2006-Q3.
#:
#: The first of those is why this fixture exists. `FOOD` is a scope error — the
#: claim held over what we retrieved and failed over what exists. This one
#: fails over BOTH, so a notice saying "it was the highest only in the
#: observations we retrieved" would itself be false.
RAIL = dict(
    claim=(
        "Latvia's 4,653 thousand rail passengers in 2026-Q1 was \"the highest "
        "number of rail passengers recorded in the 39 observations since the "
        "series began in 2016-Q3\""
    ),
    window="39 observations since 2016-Q3",
    window_start="2016-Q3",
    series_start="2004-Q1",
    true_extreme="7,781 thousand passengers",
    true_period="2006-Q3",
    window_extreme="6,074 thousand passengers",
    window_extreme_period="2025-Q3",
    beaten_in_window=15,
    beaten_in_series=55,
    claims_low=False,
)


class TestTheNoteSaysWhatAReaderNeeds:
    def test_it_names_the_claim_the_window_and_the_truth(self):
        note = record_correction_note(**FOOD, corrected_at="2026-08-29T10:00:00Z")

        text = note["description"]
        assert text.startswith("CORRECTED.")
        assert "record low" in text
        assert "60 observations since 2021-08" in text
        assert "1997-01" in text
        assert "-3.7%" in text and "2010-02" in text
        assert note["corrected_at"] == "2026-08-29T10:00:00Z"

    def test_it_says_which_direction_beats_the_claim(self):
        """"three earlier readings are beyond it" is vague in a way a
        correction cannot afford: a low is beaten by something LOWER.

        MUTATION THIS CATCHES: hardcoding one direction, which prints "higher"
        on a record-low correction and reads as the opposite of the truth.
        """
        low = record_correction_note(**FOOD)["description"]
        high = record_correction_note(**{**FOOD, "claims_low": False})["description"]

        assert "readings are lower" in low and "the lowest being" in low
        assert "readings are higher" in high and "the highest being" in high


class TestTheScopeErrorWordingIsPinnedToWhatIsLive:
    """The `beaten_in_window == 0` branch must stay byte-identical.

    THIS IS NOT STYLE PEDANTRY. `append_correction` de-duplicates on the
    description, so the text is the idempotency key. Reword this branch by one
    character and re-running the food correction stops recognising the note
    already on the article, appends a second near-identical one, and the public
    log gains a duplicate entry — which is precisely the "corrections log that
    repeats itself buries the real ones" failure the module warns about.

    The expected string below is not composed here. It was read out of the live
    article on 2026-08-30T08:56Z, so this asserts against production rather
    than against a second copy of the same f-string, which would agree with the
    code by construction and could never fail.
    """

    #: Read verbatim from
    #: `articles/latvia-s-food-inflation-drops-to-a-record-low-of-2b7683.json`,
    #: `corrections[0].description`, applied 2026-08-30T06:43:12Z.
    LIVE = (
        "CORRECTED. This article said Latvia's food inflation had dropped to a "
        '"record low" of -2% in July 2026. It was the lowest only in the 60 '
        "observations since 2021-08 that the newsroom had retrieved \u2014 not in "
        "the series, which runs back to 1997-01. Three earlier readings are "
        "lower, the lowest being -3.7% in 2010-02. The figure itself is "
        "unchanged and correct; describing it as a record was not, and a record "
        "claim on this wire now has to name the window it is measured over."
    )

    def test_the_builder_still_reproduces_the_published_note_exactly(self):
        assert record_correction_note(**FOOD)["description"] == self.LIVE

    def test_rebuilding_it_is_a_no_op_against_the_live_article(self):
        """The consequence of the pin above, stated as behaviour.

        MUTATION THIS CATCHES: any reword of the scope branch. The equality
        test says the string changed; this one says what that costs.
        """
        live_document = {"corrections": [{"description": self.LIVE}]}

        assert append_correction(live_document, record_correction_note(**FOOD)) is None


class TestAClaimBeatenInsideOurOwnWindow:
    """`RAIL` — the shape the old single-count builder could not express.

    The old note would have said "it was the highest only in the 39
    observations since 2016-Q3 that the newsroom had retrieved". Fifteen of
    those 39 are higher. That sentence is false, and it would have been
    published inside a correction notice.
    """

    def test_it_does_not_claim_the_figure_led_our_window(self):
        """The whole reason this branch exists.

        MUTATION THIS CATCHES: routing a window-beaten claim through the scope
        wording, which tells the reader it was true of something it was not.
        """
        text = record_correction_note(**RAIL)["description"]

        assert "only in the" not in text
        assert "It was not the highest." in text

    def test_it_names_what_actually_was_the_extreme_in_our_window(self):
        """A reader told "it was not the highest" immediately asks "then what
        was?". Answering it in the same breath is the difference between a
        correction and an admission."""
        text = record_correction_note(**RAIL)["description"]

        assert "Fifteen of the 39 observations since 2016-Q3" in text
        assert "6,074 thousand passengers in 2025-Q3" in text

    def test_it_separates_our_window_start_from_the_series_start(self):
        """The article named 2016-Q3 as the series origin. It is our
        `lastTimePeriod=40` boundary. Saying so is the transferable part — the
        next reader of this note learns what went wrong, not just that it did.
        """
        text = record_correction_note(**RAIL)["description"]

        assert "does not begin in 2016-Q3" in text
        assert "newsroom's data window starts" in text
        assert "but in 2004-Q1" in text

    def test_it_also_gives_the_series_extreme(self):
        text = record_correction_note(**RAIL)["description"]

        assert "55 readings are higher" in text
        assert "7,781 thousand passengers in 2006-Q3" in text

    def test_direction_follows_the_claim_here_too(self):
        """MUTATION THIS CATCHES: hardcoding a direction in the second branch
        only, which the scope-branch direction test cannot see."""
        high = record_correction_note(**RAIL)["description"]
        low = record_correction_note(**{**RAIL, "claims_low": True})["description"]

        assert "It was not the highest." in high and "lower" not in high
        assert "It was not the lowest." in low and "higher" not in low

    def test_the_figure_still_stands_in_this_shape_too(self):
        """4,653 is correct — it reproduces exactly from the article's own
        cube, and the seasonal comparison the piece is actually about is
        sound. Only the record sentence is wrong."""
        text = record_correction_note(**RAIL)["description"]

        assert "figure itself is unchanged and correct" in text
        assert "RETRACTED" not in text


class TestTheCountsAreCheckedAgainstEachOther:
    """The window is a subset of the series, so it cannot contain more
    counter-examples. When it does, one of the two was measured wrong — and a
    correction built on a wrong measurement is the one artefact this whole
    exercise exists to prevent.
    """

    def test_more_beaten_in_the_window_than_in_the_series_is_refused(self):
        import pytest

        with pytest.raises(ValueError, match="subset of the series"):
            record_correction_note(**{**RAIL, "beaten_in_series": 3})

    def test_equal_counts_are_allowed(self):
        """Every counter-example being inside our window is ordinary: it just
        means the older history holds none. Refusing it would reject a true
        measurement."""
        text = record_correction_note(
            **{**RAIL, "beaten_in_window": 15, "beaten_in_series": 15}
        )["description"]

        assert "15 readings are higher" in text

    def test_a_window_beaten_claim_must_name_the_window_extreme(self):
        """MUTATION THIS CATCHES: letting the second branch build with the
        extreme missing, which prints "the highest of them being None"."""
        import pytest

        incomplete = {**RAIL}
        del incomplete["window_extreme"]

        with pytest.raises(ValueError, match="window_extreme"):
            record_correction_note(**incomplete)

    def test_negative_counts_are_refused(self):
        import pytest

        with pytest.raises(ValueError, match="negative"):
            record_correction_note(**{**FOOD, "beaten_in_series": -1})

    def test_the_scope_branch_needs_no_window_extreme(self):
        """There was no counter-example in the window, so there is nothing to
        name. Requiring it would block the shape that is already published."""
        assert record_correction_note(**FOOD)["description"]

    def test_it_says_the_figure_itself_still_stands(self):
        """The -2% is correct and traceable, and is genuinely the lowest of the
        60 observations we held. A notice that left a reader unsure whether the
        number was wrong would be a worse artefact than the headline it
        corrects.
        """
        text = record_correction_note(**FOOD)["description"]

        assert "figure itself is unchanged and correct" in text

    def test_it_is_not_a_retraction(self):
        """The article should have been published — bounded. Calling it
        retracted would say it should not have been, which is false and would
        also remove it from the feeds."""
        text = record_correction_note(**FOOD)["description"]

        assert "RETRACTED" not in text
        assert "should not have been published" not in text

    def test_one_earlier_reading_reads_as_singular(self):
        text = record_correction_note(**{**FOOD, "beaten_in_series": 1})["description"]

        assert "One earlier reading is lower" in text
        assert "readings are" not in text

    def test_a_small_count_is_spelled_at_the_head_of_a_sentence(self):
        """A numeral opening a sentence reads as a typo, and this note is the
        one piece of newsroom prose a reader meets while already doubting us."""
        assert ". Three earlier readings are lower" in record_correction_note(**FOOD)["description"]
        assert ". 23 earlier readings are lower" in (
            record_correction_note(**{**FOOD, "beaten_in_series": 23})["description"]
        )


class TestApplyingItWritesOnceAndSaysSo:
    """The read-modify-write, against a local store rather than production."""

    @staticmethod
    def _store(tmp_path):
        from newsroom.pipeline.publish import ArticleStore

        return ArticleStore(local_dir=tmp_path, account_url="")

    async def test_it_appends_the_note_and_leaves_the_article_servable(self, tmp_path):
        import json

        from newsroom.pipeline.revisions import apply_correction_note
        from newsroom.validator import CHECK_NAMES, is_servable

        store = self._store(tmp_path)
        document = {
            "slug": "s",
            "headline": "A headline",
            "status": "published",
            "provenance": {
                "validator": {
                    "passed": True,
                    "checks": [{"name": n, "passed": True} for n in CHECK_NAMES],
                }
            },
        }
        (tmp_path / "s.json").write_text(json.dumps(document), encoding="utf-8")

        note = record_correction_note(**FOOD)
        updated = await apply_correction_note(store, "s", note)

        assert updated is not None
        stored = json.loads((tmp_path / "s.json").read_text(encoding="utf-8"))
        assert len(stored["corrections"]) == 1
        assert stored["status"] == "published"
        assert is_servable(stored), "the page the notice appears on must survive"

    async def test_it_also_writes_the_public_log(self, tmp_path):
        """The log is part of the correction, not a side effect.

        ``corrections.json`` is the one page a reader can audit us on. A
        correction that exists only on the article is one they can find only if
        they already know which article to open — and that is exactly what
        happened the first time this was applied by hand: the note rendered,
        the log did not list it, and nothing anywhere said the two disagreed.

        MUTATION THIS CATCHES: dropping the ``append_corrections`` call, which
        leaves every existing test green because they all read the article.
        """
        import json

        from newsroom.pipeline.revisions import apply_correction_note

        store = self._store(tmp_path)
        (tmp_path / "s.json").write_text(
            json.dumps({"slug": "s", "headline": "A headline", "status": "published"}),
            encoding="utf-8",
        )

        note = record_correction_note(**FOOD, corrected_at="2026-08-30T06:43:12Z")
        await apply_correction_note(store, "s", note)

        entries = json.loads((tmp_path / "corrections.json").read_text(encoding="utf-8"))
        assert len(entries) == 1
        assert entries[0]["slug"] == "s"
        assert entries[0]["headline"] == "A headline"
        assert entries[0]["corrected_at"] == "2026-08-30T06:43:12Z"
        # The log quotes the note already written to the article rather than
        # composing a second one, so the two cannot disagree about the wording.
        assert entries[0]["description"] == note["description"]

    async def test_the_log_is_not_appended_twice_either(self, tmp_path):
        import json

        from newsroom.pipeline.revisions import apply_correction_note

        store = self._store(tmp_path)
        (tmp_path / "s.json").write_text(
            json.dumps({"slug": "s", "headline": "H", "status": "published"}),
            encoding="utf-8",
        )
        note = record_correction_note(**FOOD, corrected_at="2026-08-30T06:43:12Z")

        await apply_correction_note(store, "s", note)
        await apply_correction_note(store, "s", note)

        entries = json.loads((tmp_path / "corrections.json").read_text(encoding="utf-8"))
        assert len(entries) == 1

    async def test_running_it_twice_writes_once(self, tmp_path):
        """Safe to re-run, and it SAYS it did nothing rather than being safe by
        accident — the difference between an idempotent operation and one that
        happens not to have broken anything yet."""
        import json

        from newsroom.pipeline.revisions import apply_correction_note

        store = self._store(tmp_path)
        (tmp_path / "s.json").write_text(
            json.dumps({"slug": "s", "status": "published"}), encoding="utf-8"
        )
        note = record_correction_note(**FOOD, corrected_at="2026-08-29T10:00:00Z")

        first = await apply_correction_note(store, "s", note)
        second = await apply_correction_note(store, "s", note)

        assert first is not None
        assert second is None
        stored = json.loads((tmp_path / "s.json").read_text(encoding="utf-8"))
        assert len(stored["corrections"]) == 1

    def test_the_note_matches_the_schema(self):
        import json
        from pathlib import Path

        schema = json.loads(
            (
                Path(__file__).resolve().parents[2] / "schemas" / "article.schema.json"
            ).read_text(encoding="utf-8")
        )
        item = schema["properties"]["corrections"]["items"]
        note = record_correction_note(**FOOD)

        assert set(item["required"]) <= set(note)
        assert set(note) <= set(item["properties"])


class TestAppendingIsIdempotent:
    def test_the_same_note_twice_is_a_no_op(self):
        """A corrections log that repeats itself every run buries the real
        entries and makes the article look chaotically wrong.

        MUTATION THIS CATCHES: dropping the duplicate scan, which appends on
        every invocation and is invisible until someone reads the article.
        """
        note = record_correction_note(**FOOD, corrected_at="2026-08-29T10:00:00Z")
        document = {"slug": "x", "status": "published"}

        once = append_correction(document, note)
        assert once is not None and len(once["corrections"]) == 1

        again = append_correction(once, note)
        assert again is None, "a second identical note must not be appended"

    def test_a_genuinely_different_note_still_lands(self):
        """The control for the test above: an idempotence guard that refused
        everything would satisfy it while making corrections impossible."""
        first = record_correction_note(**FOOD, corrected_at="2026-08-29T10:00:00Z")
        second = record_correction_note(
            **{**FOOD, "true_extreme": "-4.9%"}, corrected_at="2026-08-30T10:00:00Z"
        )

        document = append_correction({"slug": "x"}, first)
        document = append_correction(document, second)

        assert document is not None and len(document["corrections"]) == 2

    def test_it_does_not_mutate_the_document_it_was_given(self):
        """A caller that decides not to write must not already have changed the
        record."""
        document = {"slug": "x", "corrections": []}

        append_correction(document, record_correction_note(**FOOD))

        assert document["corrections"] == []

    def test_an_empty_note_is_refused(self):
        assert append_correction({"slug": "x"}, {"description": "  "}) is None

    def test_an_existing_correction_is_preserved(self):
        """The log is append-only by policy — a log we can rewrite is not
        evidence of anything."""
        document = {"corrections": [{"corrected_at": "t", "description": "an earlier note"}]}

        updated = append_correction(document, record_correction_note(**FOOD))

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

        updated = append_correction(document, record_correction_note(**FOOD))

        assert updated is not None
        assert updated["status"] == "published"
        assert is_servable(updated), "correcting an article must not remove it from the site"
