"""The revision watch must be wired to the run, and must reach the reader.

WHY THIS FILE EXISTS SEPARATELY FROM test_revisions.py
------------------------------------------------------
``test_revisions.py`` proves the watch works when it is driven. That was never
the thing that goes wrong here. This repository has twice shipped a mechanism
that was built, unit-tested and connected to nothing — the inert ``chart_ref``,
and the desk's ``revise`` verdict that held six articles and rewrote none — and
in both cases the whole suite stayed green, because every test drove the
component directly.

So these tests refuse to call ``find_revisions``. They start from a published
article on disk and a ledger, run the stage the pipeline actually runs, and
assert that the file a reader would fetch has changed.
"""

from __future__ import annotations

import inspect
import json

import pytest

from newsroom.pipeline import run as run_module
from newsroom.pipeline.detect.series import Observation, TimeSeries
from newsroom.pipeline.models import Article, Block, Signal, SourceRef
from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.run import RunReport, _watch_revisions
from newsroom.pipeline.vintage import PublishedFigure, VintageLedger, VintageStore
from newsroom.pipeline.write.generator import GenerationResult

PUBLISHED_AT = "2026-08-24T12:00:00Z"


def _stores(tmp_path):
    return (
        ArticleStore(local_dir=tmp_path, account_url=""),
        VintageStore(local_dir=tmp_path, account_url=""),
    )


def _series(value: float, *, retrieved="2026-09-24T10:00:00Z") -> TimeSeries:
    return TimeSeries(
        metric="unemployment_rate",
        metric_label="unemployment rate",
        geography="EE",
        unit="%",
        section="labour",
        observations=(Observation(period="2026-06", value=value),),
        source=SourceRef(source_id="eurostat", retrieved_at=retrieved),
    )


def _figure(value=6.6, slug="estonia-unemployment") -> PublishedFigure:
    return PublishedFigure(
        metric="unemployment_rate",
        metric_label="unemployment rate",
        geography="EE",
        period="2026-06",
        value=value,
        unit="%",
        slug=slug,
        article_id="01ABC",
        headline="Estonia's unemployment rate declines to 6.6% in June 2026",
        observed_at="2026-08-24T10:00:00Z",
        published_at=PUBLISHED_AT,
        signal_id="sig1",
    )


def _stored_article(slug="estonia-unemployment") -> dict:
    return {
        "id": "01ABC",
        "slug": slug,
        "tier": "A",
        "status": "published",
        "headline": "Estonia's unemployment rate declines to 6.6% in June 2026",
        "section": "labour",
        "created_at": PUBLISHED_AT,
        "published_at": PUBLISHED_AT,
        "body": [{"type": "paragraph", "text": "The rate fell to 6.6% in June 2026."}],
        "provenance": {"validator": {"passed": True, "checks": []}},
    }


