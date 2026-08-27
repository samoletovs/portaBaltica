"""Research that leaves the building, and the two rules that keep it lawful.

The dangerous capability added here is fetching a page the newsroom did not
subscribe to. These tests pin the boundary:

* only a **primary official source** is ever fetched, and the registry refuses
  to mark anything else fetchable — so tier C stays headline, the outlet's own
  RSS snippet, and a link;
* a search result whose host is not already registered is discarded **before**
  anything is requested, so discovery can only ever find another page of a
  publisher whose licence has already been assessed.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest

from newsroom.pipeline.research import ResearchContext, ResearchItem
from newsroom.pipeline.webresearch import (
    NullSearchProvider,
    SearchHit,
    build_query,
    deepen,
    extract_text,
    fetch_documents,
    resolve_to_registered,
    search_provider,
)
from newsroom.source_registry import InvalidRegistryError, SourceRegistry

from .conftest import make_signal


class _FakeItem:
    def __init__(self, body: bytes, content_type: str = "text/html") -> None:
        self.body = body
        self.content_type = content_type


class _FakeResult:
    def __init__(self, item=None, skipped_reason: str | None = None) -> None:
        self.item = item
        self.skipped_reason = skipped_reason

    @property
    def ok(self) -> bool:
        return self.item is not None


class _FakeHttp:
    """Records every fetch, so a test can assert one did *not* happen."""

    def __init__(self, body: bytes = b"", fail: bool = False) -> None:
        self.body = body
        self.fail = fail
        self.requested: list[str] = []

    async def fetch(self, *, source_id: str, url: str, cache_ttl_minutes: int, **kwargs):
        self.requested.append(url)
        if self.fail:
            return _FakeResult(skipped_reason="fetch_failed")
        return _FakeResult(_FakeItem(self.body))


PRESS_RELEASE = b"""
<html><head><title>t</title><style>.a{color:red}</style></head><body>
<nav><a href="/">Home</a><a href="/x">Media</a></nav>
<div>Skip to content</div>
<div>EN</div>
<p>The Governing Council today decided to keep the three key ECB interest
rates unchanged, judging that the disinflation process remains on track.</p>
<p>Wage growth in the euro area continued to moderate over the period under
review, easing pressure on services price inflation.</p>
<footer>Copyright</footer></body></html>
"""


def official_item(source_id: str = "ecb_press", url: str = "https://www.ecb.europa.eu/press/x.html"):
    return ResearchItem(
        source_id=source_id,
        source_name="European Central Bank press",
        role="official_statement",
        title="Monetary policy decisions",
        url=url,
        retrieved_at="2026-08-24T11:00:00Z",
    )


def coverage_item():
    return ResearchItem(
        source_id="lsm_en",
        source_name="LSM.lv English",
        role="prior_coverage",
        title="Wages rise again",
        url="https://eng.lsm.lv/article/economy/wages.html",
        retrieved_at="2026-08-24T11:00:00Z",
    )


# ── the licence gate ────────────────────────────────────────────────────


def test_an_official_document_is_fetched_and_read():
    http = _FakeHttp(PRESS_RELEASE)
    context = ResearchContext(items=(official_item(),), candidates_considered=1)

    result = asyncio.run(fetch_documents(context, http))

    assert result.documents_fetched == 1
    assert "Governing Council" in result.items[0].document


def test_a_news_outlets_page_is_never_requested():
    """The single most important assertion in this file.

    Tier C is link-out only under DSM Art. 15, and fetching an article body
    would put the whole portal on the wrong side of that. The check is that no
    HTTP request was made at all — not merely that the text was discarded
    afterwards.
    """
    http = _FakeHttp(PRESS_RELEASE)
    context = ResearchContext(items=(coverage_item(),), candidates_considered=1)

    result = asyncio.run(fetch_documents(context, http))

    assert http.requested == []
    assert result.items[0].document is None
    assert result.documents_fetched == 0


def test_the_registry_refuses_to_make_a_news_outlet_fetchable():
    """So it cannot be switched on by editing one line of YAML."""
    document = {
        "version": 1,
        "sources": [
            {
                "id": "someoutlet",
                "name": "Some Outlet",
                "publisher": "Some Outlet",
                "tier": "C",
                "licence": "copyright",
                "attribution": "Some Outlet",
                "rewrite_allowed": False,
                "requires_human_approval": False,
                "research_role": "prior_coverage",
                "research_language": "en",
                "max_snippet_source": "rss_description_verbatim",
                "document_fetch_allowed": True,
            }
        ],
    }

    with pytest.raises(InvalidRegistryError, match="document_fetch_allowed"):
        SourceRegistry.from_mapping(document)


def test_the_registry_refuses_document_fetch_without_an_official_role():
    document = {
        "version": 1,
        "sources": [
            {
                "id": "somedata",
                "name": "Some Data",
                "publisher": "Some Data",
                "tier": "A",
                "licence": "open",
                "attribution": "Some Data",
                "rewrite_allowed": True,
                "requires_human_approval": False,
                "document_fetch_allowed": True,
            }
        ],
    }

    with pytest.raises(InvalidRegistryError, match="official_statement"):
        SourceRegistry.from_mapping(document)


def test_every_registered_tier_c_source_is_unfetchable():
    """The invariant, checked against the registry that actually ships."""
    for source in SourceRegistry.load():
        if source.tier == "C":
            assert not source.document_fetch_allowed, source.id


def test_document_text_only_reaches_the_prompt_for_an_official_source():
    """Belt and braces: even a hand-built item carrying text cannot leak it.

    The producer-side guards (``research_signal`` only attaches a summary when
    the source allows it, and the registry refuses that flag on tier C) are
    real, but they are guards in a different module. This one sits at the
    boundary the text actually crosses on its way to a model.
    """
    smuggled = ResearchItem(
        source_id="lsm_en",
        source_name="LSM.lv English",
        role="prior_coverage",
        title="t",
        url="https://eng.lsm.lv/a",
        retrieved_at="2026-08-24T11:00:00Z",
        summary="the outlet's own snippet",
        document="the full text of somebody else's article",
    )

    record = smuggled.prompt_record()

    assert "official_document_text" not in record
    assert "official_summary" not in record
    assert "somebody else" not in str(record)
    # What tier C IS allowed to contribute survives.
    assert record["title"] == "t"
    assert record["source"] == "LSM.lv English"
    # The URL is not among it. A model has no legitimate use for the link — it
    # is told to treat prior coverage as an orientation lead and not to quote
    # it — and a slug is a run of third-party text and digits that did reach
    # prose. The reader still gets it: it is in ``provenance_record``, which is
    # what the article's provenance block is built from.
    assert "url" not in record
    assert smuggled.provenance_record()["url"] == "https://eng.lsm.lv/a"


def test_an_official_source_still_contributes_its_text():
    """The gate must not be so tight that research stops working."""
    record = replace(
        official_item(), summary="the bank said", document="the full release"
    ).prompt_record()

    assert record["official_summary"] == "the bank said"
    assert record["official_document_text"] == "the full release"


def test_provenance_records_that_a_document_was_read_but_not_its_text():
    """The text belongs to the publisher; the article links to it. That it was
    read, and how much, is what an auditing reader needs."""
    record = replace(official_item(), document="x" * 500).provenance_record()

    assert record["document_chars"] == "500"
    assert "x" * 500 not in str(record)


# ── extraction ──────────────────────────────────────────────────────────


def test_extraction_drops_navigation_and_keeps_prose():
    """A real ECB release measured 11,548 characters of which ~600 were a
    language switcher and a menu. At a 2,400 character budget that is a quarter
    of the prompt spent on furniture."""
    text = extract_text(PRESS_RELEASE, "text/html")

    assert text.startswith("The Governing Council")
    assert "Skip to content" not in text
    assert "Home" not in text
    assert "color:red" not in text
    assert "Wage growth" in text


def test_a_page_that_is_all_boilerplate_yields_nothing():
    text = extract_text(b"<html><body><nav>Home</nav><div>EN</div></body></html>", "text/html")

    assert text == ""


def test_a_failed_fetch_leaves_the_item_alone():
    """Research is enrichment. An unreachable press office costs depth."""
    http = _FakeHttp(fail=True)
    context = ResearchContext(items=(official_item(),), candidates_considered=1)

    result = asyncio.run(fetch_documents(context, http))

    assert result.items[0].document is None
    assert result.documents_fetched == 0


def test_the_number_of_documents_is_bounded():
    http = _FakeHttp(PRESS_RELEASE)
    items = tuple(
        official_item(url=f"https://www.ecb.europa.eu/press/{index}.html")
        for index in range(6)
    )

    result = asyncio.run(fetch_documents(ResearchContext(items=items), http, limit=2))

    assert len(http.requested) == 2
    assert result.documents_fetched == 2


# ── discovery ───────────────────────────────────────────────────────────


def test_search_is_off_unless_it_is_configured(monkeypatch):
    monkeypatch.delenv("NEWSROOM_SEARCH_PROVIDER", raising=False)
    monkeypatch.delenv("NEWSROOM_SEARCH_API_KEY", raising=False)

    assert isinstance(search_provider(), NullSearchProvider)


def test_an_unregistered_host_is_discarded_before_anything_is_fetched():
    """Search proposes a URL; the registry decides whether we may read it.

    Without this, enabling search would silently introduce publishers whose
    licence nobody has assessed — which is the failure mode that would make
    search unusable in this pipeline.
    """
    hits = [
        SearchHit(title="a", url="https://randomblog.example/post"),
        SearchHit(title="b", url="https://www.ecb.europa.eu/press/real.html"),
    ]

    resolved = resolve_to_registered(hits)

    assert [source.id for source, _ in resolved] == ["ecb_press"]


def test_a_registered_but_unfetchable_host_is_also_discarded():
    hits = [SearchHit(title="a", url="https://eng.lsm.lv/article/x")]

    assert resolve_to_registered(hits) == []


def test_the_query_names_the_measure_the_country_and_the_period():
    signal = make_signal(
        metric_label="hourly labour cost", geography="LV", period="2025"
    )

    query = build_query(signal)

    assert "hourly labour cost" in query
    assert "Latvia" in query
    assert "2025" in query


def test_deepen_still_reads_documents_when_discovery_is_off():
    http = _FakeHttp(PRESS_RELEASE)
    context = ResearchContext(items=(official_item(),), candidates_considered=1)

    result = asyncio.run(
        deepen(make_signal(), context, http, provider=NullSearchProvider())
    )

    assert result.documents_fetched == 1


# ── the URL, not just the source ────────────────────────────────────────


def test_a_link_that_leaves_the_publishers_domain_is_not_fetched():
    """The gate answers "may we read this publisher's pages". It does not
    answer "is this URL that publisher's page", and those come apart.

    `item.url` is the raw <link> of an RSS entry, and a central bank or the
    Commission may legitimately point one at a newspaper. Fetching it would
    pull a third party's article body through a gate that only ever inspected
    the FEED's licence, and `prompt_record` would then label it
    `official_document_text` because it keys on the feed's declared role.
    """
    http = _FakeHttp(PRESS_RELEASE)
    item = official_item(url="https://eng.lsm.lv/article/economy/wages.html")

    result = asyncio.run(fetch_documents(ResearchContext(items=(item,)), http))

    assert http.requested == []
    assert result.items[0].document is None
    assert result.documents_fetched == 0


def test_a_link_to_an_entirely_unregistered_host_is_not_fetched():
    http = _FakeHttp(PRESS_RELEASE)
    item = official_item(url="https://randomblog.example/post")

    asyncio.run(fetch_documents(ResearchContext(items=(item,)), http))

    assert http.requested == []


def test_a_redirect_off_the_publishers_domain_discards_the_body():
    """The collector follows redirects, so a pre-flight check alone is a
    guarantee about the request rather than about the response."""

    class Redirecting(_FakeHttp):
        async def fetch(self, *, source_id, url, cache_ttl_minutes, **kwargs):
            self.requested.append(url)
            item = _FakeItem(self.body)
            item.url = "https://eng.lsm.lv/article/economy/wages.html"
            return _FakeResult(item)

    http = Redirecting(PRESS_RELEASE)
    result = asyncio.run(fetch_documents(ResearchContext(items=(official_item(),)), http))

    assert http.requested, "the request itself was legitimate and should have been made"
    assert result.items[0].document is None
    assert result.documents_fetched == 0


def test_an_on_domain_link_is_still_fetched():
    """The guard must not be so tight that document research stops working."""
    http = _FakeHttp(PRESS_RELEASE)
    item = official_item(url="https://www.ecb.europa.eu/press/pr/date/2026/html/x.en.html")

    result = asyncio.run(fetch_documents(ResearchContext(items=(item,)), http))

    assert result.documents_fetched == 1
    assert "Governing Council" in result.items[0].document
