"""Which kind of correction is this, and what does silence mean?

WHAT WAS WRONG
--------------
``Correction`` declared ``corrected_at``, ``description`` and ``previous_value``
and nothing else, so every surface said one word — "Corrected" — for two facts a
reader must not have confused:

    we published something wrong
    the source restated a figure we reported faithfully, and our text stands

Measured across the live log on 2026-09-01: ``previous_value`` cannot separate
them, appearing on entries of both kinds. Nothing structural could, so the only
way to tell was to read the prose — a word list standing in for a property,
which this repository keeps being beaten by.

Two states wearing one artefact, in the machinery whose entire subject is
telling a reader the truth about what changed.

WHAT THIS FILE PINS
-------------------
Four things, and the first is the one that decides whether the field is safe to
add at all: **an entry that does not say must never render as "we were wrong".**
The 31 entries written before the field existed carry nothing, and nothing
backfills them, because the log cannot tell us which they were and guessing in
the flattering direction is the one thing this apparatus must not do.
"""

from __future__ import annotations

import inspect
import json
from pathlib import Path

import pytest

from newsroom.pipeline import revisions
from newsroom.pipeline.corrections import EditorialCorrection
from newsroom.pipeline.revisions import (
    CORRECTION_KINDS,
    OUR_ERROR,
    SOURCE_REVISION,
    UNSPECIFIED_KIND,
    correction_kind,
)

SCHEMA = Path(__file__).resolve().parents[2] / "schemas" / "article.schema.json"


def _correction_schema() -> dict:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    return schema["properties"]["corrections"]["items"]


class TestAbsenceResolvesToTheWeakerClaim:
    """The load-bearing half. A correction that does not say, says nothing."""

    def test_an_entry_with_no_kind_is_unspecified(self) -> None:
        assert correction_kind({"corrected_at": "x", "description": "y"}) == UNSPECIFIED_KIND

    def test_unspecified_is_neither_of_the_two_declared_values(self) -> None:
        # The point of a third value. Were `UNSPECIFIED_KIND` equal to either
        # declared kind, every assertion in this class would pass while the
        # field asserted something about 31 entries nobody measured.
        assert UNSPECIFIED_KIND not in CORRECTION_KINDS

    def test_an_unrecognised_value_also_resolves_to_unspecified(self) -> None:
        # A build that meets a value it does not understand must claim nothing,
        # rather than fall through to either side. Same allow-list reasoning as
        # `SHOWABLE_STATUSES` in src/news-api.ts.
        for bad in ["ours", "OUR_ERROR", "our-error", "", "source revision", None, 7]:
            assert correction_kind({"kind": bad}) == UNSPECIFIED_KIND

    def test_the_live_shape_of_an_old_entry_resolves_weakly(self) -> None:
        # The exact shape of the 31 entries already published, from the live log.
        legacy = {
            "corrected_at": "2026-08-30T06:43:00Z",
            "description": "CORRECTED. This article said Latvia's food inflation had dropped…",
            "previous_value": "a record low",
        }
        assert correction_kind(legacy) == UNSPECIFIED_KIND

    def test_a_declared_value_is_returned_as_declared(self) -> None:
        # The control. Without it every assertion above is satisfied by a
        # function that returns UNSPECIFIED_KIND unconditionally.
        assert correction_kind({"kind": OUR_ERROR}) == OUR_ERROR
        assert correction_kind({"kind": SOURCE_REVISION}) == SOURCE_REVISION


class TestTheKindIsSetWhereACorrectionIsCreated:
    """Structurally, by which builder ran — never by reading the prose back."""

    def test_every_note_builder_in_the_module_declares_our_error(self) -> None:
        """Derived from the module, not from a list written here.

        A seventh builder added without a kind must fail this, which a list of
        six names could not do — the enumeration rule applied to the guard's own
        population. `#357` added the sixth while this branch was being written,
        which is how fast that list would have gone stale.

        ``apply_correction_note`` shares the suffix and is NOT a builder: it
        writes a note somebody else composed, and carries the kind rather than
        originating one. The first version of this test enumerated on the suffix
        alone and failed on it — the guard walking a larger set than its subject,
        which is the same fault one level up. A coroutine is the structural
        discriminator, not a name I would have to keep in step.
        """
        builders = [
            name
            for name in dir(revisions)
            if name.endswith("_correction_note")
            and callable(getattr(revisions, name))
            and not inspect.iscoroutinefunction(getattr(revisions, name))
        ]
        assert len(builders) >= 5, f"expected the note builders, found {builders}"
        # The control on the split: the writer really is in the module and really
        # is excluded, so the predicate is doing work rather than matching all.
        assert inspect.iscoroutinefunction(revisions.apply_correction_note)
        assert "apply_correction_note" not in builders

        for name in builders:
            fn_source = inspect.getsource(getattr(revisions, name))
            assert '"kind": OUR_ERROR' in fn_source, (
                f"{name} composes a notice about something we published wrong and does "
                f"not say so"
            )
        assert inspect.getsource(revisions).count('"kind": OUR_ERROR') >= len(builders)

    def test_a_source_revision_declares_itself_a_source_revision(self) -> None:
        # `Revision.to_correction` is the one path whose subject is the source
        # moving rather than us being wrong, and its own description says so in
        # its last sentence — which is precisely why the kind is stamped instead
        # of read back out of that sentence.
        fn_source = inspect.getsource(revisions.Revision.to_correction)
        assert '"kind": SOURCE_REVISION' in fn_source
        assert '"kind": OUR_ERROR' not in fn_source

    def test_an_editorial_correction_declares_our_error(self) -> None:
        note = EditorialCorrection(slug="a-slug", description="We were wrong.").to_correction()
        assert correction_kind(note) == OUR_ERROR

    def test_the_kind_reaches_the_public_log_entry(self) -> None:
        # A field the producer sets and the consumer drops is the seam this
        # repository has been auditing all week. The log is the copy a reader is
        # pointed at from the policy page.
        correction = EditorialCorrection(slug="a-slug", description="We were wrong.")
        note = correction.to_correction()
        entry = correction.to_log_entry(note, headline="As published")
        assert correction_kind(entry) == OUR_ERROR

    def test_a_log_entry_built_from_a_kindless_note_stays_silent(self) -> None:
        # Not "defaults to our_error". An old note carries nothing, and the entry
        # built from it must carry nothing either, or the backfill this file
        # refuses would happen one layer down.
        correction = EditorialCorrection(slug="a-slug", description="We were wrong.")
        entry = correction.to_log_entry(
            {"corrected_at": "2026-01-01T00:00:00Z", "description": "old"},
            headline="As published",
        )
        assert "kind" not in entry
        assert correction_kind(entry) == UNSPECIFIED_KIND


