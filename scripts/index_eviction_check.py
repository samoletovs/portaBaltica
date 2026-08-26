"""Replay the live index against the fixed code and report what survives.

Not a test. This is the measurement that motivated the change, kept runnable so
the claim in the PR can be checked rather than believed.

    py scripts/index_eviction_check.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from newsroom.pipeline.models import Article  # noqa: E402
from newsroom.pipeline.publish import ArticleStore  # noqa: E402

LIVE_INDEX = "https://stportabalticabpmff5so.blob.core.windows.net/articles/index.json"


def as_article(entry: dict) -> Article:
    tier = entry.get("tier") or "C"
    kwargs = {
        "id": entry.get("id") or entry["slug"],
        "slug": entry["slug"],
        "tier": tier,
        "status": "published",
        "headline": entry.get("headline") or "Untitled",
        "section": entry.get("section") or "economy",
        "created_at": entry.get("published_at") or "2026-01-01T00:00:00Z",
        "published_at": entry.get("published_at"),
        "provenance": {
            "validator": {"passed": True, "checks": []},
            "signal_id": entry.get("signal_id"),
        },
    }
    if tier == "A":
        kwargs["persona"] = entry.get("persona") or {"id": "kolka", "name": "x", "beat": "y"}
    else:
        kwargs["syndicated"] = entry.get("syndicated") or {
            "source_id": "err_en",
            "original_url": "https://example.invalid",
            "attribution": "ERR News",
        }
    return Article(**kwargs)


def synthetic_run(n: int, day: int) -> list[Article]:
    """One run's worth of syndication, at the velocity these feeds publish at."""
    return [
        as_article(
            {
                "slug": f"synthetic-{day}-{i}",
                "tier": "C",
                "headline": f"Another outlet's story {i}",
                "published_at": f"2026-09-{day:02d}T{i % 24:02d}:{i % 60:02d}:00Z",
            }
        )
        for i in range(n)
    ]


async def main() -> None:
    with urllib.request.urlopen(LIVE_INDEX, timeout=30) as response:
        live = json.loads(response.read().decode("utf-8"))

    entries = [e for e in live["articles"] if isinstance(e, dict) and e.get("slug")]
    ours_before = sum(1 for e in entries if e.get("tier") != "C")
    print(f"live index: {len(entries)} entries, {ours_before} ours, "
          f"{len(entries) - ours_before} link-outs")

    with tempfile.TemporaryDirectory() as tmp:
        store = ArticleStore(local_dir=Path(tmp), account_url="")
        await store.write_index([as_article(e) for e in entries])

        for day, count in ((1, 100), (2, 100), (3, 100)):
            await store.write_index(synthetic_run(count, day))
            kept = json.loads((Path(tmp) / "index.json").read_text(encoding="utf-8"))["articles"]
            ours = sum(1 for e in kept if e.get("tier") != "C")
            theirs = len(kept) - ours
            print(
                f"after run +{day} ({count} new link-outs): "
                f"{ours}/{ours_before} of ours kept, {theirs} link-outs, {len(kept)} total"
            )

    print(
        "\nBefore this change the same replay left 0 of 7 originals after a single run.\n"
        "See newsroom/tests/pipeline/test_index_reserves_our_work.py."
    )


if __name__ == "__main__":
    asyncio.run(main())
