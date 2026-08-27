"""A slug the schema forbids is a page that does not exist.

``article.schema.json`` has declared ``^[a-z0-9]+(-[a-z0-9]+)*$`` since the
first commit and nothing has ever checked it. Eight live articles carry slugs
with diacritics — published, listed in ``index.json``, advertised in
``rss.xml`` and ``sitemap.xml``, and answering *"Article not found"* to anyone
who follows the link, because ``SLUG_PATTERN`` in ``news-api.ts`` correctly
mirrors the schema and correctly refuses them.

There were two slugifiers with two different faults:

``collect/rss.py:item_slug`` kept any character ``str.isalnum()`` accepted.
That is Unicode-aware, so ``ī`` and ``ž`` passed straight through and the slug
broke the schema. This produced all eight.

``ids.py:slugify`` deleted anything outside ``a-z0-9``, which is legal but
destroys the word: ``Rīga`` became ``r-ga`` and ``Braže`` became ``bra-e``.
Its docstring claimed "A schema-legal slug" and was half right.

Latvian, Estonian and Lithuanian headlines are the *ordinary* case for this
newsroom, so neither behaviour is an edge. Both now transliterate, through one
function.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from newsroom.pipeline.collect.rss import item_slug
from newsroom.pipeline.ids import SLUG_PATTERN, slug_problem, slugify
from newsroom.pipeline.models import FeedItem

SCHEMA = Path(__file__).resolve().parents[2] / "schemas" / "article.schema.json"

#: The headlines behind the eight unreachable slugs on production.
LIVE_HEADLINES = [
    ("Explosives factory being built near Jēkabpils Latvia", "jekabpils"),
    ("Reason for CIA chief s trip via Rīga", "riga"),
    ("Rīga Central Station building mostly finished", "riga"),
    ("Gallery European Council president António Costa meets PM", "antonio"),
    ("Oligarchs could hijack Reykjavík s EU referendum", "reykjavik"),
    ("Baiba Braže has a busy day in Sweden", "braze"),
    ("Eiropas komisāra Valda Dombrovska runa", "komisara"),
]


class TestTheSlugMatchesTheContractItClaims:
    def test_the_pattern_here_is_the_pattern_in_the_schema(self) -> None:
        """Two copies of a rule are two chances to check the wrong one."""
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))

        assert schema["properties"]["slug"]["pattern"] == SLUG_PATTERN.pattern

    @pytest.mark.parametrize("headline,expected_word", LIVE_HEADLINES)
    def test_a_baltic_headline_slugs_legally(
        self, headline: str, expected_word: str
    ) -> None:
        slug = slugify(headline, max_words=8, suffix="deadbeef")

        assert slug_problem(slug) is None, slug
        assert expected_word in slug, (
            f"{slug!r} lost the word instead of its diacritic"
        )

    @pytest.mark.parametrize(
        "text,expected",
        [
            ("Rīga", "riga"),
            ("Braže", "braze"),
            ("Jēkabpils", "jekabpils"),
            ("Šiauliai", "siauliai"),
            ("Kärdla", "kardla"),
            ("Võru", "voru"),
            ("Panevėžys", "panevezys"),
            ("Akmeņrags", "akmenrags"),
        ],
    )
    def test_it_transliterates_rather_than_deleting(
        self, text: str, expected: str
    ) -> None:
        """`Rīga` is `riga`, not `r-ga`. The letter survives; the mark does not."""
        assert slugify(text) == expected

    def test_a_syndicated_latvian_headline_is_reachable(self) -> None:
        """`item_slug` produced all eight. It is the same function now."""
        item = FeedItem(
            source_id="lsm",
            title="Rīga Central Station building mostly finished but won't open",
            link="https://eng.lsm.lv/article/12345",
            description="",
            published="2026-08-24T00:00:00Z",
            guid="https://eng.lsm.lv/article/12345",
            raw_blob="raw-feeds/lsm/2026-08-24.xml",
        )

        slug = item_slug(item)

        assert slug_problem(slug) is None, slug
        assert slug.startswith("riga-central-station")


class TestSlugProblemNamesTheFault:
    @pytest.mark.parametrize(
        "slug",
        ["rīga-central-station-9a4349d1", "baiba-braže-bfe0a539", "Estonia-Rate", ""],
    )
    def test_it_refuses_what_the_frontend_refuses(self, slug: str) -> None:
        assert slug_problem(slug) is not None

    def test_it_accepts_a_legal_slug(self) -> None:
        assert slug_problem("riga-central-station-9a4349d1") is None

    def test_it_says_which_character_is_wrong(self) -> None:
        problem = slug_problem("rīga-central-9a4349d1")

        assert problem is not None
        assert "ī" in problem


def _article(publish_module, *, slug: str):
    from newsroom.pipeline.models import Article

    return Article(
        id="01M0SX2DPNN1G0K38FGP4M7ZTZ",
        slug=slug,
        tier="A",
        status="published",
        section="labour",
        headline="Estonia's unemployment rate at 6.6% in June 2026",
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


def _local_publish(monkeypatch):
    monkeypatch.delenv("BLOB_ACCOUNT_URL", raising=False)
    monkeypatch.delenv("NEWSROOM_STORAGE_ACCOUNT_URL", raising=False)

    import importlib

    import newsroom.pipeline.config as config

    importlib.reload(config)
    import newsroom.pipeline.publish as publish

    importlib.reload(publish)
    return publish


class TestTheStoreRefusesWhatCannotBeServed:
    def test_put_rejects_an_illegal_slug(self, tmp_path, monkeypatch) -> None:
        """The contract fires at the boundary, not in a docstring."""
        publish = _local_publish(monkeypatch)
        store = publish.ArticleStore(local_dir=tmp_path)
        article = _article(publish, slug="rīga-central-station-9a4349d1")

        with pytest.raises(publish.NotServable, match="schema pattern"):
            asyncio.run(store.put(article))

    def test_put_accepts_the_transliterated_form(self, tmp_path, monkeypatch) -> None:
        publish = _local_publish(monkeypatch)
        store = publish.ArticleStore(local_dir=tmp_path)
        article = _article(publish, slug="riga-central-station-9a4349d1")

        asyncio.run(store.put(article))

        assert list(tmp_path.rglob("*.json"))


class TestTheIndexStopsAdvertisingUnreachablePages:
    def test_an_existing_bad_entry_is_dropped(self, tmp_path, monkeypatch) -> None:
        """The eight already published. Not rewritten -- just not advertised.

        `api/shared/newsroom.js` reads `index.json` and both `/rss.xml` and
        `/sitemap.xml` are built from it, so dropping the entry here stops
        both surfaces pointing at a page that answers "Article not found".
        """
        publish = _local_publish(monkeypatch)
        (tmp_path / "index.json").write_text(
            json.dumps(
                {
                    "generated_at": "2026-08-26T00:00:00Z",
                    "count": 1,
                    "articles": [
                        {
                            "slug": "baiba-braže-has-a-busy-day-in-sweden-bfe0a539",
                            "tier": "C",
                            "status": "published",
                            "headline": "Baiba Braže has a busy day in Sweden",
                            "published_at": "2026-08-26T00:00:00Z",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        store = publish.ArticleStore(local_dir=tmp_path)
        asyncio.run(store.write_index([_article(publish, slug="a-legal-slug-aae775")]))

        written = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
        slugs = [entry["slug"] for entry in written["articles"]]

        assert "baiba-braže-has-a-busy-day-in-sweden-bfe0a539" not in slugs
        assert "a-legal-slug-aae775" in slugs

    def test_every_advertised_slug_is_servable(self, tmp_path, monkeypatch) -> None:
        publish = _local_publish(monkeypatch)
        store = publish.ArticleStore(local_dir=tmp_path)
        asyncio.run(store.write_index([_article(publish, slug="a-legal-slug-aae775")]))

        written = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))

        assert written["articles"]
        assert all(slug_problem(e["slug"]) is None for e in written["articles"])
