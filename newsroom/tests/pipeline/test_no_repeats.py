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


class TestTheEditorDoesNotReDecideACardItHasRun:
    """133 cards built, 113 already published, all 133 read by the editor.

    A tier B/C slug is derived from the feed item's own guid, so it is the same
    card on every run for as long as the outlet keeps the item in its feed. One
    model call each, three runs a day, and it is by some distance the largest
    single line in the bill.

    It is also unsound rather than merely wasteful. The editor is a model, so a
    second read of an identical card can return a different verdict, and asking
    repeatedly until the answer changes is the shape this pipeline refuses
    everywhere else.
    """

    @pytest.mark.anyio
    async def test_published_slugs_come_back_from_the_index(self, tmp_path):
        import json

        from newsroom.pipeline.publish import ArticleStore

        store = ArticleStore(local_dir=tmp_path, account_url="")
        (tmp_path / "index.json").write_text(
            json.dumps({"articles": [{"slug": "lsm-storm-abc123"}, {"slug": "err-cable-def456"}]}),
            encoding="utf-8",
        )

        assert await store.published_slugs() == {"lsm-storm-abc123", "err-cable-def456"}

    @pytest.mark.anyio
    async def test_an_empty_index_skips_nothing(self, tmp_path):
        """No history must mean "decide everything", never "decide nothing"."""
        from newsroom.pipeline.publish import ArticleStore

        store = ArticleStore(local_dir=tmp_path, account_url="")

        assert await store.published_slugs() == set()

    def test_a_card_slug_is_stable_across_runs(self):
        """The property the skip rests on. If slugs churned, nothing would match.

        It is derived from the feed item's guid, so the same item yields the
        same slug however many times it is collected — and a different item
        yields a different one even when the headline is identical.
        """
        from newsroom.pipeline.collect.rss import item_slug
        from newsroom.pipeline.models import FeedItem

        def item(guid: str) -> FeedItem:
            return FeedItem(
                source_id="lsm_en",
                title="Storm knocks out power across Latvia",
                link=f"https://eng.lsm.lv/{guid}",
                description="",
                published=None,
                guid=guid,
                raw_blob=f"2026-08-26/lsm_en/{guid}.raw",
            )

        assert item_slug(item("a")) == item_slug(item("a"))
        assert item_slug(item("a")) != item_slug(item("b"))

    def test_the_run_actually_skips_them(self):
        """A helper that works and is never called is the failure mode here.

        ``published_slugs`` passing its own tests while ``run_once`` still hands
        every card to the editor would leave the bill exactly where it was, and
        nothing else in the suite would notice.
        """
        import inspect

        from newsroom.pipeline import run as run_module

        source = inspect.getsource(run_module.run_once)

        assert "published_slugs()" in source, (
            "run_once no longer reads what it has already published, so the "
            "editor re-decides every card on every run"
        )
        assert "refused_slugs()" in source, (
            "a card the editor refused never reaches the index, so without the "
            "ledger it is re-sent to be refused again on every run"
        )
        assert "card.slug not in decided" in source, (
            "the already-decided cards are read but not filtered out"
        )
        assert source.index("published_slugs()") < source.index(
            "edit_syndicated_articles("
        ), "the skip must happen before the editor, not after it"


class TestARefusalIsRememberedRatherThanRepeated:
    """103 of 111 tier C rejections were Azure content-filter refusals.

    Ukraine and Russia military coverage, political opinion — 59 unique
    headlines, re-sent on every run to be refused again, because a refused card
    never reaches the index and so ``published_slugs`` cannot see it.

    Remembered rather than filtered by topic, deliberately. A Baltic wire that
    quietly drops military stories has an editorial problem, not a cost one.
    """

    @staticmethod
    def _outcome(action: str, reason: str = "content filter"):
        from newsroom.pipeline.editor import EditorAction, EditorOutcome

        return EditorOutcome(
            article_id="a",
            action=EditorAction(action),
            reason=reason,
            editor="Dace",
            decided_at="2026-08-26T14:00:00Z",
        )

    @pytest.mark.anyio
    async def test_should_remember_a_rejection(self, tmp_path):
        from newsroom.pipeline.decisions import DecisionLedger
        from newsroom.pipeline.publish import ArticleStore

        ledger = DecisionLedger(ArticleStore(local_dir=tmp_path, account_url=""))

        await ledger.remember([("lsm-strike-abc123", self._outcome("reject"))])

        assert await ledger.refused_slugs() == {"lsm-strike-abc123"}

    @pytest.mark.anyio
    async def test_should_remember_an_escalation(self, tmp_path):
        """Waiting on a human. Re-asking does not make them answer faster, and
        it would re-notify them."""
        from newsroom.pipeline.decisions import DecisionLedger
        from newsroom.pipeline.publish import ArticleStore

        ledger = DecisionLedger(ArticleStore(local_dir=tmp_path, account_url=""))

        await ledger.remember([("err-opinion-def456", self._outcome("escalate"))])

        assert await ledger.refused_slugs() == {"err-opinion-def456"}

    @pytest.mark.anyio
    async def test_should_not_remember_an_approval(self, tmp_path):
        """An approved card is in the index, and ``published_slugs`` covers it.

        Recording it here too would be a second source of truth for one fact.
        """
        from newsroom.pipeline.decisions import DecisionLedger
        from newsroom.pipeline.publish import ArticleStore

        ledger = DecisionLedger(ArticleStore(local_dir=tmp_path, account_url=""))

        await ledger.remember([("lsm-storm-abc123", self._outcome("approve"))])

        assert await ledger.refused_slugs() == set()

    @pytest.mark.anyio
    async def test_should_survive_a_missing_ledger(self, tmp_path):
        """No memory must mean "decide everything", never "decide nothing"."""
        from newsroom.pipeline.decisions import DecisionLedger
        from newsroom.pipeline.publish import ArticleStore

        ledger = DecisionLedger(ArticleStore(local_dir=tmp_path, account_url=""))

        assert await ledger.refused_slugs() == set()

    @pytest.mark.anyio
    async def test_should_survive_a_corrupt_ledger(self, tmp_path):
        from newsroom.pipeline.decisions import DECISIONS_BLOB, DecisionLedger
        from newsroom.pipeline.publish import ArticleStore

        target = tmp_path / DECISIONS_BLOB
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("{ not json", encoding="utf-8")
        ledger = DecisionLedger(ArticleStore(local_dir=tmp_path, account_url=""))

        assert await ledger.refused_slugs() == set()

    @pytest.mark.anyio
    async def test_should_accumulate_across_runs(self, tmp_path):
        from newsroom.pipeline.decisions import DecisionLedger
        from newsroom.pipeline.publish import ArticleStore

        store = ArticleStore(local_dir=tmp_path, account_url="")

        await DecisionLedger(store).remember([("a", self._outcome("reject"))])
        await DecisionLedger(store).remember([("b", self._outcome("reject"))])

        assert await DecisionLedger(store).refused_slugs() == {"a", "b"}

    @pytest.mark.anyio
    async def test_should_keep_the_reason_so_a_human_can_audit_it(self, tmp_path):
        """A refusals cache nobody can read is indistinguishable from a filter."""
        from newsroom.pipeline.decisions import DecisionLedger
        from newsroom.pipeline.publish import ArticleStore

        store = ArticleStore(local_dir=tmp_path, account_url="")
        ledger = DecisionLedger(store)

        await ledger.remember(
            [("lsm-strike-abc123", self._outcome("reject", "content filter: violence"))]
        )

        record = (await ledger.load())["lsm-strike-abc123"]
        assert record["decision"] == "reject"
        assert "violence" in record["reason"]
        assert record["decided_at"] == "2026-08-26T14:00:00Z"


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
        # Which of the two folds caught it is an implementation detail and has
        # moved: keying the release fold on the family means a Baltic-wide pair
        # is absorbed there, and the event fold now covers the geographies the
        # release fold passes through. The contract is one story, not which
        # counter incremented.
        assert report.same_release + report.same_event == 1

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


