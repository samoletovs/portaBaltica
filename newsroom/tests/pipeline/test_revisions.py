"""The revision watch: can the wire discover it was wrong?

Before this existed the answer was no — 161 published articles, zero
corrections, and no code path capable of producing one. These tests assert the
capability, not the implementation: each one describes something a reader should
be able to observe.
"""

from __future__ import annotations

import json

import pytest

from newsroom.pipeline.detect.series import Observation, TimeSeries
from newsroom.pipeline.models import Article, Signal, SourceRef
from newsroom.pipeline.revisions import already_recorded, find_revisions
from newsroom.pipeline.vintage import (
    PublishedFigure,
    VintageLedger,
    VintageStore,
    figures_from,
)

RETRIEVED = "2026-08-24T10:00:00Z"
LATER = "2026-09-24T10:00:00Z"


def series(pairs, *, metric="unemployment_rate", geography="EE", retrieved=LATER, unit="%"):
    return TimeSeries(
        metric=metric,
        metric_label="unemployment rate",
        geography=geography,
        unit=unit,
        section="labour",
        observations=tuple(Observation(period=p, value=v) for p, v in pairs),
        source=SourceRef(source_id="eurostat", retrieved_at=retrieved),
    )


def figure(value=6.6, *, period="2026-06", slug="estonia-unemployment", metric="unemployment_rate"):
    return PublishedFigure(
        metric=metric,
        metric_label="unemployment rate",
        geography="EE",
        period=period,
        value=value,
        unit="%",
        slug=slug,
        article_id="01ABC",
        headline="Estonia's unemployment rate declines to 6.6% in June 2026",
        observed_at=RETRIEVED,
        published_at="2026-08-24T12:00:00Z",
        signal_id="sig1",
    )


class TestTheWireCanDiscoverItWasWrong:
    def test_a_revised_figure_produces_a_correction(self) -> None:
        ledger = VintageLedger([figure(6.6)])
        current = series([("2026-05", 6.7), ("2026-06", 7.4)])

        found = find_revisions(ledger, [current])

        assert len(found) == 1, "the source restated a published figure and nothing noticed"
        correction = found[0].to_correction()
        assert "6.6" in correction["previous_value"]
        assert "7.4" in correction["description"]
        assert "revised up" in correction["description"]

    def test_the_correction_says_it_is_a_restatement_not_our_error(self) -> None:
        ledger = VintageLedger([figure(6.6)])
        found = find_revisions(ledger, [series([("2026-06", 7.4)])])

        description = found[0].to_correction()["description"]

        assert "not a reporting error" in description
        assert "text is unchanged" in description, (
            "a reader must be told the prose still carries the old figure"
        )

    def test_it_names_both_vintages(self) -> None:
        ledger = VintageLedger([figure(6.6)])
        found = find_revisions(ledger, [series([("2026-06", 7.4)])])

        description = found[0].description()

        assert "2026-08-24" in description, "the vintage we published against"
        assert "2026-09-24" in description, "the vintage that disagrees"

    def test_an_unchanged_figure_produces_nothing(self) -> None:
        ledger = VintageLedger([figure(6.6)])

        assert find_revisions(ledger, [series([("2026-06", 6.6)])]) == []

    def test_a_move_below_the_measurement_floor_is_not_a_revision(self) -> None:
        # 6.6 -> 6.7 is one tenth in a survey series: the same number twice.
        ledger = VintageLedger([figure(6.6)])

        assert find_revisions(ledger, [series([("2026-06", 6.7)])]) == [], (
            "a restatement smaller than the series can express must not be corrected"
        )

    def test_a_missing_period_is_not_read_as_a_revision(self) -> None:
        # The collector fetches a rolling window; falling out of it is not news.
        ledger = VintageLedger([figure(6.6, period="2020-01")])

        assert find_revisions(ledger, [series([("2026-06", 6.6)])]) == []

    def test_an_untracked_series_is_not_read_as_a_revision(self) -> None:
        ledger = VintageLedger([figure(6.6, metric="mystery_metric")])

        assert find_revisions(ledger, [series([("2026-06", 99.0)])]) == []

    def test_two_articles_citing_the_same_figure_are_both_corrected(self) -> None:
        ledger = VintageLedger([figure(6.6, slug="first"), figure(6.6, slug="second")])

        found = find_revisions(ledger, [series([("2026-06", 7.4)])])

        assert {r.figure.slug for r in found} == {"first", "second"}


class TestCorrectionsAreNotRepeated:
    def test_a_recorded_revision_is_recognised(self) -> None:
        ledger = VintageLedger([figure(6.6)])
        revision = find_revisions(ledger, [series([("2026-06", 7.4)])])[0]
        existing = [revision.to_correction()]

        assert already_recorded(existing, revision), (
            "a correction log that repeats every run buries the real corrections"
        )

    def test_a_further_revision_is_still_recorded(self) -> None:
        ledger = VintageLedger([figure(6.6)])
        first = find_revisions(ledger, [series([("2026-06", 7.4)])])[0]
        second = find_revisions(ledger, [series([("2026-06", 8.1)])])[0]

        assert not already_recorded([first.to_correction()], second)

    def test_an_empty_log_records_nothing_yet(self) -> None:
        ledger = VintageLedger([figure(6.6)])
        revision = find_revisions(ledger, [series([("2026-06", 7.4)])])[0]

        assert not already_recorded([], revision)


class TestTheLedger:
    def test_only_published_articles_are_recorded(self) -> None:
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
            sources=[SourceRef(source_id="eurostat", retrieved_at=RETRIEVED)],
        )
        draft = Article(
            id="01ABC",
            slug="s",
            tier="A",
            status="draft",
            headline="h",
            section="labour",
            created_at=RETRIEVED,
            provenance={},
        )

        assert figures_from(draft, signal) == []

        draft.status = "published"
        recorded = figures_from(draft, signal)
        assert len(recorded) == 1
        assert recorded[0].observed_at == RETRIEVED, "the vintage must be the retrieval time"

    def test_it_survives_a_round_trip(self) -> None:
        ledger = VintageLedger([figure(6.6), figure(1.2, slug="other")])

        restored = VintageLedger.from_json(json.loads(json.dumps(ledger.to_json())))

        assert len(restored) == 2
        assert {e.value for e in restored} == {6.6, 1.2}

    def test_one_bad_row_does_not_blind_the_whole_watch(self) -> None:
        payload = {"figures": [figure(6.6).to_json(), {"metric": "broken"}, "not a dict"]}

        restored = VintageLedger.from_json(payload)

        assert len(restored) == 1

    def test_a_missing_ledger_reads_as_empty_rather_than_raising(self) -> None:
        assert len(VintageLedger.from_json(None)) == 0
        assert len(VintageLedger.from_json({"figures": "nonsense"})) == 0

    def test_recording_the_same_figure_twice_keeps_one_entry(self) -> None:
        ledger = VintageLedger([figure(6.6)])
        ledger.record([figure(6.9)])

        assert len(ledger) == 1
        assert next(iter(ledger)).value == 6.9, "the newer reading wins"

    @pytest.mark.asyncio
    async def test_it_persists_locally_without_azure(self, tmp_path) -> None:
        store = VintageStore(local_dir=tmp_path, account_url="")

        await store.record([figure(6.6)])
        reloaded = await store.load()

        assert len(reloaded) == 1
        assert (tmp_path / "vintages.json").exists()
