"""A rejection has to say why, and the ways that can quietly stop being true.

WHY THIS FILE
-------------
The 14:00Z run of 2026-08-28 generated eight original articles over 21 attempts
and published two. ``runs/latest.json`` named the six that died and gave no
reason for any of them, because ``build_run_report`` took ``.slug`` off objects
that were carrying the whole verdict. A reader could not tell six bad drafts
correctly caught from a check destroying correct work — and those are not
equally likely: ``#171`` is *"Stop comparison_basis_stated rejecting a basis
that is stated"*, nine of nine rejections false, found by a human reading the
output because a rejection left nothing behind to read.

So these tests are about the reporting layer only. They do not assert that any
particular check is right; they assert that whichever check fired can be named
by someone reading the artefact tomorrow.

WHAT EACH ONE IS DEFENDING
--------------------------
Every test here was written against a specific mutation of
``newsroom/pipeline/runreport.py`` that leaves the module importable, the other
tests green, and the report plausible. Each mutation is named in the test that
catches it. The one that matters most is the second: dropping a rejection that
carries no reason reads as tidiness and reinstates exactly the blindness this
file exists to remove — a rejection leaving no trace is indistinguishable from a
rejection that never happened.
"""

from __future__ import annotations

import json

from newsroom.pipeline.runreport import (
    MAX_REJECTION_DETAIL,
    UNRECORDED_REASON,
    build_run_report,
)


class Draft:
    """A rejected article, as thin as the report's duck-typing allows."""

    def __init__(self, slug, rejection=..., provenance=...):
        self.slug = slug
        if provenance is not ...:
            self.provenance = provenance
        elif rejection is ...:
            self.provenance = {"attempts": 3}
        else:
            self.provenance = {"attempts": 3, "rejection": rejection}


class Generated:
    def __init__(self, article):
        self.article = article
        self.publishable = False


class Run:
    """Enough of ``RunReport`` for :func:`build_run_report`."""

    def __init__(self, rejected):
        self.rejected = list(rejected)
        self.generated = [Generated(a) for a in self.rejected]
        self.published: list = []
        self.desk: list = []
        self.errors: list = []
        self.syndicated: list = []
        self.style_notes: list = []
        self.signals: list = []
        self.syndication_skipped = 0

    def summary(self) -> str:
        return f"0 published, {len(self.rejected)} rejected"


def _validator(*checks, detail="something went wrong"):
    return {"gate": "validator", "checks": list(checks), "detail": detail}


def _report(*drafts):
    return build_run_report(Run(drafts), trigger="timer")


