"""Stage 4c — research that actually leaves the building.

WHAT WAS THERE BEFORE
---------------------
``research.py`` opens with the words "bounded web research". It makes no web
request. It keyword-filters RSS items that syndication had already fetched, and
on a live run the article it produced recorded:

    "research": {"method": "registered_feeds",
                 "candidates_considered": 0, "consulted": []}

Zero. The correspondent asked what else was known about Latvian labour costs and
the newsroom answered with silence, so it wrote "future data releases will
provide further insights" and the desk waved it through.

Even when the matcher fires, the most it can offer is a headline and a link. A
central bank's commentary on the release — the one thing that could say *why* —
sits one HTTP request away and was never fetched.

WHAT THIS ADDS
--------------
1. ``fetch_documents`` retrieves the page behind an **official statement** and
   extracts its readable text, so a Latvijas Banka or Commission release
   contributes its actual argument instead of its title.

2. ``SearchProvider`` is a seam for genuine discovery. The default makes no
   network call at all, so nothing here depends on a third-party account; an
   operator who wants search sets two environment variables and gets it.

THE TWO RULES THAT KEEP THIS LAWFUL
-----------------------------------
**Only official sources are ever fetched.** ``document_fetch_allowed`` is a
registry flag that the registry itself refuses to set on anything that is not
``research_role: official_statement``, and refuses on tier C outright. A
newspaper's article body cannot be fetched by editing a YAML line, because the
registry will not load. Tier C remains what it has always been: headline, the
outlet's own RSS snippet, link, nothing more.

**Search can only find registered sources.** A hit whose host does not resolve
to an entry in the source registry is discarded before anything is fetched. So
search widens *which page* of a known publisher the newsroom reads. It cannot
introduce a publisher whose licence nobody has assessed, which is the failure
mode that would otherwise make search unusable here.
"""

from __future__ import annotations

import asyncio
import html
import logging
import os
import re
from dataclasses import dataclass, replace
from html.parser import HTMLParser
from typing import Any, Protocol, Sequence
from urllib.parse import urlsplit

from newsroom.pipeline import config
from newsroom.pipeline.research import ResearchContext, ResearchItem
from newsroom.pipeline.safety import registry
from newsroom.source_registry import Source, UnregisteredSourceError

log = logging.getLogger(__name__)

#: How much of a fetched official document reaches the prompt. Long enough for
#: a press release's substance, short enough that five of them cannot crowd out
#: the verified figures — which are the part that must not be skimmed.
DOCUMENT_MAX_CHARS = int(os.environ.get("NEWSROOM_DOCUMENT_MAX_CHARS", "2400"))

#: Documents fetched per article. Each is one HTTP request and roughly 600
#: prompt tokens.
DOCUMENTS_PER_ARTICLE = int(os.environ.get("NEWSROOM_DOCUMENTS_PER_ARTICLE", "3"))

#: Official releases do not change after publication, so this is deliberately
#: long — a rerun of the same day costs nothing.
DOCUMENT_CACHE_TTL_MINUTES = int(os.environ.get("NEWSROOM_DOCUMENT_CACHE_TTL", "1440"))

_SPACE = re.compile(r"[ \t\r\f\v]+")
_BLANK_LINES = re.compile(r"\n{3,}")

