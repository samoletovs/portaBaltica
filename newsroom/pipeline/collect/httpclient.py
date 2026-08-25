"""A polite HTTP client for feed and open-data collection.

Three behaviours matter, and all three are about being a good citizen on
infrastructure that is not ours:

* **Conditional requests.** ETag and Last-Modified from the previous fetch are
  replayed, so an unchanged feed costs the publisher a 304 and no body.
* **TTL respect.** Each source declares ``cache_ttl_minutes`` in
  ``sources.yaml``. Inside that window the client does not make a request at
  all — not even a conditional one.
* **Backoff.** Retries are exponential with jitter, and ``Retry-After`` is
  honoured when the server sends it.

The identifying user-agent carries a contact address, so anyone who objects to
our traffic can find us before they block us.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from newsroom.pipeline import config
from newsroom.pipeline.models import RawItem, isoformat, utcnow

log = logging.getLogger(__name__)

RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


@dataclass
class FetchResult:
    """Outcome of one attempted fetch."""

    source_id: str
    url: str
    item: RawItem | None
    skipped_reason: str | None = None

    @property
    def ok(self) -> bool:
        return self.item is not None


class ConditionalState:
    """Remembers ETag / Last-Modified / last-fetch time per URL.

    Persisted as a small JSON file next to the raw archive. It is a cache, not a
    source of truth: deleting it costs one extra full fetch per source.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._data: dict[str, dict[str, Any]] = {}
        if path.exists():
            try:
                self._data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                log.warning("conditional state at %s unreadable; starting fresh", path)

    def get(self, url: str) -> dict[str, Any]:
        return self._data.get(url, {})

    def remember(
        self,
        url: str,
        *,
        etag: str | None,
        last_modified: str | None,
        archive_name: str | None,
        retrieved_at: str | None = None,
    ) -> None:
        entry = dict(self._data.get(url, {}))
        entry["fetched_at"] = isoformat(utcnow())
        if etag:
            entry["etag"] = etag
        if last_modified:
            entry["last_modified"] = last_modified
        if archive_name:
            entry["archive_name"] = archive_name
        if retrieved_at:
            entry["retrieved_at"] = retrieved_at
        self._data[url] = entry

    def flush(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self._data, indent=2, sort_keys=True), encoding="utf-8")

    def is_fresh(self, url: str, ttl_minutes: int) -> bool:
        fetched = self.get(url).get("fetched_at")
        if not fetched:
            return False
        try:
            when = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
        except ValueError:
            return False
        return utcnow() - when < timedelta(minutes=ttl_minutes)


