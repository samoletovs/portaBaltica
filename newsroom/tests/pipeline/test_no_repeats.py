"""The wire must not tell the same story twice.

WHY THIS EXISTS
---------------
Three separate repetitions, all live, all invisible to every gate:

1. **Across runs.** Nothing checked what had already been published before
   generating. The index deduped itself by ``signal_id`` afterwards, so the
   front page looked right and the run had still paid for research, an analyst
   brief, up to three writer drafts and up to three desk reads on a story it
   then discarded. At three scheduled runs a day against monthly and quarterly
   data, almost every signal is a repeat.

2. **Across countries.** One Eurostat labour-cost release produced three tier A
   articles, one per Baltic state, because the dedupe key is
   ``(metric, geography)`` and the geographies differ. An editor writes one
   comparison.

3. **Across metrics.** ``day_ahead_power_price`` and ``day_ahead_power_spread``
   both fired on the same Baltic market on the same day and both published,
   minutes apart, because they are different metrics.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.config import RankingPolicy
from newsroom.pipeline.rank import METRIC_FAMILIES, family_of, finding_key, rank
from newsroom.tests.pipeline.conftest import make_signal

POLICY = RankingPolicy(max_articles=8, min_score=0.55, max_per_metric=1)


class TestAFindingIsNotPublishedTwice:
    def test_should_suppress_a_finding_already_on_the_front_page(self):
        signal = make_signal(score=0.9, metric="unemployment_rate", geography="EE",
                             period="2026-06")

        report = rank(
            [signal], POLICY,
            published={finding_key("unemployment_rate", "EE", "2026-06")},
        )

        assert report.selected == []
        assert report.already_published == 1

    def test_should_publish_the_same_metric_for_a_new_period(self):
        """The period is the window, so a new reading is a new story."""
        signal = make_signal(score=0.9, metric="unemployment_rate", geography="EE",
                             period="2026-07")

        report = rank(
            [signal], POLICY,
            published={finding_key("unemployment_rate", "EE", "2026-06")},
        )

        assert len(report.selected) == 1

    def test_should_suppress_regardless_of_which_detector_fired(self):
        """``signal_id`` hashes the detector in; this key deliberately does not.

        Otherwise the reader gets "Estonian unemployment hits a record" and
        "Estonian unemployment extends its run" about one number on one day.
        """
        signal = make_signal(score=0.9, detector="streak", metric="unemployment_rate",
                             geography="EE", period="2026-06")

        report = rank(
            [signal], POLICY,
            published={finding_key("unemployment_rate", "EE", "2026-06")},
        )

        assert report.selected == []

    def test_should_suppress_regardless_of_a_revised_value(self):
        """A revision annotates the published piece; it is not a second one."""
        signal = make_signal(score=0.9, metric="unemployment_rate", geography="EE",
                             period="2026-06", value=6.7)

        report = rank(
            [signal], POLICY,
            published={finding_key("unemployment_rate", "EE", "2026-06")},
        )

        assert report.selected == []

    def test_should_publish_everything_when_the_history_is_unknown(self):
        """Fails towards a duplicate rather than towards silence.

        Entries written before the finding key existed carry none, so an empty
        history must mean "publish", never "withhold".
        """
        report = rank([make_signal(score=0.9)], POLICY, published=set())

        assert len(report.selected) == 1

    def test_should_not_suppress_before_the_quality_floor_is_applied(self):
        """Order of operations: the floor still runs first.

        A weak signal must never be promoted into the wire because a stronger
        one on the same reading was suppressed as a repeat.
        """
        report = rank(
            [
                make_signal(score=0.9, metric="m", geography="EE", period="p"),
                make_signal(score=0.2, metric="m", geography="EE", period="p"),
            ],
            POLICY,
            published={finding_key("m", "EE", "p")},
        )

        assert report.selected == []
        assert report.below_floor == 1
        assert report.already_published == 1


class TestAComparativeSubsumesItsSingles:
    """"When a comparative signal does fire, the per-country singles it
    subsumes should not also publish."

    On the live trade series this was the last duplication left after the
    country fold and the cross-run key: ``financial_services_balance/LT``
    published on one run and ``financial_services_balance/Baltic`` on the next,
    two articles about one quarter of one series. Five trade metrics did it.
    """

    def test_a_baltic_reading_takes_the_slot_from_a_country_one(self):
        signals = [
            make_signal(score=0.95, metric="financial_services_balance",
                        geography="LT", period="2026-Q1", detector="seasonal_deviation"),
            make_signal(score=0.80, metric="financial_services_balance",
                        geography="Baltic", period="2026-Q1", detector="divergence"),
        ]

        report = rank(signals, POLICY)

        assert len(report.selected) == 1
        assert report.selected[0].geography == "Baltic", (
            "the comparison lost its slot to one of the countries it compares"
        )

    def test_even_though_the_country_signal_scored_higher(self):
        """Deliberate. The comparison is the better story at equal accuracy,
        and score measures how unusual a movement is, not how much a reader
        learns from reading about it."""
        signals = [
            make_signal(score=1.0, metric="m", geography="EE", period="p"),
            make_signal(score=0.6, metric="m", geography="Baltic", period="p"),
        ]

        report = rank(signals, POLICY)

        assert [s.geography for s in report.selected] == ["Baltic"]

    def test_publishing_the_comparison_closes_the_release_for_the_singles(self):
        published = {finding_key("m", "Baltic", "p")}

        report = rank(
            [make_signal(score=0.9, metric="m", geography="LV", period="p")],
            POLICY,
            published=published,
        )

        assert report.selected == []
        assert report.already_published == 1

    def test_and_publishing_a_single_closes_it_for_the_comparison(self):
        published = {finding_key("m", "LV", "p")}

        report = rank(
            [make_signal(score=0.9, metric="m", geography="Baltic", period="p")],
            POLICY,
            published=published,
        )

        assert report.selected == []


class TestOneArticlePerEvent:
    def test_should_publish_one_story_about_the_baltic_power_market(self):
        """Both of these ran, minutes apart, on the same market on the same day.

            "Divergence in Baltic electricity prices reaches 70.2 EUR/MWh"
            "Baltic power market sees significant spread divergence"
        """
        signals = [
            make_signal(score=0.90, metric="day_ahead_power_price",
                        geography="Baltic", period="2026-08-24"),
            make_signal(score=0.85, metric="day_ahead_power_spread",
                        geography="Baltic", period="2026-08-24"),
        ]

        report = rank(signals, POLICY)

        assert len(report.selected) == 1
        assert report.selected[0].metric == "day_ahead_power_price"
        assert report.same_event == 1

    def test_should_leave_unrelated_metrics_alone(self):
        """A metric standing on its own is its own family.

        The map is curated, so nothing is collapsed by a guess: the cost of a
        missed pair is one duplicate, the cost of a wrong guess is a finding
        that never runs.
        """
        signals = [
            make_signal(score=0.9, metric="unemployment_rate", geography="Baltic"),
            make_signal(score=0.85, metric="hourly_labour_cost", geography="Baltic"),
        ]

        report = rank(signals, POLICY)

        assert len(report.selected) == 2

    @pytest.mark.parametrize("metric", sorted(METRIC_FAMILIES))
    def test_every_declared_family_member_resolves_to_its_family(self, metric):
        assert family_of(metric) == METRIC_FAMILIES[metric]

    def test_an_undeclared_metric_is_its_own_family(self):
        assert family_of("unemployment_rate") == "unemployment_rate"

    def test_should_not_collapse_two_days_of_the_same_market(self):
        signals = [
            make_signal(score=0.9, metric="day_ahead_power_price",
                        geography="Baltic", period="2026-08-24"),
            make_signal(score=0.85, metric="day_ahead_power_spread",
                        geography="Baltic", period="2026-08-25"),
        ]

        report = rank(signals, POLICY)

        assert len(report.selected) == 2


class TestTheIndexCarriesWhatRankingNeeds:
    """The suppression key has to survive into the published record.

    Ranking reads it back from the index next run, so a key written into
    provenance and dropped from the index entry would make the whole mechanism
    a no-op that still passes its own unit tests.
    """

    def test_the_generator_records_the_finding_on_the_article(self):
        from newsroom.pipeline.write import StubWriter, generate_article
        from newsroom.tests.pipeline.test_generation import GOOD_PAYLOAD

        signal = make_signal(metric="unemployment_rate", geography="EE", period="2026-06")

        result = generate_article(signal, StubWriter(GOOD_PAYLOAD))

        assert result.article.provenance["signal_finding"] == finding_key(
            "unemployment_rate", "EE", "2026-06"
        )

    @pytest.mark.anyio
    async def test_the_index_round_trips_it(self, tmp_path):
        from newsroom.pipeline.publish import ArticleStore
        from newsroom.pipeline.write import StubWriter, generate_article
        from newsroom.tests.pipeline.test_generation import GOOD_PAYLOAD

        store = ArticleStore(local_dir=tmp_path, account_url="")
        signal = make_signal(metric="unemployment_rate", geography="EE", period="2026-06")
        result = generate_article(signal, StubWriter(GOOD_PAYLOAD))
        assert result.publishable

        await store.write_index([result.article])

        assert await store.published_findings() == {
            finding_key("unemployment_rate", "EE", "2026-06")
        }

    @pytest.mark.anyio
    async def test_an_index_without_the_field_suppresses_nothing(self, tmp_path):
        import json

        from newsroom.pipeline.publish import ArticleStore

        store = ArticleStore(local_dir=tmp_path, account_url="")
        (tmp_path / "index.json").write_text(
            json.dumps({"articles": [{"slug": "old", "signal_id": "abc"}]}),
            encoding="utf-8",
        )

        assert await store.published_findings() == set()
