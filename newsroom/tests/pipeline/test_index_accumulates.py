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
            "name": "Nida",
            "beat": "Economy & Labour",
            "byline": "Nida · AI correspondent, Economy & Labour",
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
        store = ArticleStore(local_dir=tmp_path)
        cap = ArticleStore.INDEX_MAX_ENTRIES
        batch = [
            article(f"story-{i:04d}", published_at=f"2026-08-24T{i % 24:02d}:00:00Z")
            for i in range(cap + 25)
        ]
        asyncio.run(store.write_index(batch))
        assert read_index(tmp_path)["count"] == cap

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