class TestARejectionSaysWhy:
    def test_names_the_gate_the_checks_and_what_they_said(self):
        """The whole point: the reason travels with the slug.

        Reproduced from the real 14:00Z artefacts, which carried exactly this
        record on ``provenance.rejection`` while the run report kept the slug
        and discarded it.

        MUTATION THIS CATCHES: keeping ``gate`` and dropping ``checks``, which
        still yields a per-rejection entry and a report that looks answered.
        """
        document = _report(
            Draft(
                "latvia-rail-395245",
                _validator(
                    "figures_traceable",
                    detail="figures_traceable: body[4]: figure 4000.0 does not"
                    " match baseline_years=9.0 (tolerance 0.5)",
                ),
            )
        )

        (entry,) = document["rejections"]
        assert entry["slug"] == "latvia-rail-395245"
        assert entry["gate"] == "validator"
        assert entry["checks"] == ["figures_traceable"]
        assert "baseline_years=9.0" in entry["detail"]

    def test_a_reason_that_was_never_recorded_still_appears_and_says_so(self):
        """The defect this file is really about, one level up.

        A rejection carrying no reason is the single thing the reporting layer
        must not be able to hide, because it is the state that looks identical
        to a healthy run. Two of these three drafts explain themselves and one
        does not; the report must still show three.

        MUTATION THIS CATCHES: ``if not isinstance(record, Mapping): continue``
        — skipping the unexplained one. That is a boundary mutation, not a
        wholesale one: it removes one entry of three and leaves a report whose
        every remaining entry is correct.
        """
        document = _report(
            Draft("explained-a", _validator("figures_traceable")),
            Draft("silent-b"),
            Draft("explained-c", _validator("no_invented_numbers")),
        )

        assert [e["slug"] for e in document["rejections"]] == [
            "explained-a",
            "silent-b",
            "explained-c",
        ]
        assert document["counts"]["rejected"] == 3

        silent = document["rejections"][1]
        assert silent["gate_unavailable"] == UNRECORDED_REASON
        assert "gate" not in silent
        assert "checks" not in silent

    def test_an_unrecorded_reason_cannot_be_mistaken_for_a_gate(self):
        """Two keys, not one key with a fallback.

        The same construction as ``revision`` / ``revision_unavailable`` on the
        article, and for the same stated reason: a placeholder that looks like
        an answer earns trust it has not verified. ``"gate" in entry`` is the
        exact question "do we know why this died", so no value of ``gate`` may
        answer it by accident.

        MUTATION THIS CATCHES: ``entry["gate"] = "unrecorded"`` instead of a
        separate key — conspicuous to a human, invisible to a consumer testing
        the field's presence.
        """
        document = _report(Draft("silent"), Draft("explained", _validator("x")))

        for entry in document["rejections"]:
            assert ("gate" in entry) != ("gate_unavailable" in entry)

        # And the unavailable text is prose about not knowing, not a token that
        # could sit in the gate enum beside "validator" and "article_shape".
        assert " " in UNRECORDED_REASON
        assert UNRECORDED_REASON not in json.dumps(document["rejected_checks"])


class TestTheCluster:
    """``rejected_checks`` is the field that answers the question fastest."""

    def test_counts_rejections_rather_than_occurrences(self):
        """An article failing one check twice is one rejection, not two.

        The unit is the thing that makes the number readable, and this repo has
        already shipped the other version of this mistake — a streak detector
        counting readings and calling them periods.

        MUTATION THIS CATCHES: dropping ``dict.fromkeys``, so a check named
        twice on one draft counts twice and a single bad article looks like a
        cluster.
        """
        document = _report(
            Draft("a", _validator("comparison_basis_stated", "comparison_basis_stated")),
            Draft("b", _validator("comparison_basis_stated")),
        )

        assert document["rejected_checks"] == {"comparison_basis_stated": 2}

    def test_ranks_the_check_refusing_the_most_drafts_first(self):
        """So a check eating the wire is the first thing read, not the fourth.

        The shape of the real run: one check dominating and a tail behind it.
        """
        document = _report(
            Draft("a", _validator("comparison_basis_stated", "no_unsupported_mechanism")),
            Draft("b", _validator("comparison_basis_stated", "no_repeated_findings")),
            Draft("c", _validator("comparison_basis_stated")),
            Draft("d", _validator("figures_traceable")),
        )

        assert list(document["rejected_checks"]) == [
            "comparison_basis_stated",
            "figures_traceable",
            "no_repeated_findings",
            "no_unsupported_mechanism",
        ]
        assert document["rejected_checks"]["comparison_basis_stated"] == 3

    def test_counts_every_rejection_even_when_the_list_is_truncated(self):
        """The aggregate and the list walk different-sized populations by design.

        A guard that enumerates a smaller set than its subject is this repo's
        most-repeated fault — the maritime probe reading one port of four, the
        wiring guard reading one directory of a tree. Here the *list* is
        deliberately a sample and the *aggregate* is the complete statement, so
        the aggregate must be computed before the cut, not after it.

        MUTATION THIS CATCHES: ``_checks_of(reasons[:50])``. It agrees with the
        truth on every run this pipeline has ever had, because eight articles
        are generated per run and the cut never bites.
        """
        drafts = [Draft(f"slug-{i}", _validator("figures_traceable")) for i in range(60)]

        document = _report(*drafts)

        assert len(document["rejections"]) == 50
        assert document["counts"]["rejected"] == 60
        assert document["rejected_checks"] == {"figures_traceable": 60}


