"""Live end-to-end check of the depth pipeline, printed for a human to read.

Runs collect -> detect -> rank -> context -> research -> analyse -> write ->
validate against **real** data and the real model, and shows, for every
selected signal:

* the context pack the newsroom assembled from series it already held;
* the official documents it fetched and read in full;
* the specialist desk's brief, including how many of its proposed mechanisms
  were deleted for resting on no verified figure;
* the finished article, paragraph by paragraph, with the figures each one
  declared.

A stage that exists in a module but was never exercised against live data is
indistinguishable from one that does not work. The unit tests prove the shape;
this proves the behaviour, and it is the only way to see whether the articles
are actually any good.

Not part of the test suite: it costs money and needs ``az login``. The desk is
deliberately not run here, because this answers "is the writing deep and
correct", which is a different question from "would an editor run it".

    python scripts/depth_smoke.py
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

from newsroom.pipeline.analyst import analyse  # noqa: E402
from newsroom.pipeline.collect.archive import RawArchive  # noqa: E402
from newsroom.pipeline.collect.httpclient import CollectorHttp  # noqa: E402
from newsroom.pipeline.collect.opendata import collect_open_data  # noqa: E402
from newsroom.pipeline.context import build_context, enrich_signal  # noqa: E402
from newsroom.pipeline.detect import detect_all  # noqa: E402
from newsroom.pipeline.rank import rank  # noqa: E402
from newsroom.pipeline.run import THRESHOLDS, apply_house_style  # noqa: E402
from newsroom.pipeline.webresearch import deepen_all  # noqa: E402
from newsroom.pipeline.write import AzureOpenAIWriter, generate_article  # noqa: E402

RULE = "=" * 78


async def main() -> None:
    archive = RawArchive()
    async with CollectorHttp(archive) as http:
        series = await collect_open_data(http)
        print(f"\ncollected {len(series)} series")

        signals = detect_all(series, thresholds=THRESHOLDS)
        report = rank(signals)
        print(f"detected {len(signals)} signals, selected {len(report.selected)}\n")

        research = await deepen_all(report.selected, {}, http)

    writer = AzureOpenAIWriter()
    published = 0
    for signal in report.selected:
        print(RULE)
        print(f"SIGNAL  {signal.metric_label} / {signal.geography} / {signal.period}")
        print(f"        detector={signal.detector} score={signal.score:.2f}")
        print(f"        basis: {signal.comparison_basis}")

        pack = build_context(signal, series)
        enriched = enrich_signal(signal, pack)
        print(f"\nCONTEXT PACK: {len(pack.facts)} fact(s) from {pack.series_considered} series")
        for fact in pack.facts:
            print(f"  {fact.field:32} = {fact.value:>12}  {fact.label}")
        for line in pack.observations:
            print(f"  OBSERVED: {line}")

        context = research.get(signal.id)
        if context and context.items:
            print(
                f"\nRESEARCH: {len(context.items)} item(s), "
                f"{context.documents_fetched} document(s) read in full"
            )
            for item in context.items:
                read = f"  [{len(item.document)} chars read]" if item.document else ""
                print(f"  {item.source_name}: {item.title[:70]}{read}")

        brief = analyse(enriched, writer, pack=pack, research=context)
        print(f"\nANALYST ({brief.discipline} {brief.expert})")
        print(f"  angle:        {brief.angle}")
        print(f"  significance: {brief.significance}")
        for mechanism in brief.mechanisms:
            print(f"  [{mechanism.confidence}] {mechanism.claim}")
            print(f"      grounded in: {', '.join(mechanism.grounded_in)}")
        for gone in brief.discarded:
            print(f"  DISCARDED: {gone}")
        print(f"  watch:        {brief.what_to_watch}")

        result = generate_article(enriched, writer, pack=pack, brief=brief, research=context)
        for note in apply_house_style(result.article):
            print(f"  house style: {note}")

        article = result.article
        print(
            f"\nARTICLE  publishable={result.publishable}  "
            f"attempts={article.provenance['attempts']}"
        )
        print(f"  {article.headline}")
        print(f"  {article.dek}")
        for index, block in enumerate(article.body):
            if not block.text:
                continue
            declared = ", ".join(
                f"{f.rendered_as or f.value}<-{f.signal_field}" for f in block.figures
            )
            print(f"\n  [{index}] {block.text}")
            if declared:
                print(f"       figures: {declared}")
        if result.publishable:
            published += 1
        else:
            print(f"\n  REJECTED: {result.verdict.failure_summary()}")
        print()

    print(RULE)
    print(f"PUBLISHED {published} of {len(report.selected)}")


if __name__ == "__main__":
    asyncio.run(main())
