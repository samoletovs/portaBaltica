"""The index must not let link-outs delete our own journalism.

WHAT WAS HAPPENING
------------------
``write_index`` sorted every entry by date and kept the newest 200. Tier C cards
are minted at feed velocity — LSM, ERR and EUobserver together produced 154 of
the 161 entries in the live index — while tier A is produced only when the data
warrants it, which on a normal day is nought to eight.

Sorting those together by date has one outcome. Replaying the live index and
adding a single further run's worth of syndication drops **all seven** original
articles and leaves an index that is 200/200 link-outs. The front page would
then read "Nothing to report yet today" beside a full rail of other outlets'
headlines.

The articles themselves survive in storage; only their index entries are lost.
That is not a consolation. newsroom/README.md is explicit: "an article missing
from it is invisible however faithfully it was stored."

So the wire would have converted itself into the aggregator its own README says
it deliberately is not — not by anyone's decision, but by a sort order.

WHAT THIS ASSERTS
-----------------
Our journalism has a reserved allocation that syndication cannot take, at any
ratio, however fast the feeds run.
"""

from __future__ import annotations

import json

import pytest

from newsroom.pipeline.models import Article
from newsroom.pipeline.publish import ArticleStore


def article(
    slug: str,
    tier: str,
    published_at: str,
    *,
    section: str = "economy",
) -> Article:
    """A servable article of the given tier."""
    kwargs = {
        "id": slug,
        "slug": slug,
        "tier": tier,
        "status": "published",
        "headline": f"Headline for {slug}",
        "section": section,
        "created_at": published_at,
        "published_at": published_at,
        "provenance": {"validator": {"passed": True, "checks": []}, "signal_id": None},
    }
    if tier == "A":
        kwargs["persona"] = {"id": "kolka", "name": "A Correspondent", "beat": "Economy"}
        kwargs["provenance"]["signal_id"] = f"sig-{slug}"
    else:
        kwargs["syndicated"] = {
            "source_id": "err_en",
            "original_url": f"https://news.err.ee/{slug}",
            "attribution": "ERR News",
            "snippet": "A snippet.",
            "snippet_is_verbatim": True,
        }
    return Article(**kwargs)


def stamp(day: int, minute: int = 0) -> str:
    return f"2026-08-{day:02d}T20:{minute:02d}:00Z"


async def index_of(store: ArticleStore, articles) -> list[dict]:
    await store.write_index(articles)
    return json.loads((store._local_dir / "index.json").read_text(encoding="utf-8"))["articles"]


class TestSyndicationCannotEvictOurJournalism:
    @pytest.mark.asyncio
    async def test_the_live_shape_survives_another_run(self, tmp_path) -> None:
        """Reproduces the measured failure: 7 originals, 154 link-outs, one more run."""
        store = ArticleStore(local_dir=tmp_path, account_url="")

        # The index as it stood: originals from the 24th and 25th, syndication
        # stamped at the run time and therefore newer than all of them.
        existing = [article(f"ours-{n}", "A", stamp(24, n)) for n in range(7)]
        existing += [article(f"theirs-{n}", "C", stamp(25, n % 60)) for n in range(154)]
        await index_of(store, existing)

        # One further run, at the feed velocity these outlets actually publish at.
        next_run = [article(f"fresh-{n}", "C", stamp(26, n % 60)) for n in range(100)]
        entries = await index_of(store, next_run)

        ours = [e for e in entries if e["tier"] == "A"]
        assert len(ours) == 7, (
            f"{7 - len(ours)} original article(s) were evicted from the index by "
            f"syndicated link-outs. The articles still exist in storage, but the "
            f"front page reads the index, so they are invisible."
        )

    @pytest.mark.asyncio
    async def test_our_work_survives_an_unbounded_flood(self, tmp_path) -> None:
        store = ArticleStore(local_dir=tmp_path, account_url="")

        ours = [article(f"ours-{n}", "A", stamp(20, n)) for n in range(5)]
        flood = [article(f"theirs-{n}", "C", stamp(27, n % 60)) for n in range(600)]

        entries = await index_of(store, ours + flood)

        assert len([e for e in entries if e["tier"] == "A"]) == 5, (
            "no volume of syndication may displace our own reporting"
        )

    @pytest.mark.asyncio
    async def test_syndication_is_still_capped(self, tmp_path) -> None:
        """The rail is a pointer to other people's work, not a second archive."""
        store = ArticleStore(local_dir=tmp_path, account_url="")

        entries = await index_of(
            store, [article(f"theirs-{n}", "C", stamp(27, n % 60)) for n in range(600)]
        )

        theirs = [e for e in entries if e["tier"] == "C"]
        assert 0 < len(theirs) <= ArticleStore.INDEX_MAX_ELSEWHERE
        assert len(entries) <= ArticleStore.INDEX_MAX_ENTRIES

    @pytest.mark.asyncio
    async def test_the_newest_of_each_kind_is_the_one_kept(self, tmp_path) -> None:
        store = ArticleStore(local_dir=tmp_path, account_url="")

        old = article("ours-old", "A", stamp(1))
        new = article("ours-new", "A", stamp(28))
        entries = await index_of(store, [old, new])

        assert [e["slug"] for e in entries if e["tier"] == "A"] == ["ours-new", "ours-old"]

    @pytest.mark.asyncio
    async def test_an_empty_wire_still_publishes_the_rail(self, tmp_path) -> None:
        # Reserving room for our work must not mean withholding everything else
        # on a day we wrote nothing.
        store = ArticleStore(local_dir=tmp_path, account_url="")

        entries = await index_of(store, [article("theirs-1", "C", stamp(27))])

        assert len(entries) == 1

    @pytest.mark.asyncio
    async def test_tier_b_is_counted_as_ours_for_eviction(self, tmp_path) -> None:
        """Tier B is a press release we reproduce under licence, not a link-out.

        It carries no byline, but it is material we chose and stand behind, and
        it is not produced at feed velocity. Grouping it with tier C would let
        the rail evict it.
        """
        store = ArticleStore(local_dir=tmp_path, account_url="")

        ours = [article("release", "B", stamp(20))]
        flood = [article(f"theirs-{n}", "C", stamp(27, n % 60)) for n in range(600)]

        entries = await index_of(store, ours + flood)

        assert any(e["slug"] == "release" for e in entries)
