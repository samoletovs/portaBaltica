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

import asyncio
import json
import pathlib
import re
from typing import Any, Mapping

import pytest

SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

#: Mirrors ``SHOWABLE_STATUSES`` in ``src/news-api.ts`` and
#: ``SYNDICATABLE_STATUSES`` in ``api/shared/newsroom.js``. Three surfaces read
#: this index and the rule has to be the same on all of them.
SHOWABLE_STATUSES = ("published", "corrected")


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

    # An allow list, so an unrecognised state is withheld rather than shown.
    # Skipped when absent: entries written before the field existed are
    # servable and must not vanish.
    status = value.get("status")
    if isinstance(status, str) and status not in SHOWABLE_STATUSES:
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
            "name": "Ilze Nida",
            "beat": "Economy & Labour",
            "byline": "Ilze Nida · AI correspondent, Economy & Labour",
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
        broken["byline"] = "Ilze Nida · AI correspondent, Economy & Labour"
        assert not is_renderable_summary(broken)

    def test_a_persona_without_a_name_is_not_renderable(self) -> None:
        assert not is_renderable_summary(
            tier_a_entry(persona={"id": "nida", "byline": "Ilze Nida · AI correspondent"})
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
                "name": "Ilze Nida",
                "beat": "Economy & Labour",
                "byline": "Ilze Nida · AI correspondent, Economy & Labour",
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


# ── the guard the index has to feed ────────────────────────────────────────


class TestTheIndexCarriesTheStatusItsGuardsReadOn:
    """A filter on a field the data does not carry is not a filter.

    ``ourArticles`` in ``api/shared/newsroom.js`` withholds a retracted article
    from RSS and the sitemap, and ``isRenderableSummary`` does the same for the
    front page. Both read ``status`` off the INDEX ENTRY rather than the
    article, and index entries carried no such field -- so both guards read as
    protection in review and could never fire against a live index.

    This is the same defect as an invariant test whose corpus omits three
    detectors, and as a verification that reads back through the store it wrote
    to. It is the third instance today.
    """

    def _published(self, **overrides: Any):
        from newsroom.pipeline.models import Article, Block

        fields = dict(
            id="01M0SX2DPNN1G0K38FGP4M7ZTZ",
            slug="estonia-s-unemployment-rate-at-6-6-in-june-2026-aae775",
            tier="A",
            status="published",
            headline="Estonia's unemployment rate at 6.6% in June 2026",
            dek="Below the four-year average for this point in the year.",
            section="labour",
            persona={"id": "nida", "name": "Elza Kalnina", "byline": "Elza Kalnina, AI correspondent"},
            body=[Block(type="paragraph", text="The rate fell to 6.6%.")],
            provenance={
                "sources": [{"source_id": "eurostat", "retrieved_at": "2026-08-24T00:00:00Z"}],
                "generated_at": "2026-08-24T00:00:00Z",
                "validator": {"passed": True, "checked_at": "2026-08-24T00:00:00Z", "checks": []},
            },
            created_at="2026-08-24T00:00:00Z",
            published_at="2026-08-24T00:00:00Z",
            countries=["EE"],
        )
        fields.update(overrides)
        return Article(**fields)

    def _index(self, tmp_path, articles):
        from newsroom.pipeline import publish

        store = publish.ArticleStore(local_dir=tmp_path, account_url="")
        asyncio.run(store.write_index(articles))
        return json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))

    def test_the_entry_carries_a_status(self, tmp_path):
        """The one that matters. Without it both guards are inert."""
        payload = self._index(tmp_path, [self._published()])

        entry = payload["articles"][0]
        assert "status" in entry, (
            "index entries carry no status, so `ourArticles` and "
            "`isRenderableSummary` cannot withhold anything"
        )
        assert entry["status"] == "published"

    def test_the_status_is_one_the_guards_recognise(self, tmp_path):
        """Both consumers use an allow list, so a status they have never heard
        of fails closed and the article silently disappears. Emitting one is a
        way to take the front page down without an error anywhere."""
        payload = self._index(tmp_path, [self._published()])

        assert payload["articles"][0]["status"] in SHOWABLE_STATUSES

    def test_a_withheld_entry_would_now_be_dropped(self, tmp_path):
        """Proves the pair composes: emit the field, and the guard bites.

        Built by hand rather than through ``write_index``, because
        ``is_servable`` correctly refuses to index a retracted article in the
        first place. This is the half-failure case -- the stale entry that
        survives when ``drop_from_index`` does not complete.
        """
        payload = self._index(tmp_path, [self._published()])
        entry = dict(payload["articles"][0])

        assert is_renderable_summary(entry)

        entry["status"] = "retracted"
        assert not is_renderable_summary(entry), (
            "a retracted entry left behind by a half-completed drop would still "
            "reach the front page"
        )

    def test_an_entry_without_a_status_is_still_shown(self, tmp_path):
        """Everything published before the field existed must not vanish."""
        payload = self._index(tmp_path, [self._published()])
        entry = dict(payload["articles"][0])
        entry.pop("status")

        assert is_renderable_summary(entry)

    def test_the_three_allow_lists_agree(self):
        """Python, TypeScript and JavaScript each hold this list separately.

        Two surfaces read this index and a third writes it; a rule that holds
        on one of them is not a rule.
        """
        root = pathlib.Path(__file__).resolve().parents[3]
        ts = (root / "src" / "news-api.ts").read_text(encoding="utf-8")
        js = (root / "api" / "shared" / "newsroom.js").read_text(encoding="utf-8")

        for name, source in (("news-api.ts", ts), ("newsroom.js", js)):
            for status in SHOWABLE_STATUSES:
                assert f"'{status}'" in source, f"{name} does not allow {status!r}"
            assert "'retracted'" not in source.split("STATUSES")[1].split("]")[0], (
                f"{name} allows a retracted article through"
            )
