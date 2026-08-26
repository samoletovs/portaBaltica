"""Stage 6 — publish.

The store refuses to write a ``published`` article whose provenance does not
carry a passing verdict. That is a second, independent enforcement of the same
rule the renderer applies: even if a bug set the status, the bytes never reach
the container the site reads from.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Sequence

from newsroom.pipeline import config
from newsroom.pipeline.models import Article, isoformat, utcnow

log = logging.getLogger(__name__)

#: How long a reader's browser may reuse a copy without asking.
#:
#: Both were previously written with no content settings at all, so Azure
#: served them as `application/octet-stream` with no `Cache-Control`. Browsers
#: fall back to heuristic caching in that case, and a front page pinned to a
#: stale index is a serious defect for a news site specifically: the portal
#: kept showing articles and correspondent names that had since been replaced,
#: which read as "the site is broken" rather than "your cache is old".
#:
#: The index is the freshness-critical document — it is what the front page
#: reads — so it gets a short window and must revalidate. Individual articles
#: are effectively immutable once published (a correction changes the file, but
#: that is rare and the index links it), so they can be cached longer.
_INDEX_CACHE_CONTROL = "public, max-age=60, must-revalidate"
_ARTICLE_CACHE_CONTROL = "public, max-age=300"


def _content_settings(cache_control: str) -> Any:
    """Built lazily: the Azure SDK is not a dependency of the local-only path."""
    from azure.storage.blob import ContentSettings

    return ContentSettings(
        content_type="application/json; charset=utf-8",
        cache_control=cache_control,
    )


class NotServable(RuntimeError):
    """Raised when something tries to publish an unvalidated article."""


def is_servable(article: Article) -> bool:
    verdict = (article.provenance or {}).get("validator") or {}
    return bool(verdict.get("passed")) and article.status == "published"


class ArticleStore:
    """Writes finished articles to a local directory and, when configured, Blob."""

    def __init__(
        self,
        *,
        local_dir: Path | None = None,
        account_url: str | None = None,
        container: str | None = None,
    ) -> None:
        self._local_dir = Path(local_dir or (config.LOCAL_ARCHIVE_DIR.parent / ".newsroom-articles"))
        self._account_url = account_url if account_url is not None else config.STORAGE_ACCOUNT_URL
        self._container = container or config.ARTICLES_CONTAINER
        self._blob: Any = None
        self._blob_failed = False

    def _container_client(self) -> Any:
        if self._blob is not None or self._blob_failed or not self._account_url:
            return self._blob
        try:
            from azure.identity import DefaultAzureCredential
            from azure.storage.blob import BlobServiceClient

            service = BlobServiceClient(self._account_url, credential=DefaultAzureCredential())
            container = service.get_container_client(self._container)
            try:
                container.create_container()
            except Exception:  # noqa: BLE001
                pass
            self._blob = container
        except Exception as exc:  # noqa: BLE001
            log.warning("article blob container unavailable (%s); local only", exc)
            self._blob_failed = True
        return self._blob

    @staticmethod
    def blob_name_for(article: Article) -> str:
        """Where an article is stored.

        A PUBLISHED article lives at ``<slug>.json``, flat at the container
        root, because that is the address the reader asks for: ``news-api.ts``
        fetches ``${BASE}/${slug}.json`` and the route is ``/article/<slug>``.
        A dated path would give every story a URL that depends on when it was
        generated, and the frontend would 404 on all of them -- which is
        exactly what happened: the front page listed two articles and both
        links led to "Article not found", with the only clue a 404 in the
        console reading "The specified blob does not exist".

        Everything NOT published keeps a dated, status-prefixed path. Rejected
        drafts are an audit trail, never reachable content, and grouping them
        by day is how you review a bad afternoon.
        """
        if article.status == "published":
            return f"{article.slug}.json"
        return f"{article.status}/{article.created_at[:10]}/{article.slug}.json"

    async def put(self, article: Article) -> str:
        if article.status == "published" and not is_servable(article):
            raise NotServable(
                f"{article.id} is marked published without a passing validator verdict"
            )
        name = self.blob_name_for(article)
        body = json.dumps(article.to_json(), ensure_ascii=False, indent=2).encode("utf-8")
        await asyncio.to_thread(self._write_local, name, body)
        container = self._container_client()
        if container is not None:
            try:
                await asyncio.to_thread(
                    container.upload_blob,
                    name=name,
                    data=body,
                    overwrite=True,
                    content_settings=_content_settings(_ARTICLE_CACHE_CONTROL),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("blob write failed for %s (%s)", name, exc)
        return name

    def _write_local(self, name: str, body: bytes) -> None:
        target = self._local_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)

    def _read_published(self, slug: str) -> dict[str, Any] | None:
        """The stored JSON for a published article, or ``None``.

        Returns the raw document rather than an :class:`Article`. A correction
        annotates a story that already exists, and round-tripping it through the
        dataclass would quietly drop anything the dataclass does not model —
        which for a file written by an older version of this pipeline is exactly
        the part worth preserving.
        """
        name = f"{slug}.json"
        container = self._container_client()
        if container is not None:
            try:
                raw = container.download_blob(name).readall()
                payload = json.loads(raw.decode("utf-8"))
                if isinstance(payload, dict):
                    return payload
            except Exception as exc:  # noqa: BLE001
                log.info("no readable article %s in blob (%s)", name, exc)
        local = self._local_dir / name
        if local.exists():
            try:
                payload = json.loads(local.read_text(encoding="utf-8"))
                if isinstance(payload, dict):
                    return payload
            except Exception as exc:  # noqa: BLE001
                log.warning("local article %s unreadable (%s)", name, exc)
        return None

    def _write_published(self, slug: str, payload: dict[str, Any]) -> None:
        name = f"{slug}.json"
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self._write_local(name, body)
        container = self._container_client()
        if container is not None:
            try:
                container.upload_blob(
                    name=name,
                    data=body,
                    overwrite=True,
                    content_settings=_content_settings(_ARTICLE_CACHE_CONTROL),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("blob write failed for %s (%s)", name, exc)

    async def read_published(self, slug: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._read_published, slug)

    async def write_published(self, slug: str, payload: dict[str, Any]) -> None:
        await asyncio.to_thread(self._write_published, slug, payload)

    CORRECTIONS_BLOB = "corrections.json"

    def _read_corrections_log(self) -> list[dict[str, Any]]:
        container = self._container_client()
        if container is not None:
            try:
                raw = container.download_blob(self.CORRECTIONS_BLOB).readall()
                payload = json.loads(raw.decode("utf-8"))
                if isinstance(payload, list):
                    return [e for e in payload if isinstance(e, dict)]
            except Exception as exc:  # noqa: BLE001
                log.info("no corrections log in blob yet (%s)", exc)
        local = self._local_dir / self.CORRECTIONS_BLOB
        if local.exists():
            try:
                payload = json.loads(local.read_text(encoding="utf-8"))
                if isinstance(payload, list):
                    return [e for e in payload if isinstance(e, dict)]
            except Exception as exc:  # noqa: BLE001
                log.warning("local corrections log unreadable (%s)", exc)
        return []

    #: Reserved room for our own reporting, and a separate ceiling for link-outs.
    #:
    #: A SINGLE DATE-SORTED CAP DOES NOT WORK HERE, and the reason is arithmetic
    #: rather than editorial. Tier C is minted at feed velocity — LSM, ERR and
    #: EUobserver supplied 154 of the 161 entries in the live index — while tier A
    #: is written only when the data warrants it, which is nought to eight a day.
    #: Sorting the two together by date and keeping the newest N has exactly one
    #: outcome, and replaying the live index proved it: one further run's worth of
    #: syndication evicts all seven original articles and leaves an index that is
    #: 200/200 link-outs. The front page then reads "Nothing to report yet today"
    #: beside a full rail of other outlets' headlines.
    #:
    #: The articles survive in storage; only their index entries are lost. That
    #: is not a consolation. This file's own docstring says an article missing
    #: from the index "is invisible however faithfully it was stored".
    #:
    #: So the budgets are separate. Syndication cannot take our allocation at any
    #: ratio, however fast the feeds run. 150 originals is roughly a month of
    #: archive at the rate we actually publish; 50 link-outs is far more than the
    #: rail shows, which is four at a time.
    INDEX_MAX_OURS = 150
    INDEX_MAX_ELSEWHERE = 50
    INDEX_MAX_ENTRIES = INDEX_MAX_OURS + INDEX_MAX_ELSEWHERE

    @classmethod
    def _apply_budgets(cls, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Truncate each kind against its own ceiling, then restore date order.

        ``entries`` arrives newest-first, so taking a prefix of each group keeps
        the newest of that kind. Tier B counts as ours: it is a press release we
        chose to carry under licence, it is not produced at feed velocity, and
        grouping it with tier C would let the rail evict it.
        """
        ours = [e for e in entries if e.get("tier") != "C"][: cls.INDEX_MAX_OURS]
        elsewhere = [e for e in entries if e.get("tier") == "C"][: cls.INDEX_MAX_ELSEWHERE]
        kept = {id(e) for e in ours} | {id(e) for e in elsewhere}
        return [e for e in entries if id(e) in kept]

    def _append_corrections(self, entries: Sequence[dict[str, Any]]) -> int:
        """Add to the public log, append-only, and return the new total.

        A BARE JSON ARRAY, not an object with a ``corrections`` key. The reader
        is ``fetchCorrections`` in ``src/news-api.ts``, which does
        ``if (!Array.isArray(raw)) return []`` — so wrapping this the way
        ``index.json`` is wrapped would produce an empty log with no error
        anywhere, which is the failure this file already has a history of.

        Append-only is the policy, not an implementation detail: the corrections
        page is the one place a reader can audit us, and a log we can rewrite is
        not evidence of anything.
        """
        existing = self._read_corrections_log()
        seen = {
            (str(e.get("slug")), str(e.get("corrected_at")), str(e.get("description")))
            for e in existing
        }
        for entry in entries:
            key = (
                str(entry.get("slug")),
                str(entry.get("corrected_at")),
                str(entry.get("description")),
            )
            if key not in seen:
                existing.append(entry)
                seen.add(key)
        body = json.dumps(existing, ensure_ascii=False, indent=2).encode("utf-8")
        self._write_local(self.CORRECTIONS_BLOB, body)
        container = self._container_client()
        if container is not None:
            try:
                container.upload_blob(
                    name=self.CORRECTIONS_BLOB,
                    data=body,
                    overwrite=True,
                    content_settings=_content_settings(_INDEX_CACHE_CONTROL),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("corrections log blob write failed (%s)", exc)
        return len(existing)

    async def append_corrections(self, entries: Sequence[dict[str, Any]]) -> int:
        return await asyncio.to_thread(self._append_corrections, entries)

    def _read_existing_index(self) -> list[dict[str, Any]]:
        """Entries already on the front page, from blob if available else local.

        Blob is authoritative: a local run must not be able to publish a front
        page built from one machine's leftovers.
        """
        container = self._container_client()
        if container is not None:
            try:
                raw = container.download_blob("index.json").readall()
                payload = json.loads(raw.decode("utf-8"))
                existing = payload.get("articles")
                if isinstance(existing, list):
                    return [e for e in existing if isinstance(e, dict)]
            except Exception as exc:  # noqa: BLE001
                log.info("no readable index in blob yet (%s); starting fresh", exc)

        local = self._local_dir / "index.json"
        if local.exists():
            try:
                payload = json.loads(local.read_text(encoding="utf-8"))
                existing = payload.get("articles")
                if isinstance(existing, list):
                    return [e for e in existing if isinstance(e, dict)]
            except Exception as exc:  # noqa: BLE001
                log.warning("local index unreadable (%s); starting fresh", exc)
        return []

    @staticmethod
    def _dedupe_by_signal(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Keep one article per deterministic signal, the newest.

        A signal is a specific finding in a specific series for a specific
        period — "Estonian unemployment in June 2026 sits below its four-year
        seasonal average". Re-running the pipeline regenerates it, and because
        the slug is derived from the headline and the model rephrases the
        headline each time, every run minted what looked like a new story:

            Estonia's Unemployment Rate at 6.6% in June 2026
            Estonia's Unemployment Rate Declines in June 2026
            Estonia's Unemployment Rate Declines to 6.6% in June 2026

        Three slugs, three index entries, one fact. A front page that reports
        the same figure three times in different words is worse than one that
        reports it once, and it is the sort of thing a reader notices before
        anything else.

        Entries arrive newest-first, so the first sighting of a signal wins and
        later re-tellings are dropped. Entries without a signal id — tier B and
        C syndication, and anything published before this field existed — are
        never deduped, because there is nothing to compare and dropping them on
        a missing key would silently empty the syndication rail.
        """
        seen: set[str] = set()
        kept: list[dict[str, Any]] = []
        for entry in entries:
            signal_id = entry.get("signal_id")
            if isinstance(signal_id, str) and signal_id:
                if signal_id in seen:
                    continue
                seen.add(signal_id)
            kept.append(entry)
        return kept

    async def write_index(self, articles: Sequence[Article]) -> str:
        """A compact index of servable articles, for the frontend to fetch.

        The shape is fixed by ``ArticleSummary`` in ``src/news-types.ts`` and is
        enforced at render time by ``isRenderableSummary`` in ``src/news-api.ts``:
        a tier A entry must carry a ``persona`` OBJECT with a ``name``, and a
        tier B/C entry a ``syndicated`` object with ``attribution`` and
        ``original_url``. Entries that do not match are dropped silently by the
        reader, which is the right behaviour for the client and a miserable
        thing to debug from the server.

        THE INDEX ACCUMULATES. It is the front page of a news site, not a
        report on the last run. This previously rebuilt the index from only the
        current run's articles, so the first run that published nothing --
        which is the *designed* behaviour on a quiet day -- silently erased
        every story already on the front page. A wire that deletes its archive
        whenever the data is unremarkable is not a wire.

        Entries are keyed by slug so a re-run that regenerates the same story
        updates it rather than duplicating it. Our own reporting and other
        outlets' link-outs are then truncated against *separate* budgets, so the
        file cannot grow without bound and syndication cannot evict journalism.
        See ``INDEX_MAX_OURS``.
        """
        fresh = [
            {
                "id": a.id,
                "slug": a.slug,
                "tier": a.tier,
                "section": a.section,
                "headline": a.headline,
                "dek": a.dek,
                "persona": a.persona or None,
                "syndicated": (
                    {
                        "attribution": (a.syndicated or {}).get("attribution"),
                        "original_url": (a.syndicated or {}).get("original_url"),
                        "snippet": (a.syndicated or {}).get("snippet"),
                    }
                    if a.syndicated
                    else None
                ),
                "published_at": a.published_at or a.created_at,
                "countries": a.countries,
                # The deterministic signal this story came from. Two articles
                # sharing one signal are two tellings of the same finding, not
                # two stories, and the index dedupes on it below.
                "signal_id": (a.provenance or {}).get("signal_id"),
            }
            for a in articles
            if is_servable(a)
        ]

        by_slug: dict[str, dict[str, Any]] = {}
        for entry in await asyncio.to_thread(self._read_existing_index):
            slug = entry.get("slug")
            if isinstance(slug, str) and slug:
                by_slug[slug] = entry
        for entry in fresh:  # this run wins on a slug collision
            by_slug[entry["slug"]] = entry

        entries = sorted(
            by_slug.values(), key=lambda e: str(e.get("published_at") or ""), reverse=True
        )
        entries = self._apply_budgets(self._dedupe_by_signal(entries))

        body = json.dumps(
            {"generated_at": isoformat(utcnow()), "count": len(entries), "articles": entries},
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")
        await asyncio.to_thread(self._write_local, "index.json", body)
        container = self._container_client()
        if container is not None:
            try:
                await asyncio.to_thread(
                    container.upload_blob,
                    name="index.json",
                    data=body,
                    overwrite=True,
                    content_settings=_content_settings(_INDEX_CACHE_CONTROL),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("index blob write failed (%s)", exc)
        return "index.json"


__all__ = ["ArticleStore", "NotServable", "is_servable"]