class TestOneReleaseIsOneStoryHoweverManyWaysItIsRead:
    """Seven nested balance-of-payments series are one release.

    The goods-and-services balance IS goods plus services, and services is
    transport plus financial plus telecoms plus other business services — so
    the same euro appears in three of them. On the live collection they
    produced **26 of 47 signals** and took three of the eight slots, which is
    why maritime's best signal, a container record scoring 0.95, landed
    seventh of eight and was the first thing lost to any jitter.

    Folding them fixed the front page without a section quota: measured over
    the same 47 signals, trade goes from three slots to one and maritime from
    nothing to four articles, two of them on the first run's page.
    """

    BOP = (
        "trade_balance",
        "goods_balance",
        "services_balance",
        "transport_services_balance",
        "financial_services_balance",
        "ict_services_balance",
        "other_business_services_balance",
    )

    @pytest.mark.parametrize("metric", BOP)
    def test_every_component_belongs_to_the_family(self, metric):
        assert family_of(metric) == "external_balance"

    def test_one_release_yields_one_article(self):
        signals = [
            make_signal(score=0.90 + index / 100, metric=metric,
                        geography="Baltic", period="2026-Q1")
            for index, metric in enumerate(self.BOP)
        ]

        report = rank(signals, POLICY)

        assert len(report.selected) == 1

    def test_the_strongest_component_wins_not_the_headline_total(self):
        """The split exists because "the total hides the finding".

        All three states run a similar goods deficit and the entire divergence
        sits in services, so collection keeps the components deliberately.
        Folding must preserve that: the wire should say "the transport services
        balance diverged", not fall back to the vaguer headline number.
        """
        signals = [
            make_signal(score=0.70, metric="trade_balance",
                        geography="Baltic", period="2026-Q1"),
            make_signal(score=0.99, metric="transport_services_balance",
                        geography="Baltic", period="2026-Q1"),
        ]

        report = rank(signals, POLICY)

        assert [s.metric for s in report.selected] == ["transport_services_balance"]

    def test_a_later_run_does_not_publish_another_component(self):
        """Within a run they were folded; across runs they were not.

        Live, that produced transport services on run 1, financial services on
        run 2, services on run 3 and the headline total on run 4 — four
        articles about one quarter of one release, on four consecutive runs.
        Same bug as the country fold, in the same shape, needing the same fix.
        """
        published = {finding_key("transport_services_balance", "Baltic", "2026-Q1")}

        report = rank(
            [
                make_signal(score=0.99, metric="financial_services_balance",
                            geography="Baltic", period="2026-Q1"),
                make_signal(score=0.98, metric="goods_balance",
                            geography="EE", period="2026-Q1"),
            ],
            POLICY,
            published=published,
        )

        assert report.selected == []
        assert report.already_published == 2

    def test_a_new_quarter_is_a_new_release(self):
        published = {finding_key("transport_services_balance", "Baltic", "2026-Q1")}

        report = rank(
            [make_signal(score=0.9, metric="goods_balance",
                         geography="Baltic", period="2026-Q2")],
            POLICY,
            published=published,
        )

        assert len(report.selected) == 1

    def test_an_unrelated_metric_is_untouched(self):
        """Only declared families fold. A metric on its own is its own family."""
        signals = [
            make_signal(score=0.9, metric="unemployment_rate",
                        geography="Baltic", period="2026-06"),
            make_signal(score=0.85, metric="goods_balance",
                        geography="Baltic", period="2026-06"),
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
