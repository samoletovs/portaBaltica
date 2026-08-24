"""The index shape must satisfy the frontend's type guard.

``ArticleIndex`` is the only thing the browser ever reads. Its shape is fixed by
``ArticleSummary`` in ``src/news-types.ts`` and enforced at render time by
``isRenderableSummary`` in ``src/news-api.ts``, which silently drops entries it
does not recognise.

Silently is the problem. When the index carried a flat ``byline`` string instead
of a ``persona`` object, everything downstream reported success: the pipeline
published, the blob served 200, CORS passed, the browser fetched it — and the
front page said "Nothing to report yet today" because its only article failed
the guard and was filtered out. No error anywhere.

These tests reimplement that guard against real published articles, so the
server side fails loudly the moment the two drift apart again.
"""

from __future__ import annotations

import json
import re
from typing import Any, Mapping

import pytest

SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def is_renderable_summary(value: Any) -> bool:
    """Port of ``isRenderableSummary`` from src/news-api.ts.

    Kept deliberately literal rather than tidied, so a reader can diff the two
    by eye.
    """
    if not isinstance(value, Mapping):
        return False

    slug = value.get("slug")
    headline = value.get("headline")
    section = value.get("section")
    tier = value.get("tier")

    if not isinstance(slug, str) or not SLUG.match(slug):
        return False
    if not isinstance(headline, str) or not headline:
        return False
    if not isinstance(section, str):
        return False
    if tier not in ("A", "B", "C"):
        return False

    if tier == "A":
        persona = value.get("persona")
        if not isinstance(persona, Mapping):
            return False
        name = persona.get("name")
        if not isinstance(name, str) or not name:
            return False

    if tier in ("B", "C"):
        syndicated = value.get("syndicated")
        if not isinstance(syndicated, Mapping):
            return False
        for key in ("attribution", "original_url"):
            item = syndicated.get(key)
            if not isinstance(item, str) or not item:
                return False

    return True


def tier_a_entry(**overrides: Any) -> dict[str, Any]:
    entry = {
        "id": "01M0SX2DPNN1G0K38FGP4M7ZTZ",
        "slug": "estonia-s-unemployment-rate-at-6-6-in-june-2026-aae775",
        "tier": "A",
        "section": "labour",
        "headline": "Estonia's Unemployment Rate at 6.6% in June 2026",
        "dek": "Below the four-year average for this point in the year.",
        "persona": {
            "id": "nida",
            "name": "Nida",
            "beat": "Economy & Labour",
            "byline": "Nida · AI correspondent, Economy & Labour",
        },
        "syndicated": None,
        "published_at": "2026-08-24T12:48:57Z",
        "countries": ["EE"],
    }
    entry.update(overrides)
    return entry


class TestTheFrontendCanRenderWhatWePublish:
    def test_a_tier_a_entry_is_renderable(self) -> None:
        assert is_renderable_summary(tier_a_entry())

    def test_a_flat_byline_is_not_renderable(self) -> None:
        """The exact regression that emptied the front page.

        This is what the index used to emit. It reads perfectly well to a
        human and is invisible to every server-side check.
        """
        broken = tier_a_entry()
        broken.pop("persona")
        broken["byline"] = "Nida · AI correspondent, Economy & Labour"
        assert not is_renderable_summary(broken)

    def test_a_persona_without_a_name_is_not_renderable(self) -> None:
        assert not is_renderable_summary(
            tier_a_entry(persona={"id": "nida", "byline": "Nida · AI correspondent"})
        )

    def test_a_tier_c_entry_needs_a_syndicated_object(self) -> None:
        card = tier_a_entry(tier="C", persona=None)
        card["syndicated"] = None
        assert not is_renderable_summary(card)

    def test_a_tier_c_entry_with_attribution_and_url_is_renderable(self) -> None:
        card = tier_a_entry(tier="C", persona=None)
        card["syndicated"] = {
            "attribution": "ERR News",
            "original_url": "https://news.err.ee/123456/example",
            "snippet": "The Riigikogu began its first reading on Tuesday.",
        }
        assert is_renderable_summary(card)

    def test_a_flat_attribution_is_not_renderable(self) -> None:
        card = tier_a_entry(tier="C", persona=None)
        card["syndicated"] = None
        card["attribution"] = "ERR News"
        assert not is_renderable_summary(card)

    @pytest.mark.parametrize(
        "bad_slug", ["Estonia-Unemployment", "estonia_unemployment", "", "a--b"]
    )
    def test_slugs_must_match_the_frontend_pattern(self, bad_slug: str) -> None:
        assert not is_renderable_summary(tier_a_entry(slug=bad_slug))


class TestTheWriterProducesThatShape:
    """Runs the real index writer, not a hand-built fixture."""

    def test_write_index_emits_renderable_entries(self, tmp_path, monkeypatch) -> None:
        monkeypatch.delenv("BLOB_ACCOUNT_URL", raising=False)
        monkeypatch.delenv("NEWSROOM_STORAGE_ACCOUNT_URL", raising=False)

        import asyncio
        import importlib

        import newsroom.pipeline.config as config
        importlib.reload(config)
        import newsroom.pipeline.publish as publish
        importlib.reload(publish)

        from newsroom.pipeline.models import Article

        article = Article(
            id="01M0SX2DPNN1G0K38FGP4M7ZTZ",
            slug="estonia-s-unemployment-rate-at-6-6-in-june-2026-aae775",
            tier="A",
            status="published",
            section="labour",
            headline="Estonia's Unemployment Rate at 6.6% in June 2026",
            dek="Below the four-year average for this point in the year.",
            body=[],
            persona={
                "id": "nida",
                "name": "Nida",
                "beat": "Economy & Labour",
                "byline": "Nida · AI correspondent, Economy & Labour",
            },
            provenance={
                "sources": [{"source_id": "eurostat", "retrieved_at": "2026-08-24T00:00:00Z"}],
                "generated_at": "2026-08-24T00:00:00Z",
                "validator": {"passed": True, "checked_at": "2026-08-24T00:00:00Z", "checks": []},
            },
            created_at="2026-08-24T00:00:00Z",
            published_at="2026-08-24T00:00:00Z",
            countries=["EE"],
        )

        store = publish.ArticleStore(local_dir=tmp_path)
        asyncio.run(store.write_index([article]))

        index_path = tmp_path / "index.json"
        assert index_path.exists(), "write_index wrote no index"
        payload = json.loads(index_path.read_text(encoding="utf-8"))

        assert payload["count"] == 1
        entry = payload["articles"][0]
        assert is_renderable_summary(entry), (
            "the real index writer emitted an entry the frontend will silently "
            f"drop: {entry!r}"
        )