class TestTheWriterCarriesTheKindToBothStores:
    """`apply_correction_note` writes the article AND the public log.

    Tested by running it rather than by reading it, because what matters is what
    lands in the two stores. A field the producer sets and the consumer drops is
    the seam this repository has spent the week auditing, and the log is the copy
    a reader is pointed at from the policy page.
    """

    class _FakeStore:
        def __init__(self, document: dict) -> None:
            self.document = document
            self.written: dict | None = None
            self.logged: list[dict] = []

        async def read_json(self, name: str) -> dict:
            assert name.endswith(".json")
            return dict(self.document)

        async def put_json(self, name: str, payload: dict) -> None:
            self.written = payload

        async def append_corrections(self, entries) -> int:
            self.logged.extend(entries)
            return len(entries)

    @staticmethod
    def _run(coro):
        import asyncio

        return asyncio.run(coro)

    def test_a_stamped_note_reaches_the_article_and_the_log(self) -> None:
        store = self._FakeStore({"slug": "s", "headline": "As published"})
        note = EditorialCorrection(slug="s", description="We were wrong.").to_correction()

        updated = self._run(revisions.apply_correction_note(store, "s", note))

        assert updated is not None
        assert correction_kind(updated["corrections"][-1]) == OUR_ERROR
        assert len(store.logged) == 1
        assert correction_kind(store.logged[0]) == OUR_ERROR

    def test_a_kindless_note_stays_kindless_in_both(self) -> None:
        # Not "becomes our_error". The writer must not invent what the note did
        # not say, or the backfill this file refuses happens one layer down.
        store = self._FakeStore({"slug": "s", "headline": "As published"})
        note = {"corrected_at": "2026-01-01T00:00:00Z", "description": "an older note"}

        updated = self._run(revisions.apply_correction_note(store, "s", note))

        assert updated is not None
        assert "kind" not in updated["corrections"][-1]
        assert "kind" not in store.logged[0]
        assert correction_kind(store.logged[0]) == UNSPECIFIED_KIND


class TestTheSchemaRefusesAnUndeclaredValue:
    """So a typo cannot become a third silent category."""

    def test_kind_is_an_enum_of_exactly_the_two_declared_values(self) -> None:
        properties = _correction_schema()["properties"]
        assert "kind" in properties, "the schema does not declare `kind` at all"
        assert set(properties["kind"]["enum"]) == set(CORRECTION_KINDS)

    def test_kind_is_optional_because_31_entries_do_not_have_it(self) -> None:
        assert "kind" not in _correction_schema().get("required", [])

    def test_jsonschema_rejects_a_value_outside_the_enum(self) -> None:
        jsonschema = pytest.importorskip("jsonschema")
        item = _correction_schema()
        base = {"corrected_at": "2026-09-01T00:00:00Z", "description": "x"}

        # The control first: the two declared values, and absence, all validate.
        for note in [base, {**base, "kind": OUR_ERROR}, {**base, "kind": SOURCE_REVISION}]:
            jsonschema.validate(note, item)

        for bad in ["ours", "OUR_ERROR", "our-error", "correction", ""]:
            with pytest.raises(jsonschema.ValidationError):
                jsonschema.validate({**base, "kind": bad}, item)


class TestNothingIsBackfilled:
    """The refusal, asserted rather than described."""

    def test_no_module_writes_a_kind_onto_an_entry_that_lacks_one(self) -> None:
        # A backfill would have to appear as a default somewhere. The two shapes
        # it would take are a `get` with a fallback to a declared kind, or an
        # assignment guarded on absence — both are absent, and this says so about
        # the source rather than about one code path.
        for module in [revisions, inspect.getmodule(EditorialCorrection)]:
            source = inspect.getsource(module)
            for forbidden in [
                'get("kind", OUR_ERROR)',
                'get("kind", SOURCE_REVISION)',
                'get("kind") or OUR_ERROR',
                'get("kind") or SOURCE_REVISION',
            ]:
                assert forbidden not in source, (
                    f"{module.__name__} defaults a missing kind to a declared value, which "
                    f"asserts something about entries nobody measured"
                )