class TestTheRunDrivesTheWatch:
    def test_run_once_calls_the_watch(self) -> None:
        source = inspect.getsource(run_module.run_once)

        assert "_watch_revisions(" in source, (
            "run_once no longer runs the revision watch, so a restated figure "
            "can never produce a correction in production"
        )

    @pytest.mark.asyncio
    async def test_a_restated_figure_changes_the_file_a_reader_fetches(self, tmp_path) -> None:
        articles, vintages = _stores(tmp_path)
        await articles.write_published("estonia-unemployment", _stored_article())
        await vintages.save(VintageLedger([_figure(6.6)]))

        report = RunReport(series=[_series(7.4)])
        await _watch_revisions(articles, report, vintages=vintages)

        on_disk = json.loads((tmp_path / "estonia-unemployment.json").read_text(encoding="utf-8"))
        assert on_disk["corrections"], "the published article carries no correction"
        assert "7.4" in on_disk["corrections"][0]["description"]
        assert len(report.corrections) == 1

    @pytest.mark.asyncio
    async def test_a_corrected_article_is_still_servable(self, tmp_path) -> None:
        """The trap that would delete the story instead of correcting it.

        ``publish.is_servable`` and the frontend's ``isServable`` both require
        ``status == "published"``. Setting the schema's ``corrected`` status —
        which is the obvious move, and is in the enum — would remove the article
        from the site at the moment it was annotated.
        """
        articles, vintages = _stores(tmp_path)
        await articles.write_published("estonia-unemployment", _stored_article())
        await vintages.save(VintageLedger([_figure(6.6)]))

        await _watch_revisions(articles, RunReport(series=[_series(7.4)]), vintages=vintages)

        on_disk = json.loads((tmp_path / "estonia-unemployment.json").read_text(encoding="utf-8"))
        assert on_disk["status"] == "published", (
            "correcting an article must not unpublish it"
        )

    @pytest.mark.asyncio
    async def test_the_prose_is_left_alone(self, tmp_path) -> None:
        articles, vintages = _stores(tmp_path)
        await articles.write_published("estonia-unemployment", _stored_article())
        await vintages.save(VintageLedger([_figure(6.6)]))

        await _watch_revisions(articles, RunReport(series=[_series(7.4)]), vintages=vintages)

        on_disk = json.loads((tmp_path / "estonia-unemployment.json").read_text(encoding="utf-8"))
        assert on_disk["body"][0]["text"] == "The rate fell to 6.6% in June 2026.", (
            "the body must keep the figure it was written around; every number in "
            "it is bound to a verified signal field and rewriting one breaks that "
            "binding, quite apart from editing the past"
        )

    @pytest.mark.asyncio
    async def test_running_twice_appends_one_correction(self, tmp_path) -> None:
        articles, vintages = _stores(tmp_path)
        await articles.write_published("estonia-unemployment", _stored_article())
        await vintages.save(VintageLedger([_figure(6.6)]))

        for _ in range(3):
            await _watch_revisions(articles, RunReport(series=[_series(7.4)]), vintages=vintages)

        on_disk = json.loads((tmp_path / "estonia-unemployment.json").read_text(encoding="utf-8"))
        assert len(on_disk["corrections"]) == 1, (
            "a correction log that repeats every run buries the real corrections"
        )

    @pytest.mark.asyncio
    async def test_an_unchanged_figure_leaves_the_article_untouched(self, tmp_path) -> None:
        articles, vintages = _stores(tmp_path)
        await articles.write_published("estonia-unemployment", _stored_article())
        await vintages.save(VintageLedger([_figure(6.6)]))

        await _watch_revisions(articles, RunReport(series=[_series(6.6)]), vintages=vintages)

        on_disk = json.loads((tmp_path / "estonia-unemployment.json").read_text(encoding="utf-8"))
        assert "corrections" not in on_disk

    @pytest.mark.asyncio
    async def test_a_vanished_article_does_not_crash_the_run(self, tmp_path) -> None:
        articles, vintages = _stores(tmp_path)
        await vintages.save(VintageLedger([_figure(6.6, slug="never-stored")]))

        report = RunReport(series=[_series(7.4)])
        await _watch_revisions(articles, report, vintages=vintages)

        assert report.corrections == []
        assert report.errors == []


    @pytest.mark.asyncio
    async def test_the_public_log_is_written_in_the_shape_the_page_reads(
        self, tmp_path
    ) -> None:
        """The /corrections page reads a bare array from corrections.json.

        ``fetchCorrections`` does ``if (!Array.isArray(raw)) return []``, so an
        object wrapper here would empty the log with no error anywhere.
        """
        articles, vintages = _stores(tmp_path)
        await articles.write_published("estonia-unemployment", _stored_article())
        await vintages.save(VintageLedger([_figure(6.6)]))

        await _watch_revisions(articles, RunReport(series=[_series(7.4)]), vintages=vintages)

        payload = json.loads((tmp_path / "corrections.json").read_text(encoding="utf-8"))
        assert isinstance(payload, list), "the page reads a bare array, not an object"
        assert payload[0]["slug"] == "estonia-unemployment"
        assert payload[0]["headline"]
        assert payload[0]["corrected_at"]
        assert "7.4" in payload[0]["description"]

    @pytest.mark.asyncio
    async def test_the_log_and_the_article_agree_word_for_word(self, tmp_path) -> None:
        articles, vintages = _stores(tmp_path)
        await articles.write_published("estonia-unemployment", _stored_article())
        await vintages.save(VintageLedger([_figure(6.6)]))

        await _watch_revisions(articles, RunReport(series=[_series(7.4)]), vintages=vintages)

        on_article = json.loads(
            (tmp_path / "estonia-unemployment.json").read_text(encoding="utf-8")
        )["corrections"][0]
        in_log = json.loads((tmp_path / "corrections.json").read_text(encoding="utf-8"))[0]

        assert in_log["description"] == on_article["description"]
        assert in_log["corrected_at"] == on_article["corrected_at"]

    @pytest.mark.asyncio
    async def test_the_log_is_append_only_across_runs(self, tmp_path) -> None:
        articles, vintages = _stores(tmp_path)
        await articles.write_published("first", {**_stored_article(), "slug": "first"})
        await articles.write_published("second", {**_stored_article(), "slug": "second"})
        await vintages.save(VintageLedger([_figure(6.6, slug="first")]))

        await _watch_revisions(articles, RunReport(series=[_series(7.4)]), vintages=vintages)
        await vintages.save(VintageLedger([_figure(6.6, slug="second")]))
        await _watch_revisions(articles, RunReport(series=[_series(7.9)]), vintages=vintages)

        payload = json.loads((tmp_path / "corrections.json").read_text(encoding="utf-8"))
        assert {e["slug"] for e in payload} == {"first", "second"}, (
            "the second run overwrote the first run's correction; the log must accumulate"
        )

    @pytest.mark.asyncio
    async def test_no_revision_writes_no_log(self, tmp_path) -> None:
        articles, vintages = _stores(tmp_path)
        await articles.write_published("estonia-unemployment", _stored_article())
        await vintages.save(VintageLedger([_figure(6.6)]))

        await _watch_revisions(articles, RunReport(series=[_series(6.6)]), vintages=vintages)

        assert not (tmp_path / "corrections.json").exists()


