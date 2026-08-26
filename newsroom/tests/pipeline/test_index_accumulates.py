"""The front page must accumulate, not reset.

`write_index` used to rebuild the index from only the current run's articles.
That is a defensible shape for a report and a catastrophic one for a news site:
the pipeline is *designed* to publish nothing on a quiet day, so the first quiet
run silently deleted every story already on the front page.

It happened in production. A run reporting
`0 published, 3 rejected, 0 errors` -- a completely healthy quiet day -- took the
front page from one article to zero.

These tests pin the accumulate-and-merge behaviour.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from newsroom.pipeline.models import Article
from newsroom.pipeline.publish import ArticleStore


def article(slug: str, *, published_at: str, headline: str | None = None) -> Article:
    return Article(
        id=slug.upper().replace("-", "")[:26].ljust(26, "X"),
        slug=slug,
        tier="A",
        status="published",
        section="labour",
        headline=headline or f"Headline for {slug}",
        dek="A standfirst.",
        body=[],
        persona={
            "id": "nida",
            "name": "Ilze Bērziņa",
            "beat": "Economy & Labour",
            "byline": "Ilze Bērziņa · AI correspondent, Economy & Labour",
        },
        provenance={
            "sources": [{"source_id": "eurostat", "retrieved_at": published_at}],
            "generated_at": published_at,
            "validator": {"passed": True, "checked_at": published_at, "checks": []},
        },
        created_at=published_at,
        published_at=published_at,
        countries=["EE"],
    )


def read_index(tmp_path) -> dict[str, Any]:
    return json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))


class TestTheIndexAccumulates:
    def test_a_quiet_run_must_not_erase_the_front_page(self, tmp_path) -> None:
        """The exact production regression."""
        store = ArticleStore(local_dir=tmp_path)
        asyncio.run(store.write_index([article("first-story", published_at="2026-08-24T10:00:00Z")]))
        assert read_index(tmp_path)["count"] == 1

        # A healthy quiet day: nothing new was worth publishing.
        asyncio.run(store.write_index([]))

        payload = read_index(tmp_path)
        assert payload["count"] == 1, "a quiet run erased the front page"
        assert payload["articles"][0]["slug"] == "first-story"

    def test_new_stories_are_added_to_the_existing_ones(self, tmp_path) -> None:
        store = ArticleStore(local_dir=tmp_path)
        asyncio.run(store.write_index([article("first-story", published_at="2026-08-24T10:00:00Z")]))
        asyncio.run(store.write_index([article("second-story", published_at="2026-08-24T11:00:00Z")]))

        slugs = [a["slug"] for a in read_index(tmp_path)["articles"]]
        assert slugs == ["second-story", "first-story"], "newest first, both retained"

    def test_republishing_the_same_slug_updates_rather_than_duplicates(self, tmp_path) -> None:
        store = ArticleStore(local_dir=tmp_path)
        asyncio.run(
            store.write_index(
                [article("same-story", published_at="2026-08-24T10:00:00Z", headline="First take")]
            )
        )
        asyncio.run(
            store.write_index(
                [article("same-story", published_at="2026-08-24T12:00:00Z", headline="Corrected")]
            )
        )

        payload = read_index(tmp_path)
        assert payload["count"] == 1, "the same slug appeared twice"
        assert payload["articles"][0]["headline"] == "Corrected", "the newer run must win"

    def test_the_index_is_capped_so_it_cannot_grow_without_bound(self, tmp_path) -> None:
        """The bound is now per kind, because one shared cap was the bug.

        ``article()`` builds tier A, so the ceiling that applies is the reserved
        allocation for our own reporting. A single global cap let syndication —
        which is minted at feed velocity — evict every original article in the
        index; see test_index_reserves_our_work.py.
        """
        store = ArticleStore(local_dir=tmp_path)
        cap = ArticleStore.INDEX_MAX_OURS
        batch = [
            article(f"story-{i:04d}", published_at=f"2026-08-24T{i % 24:02d}:00:00Z")
            for i in range(cap + 25)
        ]
        asyncio.run(store.write_index(batch))
        assert read_index(tmp_path)["count"] == cap

    def test_the_two_budgets_sum_to_the_total_bound(self) -> None:
        assert (
            ArticleStore.INDEX_MAX_OURS + ArticleStore.INDEX_MAX_ELSEWHERE
            == ArticleStore.INDEX_MAX_ENTRIES
        )

    def test_a_corrupt_existing_index_does_not_lose_the_new_run(self, tmp_path) -> None:
        """Fail forward: a damaged index must not block today's publishing."""
        (tmp_path / "index.json").write_text("{ this is not json", encoding="utf-8")
        store = ArticleStore(local_dir=tmp_path)
        asyncio.run(store.write_index([article("todays-story", published_at="2026-08-24T10:00:00Z")]))

        payload = read_index(tmp_path)
        assert payload["count"] == 1
        assert payload["articles"][0]["slug"] == "todays-story"

    def test_unservable_articles_are_never_indexed(self, tmp_path) -> None:
        store = ArticleStore(local_dir=tmp_path)
        rejected = article("rejected-story", published_at="2026-08-24T10:00:00Z")
        rejected.status = "rejected"
        asyncio.run(store.write_index([rejected]))
        assert read_index(tmp_path)["count"] == 0

