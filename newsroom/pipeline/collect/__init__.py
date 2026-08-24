"""Stage 1 — collect.

Fetch from registered sources only, archive the bytes before anything parses
them, and behave like a good citizen on someone else's server.
"""

from __future__ import annotations

from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp, FetchResult
from newsroom.pipeline.collect.rss import parse_feed

__all__ = ["CollectorHttp", "FetchResult", "RawArchive", "parse_feed"]
