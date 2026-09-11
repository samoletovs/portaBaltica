"""Arrivals are not nights, and repinning a collector is not a source revision."""

from dataclasses import replace

import httpx
import pytest

from newsroom.pipeline.collect.opendata import EUROSTAT_DATASETS, collect_eurostat
from newsroom.pipeline.detect.series import Observation, TimeSeries
from newsroom.pipeline.models import SourceRef
from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.revisions import find_revisions
from newsroom.pipeline.run import RunReport, _watch_revisions
from newsroom.pipeline.vintage import PublishedFigure, VintageLedger, VintageStore
from newsroom.tests.pipeline.test_collect import client_for


def _tourism_spec():
    return next(spec for spec in EUROSTAT_DATASETS if spec.metric == "tourism")


def _payload(dataset):
    # Official June 2026 observations, checked by the API workstream on
    # 2026-09-11. The transport varies its answer with the actual requested cube.
    values = {
        "tour_occ_arm": [313942, 395333, 410171],
        "tour_occ_nim": [528988, 718385, 948906],
    }
    return {
        "id": ["geo", "time"],
        "size": [3, 1],
        "dimension": {
            "geo": {"category": {"index": {"LV": 0, "EE": 1, "LT": 2}}},
            "time": {"category": {"index": {"2026-06": 0}}},
        },
        "value": values[dataset],
    }


@pytest.mark.asyncio
async def test_the_collector_requests_arrivals_and_preserves_their_source_identity(tmp_path):
    requested = []

    def handler(request):
        requested.append(request)
        return httpx.Response(200, json=_payload(request.url.path.rsplit("/", 1)[-1]))

    http, archive = client_for(handler, tmp_path)
    async with http:
        collected = await collect_eurostat(
            http, [_tourism_spec()], geographies=("LV", "EE", "LT")
        )

    assert {s.geography: s.latest.value for s in collected} == {
        "LV": 313942, "EE": 395333, "LT": 410171,
    }
    assert len(requested) == len(archive.stored) == 1
    assert requested[0].url.path.endswith("/tour_occ_arm")
    assert requested[0].url.params["c_resid"] == "TOTAL"
    assert requested[0].url.params["nace_r2"] == "I551-I553"
    assert requested[0].url.params["unit"] == "NR"
    assert all(s.source.dataset == "tour_occ_arm" and s.unit == "arrivals" for s in collected)
    assert all(s.source.source_id == "eurostat" for s in collected)


def test_foreign_visitor_nights_remain_a_separate_measure():
    spec = next(spec for spec in EUROSTAT_DATASETS if spec.metric == "tourism_foreign")
    assert (spec.dataset, spec.unit, spec.params["c_resid"]) == (
        "tour_occ_nim", "nights", "FOR",
    )


def _arrivals():
    return TimeSeries(
        metric="tourism", metric_label="tourist arrivals", geography="EE",
        unit="arrivals", section="business", frequency="monthly",
        observations=(Observation("2026-06", 395333),),
        source=SourceRef("eurostat", "2026-09-11T13:10:08Z", dataset="tour_occ_arm"),
    )


def _published():
    return PublishedFigure(
        metric="tourism", metric_label="tourist arrivals", geography="EE",
        period="2026-06", value=718385, unit="arrivals",
        slug="estonia-s-tourist-arrivals-reached-718-thousand-in-june-2026-a23500",
        article_id="01M1H6XNP1X8XCTY7AEJPS26RV",
        headline="Tourist arrivals in Estonia reach 718 thousand in June 2026",
        observed_at="2026-09-02T14:00:21Z", published_at="2026-09-02T14:06:24Z",
        source_id="eurostat", dataset="tour_occ_nim", raw_source=True,
    )


@pytest.mark.parametrize(
    ("source_id", "dataset", "raw_source"),
    [
        ("eurostat", "tour_occ_nim", True),
        ("eurostat", None, True),
        ("", "tour_occ_arm", True),
        ("", None, False),  # The sole tourism row in the sampled public ledger.
        ("another-source", "tour_occ_arm", True),
    ],
)
def test_old_or_unidentified_observations_are_not_relabelled_as_source_revisions(
    source_id, dataset, raw_source
):
    previous = replace(
        _published(), source_id=source_id, dataset=dataset, raw_source=raw_source
    )
    before = previous.to_json()

    assert find_revisions(VintageLedger([previous]), [_arrivals()]) == []
    assert previous.to_json() == before


def test_a_real_restatement_of_the_same_arrivals_dataset_is_still_detected():
    previous = replace(_published(), value=395000, dataset="tour_occ_arm")

    found = find_revisions(VintageLedger([previous]), [_arrivals()])

    assert len(found) == 1
    assert found[0].figure == previous
    assert found[0].current_value == 395333


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("dataset", "raw_source"),
    [("tour_occ_nim", True), (None, True), (None, False)],
)
async def test_the_watch_leaves_old_tourism_article_index_and_ledger_unchanged(
    tmp_path, dataset, raw_source
):
    previous = replace(_published(), dataset=dataset, raw_source=raw_source)
    store = ArticleStore(local_dir=tmp_path, account_url="")
    vintages = VintageStore(local_dir=tmp_path, account_url="")
    document = {
        "slug": previous.slug,
        "tier": "A",
        "status": "published",
        "headline": previous.headline,
        "body": [{"type": "paragraph", "text": "Estonia recorded 718385 arrivals."}],
        "provenance": {},
    }
    await store.write_published(previous.slug, document)
    await store.put_json(ArticleStore.INDEX_BLOB, {
        "articles": [{"slug": previous.slug, "tier": "A", "signal_finding": "tourism|EE|2026-06"}],
    })
    await vintages.save(VintageLedger([previous]))
    paths = [previous.slug + ".json", ArticleStore.INDEX_BLOB, "vintages.json"]
    before = {name: (tmp_path / name).read_bytes() for name in paths}
    report = RunReport(series=[_arrivals()])

    await _watch_revisions(store, report, vintages=vintages)

    assert report.corrections == []
    assert {name: (tmp_path / name).read_bytes() for name in paths} == before
