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

    async def put(self, article: Article) -> str:
        if article.status == "published" and not is_servable(article):
            raise NotServable(
                f"{article.id} is marked published without a passing validator verdict"
            )
        name = f"{article.status}/{article.created_at[:10]}/{article.slug}.json"
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
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("blob write failed for %s (%s)", name, exc)
        return name

    def _write_local(self, name: str, body: bytes) -> None:
        target = self._local_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)

    INDEX_MAX_ENTRIES = 200

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
        updates it rather than duplicating it, and the newest
        ``INDEX_MAX_ENTRIES`` are kept so the file cannot grow without bound.
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
        )[: self.INDEX_MAX_ENTRIES]

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
                    container.upload_blob, name="index.json", data=body, overwrite=True
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("index blob write failed (%s)", exc)
        return "index.json"


__all__ = ["ArticleStore", "NotServable", "is_servable"]
