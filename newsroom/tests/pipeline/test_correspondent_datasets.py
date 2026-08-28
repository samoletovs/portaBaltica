"""Every dataset a correspondent claims must be one the newsroom actually fetches.

WHAT WAS WRONG
--------------
``CorrespondentPage.tsx`` renders each correspondent's dataset list under the
heading **"Works only from these datasets"**, on the page a sceptical reader
visits precisely to check whether an AI byline is honest. Five of the ids listed
there were fetched by no collector at all::

    datagovlv   statee   datagovlt   ecb   openmeteo

The field is documented as what a correspondent is *permitted* to work from,
which sounds like it licenses a ceiling wider than current usage. It does not
license this: **a permission is only a permission if exercising it is
possible.** No collector requests Statistics Estonia, so "permitted to work from
Statistics Estonia" could never become true, and the list implied a breadth of
sourcing that did not exist.

Confirmed empirically as well as from the code. Across all 78 published
articles, read from the live blob store on 2026-08-28, the only source ids
appearing in ``provenance.sources`` of an original are::

    akmensrags  elering 7, eurostat 1        kolka   eurostat 15
    nida        eurostat 9                   ristna  eurostat 4
    irbene      eurostat 1

WHY THIS GUARD RUNS THE COLLECTORS INSTEAD OF LISTING THEIR SOURCES
-------------------------------------------------------------------
The tempting implementations are both wrong, and this repository has shipped
both mistakes before:

* **``enabled_sources()`` is not the fetched set.** It returns 14; the
  collectors request 9. Six enabled tier A sources are fetched by nothing, which
  is the very defect being fixed here — so a guard built on ``enabled`` would
  have passed the broken list unchanged.
* **A grep for a source id is not a call site.** ``statee`` appears in
  ``sources.yaml``, in two display-name maps and in this list; none of those is
  a fetch.

So the permitted set is *derived by executing both collectors* against a
recording fake and reading back what they asked for. That compares behaviour
rather than source text: it cannot be satisfied by a second implementation that
merely looks right, and it goes red the day someone adds or removes a collector
upstream. It is the same technique as the wire probe's parity guard, which was
built for the same reason.

WHAT THIS GUARD DOES NOT COVER, STATED RATHER THAN IMPLIED
-----------------------------------------------------------
It checks that every declared id is fetched. It does **not** check that the
human-readable ``label`` beside it is accurate — nothing can, since a label is
prose. So ``{ sourceId: 'eurostat', label: 'Eurostat — anything at all' }``
passes. The label is a claim a human still has to keep honest.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
CORRESPONDENTS_TS = REPO_ROOT / "src" / "newsroom" / "correspondents.ts"


# ── deriving what the newsroom actually fetches ─────────────────────────────


@dataclass
class _RecordingHttp:
    """A ``CollectorHttp`` that fetches nothing and remembers what it was asked for."""

    asked: list[str] = field(default_factory=list)

    async def fetch(self, *, source_id: str, url: str, cache_ttl_minutes: Any = None, **_: Any) -> Any:
        from newsroom.pipeline.collect.httpclient import FetchResult

        self.asked.append(source_id)
        # `item=None` makes `FetchResult.ok` false, so each collector logs and
        # moves on without parsing or touching the archive. The call list is the
        # point of this fake, not the payload.
        return FetchResult(source_id, url, None, skipped_reason="dataset_claim_test")


class _UnusedArchive:
    def read(self, *args: Any, **kwargs: Any) -> bytes:  # pragma: no cover
        raise AssertionError("no feed parsed, so the archive should never be read")


def fetched_source_ids() -> set[str]:
    """Every source id the newsroom's collectors actually request.

    Both stages, run for real:

    * ``collect_open_data`` — the tier A collectors, whose own docstring calls
      itself "every tier A collector".
    * ``collect_feeds`` — the tier B and C wire.
    """
    from newsroom.pipeline.collect.opendata import collect_open_data
    from newsroom.pipeline.run import collect_feeds

    tier_a = _RecordingHttp()
    asyncio.run(collect_open_data(tier_a))

    wire = _RecordingHttp()
    asyncio.run(collect_feeds(wire, _UnusedArchive()))

    return set(tier_a.asked) | set(wire.asked)


# ── reading the declarations ────────────────────────────────────────────────

_LITERAL = re.compile(r"sourceId:\s*'([^']+)'")
_ANY = re.compile(r"sourceId\s*:")
_BLOCK = re.compile(r"datasets:\s*\[(.*?)\]", re.DOTALL)


def declared_source_ids(text: str) -> set[str]:
    """Every ``sourceId`` literal declared inside a ``datasets: [...]`` block.

    A regex is legitimate here because the thing being read *is* a list of
    literals — this extracts declarations rather than proxying a property with a
    vocabulary, which is the distinction ``AGENTS.md`` draws.

    Scoped to the blocks rather than to the whole file, because the interface
    declares ``datasets: { sourceId: string; label: string }[]`` and a
    file-wide scan counts that as a tenth entry. The first version did, and the
    literal-count assertion below caught it and refused to run — which is the
    behaviour wanted, one level down: a parser that cannot see everything must
    say so rather than check a subset and report success.

    That assertion stays, because it is the real protection: a computed
    ``sourceId`` would be skipped silently, and silence here means a claim goes
    unchecked.
    """
    ids: set[str] = set()
    for block in _BLOCK.finditer(text):
        body = block.group(1)
        declarations = _ANY.findall(body)
        literals = _LITERAL.findall(body)

        assert len(literals) == len(declarations), (
            f"a datasets block declares {len(declarations)} sourceId entries but only "
            f"{len(literals)} are quoted literals. A computed sourceId cannot be checked "
            "by this guard, so it must not pass unnoticed — declare it literally, or "
            f"teach this test to resolve it.\n{body.strip()}"
        )
        ids.update(literals)

    assert ids, "no sourceId declarations found; the parser has stopped seeing them"
    return ids


# ── the guard ───────────────────────────────────────────────────────────────


def test_every_declared_dataset_is_one_the_newsroom_fetches() -> None:
    declared = declared_source_ids(CORRESPONDENTS_TS.read_text(encoding="utf-8"))
    fetched = fetched_source_ids()
    overclaimed = declared - fetched

    assert not overclaimed, (
        "a correspondent page claims to work from sources the newsroom never fetches.\n"
        f"  overclaimed : {sorted(overclaimed)}\n"
        f"  declared    : {sorted(declared)}\n"
        f"  fetched     : {sorted(fetched)}\n"
        'The page renders these under "Works only from these datasets", so an id here '
        "that no collector requests is a public claim that is not true. Either wire the "
        "source into a collector or remove it from the list."
    )


def test_the_guard_could_have_failed() -> None:
    """The companion assertion: prove both sides are populated and neither is trivially empty.

    A subset check passes when the left side is empty, and it passes when the
    right side is everything. Either would make the test above vacuous while it
    still reported success, so both are pinned.
    """
    declared = declared_source_ids(CORRESPONDENTS_TS.read_text(encoding="utf-8"))
    fetched = fetched_source_ids()

    assert declared, "no dataset declarations were found; the parser has stopped seeing them"
    assert fetched, "the collectors requested nothing; the recording fake is not wired in"
    assert "statee" not in fetched, (
        "the fetched set contains a source no collector requests, so it is not "
        "being derived from behaviour"
    )


def test_it_catches_an_id_that_is_registered_but_never_fetched() -> None:
    """The specific defect, reproduced against the real fetched set.

    `statee` is a perfectly valid registered source with a licence and an
    attribution; it is simply fetched by nothing. A guard written against
    `sources.yaml` membership would pass it, which is why this one is not.
    """
    fetched = fetched_source_ids()
    for registered_but_unfetched in ("statee", "datagovlt", "datagovlv", "ecb", "openmeteo"):
        assert registered_but_unfetched not in fetched, (
            f"{registered_but_unfetched} is now fetched by a collector; if that is "
            "intended, it may be declared on a correspondent page again"
        )


def test_a_computed_source_id_fails_rather_than_being_skipped() -> None:
    """The parser's own anti-vacuity guard, exercised.

    ``declared_source_ids`` can only read a quoted literal. A computed id would
    simply not match, and the set would come back smaller with no indication —
    absence resolving to success, inside the guard written to prevent it. The
    literal count is compared against the declaration count for that reason.

    A mutation control found this untested: disabling the comparison left the
    suite green, because every id in the real file *is* a literal, so nothing
    exercised the branch. This is the missing case, and it is synthetic on
    purpose — the point is the parser's behaviour, not the file's content.
    """
    import pytest

    computed = """
      datasets: [
        { sourceId: 'eurostat', label: 'fine' },
        { sourceId: SOME_CONSTANT, label: 'invisible to a literal scan' },
      ],
    """

    with pytest.raises(AssertionError, match="quoted literals"):
        declared_source_ids(computed)

    # The control: the same shape with both ids literal must parse cleanly, so
    # the failure above is attributable to the computed id and not to the
    # fixture being malformed.
    literal = computed.replace("SOME_CONSTANT", "'elering'")
    assert declared_source_ids(literal) == {"eurostat", "elering"}


def test_the_parser_reads_the_entries_and_not_the_type_declaration() -> None:
    """`datasets: { sourceId: string; label: string }[]` is not an entry.

    The first version of this parser scanned the whole file and counted the
    interface as a tenth declaration, which tripped the literal check and
    stopped the suite. Scoping to `datasets: [...]` blocks is what fixed it, and
    this pins that the interface line stays excluded.
    """
    text = CORRESPONDENTS_TS.read_text(encoding="utf-8")
    assert "sourceId: string" in text, "the interface no longer declares sourceId as a string"
    assert "string" not in declared_source_ids(text)



    """Removing an untrue claim must not leave the page claiming nothing.

    An empty list would render the heading "Works only from these datasets"
    above nothing at all, which reads as "no sources" rather than as an honest
    shorter list — replacing an overstatement with a different false impression.
    """
    text = CORRESPONDENTS_TS.read_text(encoding="utf-8")
    blocks = re.findall(r"datasets:\s*\[(.*?)\]", text, re.DOTALL)

    assert blocks, "no datasets blocks found; the parser has stopped seeing them"
    for block in blocks:
        assert "sourceId:" in block, "a correspondent declares an empty dataset list"


def test_the_registry_still_carries_the_unfetched_sources() -> None:
    """Removing the *claim* must not remove the *registration*.

    `sources.yaml` records each source's licence and attribution, which is the
    part worth keeping even for a source nothing currently reads. This is the
    other half of the same decision: the page should not claim them, and the
    registry should not forget them.
    """
    from newsroom.pipeline.safety import registry

    reg = registry()
    for source_id in ("statee", "datagovlt", "datagovlv", "ecb", "openmeteo"):
        source = reg.get(source_id)
        assert source.licence, f"{source_id} lost its licence record"
        assert source.attribution, f"{source_id} lost its attribution record"