class TestTodaysClaimsAreRecorded:
    @pytest.mark.asyncio
    async def test_publishing_adds_the_figure_to_the_ledger(self, tmp_path) -> None:
        """Without this the watch has nothing to watch on the following run."""
        articles, vintages = _stores(tmp_path)
        signal = Signal(
            detector="sharp_move",
            metric="unemployment_rate",
            metric_label="unemployment rate",
            geography="EE",
            period="2026-06",
            value=6.6,
            unit="%",
            comparison_basis="the previous reading",
            score=0.8,
            section="labour",
            fields={"latest_value": 6.6},
            sources=[SourceRef(source_id="eurostat", retrieved_at="2026-08-24T10:00:00Z")],
        )
        article = Article(
            id="01ABC",
            slug="estonia-unemployment",
            tier="A",
            status="published",
            headline="Estonia's unemployment rate declines to 6.6% in June 2026",
            section="labour",
            created_at=PUBLISHED_AT,
            provenance={"validator": {"passed": True, "checks": []}, "signal_id": "sig1"},
            body=[Block(type="paragraph", text="The rate fell to 6.6%.")],
        )

        class _Verdict:
            passed = True

        report = RunReport(
            series=[_series(6.6)],
            generated=[GenerationResult(signal=signal, article=article, verdict=_Verdict())],
        )
        await _watch_revisions(articles, report, vintages=vintages)

        ledger = await vintages.load()
        assert len(ledger) == 1
        recorded = next(iter(ledger))
        assert recorded.value == 6.6
        assert recorded.observed_at == "2026-08-24T10:00:00Z", (
            "the ledger must record the vintage, not the publication time; without "
            "it a later disagreement cannot be attributed to the source"
        )

    @pytest.mark.asyncio
    async def test_an_unpublished_draft_is_not_recorded(self, tmp_path) -> None:
        articles, vintages = _stores(tmp_path)

        report = RunReport(series=[_series(6.6)])
        await _watch_revisions(articles, report, vintages=vintages)

        assert len(await vintages.load()) == 0
