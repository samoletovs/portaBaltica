"""The front page must not be served stale.

Both the index and the articles were uploaded with no content settings, so
Azure applied its defaults: `Content-Type: application/octet-stream` and no
`Cache-Control` at all. A browser with no freshness directive falls back to
heuristic caching, and a news front page pinned to a heuristic is a defect
specific to this kind of site — the portal went on showing headlines and
correspondent names that had been replaced hours earlier.

The symptom is indistinguishable from a broken pipeline when you are looking
at it: production held one article under the byline "Ilze Bērziņa" while the
open tab showed three under "Nida", the internal persona id used before the
correspondents were renamed. The pipeline was correct throughout.

The index is the freshness-critical document, so it revalidates. Articles are
effectively immutable once published and can be cached longer.
"""

from __future__ import annotations

import asyncio
from typing import Any

from newsroom.pipeline import publish
from newsroom.pipeline.publish import ArticleStore

from .test_index_accumulates import article


class RecordingContainer:
    """Captures what would have been sent to Blob storage."""

    def __init__(self) -> None:
        self.uploads: list[dict[str, Any]] = []

    def upload_blob(self, **kwargs: Any) -> None:
        self.uploads.append(kwargs)

    def get_blob_client(self, *_: Any, **__: Any) -> Any:  # pragma: no cover
        raise AssertionError("the store must not need a blob client to write")


def store_with(container: RecordingContainer, tmp_path) -> ArticleStore:
    store = ArticleStore(local_dir=tmp_path)
    store._container_client = lambda: container  # type: ignore[method-assign]
    return store


def upload_named(container: RecordingContainer, name: str) -> dict[str, Any]:
    return next(u for u in container.uploads if u["name"] == name)


class TestCacheHeaders:
    def test_the_index_must_revalidate(self, tmp_path) -> None:
        container = RecordingContainer()
        store = store_with(container, tmp_path)

        asyncio.run(
            store.write_index([article("a-story", published_at="2026-08-24T10:00:00Z")])
        )

        settings = upload_named(container, "index.json")["content_settings"]
        assert settings.cache_control is not None, "an index with no Cache-Control is served stale"
        assert "must-revalidate" in settings.cache_control
        assert "max-age=60" in settings.cache_control

    def test_the_index_must_be_served_as_json(self, tmp_path) -> None:
        # Azure's default for a body with no declared type is
        # application/octet-stream, which is what production was serving.
        container = RecordingContainer()
        store = store_with(container, tmp_path)

        asyncio.run(
            store.write_index([article("a-story", published_at="2026-08-24T10:00:00Z")])
        )

        settings = upload_named(container, "index.json")["content_settings"]
        assert settings.content_type.startswith("application/json")

    def test_an_article_is_cacheable_but_typed(self, tmp_path) -> None:
        container = RecordingContainer()
        store = store_with(container, tmp_path)

        asyncio.run(store.put(article("a-story", published_at="2026-08-24T10:00:00Z")))

        settings = upload_named(container, "a-story.json")["content_settings"]
        assert settings.content_type.startswith("application/json")
        assert "max-age" in (settings.cache_control or "")

    def test_the_index_is_not_cached_longer_than_an_article(self, tmp_path) -> None:
        """Ordering, not exact numbers.

        The index is the document that tells a reader an article exists. If it
        were the staler of the two, a published story could sit invisible
        behind a fresh cache of a file nobody has been told to fetch.
        """
        assert _max_age(publish._INDEX_CACHE_CONTROL) < _max_age(publish._ARTICLE_CACHE_CONTROL)


def _max_age(directive: str) -> int:
    for part in directive.split(","):
        part = part.strip()
        if part.startswith("max-age="):
            return int(part.split("=", 1)[1])
    raise AssertionError(f"no max-age in {directive!r}")