class TestTheDetailIsBounded:
    def test_a_long_detail_is_cut_and_says_how_much_it_lost(self):
        """A reason, not a payload — and a cut that admits to being one.

        The real details run past 600 characters, most of it one instruction
        repeated verbatim per occurrence, and this document is fetched by a
        status probe on a schedule. A sentence that merely stops is
        indistinguishable from one the pipeline wrote that way, so the cut
        states the characters it dropped and the full text stays on the draft.

        MUTATION THIS CATCHES: returning the detail uncut.
        """
        long_detail = "no_unsupported_mechanism: " + ("x" * 500)

        document = _report(Draft("verbose", _validator("no_unsupported_mechanism", detail=long_detail)))

        detail = document["rejections"][0]["detail"]
        assert len(detail) < len(long_detail)
        assert detail.startswith("no_unsupported_mechanism: ")
        assert f"+{len(long_detail) - MAX_REJECTION_DETAIL} more" in detail

    def test_a_short_detail_is_left_alone(self):
        """The control for the test above.

        Without it, a cut applied to everything — or applied at zero — would
        satisfy the truncation assertion while destroying every reason in the
        file.
        """
        document = _report(
            Draft("terse", _validator("figures_traceable", detail="figures_traceable: body[4]"))
        )

        assert document["rejections"][0]["detail"] == "figures_traceable: body[4]"


class TestTheReportSurvivesBadInput:
    """``build_run_report`` runs at the end of a run that may already have gone
    wrong, and a report that raises while explaining a failure turns a bad run
    into a crashed one."""

    def test_a_check_list_that_is_a_string_is_not_read_as_letters(self):
        """A string is iterable and iterating one gives characters.

        MUTATION THIS CATCHES: dropping the ``isinstance(raw_checks, (list,
        tuple))`` guard, which turns ``checks: "figures_traceable"`` into
        seventeen single-letter check names, each counted in the cluster.
        """
        document = _report(
            Draft("odd", {"gate": "validator", "checks": "figures_traceable", "detail": "d"})
        )

        assert document["rejections"][0]["checks"] == []
        assert document["rejected_checks"] == {}

    def test_junk_where_the_reason_should_be_does_not_raise(self):
        """Every one of these is an unexplained rejection, not an exception."""
        document = _report(
            Draft("no-provenance-attribute", provenance=None),
            Draft("provenance-is-a-string", provenance="broken"),
            Draft("rejection-is-a-list", provenance={"rejection": ["nope"]}),
            Draft("gate-is-a-number", provenance={"rejection": {"gate": 7, "checks": []}}),
            Draft("gate-is-empty", provenance={"rejection": {"gate": "", "checks": []}}),
        )

        assert len(document["rejections"]) == 5
        assert all("gate_unavailable" in e for e in document["rejections"])
        assert document["rejected_checks"] == {}

    def test_the_attempt_count_still_ignores_an_article_with_no_provenance(self):
        """The crash fix above must not move a number it was not aimed at.

        ``attempts_total`` is the field a probe reads to say whether the yield
        work is landing. The line that raised on a non-mapping provenance also
        skipped a falsy one, and replacing a truthiness test with a type test
        would have started counting an empty provenance as one attempt —
        a real change to a published figure, arriving as a side effect of a
        crash fix and visible nowhere.
        """
        recorded = Draft("recorded", _validator("x"))
        recorded.provenance = {"attempts": 3, "rejection": _validator("x")}
        empty = Draft("empty", provenance={})
        junk = Draft("junk", provenance="broken")

        document = _report(recorded, empty, junk)

        assert document["original_articles"]["attempts_total"] == 3
        assert document["original_articles"]["attempts_max"] == 3
        assert document["original_articles"]["generated"] == 3

    def test_a_run_with_nothing_rejected_says_nothing_rather_than_guessing(self):
        document = _report()

        assert document["rejections"] == []
        assert document["rejected_checks"] == {}
        assert document["counts"]["rejected"] == 0