class CollectorHttp:
    """Fetches registered sources, archiving every response body it receives."""

    def __init__(
        self,
        archive: Any,
        *,
        client: httpx.AsyncClient | None = None,
        state: ConditionalState | None = None,
        max_retries: int = config.HTTP_MAX_RETRIES,
        backoff: float = config.HTTP_BACKOFF_SECONDS,
        sleep: Any = asyncio.sleep,
    ) -> None:
        self._archive = archive
        self._client = client
        self._owns_client = client is None
        self._state = state or ConditionalState(
            config.LOCAL_ARCHIVE_DIR / "conditional-state.json"
        )
        self._max_retries = max_retries
        self._backoff = backoff
        self._sleep = sleep
        self._memory_cache: dict[str, RawItem] = {}

    async def __aenter__(self) -> CollectorHttp:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=config.HTTP_TIMEOUT_SECONDS,
                headers={"User-Agent": config.USER_AGENT, "Accept-Encoding": "gzip, deflate"},
                follow_redirects=True,
            )
        return self

    async def __aexit__(self, *exc: Any) -> None:
        self._state.flush()
        if self._owns_client and self._client is not None:
            await self._client.aclose()

    async def fetch(
        self,
        *,
        source_id: str,
        url: str,
        cache_ttl_minutes: int,
        accept: str = "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        params: dict[str, Any] | None = None,
        force: bool = False,
    ) -> FetchResult:
        assert self._client is not None, "use CollectorHttp as an async context manager"

        if not force and self._state.is_fresh(url, cache_ttl_minutes):
            log.info("%s: inside %d-minute TTL, not requesting", source_id, cache_ttl_minutes)
            return FetchResult(
                source_id,
                url,
                self._cached_item(source_id, url),
                skipped_reason="within_cache_ttl",
            )

        headers = {"Accept": accept}
        remembered = self._state.get(url)
        if remembered.get("etag"):
            headers["If-None-Match"] = remembered["etag"]
        if remembered.get("last_modified"):
            headers["If-Modified-Since"] = remembered["last_modified"]

        response = await self._request_with_backoff(source_id, url, headers, params)
        if response is None:
            return FetchResult(source_id, url, None, skipped_reason="fetch_failed")

        if response.status_code == 304:
            log.info("%s: 304 Not Modified", source_id)
            self._state.remember(url, etag=None, last_modified=None, archive_name=None)
            return FetchResult(
                source_id,
                url,
                self._cached_item(source_id, url),
                skipped_reason="not_modified",
            )

        item = RawItem(
            source_id=source_id,
            url=str(response.request.url),
            retrieved_at=isoformat(utcnow()),
            content_type=response.headers.get("content-type", "application/octet-stream"),
            body=response.content,
            http_status=response.status_code,
            etag=response.headers.get("etag"),
            last_modified=response.headers.get("last-modified"),
        )

        # Archive first. Nothing downstream sees these bytes until they are
        # durably stored, so any later validator failure is reproducible from
        # exactly what the publisher served us.
        await self._archive.store(item)
        self._memory_cache[url] = item

        self._state.remember(
            url,
            etag=item.etag,
            last_modified=item.last_modified,
            archive_name=item.archive_name,
            retrieved_at=item.retrieved_at,
        )
        return FetchResult(source_id, url, item)

    def _cached_item(self, source_id: str, url: str) -> RawItem | None:
        in_memory = self._memory_cache.get(url)
        if in_memory is not None:
            return RawItem(
                source_id=in_memory.source_id,
                url=in_memory.url,
                retrieved_at=in_memory.retrieved_at,
                content_type=in_memory.content_type,
                body=in_memory.body,
                http_status=in_memory.http_status,
                from_cache=True,
                etag=in_memory.etag,
                last_modified=in_memory.last_modified,
            )

        state = self._state.get(url)
        archive_name = state.get("archive_name")
        retrieved_at = state.get("retrieved_at")
        if not isinstance(archive_name, str):
            return None
        if not isinstance(retrieved_at, str):
            retrieved_at = _retrieved_at_from_archive_name(archive_name)
        if retrieved_at is None:
            return None
        try:
            body = self._archive.read(archive_name)
        except (AttributeError, OSError):
            log.warning("%s: cached archive %s unavailable", source_id, archive_name)
            return None
        return RawItem(
            source_id=source_id,
            url=url,
            retrieved_at=retrieved_at,
            content_type="application/octet-stream",
            body=body,
            from_cache=True,
            etag=state.get("etag"),
            last_modified=state.get("last_modified"),
        )
    async def _request_with_backoff(
        self,
        source_id: str,
        url: str,
        headers: dict[str, str],
        params: dict[str, Any] | None,
    ) -> httpx.Response | None:
        assert self._client is not None
        last_error: str = "no attempt made"
        for attempt in range(1, self._max_retries + 1):
            try:
                response = await self._client.get(url, headers=headers, params=params)
            except httpx.HTTPError as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                log.warning("%s: attempt %d failed (%s)", source_id, attempt, last_error)
            else:
                if response.status_code < 400 or response.status_code == 304:
                    return response
                last_error = f"HTTP {response.status_code}"
                if response.status_code not in RETRYABLE_STATUS:
                    log.error("%s: %s, not retryable", source_id, last_error)
                    return None
                retry_after = _retry_after_seconds(response)
                if retry_after is not None:
                    log.warning("%s: %s, honouring Retry-After=%ss", source_id, last_error, retry_after)
                    await self._sleep(retry_after)
                    continue
                log.warning("%s: attempt %d got %s", source_id, attempt, last_error)

            if attempt < self._max_retries:
                delay = self._backoff * (2 ** (attempt - 1)) * (0.5 + random.random())
                await self._sleep(delay)
        log.error("%s: giving up after %d attempts (%s)", source_id, self._max_retries, last_error)
        return None


def _retrieved_at_from_archive_name(archive_name: str) -> str | None:
    filename = Path(archive_name).name
    stamp = filename.split("-", 1)[0]
    try:
        moment = datetime.strptime(stamp, "%Y%m%dT%H%M%SZ")
    except ValueError:
        return None
    return isoformat(moment.replace(tzinfo=timezone.utc))


def _retry_after_seconds(response: httpx.Response) -> float | None:
    raw = response.headers.get("retry-after")
    if not raw:
        return None
    try:
        return min(float(raw), 60.0)
    except ValueError:
        pass
    try:
        when = datetime.strptime(raw, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return max(0.0, min((when - utcnow()).total_seconds(), 60.0))
