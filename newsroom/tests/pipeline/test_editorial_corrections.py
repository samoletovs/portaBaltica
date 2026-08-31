"""Correcting our own error on an article that otherwise stands.

The policy names two remedies and the pipeline had one and a half. `retract.py`
withdraws a story that should not have run; `revisions.py` notes a figure **the
source** restated. A factual error of our own — the category the published
policy leads with — had nowhere to go, so the only fitting tool was retraction,
which would have destroyed correct journalism to fix a label.

These tests pin the third artefact, and the boundary that makes it honest: it
appends, and it never touches prose.
"""

from __future__ import annotations

import json

import pytest

from newsroom.pipeline.corrections import (
    INVENTED_ANALYST,
    PENDING,
    EditorialCorrection,
    already_recorded,
    annotate,
    issue,
)


CORRECTION = EditorialCorrection(
    slug="a-slug",
    description="We wrote X. It was Y.",
    previous_value="X",
)


def _article(**overrides):
    document = {
        "slug": "a-slug",
        "status": "published",
        "headline": "A headline",
        "body": [{"type": "paragraph", "text": "The published sentence."}],
        "provenance": {},
    }
    document.update(overrides)
    return document


# ── the note ────────────────────────────────────────────────────────────


def test_a_correction_is_appended_to_the_article():
    corrected = annotate(_article(), CORRECTION)

    assert corrected is not None
    assert len(corrected["corrections"]) == 1
    assert corrected["corrections"][0]["description"] == CORRECTION.description
    assert corrected["corrections"][0]["previous_value"] == "X"


def test_the_prose_is_not_touched():
    """The rule that makes a correction worth anything.

    ``retract.py`` states it for the whole apparatus — "Nothing here rewrites
    the article's prose. The record is append-only" — and the reason is
    specific here: a note saying "we credited Dr Zvirbule" beside a paragraph
    that no longer says it describes a state the reader cannot check.
    """
    original = _article()
    body_before = json.dumps(original["body"])

    corrected = annotate(original, CORRECTION)

    assert corrected is not None
    assert json.dumps(corrected["body"]) == body_before
    assert corrected["headline"] == original["headline"]


def test_the_article_stays_published():
    """Setting ``corrected`` would delete it from the site as it was corrected.

    Both ``publish.is_servable`` and the frontend's ``isServable`` require
    ``published``. ``revisions.annotate`` carries the same guard, and it is
    worth having twice because the failure is an unpublish disguised as a
    correction.
    """
    corrected = annotate(_article(), CORRECTION)

    assert corrected is not None
    assert corrected["status"] == "published"


def test_annotating_does_not_mutate_the_input():
    """A caller that decides not to write must not have already changed it."""
    original = _article()

    annotate(original, CORRECTION)

    assert "corrections" not in original


def test_an_existing_correction_is_preserved():
    existing = {"corrected_at": "2026-01-01T00:00:00Z", "description": "Earlier note."}

    corrected = annotate(_article(corrections=[existing]), CORRECTION)

    assert corrected is not None
    assert corrected["corrections"][0] == existing
    assert len(corrected["corrections"]) == 2


# ── idempotence ─────────────────────────────────────────────────────────


def test_the_same_correction_is_not_filed_twice():
    """It runs every edition, so a note that re-appends is a wall of one sentence."""
    once = annotate(_article(), CORRECTION)
    assert once is not None

    assert annotate(once, CORRECTION) is None
    assert already_recorded(once["corrections"], CORRECTION)


def test_a_different_correction_on_the_same_article_still_files():
    """A control: without it, idempotence could be 'never file anything twice'."""
    once = annotate(_article(), CORRECTION)
    assert once is not None

    other = EditorialCorrection(slug="a-slug", description="A separate mistake.")

    assert annotate(once, other) is not None


# ── the store path ──────────────────────────────────────────────────────


class FakeStore:
    def __init__(self, documents=None, *, fail_write=False):
        self.documents = documents if documents is not None else {}
        self.written: dict[str, dict] = {}
        self.logged: list[dict] = []
        self._fail_write = fail_write

    async def read_published(self, slug):
        return self.documents.get(slug)

    async def write_published(self, slug, document):
        if self._fail_write:
            raise RuntimeError("blob unavailable")
        self.written[slug] = document

    async def append_corrections(self, entries):
        self.logged.extend(entries)
        return len(self.logged)


@pytest.mark.asyncio
async def test_issue_writes_the_article_and_the_public_log():
    store = FakeStore({"a-slug": _article()})

    changed = await issue(store, [CORRECTION])

    assert changed == ["a-slug"]
    assert len(store.written["a-slug"]["corrections"]) == 1
    assert store.logged[0]["slug"] == "a-slug"
    assert store.logged[0]["headline"] == "A headline"


@pytest.mark.asyncio
async def test_the_log_entry_quotes_the_note_rather_than_rebuilding_it():
    """So the log and the article can never disagree about wording or time.

    The same rule ``revisions.Revision.to_log_entry`` follows. Two renderings
    of one correction is how a corrections page ends up contradicting the
    article it points at.
    """
    store = FakeStore({"a-slug": _article()})

    await issue(store, [CORRECTION])

    note = store.written["a-slug"]["corrections"][-1]
    assert store.logged[0]["description"] == note["description"]
    assert store.logged[0]["corrected_at"] == note["corrected_at"]