class TestTheCrossLanguageContract:
    """``api/system-status`` reads this document in JavaScript, and
    ``freshness``/``newsroomObservation`` address it by name. The addition is
    additive; these pin the fields the probe already reads so it stays that
    way."""

    def test_the_fields_the_status_probe_reads_are_untouched(self):
        """Named individually rather than by a key-set equality, because the
        probe reads these and not the shape of the whole document."""
        document = _report(Draft("a", _validator("figures_traceable")))

        assert isinstance(document["finished_at"], str) and document["finished_at"]
        assert document["stale_after_hours"] > 0
        assert set(document["original_articles"]) >= {
            "generated",
            "publishable",
            "attempts_total",
        }
        assert set(document["counts"]) >= {"published", "rejected", "errors"}
        assert set(document["liveness"]) >= {"runs_without_originals", "last_original_at"}

    def test_rejected_slugs_stays_a_list_of_strings(self):
        """The existing field keeps its type.

        Widening it into objects in place would have been the tidier diff and
        would have broken a consumer in another language that this package
        cannot see failing.
        """
        document = _report(Draft("a", _validator("x")), Draft("b"))

        assert document["rejected_slugs"] == ["a", "b"]
        assert all(isinstance(slug, str) for slug in document["rejected_slugs"])

    def test_the_document_is_json_serialisable(self):
        """It is written to Blob as JSON, so a value that cannot be encoded is
        a run report that does not exist."""
        document = _report(
            Draft("a", _validator("figures_traceable", detail="x" * 400)),
            Draft("b"),
        )

        assert json.loads(json.dumps(document))["rejections"][0]["gate"] == "validator"


class TestTheSectionShapeSeparatesJournalismFromTheWire:
    """``sections`` counts everything published; the wire swamps the originals.

    Measured on the run of 2026-08-30, ``sections`` read
    ``government 49 · energy 2 · property 1`` while the newsroom's own eight
    originals spanned economy, energy, property and trade. A link-out to
    another outlet's government story is not this newsroom filing a government
    beat, so an operator asking "what do we cover?" got a confident wrong
    answer from the field built to answer it.

    Same split, same reason, as ``original_articles`` -- which exists because
    "a published count that includes syndicated cards hid exactly that". The
    remedy was applied to the counts and never to the shape.
    """

    class _Article:
        def __init__(self, slug, section):
            self.slug = slug
            self.section = section
            self.provenance = {"attempts": 1}

    class _Result:
        def __init__(self, article, publishable):
            self.article = article
            self.publishable = publishable

    def _run(self):
        art = TestTheSectionShapeSeparatesJournalismFromTheWire._Article
        res = TestTheSectionShapeSeparatesJournalismFromTheWire._Result

        original = art("ours", "economy")
        cards = [art(f"card{i}", "government") for i in range(9)]

        run = Run([])
        run.generated = [res(original, True), res(art("spiked", "energy"), False)]
        run.published = [original, *cards]
        run.syndicated = list(cards)
        return run

    def test_the_wire_still_appears_in_the_overall_shape(self):
        document = build_run_report(self._run(), trigger="timer")

        assert document["sections"] == {"government": 9, "economy": 1}

    def test_the_newsroom_s_own_beats_are_reported_separately(self):
        document = build_run_report(self._run(), trigger="timer")

        assert "original_sections" in document, (
            "the section shape is reported only over a population the syndicated "
            "wire dominates, so it cannot answer what this newsroom covers"
        )
        assert document["original_sections"] == {"economy": 1}, (
            "original_sections must count what we WROTE and published -- not the "
            "cards we linked to, and not the drafts that were spiked"
        )