class TestPublishedArticlesLiveWhereTheReaderLooks:
    """The blob path must equal the URL the frontend requests.

    news-api.ts fetches `${BASE}/${slug}.json` and the route is
    `/article/<slug>`. Storing a published article under a dated prefix made
    every link on the front page 404 -- the list rendered, the headlines were
    right, and every one of them led to "Article not found".
    """

    def test_a_published_article_is_addressable_by_slug_alone(self) -> None:
        a = article("some-story", published_at="2026-08-24T10:00:00Z")
        assert ArticleStore.blob_name_for(a) == "some-story.json"

    def test_a_rejected_draft_keeps_a_dated_audit_path(self) -> None:
        a = article("some-story", published_at="2026-08-24T10:00:00Z")
        a.status = "rejected"
        assert ArticleStore.blob_name_for(a) == "rejected/2026-08-24/some-story.json"

    def test_a_pending_item_is_not_reachable_at_the_public_address(self) -> None:
        a = article("some-story", published_at="2026-08-24T10:00:00Z")
        a.status = "pending_approval"
        name = ArticleStore.blob_name_for(a)
        assert name != "some-story.json", "an unapproved item must not sit at the public URL"
        assert name.startswith("pending_approval/")

    def test_put_writes_a_published_article_at_the_flat_path(self, tmp_path) -> None:
        store = ArticleStore(local_dir=tmp_path)
        a = article("flat-path-story", published_at="2026-08-24T10:00:00Z")
        name = asyncio.run(store.put(a))
        assert name == "flat-path-story.json"
        assert (tmp_path / "flat-path-story.json").exists()

class TestOneStoryPerSignal:
    """A signal is a finding, not a headline.

    Re-running the pipeline regenerates the same finding, and because the slug
    comes from the headline and the model rephrases it each time, every run
    minted what looked like a new story. Production ended up with three
    articles about one Estonian unemployment figure, differing only in wording.
    """

    def test_re_telling_the_same_signal_does_not_add_a_second_story(self, tmp_path) -> None:
        store = ArticleStore(local_dir=tmp_path)

        first = article("unemployment-at-6-6-in-june", published_at="2026-08-24T10:00:00Z")
        first.provenance["signal_id"] = "aae7754ee5c17788708b"
        asyncio.run(store.write_index([first]))

        # Same finding, different wording, therefore a different slug.
        again = article("unemployment-declines-in-june", published_at="2026-08-24T11:00:00Z")
        again.provenance["signal_id"] = "aae7754ee5c17788708b"
        asyncio.run(store.write_index([again]))

        payload = read_index(tmp_path)
        assert payload["count"] == 1, "the same finding was published twice"
        assert payload["articles"][0]["slug"] == "unemployment-declines-in-june", (
            "the newest telling should be the one on the front page"
        )

    def test_different_signals_are_both_kept(self, tmp_path) -> None:
        store = ArticleStore(local_dir=tmp_path)
        a = article("unemployment-story", published_at="2026-08-24T10:00:00Z")
        a.provenance["signal_id"] = "signal-one"
        b = article("inflation-story", published_at="2026-08-24T11:00:00Z")
        b.provenance["signal_id"] = "signal-two"
        asyncio.run(store.write_index([a, b]))
        assert read_index(tmp_path)["count"] == 2

    def test_entries_without_a_signal_id_are_never_dropped(self, tmp_path) -> None:
        """Tier B and C carry no signal. Deduping on a missing key would empty
        the syndication rail entirely."""
        store = ArticleStore(local_dir=tmp_path)
        a = article("press-release-one", published_at="2026-08-24T10:00:00Z")
        b = article("press-release-two", published_at="2026-08-24T11:00:00Z")
        for art in (a, b):
            art.provenance.pop("signal_id", None)
        asyncio.run(store.write_index([a, b]))
        assert read_index(tmp_path)["count"] == 2