@pytest.mark.asyncio
async def test_a_second_run_files_nothing():
    store = FakeStore({"a-slug": _article()})
    await issue(store, [CORRECTION])
    store.documents["a-slug"] = store.written["a-slug"]

    changed = await issue(store, [CORRECTION])

    assert changed == []
    assert len(store.logged) == 1


@pytest.mark.asyncio
async def test_a_retracted_article_is_left_alone():
    """It already carries a louder notice, and we did not amend what we disowned."""
    store = FakeStore({"a-slug": _article(status="retracted")})

    assert await issue(store, [CORRECTION]) == []
    assert store.written == {}


@pytest.mark.asyncio
async def test_a_missing_article_is_skipped_not_raised():
    store = FakeStore({})

    assert await issue(store, [CORRECTION]) == []


@pytest.mark.asyncio
async def test_one_failure_does_not_stop_the_others():
    """Independent, because a correction that cannot be filed must not take an
    edition down — and the next run tries again."""
    store = FakeStore({"b-slug": _article(slug="b-slug", headline="B")})
    missing = EditorialCorrection(slug="a-slug", description="First.")
    present = EditorialCorrection(slug="b-slug", description="Second.")

    changed = await issue(store, [missing, present])

    assert changed == ["b-slug"]


@pytest.mark.asyncio
async def test_a_write_failure_is_not_logged_as_a_correction():
    """The log is the index of notes that exist. An entry for a note that was
    never written sends a reader to an article that does not carry it."""
    store = FakeStore({"a-slug": _article()}, fail_write=True)

    assert await issue(store, [CORRECTION]) == []
    assert store.logged == []


# ── the declared correction ─────────────────────────────────────────────


def test_the_pending_correction_names_the_article_and_quotes_the_sentence():
    """A correction a reader cannot check against the page is worth nothing.

    The slug and the quoted sentence were both verified against the live blob
    when this was written; this pins the shape so a later edit cannot quietly
    drop the quotation that makes it checkable.

    Addressed by NAME rather than by ``PENDING[0]``. This asserted
    ``len(PENDING) == 1`` until a second correction was filed, which is a count
    of the list standing in for a claim about one member — and the test three
    below it already says the right thing, "enumerated from ``PENDING`` so a
    second one added later is covered". Naming the subject cannot go stale when
    the list grows.
    """
    correction = INVENTED_ANALYST

    assert correction in PENDING
    assert correction.slug.startswith("consumer-confidence-in-the-baltic-states")
    assert correction.previous_value
    assert "Dr. Ineta Zvirbule" in correction.previous_value


def test_the_note_says_what_was_wrong_rather_than_that_something_was():
    """"An error occurred" asks for trust rather than earning it."""
    description = INVENTED_ANALYST.description

    assert "Dr. Ineta Zvirbule" in description
    assert "no such person" in description
    assert "AI" in description
    # And it says what was NOT wrong, because the analysis itself still stands.
    assert "unchanged" in description


def test_the_note_states_that_the_paragraph_is_left_as_published():
    """The promise the whole design rests on, made where a reader sees it."""
    assert "left exactly as published" in INVENTED_ANALYST.description


def test_every_pending_correction_is_well_formed():
    """Enumerated from ``PENDING`` so a second one added later is covered."""
    for correction in PENDING:
        assert correction.slug.strip()
        assert len(correction.description) > 80, "a one-line note explains nothing"
        note = correction.to_correction()
        assert note["corrected_at"].endswith("Z")
        assert note["description"] == correction.description


def test_no_correction_names_an_article_that_is_also_retracted_elsewhere():
    """The two remedies are alternatives, not a sequence.

    Correcting a story we withdrew tells a reader we amended something we had
    disowned. ``issue`` refuses it at run time; this catches it at review time,
    which is cheaper.
    """
    from newsroom.pipeline import retract

    retracted = set(getattr(retract, "RETRACTED_SLUGS", ()) or ())
    overlap = {c.slug for c in PENDING} & retracted

    assert not overlap, f"these are both corrected and retracted: {sorted(overlap)}"


# ── the stage is wired ──────────────────────────────────────────────────


def test_the_orchestrator_files_editorial_corrections():
    """A declared correction that no run applies is a decision nobody acted on.

    The same failure as a stage that is written, imported and never called —
    and worse here, because the artefact it produces is the one a reader is
    pointed at from the corrections page.
    """
    import inspect

    from newsroom.pipeline import run as run_module

    source = inspect.getsource(run_module.run_once)

    assert "issue_corrections(" in source
    assert "editorial_corrections.PENDING" in source


def test_a_correction_failure_does_not_take_the_edition_down():
    import inspect

    from newsroom.pipeline import run as run_module

    source = inspect.getsource(run_module.run_once)
    index = source.index("issue_corrections(")

    assert "except Exception" in source[index : index + 500]


def test_corrections_are_filed_after_the_article_is_published():
    """Ordering, because the note goes onto a stored document.

    Running before publish would try to correct an article that is not in the
    store yet, which fails silently: ``issue`` skips a missing slug by design.
    """
    import inspect

    from newsroom.pipeline import run as run_module

    source = inspect.getsource(run_module.run_once)

    assert source.index("_store_all(") < source.index("issue_corrections(")

