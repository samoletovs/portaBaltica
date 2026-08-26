"""Is the measurement floor calibrated, or is it inert or a wrecking ball?

Read-only. Collects live open data, runs detection, and reports what the floor
suppresses. Writes nothing, calls no language model, publishes nothing.

Unit tests can prove the gate refuses a 0.1pp move in a survey series. They
cannot tell you whether that refusal happens to every signal the wire would
have run, or to none of them. A floor that suppresses everything silently ends
the newsroom; a floor that suppresses nothing is decoration. Both pass a green
suite.

    py scripts/floor_calibration.py
"""

from __future__ import annotations

import asyncio
import logging
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from newsroom.pipeline.collect.archive import RawArchive  # noqa: E402
from newsroom.pipeline.collect.httpclient import CollectorHttp  # noqa: E402
from newsroom.pipeline.collect.opendata import collect_open_data  # noqa: E402
from newsroom.pipeline.detect import detect_all  # noqa: E402
from newsroom.pipeline.rank import rank  # noqa: E402
from newsroom.pipeline.run import THRESHOLDS  # noqa: E402
from newsroom.pipeline.significance import floor_for, gate  # noqa: E402

logging.basicConfig(level=logging.WARNING)


async def main() -> None:
    # A STABLE local archive, not a temp one. The HTTP layer keeps conditional
    # -request state (etags, cache TTLs) separately from the archived bytes, so
    # pointing the archive at a temp directory makes the second run of this
    # script collect nothing at all: the cache says "still fresh, reuse the
    # archived copy" and the archived copy went out with the temp directory.
    #
    # account_url="" is what keeps this off production storage. Local files are
    # harmless and make repeat runs work.
    archive = RawArchive(account_url="")
    async with CollectorHttp(archive) as http:
        series = await collect_open_data(http)

    print(f"collected {len(series)} live series\n")

    signals = detect_all(series, thresholds=THRESHOLDS)
    print(f"detection produced {len(signals)} signal(s)")

    report = gate(signals, series)
    kept, suppressed = report.kept, report.suppressed
    print(f"  cleared the floor: {len(kept)}")
    print(f"  below the floor:   {len(suppressed)}")

    if signals:
        share = 100.0 * len(suppressed) / len(signals)
        print(f"  suppression rate:  {share:.0f}%")

    if suppressed:
        print("\n--- suppressed ---")
        for signal, verdict in suppressed:
            print(
                f"  [{signal.detector}] {signal.metric} {signal.geography} {signal.period}: "
                f"moved {abs(verdict.difference):.6g} vs floor "
                f"{verdict.floor.value:.6g} ({verdict.floor.kind})"
            )

    print("\n--- what would have been written, before and after ---")
    before = rank(signals)
    after = rank(kept)
    print(f"  articles without the floor: {len(before.selected)}")
    print(f"  articles with the floor:    {len(after.selected)}")
    lost = {s.id for s in before.selected} - {s.id for s in after.selected}
    for signal in before.selected:
        if signal.id in lost:
            print(f"    dropped: [{signal.detector}] {signal.metric} {signal.geography}")

    print("\n--- floors in force ---")
    kinds = Counter()
    for s in sorted(series, key=lambda x: (x.metric, x.geography)):
        floor = floor_for(s)
        kinds[floor.kind] += 1
    for kind, count in kinds.most_common():
        print(f"  {kind}: {count} series")

    print("\n--- survey series specifically ---")
    for s in sorted(series, key=lambda x: (x.metric, x.geography)):
        floor = floor_for(s)
        if floor.kind == "survey":
            print(f"  {s.metric} {s.geography}: floor {floor.value:g} {s.unit}")

    # Staleness is not what this script is for, but detection reads the latest
    # observation of every series, so a series that stopped publishing keeps
    # producing findings about an old period forever. Worth seeing beside the
    # suppression numbers, because an old signal and a small one look alike in
    # a summary and have completely different causes.
    print("\n--- oldest 'latest' period, the 8 stalest series ---")
    for s in sorted(series, key=lambda x: x.latest.period)[:8]:
        print(f"  {s.metric:28} {s.geography:6} latest={s.latest.period}  n={len(s)}")


if __name__ == "__main__":
    asyncio.run(main())