#: Elements whose text is never prose. ``noscript`` is included because cookie
#: banners live there and would otherwise dominate a short extract.
_SKIP_ELEMENTS = frozenset(
    {"script", "style", "noscript", "svg", "head", "nav", "footer", "form", "aside"}
)
_BLOCK_ELEMENTS = frozenset(
    {"p", "div", "section", "article", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6"}
)


class _ReadableText(HTMLParser):
    """Strip a page to the text a human would read.

    Not a full readability implementation and deliberately not: a press release
    is mostly prose already, and the value of a simple extractor is that its
    failure mode is obvious — too much boilerplate — rather than silently
    dropping the paragraph that mattered.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in _SKIP_ELEMENTS:
            self._skip_depth += 1
        elif tag in _BLOCK_ELEMENTS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_ELEMENTS and self._skip_depth:
            self._skip_depth -= 1
        elif tag in _BLOCK_ELEMENTS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(data)

    def text(self) -> str:
        joined = "".join(self._parts)
        joined = _SPACE.sub(" ", joined)
        joined = "\n".join(line.strip() for line in joined.split("\n"))
        return _BLANK_LINES.sub("\n\n", joined).strip()


def _is_prose(line: str) -> bool:
    """Does this line read like a sentence, or like a navigation menu?

    Boilerplate removal by shape rather than by selector, because every site's
    selectors differ and a wrong guess silently drops the paragraph that
    mattered. A real ECB release measured 11,548 characters of which the first
    ~600 were a language switcher, a menu and "Skip to content" — at a 2,400
    character budget that is a quarter of the prompt spent on furniture.

    Navigation is short fragments without terminal punctuation. Prose is not.
    """
    words = line.split()
    if len(words) >= 9:
        return True
    if len(words) >= 5 and line.rstrip().endswith((".", "!", "?", ":", "”", '"', "%")):
        return True
    return False


def _readable_prose(text: str) -> str:
    kept = [line for line in text.split("\n") if _is_prose(line)]
    return "\n\n".join(kept).strip()


def extract_text(body: bytes, content_type: str = "") -> str:
    """Readable text from a fetched document, or "" when there is none."""
    try:
        decoded = body.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - defensive; decode with replace cannot raise
        return ""
    if "html" not in content_type.lower() and "<" not in decoded[:512]:
        return _readable_prose(_SPACE.sub(" ", decoded))
    parser = _ReadableText()
    try:
        parser.feed(html.unescape(decoded))
        parser.close()
    except Exception:  # noqa: BLE001 - a malformed page is a skip, not a crash
        log.info("document did not parse as HTML; skipping")
        return ""
    return _readable_prose(parser.text())


def _is_fetchable(source: Source) -> bool:
    return (
        source.document_fetch_allowed
        and source.research_role == "official_statement"
        and source.tier != "C"
    )


def _resolves_to(url: str, source: Source) -> bool:
    """Does this URL's host belong to the source that offered it?

    The registry gate answers "may we read *this publisher's* pages". It does
    not answer "is this URL that publisher's page", and those came apart on the
    feed path: ``item.url`` is the raw ``<link>`` of an RSS entry, which a
    central bank or the Commission may legitimately point at a newspaper, a
    PDF host or anywhere else. Fetching it would have pulled a third party's
    article body through a gate that had only ever inspected the *feed's*
    licence — and ``ResearchItem.prompt_record`` would then have labelled it
    ``official_document_text``, because it gates on the feed's declared role.

    ``discover`` already applied exactly this check to search hits and
    documented it as "what makes search safe to enable". The feed path, which
    runs on every article, did not.
    """
    if not urlsplit(url).netloc:
        return False
    try:
        return registry().resolve_feed_item({"link": url}).id == source.id
    except UnregisteredSourceError:
        return False
    except Exception:  # noqa: BLE001
        return False


async def fetch_documents(
    context: ResearchContext,
    http: Any,
    *,
    limit: int = DOCUMENTS_PER_ARTICLE,
) -> ResearchContext:
    """Attach the full text of every official statement the registry permits.

    Returns a new context; the input is untouched. A fetch that fails, times out
    or returns nothing leaves that item exactly as it was — research is
    enrichment, and an unreachable press office costs depth, never correctness.
    """
    if not context.items:
        return context

    enriched: list[ResearchItem] = []
    fetched = 0
    for item in context.items:
        if fetched >= limit:
            enriched.append(item)
            continue
        try:
            source = registry().get(item.source_id)
        except Exception:  # noqa: BLE001
            enriched.append(item)
            continue
        if not _is_fetchable(source):
            enriched.append(item)
            continue
        if not _resolves_to(item.url, source):
            log.info(
                "not fetching %s: the link leaves %s's own domain", item.url, source.id
            )
            enriched.append(item)
            continue

        text = await _fetch_one(http, source=source, url=item.url)
        if not text:
            enriched.append(item)
            continue
        fetched += 1
        enriched.append(replace(item, document=text[:DOCUMENT_MAX_CHARS]))

    return ResearchContext(
        items=tuple(enriched),
        candidates_considered=context.candidates_considered,
        documents_fetched=fetched,
        discovery=context.discovery,
    )


async def _fetch_one(http: Any, *, source: Source, url: str) -> str:
    try:
        result = await http.fetch(
            source_id=source.id,
            url=url,
            cache_ttl_minutes=DOCUMENT_CACHE_TTL_MINUTES,
            accept="text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        )
    except Exception as exc:  # noqa: BLE001
        log.info("document fetch failed for %s: %s", url, exc)
        return ""
    if not result.ok or result.item is None:
        log.info("document not retrieved for %s: %s", url, result.skipped_reason)
        return ""
    # Re-check the host we actually landed on. The collector follows redirects,
    # so a link that passed ``_resolves_to`` can still deliver bytes from
    # somewhere else entirely, and the pre-flight check alone would be a
    # guarantee about the request rather than about the response.
    final = getattr(result.item, "url", url) or url
    if not _resolves_to(final, source):
        log.warning(
            "discarding %s: redirected off %s's own domain to %s", url, source.id, final
        )
        return ""
    return extract_text(result.item.body, result.item.content_type)


# ── discovery ───────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class SearchHit:
    title: str
    url: str
    snippet: str = ""


class SearchProvider(Protocol):
    """Anything that can turn a question into candidate URLs."""

    name: str

    async def search(self, query: str, *, limit: int) -> Sequence[SearchHit]:
        ...


class NullSearchProvider:
    """The default. Makes no request and returns nothing.

    Present so the pipeline has one code path whether or not search is
    configured. A newsroom with no search key behaves exactly as it did before
    this module existed, rather than carrying a branch that is never exercised.
    """

    name = "none"

    async def search(self, query: str, *, limit: int) -> Sequence[SearchHit]:
        return ()


class BraveSearchProvider:
    """Brave Search, when ``NEWSROOM_SEARCH_API_KEY`` is set.

    Chosen over the alternatives because it has an independent index, a free
    tier that fits this newsroom's volume, and terms that permit programmatic
    use. It is opt-in: nothing in the deployed infrastructure sets the key, and
    the pipeline is fully functional without it.
    """

    name = "brave"
    endpoint = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def search(self, query: str, *, limit: int) -> Sequence[SearchHit]:
        import httpx

        headers = {
            "Accept": "application/json",
            "X-Subscription-Token": self._api_key,
            "User-Agent": config.USER_AGENT,
        }
        params = {"q": query, "count": max(1, min(limit, 20)), "safesearch": "off"}
        try:
            async with httpx.AsyncClient(timeout=config.HTTP_TIMEOUT_SECONDS) as client:
                response = await client.get(self.endpoint, headers=headers, params=params)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:  # noqa: BLE001
            log.warning("search failed: %s", exc)
            return ()
        results = ((payload.get("web") or {}).get("results")) or []
        return tuple(
            SearchHit(
                title=str(entry.get("title") or "").strip(),
                url=str(entry.get("url") or "").strip(),
                snippet=str(entry.get("description") or "").strip(),
            )
            for entry in results
            if entry.get("url")
        )


def search_provider() -> SearchProvider:
    """The configured provider, or the null one. Never raises."""
    name = os.environ.get("NEWSROOM_SEARCH_PROVIDER", "").strip().lower()
    key = os.environ.get("NEWSROOM_SEARCH_API_KEY", "").strip()
    if name == "brave" and key:
        return BraveSearchProvider(key)
    if name and name != "none":
        log.warning("unknown or unconfigured search provider %r; discovery disabled", name)
    return NullSearchProvider()


def resolve_to_registered(hits: Sequence[SearchHit]) -> list[tuple[Source, SearchHit]]:
    """Keep only hits whose host is already a registered, fetchable source.

    This is what makes search safe to enable. Search proposes a URL; the
    registry decides whether the newsroom has any right to read it, and an
    unrecognised host is dropped before a single byte is fetched. Search can
    therefore only ever find a *different page of a publisher already assessed*.

    ``fetch_documents`` applies the same rule to feed links via
    ``_resolves_to``; the two paths must not diverge.
    """
    resolved: list[tuple[Source, SearchHit]] = []
    for hit in hits:
        host = urlsplit(hit.url).netloc.lower()
        if not host:
            continue
        try:
            source = registry().resolve_feed_item({"link": hit.url})
        except UnregisteredSourceError:
            log.debug("search hit dropped, unregistered host: %s", host)
            continue
        except Exception:  # noqa: BLE001
            continue
        if not _is_fetchable(source):
            continue
        resolved.append((source, hit))
    return resolved


def build_query(signal: Any) -> str:
    """A search question for one finding, in the publisher's own vocabulary."""
    from newsroom.pipeline.context import COUNTRY_NAMES

    country = COUNTRY_NAMES.get(getattr(signal, "geography", ""), "")
    parts = [getattr(signal, "metric_label", ""), country, getattr(signal, "period", "")]
    return " ".join(part for part in parts if part).strip()


async def discover(
    signal: Any,
    *,
    provider: SearchProvider | None = None,
    limit: int = DOCUMENTS_PER_ARTICLE,
) -> list[ResearchItem]:
    """Find official pages about this finding that the registry already trusts."""
    engine = provider or search_provider()
    if isinstance(engine, NullSearchProvider):
        return []
    hits = await engine.search(build_query(signal), limit=limit * 3)
    items: list[ResearchItem] = []
    retrieved_at = ""
    sources = getattr(signal, "sources", None) or ()
    if sources:
        retrieved_at = getattr(sources[0], "retrieved_at", "") or ""
    for source, hit in resolve_to_registered(hits)[:limit]:
        items.append(
            ResearchItem(
                source_id=source.id,
                source_name=source.name,
                role="official_statement",
                title=hit.title[:300],
                url=hit.url,
                retrieved_at=retrieved_at,
                discovered_by=engine.name,
            )
        )
    return items


async def deepen(
    signal: Any,
    context: ResearchContext,
    http: Any,
    *,
    provider: SearchProvider | None = None,
) -> ResearchContext:
    """Discover, then read. The whole web-research stage for one article."""
    engine = provider or search_provider()
    # Recorded whatever happens next, so a run with no documents says which of
    # "found nothing" and "never looked" it was.
    merged = replace(context, discovery=engine.name)
    try:
        discovered = await discover(signal, provider=engine)
    except Exception as exc:  # noqa: BLE001
        log.warning("discovery failed: %s", exc)
        merged = replace(merged, discovery=f"{engine.name}_failed")
        discovered = []
    if discovered:
        known = {item.url for item in context.items}
        merged = ResearchContext(
            items=(*context.items, *(d for d in discovered if d.url not in known)),
            candidates_considered=context.candidates_considered + len(discovered),
            discovery=merged.discovery,
        )
    try:
        return await fetch_documents(merged, http)
    except Exception as exc:  # noqa: BLE001
        log.warning("document fetch stage failed: %s", exc)
        return merged


async def deepen_all(
    signals: Sequence[Any],
    contexts: dict[str, ResearchContext],
    http: Any,
    *,
    provider: SearchProvider | None = None,
) -> dict[str, ResearchContext]:
    """Run the web-research stage for every selected signal, concurrently."""
    if not signals:
        return contexts
    engine = provider or search_provider()
    results = await asyncio.gather(
        *(
            deepen(signal, contexts.get(signal.id, ResearchContext()), http, provider=engine)
            for signal in signals
        ),
        return_exceptions=True,
    )
    out = dict(contexts)
    for signal, result in zip(signals, results):
        if isinstance(result, BaseException):
            log.warning("web research failed for %s: %s", signal.id, result)
            continue
        out[signal.id] = result
    return out


__all__ = [
    "DOCUMENTS_PER_ARTICLE",
    "DOCUMENT_MAX_CHARS",
    "BraveSearchProvider",
    "NullSearchProvider",
    "SearchHit",
    "SearchProvider",
    "build_query",
    "deepen",
    "deepen_all",
    "discover",
    "extract_text",
    "fetch_documents",
    "resolve_to_registered",
    "search_provider",
]
