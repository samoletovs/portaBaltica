"""The weekly wrap, and the thing that makes it safe to publish.

A wrap is the only format that quotes work other than its own, which makes it
the only one that can be made wrong by a retraction elsewhere. Every other
correction mechanism in this pipeline assumes the faulty thing is the article
itself.

On the day this was written the newsroom retracted five articles for carrying
figures from the wrong Eurostat cube. A wrap published that week would have
been a sixth -- still asserting 130.9 as a bankruptcy figure, on the front page,
with `retract_all` unaware it existed. So the citation tests here are not
housekeeping; they are the reason the format is publishable at all.
"""

from __future__ import annotations

from datetime import date, datetime

import pytest

from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.retract import retract_all, wraps_citing
from newsroom.pipeline.vintage import PublishedFigure
from newsroom.pipeline.weekly import (
    MIN_FINDINGS,
    _field_name,
    period_problems,
    cited_slugs,
    cites_provenance,
    collect_week,
    corpus_context,
    corpus_fields,
    corpus_signal,
    dominant_section,
    is_worth_writing,
    week_bounds,
)

NOW = datetime(2026, 8, 27, 12, 0, 0)


def figure(
    slug: str,
    metric: str = "house_prices",
    *,
    value: float = 10.9,
    geography: str = "LV",
    published: str = "2026-08-26T09:00:00Z",
    basis: str = "the same quarter a year earlier",
    period: str = "2026-Q2",
) -> PublishedFigure:
    return PublishedFigure(
        metric=metric,
        metric_label=metric.replace("_", " "),
        geography=geography,
        period=period,
        value=value,
        unit="%",
        slug=slug,
        article_id="01J0",
        headline=f"{geography} {metric} moved",
        observed_at="2026-08-26T08:00:00Z",
        published_at=published,
        comparison_basis=basis,
    )


def a_week(n: int = 5) -> tuple[PublishedFigure, ...]:
    metrics = [
        ("house_prices", "LV"),
        ("unemployment_rate", "EE"),
        ("port_goods_throughput", "LT"),
        ("power_price", "LV"),
        ("greenhouse_gas", "EE"),
        ("business_registrations", "LT"),
    ]
    return tuple(
        figure(f"story-{i}", metric, geography=geo, value=float(i + 1))
        for i, (metric, geo) in enumerate(metrics[:n])
    )


class TestTheWindow:
    def test_it_is_the_seven_days_ending_today(self):
        assert week_bounds(NOW) == ("2026-08-21", "2026-08-27")

    def test_a_plain_date_works_too(self):
        assert week_bounds(date(2026, 8, 27)) == ("2026-08-21", "2026-08-27")

    def test_last_week_is_not_this_week(self):
        corpus = collect_week([figure("old", published="2026-08-01T09:00:00Z")], now=NOW)

        assert corpus.figures == ()

    def test_an_article_published_today_is_included(self):
        corpus = collect_week([figure("today", published="2026-08-27T06:00:00Z")], now=NOW)

        assert corpus.slugs == ("today",)

    def test_one_finding_per_article(self):
        """A piece that cited three readings does not get three votes."""
        corpus = collect_week(
            [figure("same", "house_prices"), figure("same", "unemployment_rate")], now=NOW
        )

        assert len(corpus) == 1


class TestOnlyVerifiedNumbersReachTheWriter:
    def test_every_quoted_value_is_a_field(self):
        corpus = collect_week(a_week(), now=NOW)
        fields = corpus_fields(corpus)

        for f in corpus.figures:
            assert float(f.value) in fields.values()

    def test_the_counts_are_supplied_rather_than_left_to_be_invented(self):
        """`figures_traceable` is NOT satisfied by construction for a wrap.

        Quoted figures are traceable because another article verified them.
        Anything the wrap says about the WEEK -- "five findings", "four
        sections" -- is a new number no source article's signal resolves, so it
        has to be computed here and supplied, or the writer cannot state it
        without inventing it.
        """
        corpus = collect_week(a_week(5), now=NOW)
        fields = corpus_fields(corpus)

        assert fields["findings_covered"] == 5.0
        assert fields["sections_covered"] == float(len(corpus.sections))

    def test_the_signal_carries_no_number_the_corpus_did_not_supply(self):
        corpus = collect_week(a_week(), now=NOW)
        signal = corpus_signal(corpus)

        assert set(signal.fields) == set(corpus_fields(corpus))

    def test_a_figure_with_no_recorded_basis_says_so(self):
        """Every ledger entry written before `comparison_basis` existed carries
        none, and a probe of the live ledger found all eight of the week's
        findings in that state. A bare number invites the writer to describe a
        movement it cannot support, which the validator then refuses -- so the
        gap is stated rather than left blank."""
        corpus = collect_week(
            [figure("legacy", "construction_output", basis=""), *a_week(4)], now=NOW
        )
        context = corpus_context(corpus)

        assert "NO COMPARISON BASIS RECORDED" in context["construction_output_lv_2026_q2"]
        assert "do not describe it as a rise" in context["construction_output_lv_2026_q2"]

    def test_each_field_is_explained_with_its_comparison_basis(self):
        """`check_comparison_basis_stated` refuses prose that quantifies a
        change without naming what it is measured against. A wrap cannot
        describe a movement it has no basis for, so the bases go in front of
        the writer with the values."""
        corpus = collect_week(a_week(), now=NOW)
        context = corpus_context(corpus)

        for key in corpus_fields(corpus):
            if key in ("findings_covered", "sections_covered"):
                continue
            assert "measured against" in context[key], f"{key} reached the writer with no basis"

    def test_the_unit_contains_no_digit(self):
        """The unit is interpolated into the comparison basis and read back by
        the numeric scanner, so a digit in it becomes an untraceable numeral in
        every article. Guarded elsewhere for datasets; a synthetic signal is
        just as capable of it."""
        signal = corpus_signal(collect_week(a_week(), now=NOW))

        assert not any(ch.isdigit() for ch in signal.unit)


class TestAThinWeekIsNotWrittenUp:
    def test_below_the_floor_no_wrap(self):
        assert not is_worth_writing(collect_week(a_week(MIN_FINDINGS - 1), now=NOW))

    def test_at_the_floor_a_wrap(self):
        assert is_worth_writing(collect_week(a_week(MIN_FINDINGS), now=NOW))

    def test_the_busiest_beat_writes_it(self):
        """A wrap crosses beats, so it is given to the week's busiest one
        rather than to a seventh persona invented to have no beat."""
        figures = (
            figure("a", "port_goods_throughput"),
            figure("b", "port_goods_containers"),
            figure("c", "house_prices"),
        )

        assert dominant_section(collect_week(figures, now=NOW)) == "maritime"


class TestTheCitations:
    def test_the_wrap_records_what_it_quoted(self):
        corpus = collect_week(a_week(), now=NOW)

        assert cites_provenance(corpus)["cites"] == list(corpus.slugs)

    def test_an_ordinary_article_cites_nothing(self):
        assert cited_slugs({"provenance": {"signal_id": "x"}}) == ()

    def test_a_malformed_cites_is_not_trusted(self):
        assert cited_slugs({"provenance": {"cites": "story-1"}}) == ()
        assert cited_slugs({"provenance": {"cites": [1, None, "ok"]}}) == ("ok",)

    def test_a_retracted_article_is_never_quoted(self):
        """Second lock. The ledger is purged on retraction, so this should be
        unreachable -- which is exactly why it is worth asserting."""
        corpus = collect_week(a_week(), now=NOW, exclude=["story-0"])

        assert "story-0" not in corpus.slugs


# ── the part that makes it safe to publish ─────────────────────────────────


def _stored(slug: str, *, cites: list[str] | None = None, status: str = "published") -> dict:
    provenance: dict = {"validator": {"passed": True, "checks": []}}
    if cites is not None:
        provenance["cites"] = cites
    return {
        "id": "01J0",
        "slug": slug,
        "tier": "A",
        "status": status,
        "headline": f"Headline for {slug}",
        "section": "economy",
        "created_at": "2026-08-26T14:00:00Z",
        "published_at": "2026-08-26T14:00:00Z",
        "body": [{"type": "paragraph", "text": "Something happened."}],
        "provenance": provenance,
    }


async def _seed(store: ArticleStore, documents: list[dict]) -> None:
    for document in documents:
        await store.write_published(document["slug"], document)
    await store.put_json(
        ArticleStore.INDEX_BLOB,
        {
            "generated_at": "2026-08-26T14:00:00Z",
            "count": len(documents),
            "articles": [
                {
                    "slug": d["slug"],
                    "tier": "A",
                    "section": "economy",
                    "headline": d["headline"],
                    "status": d["status"],
                }
                for d in documents
            ],
        },
    )


class TestAWrapDoesNotOutliveItsCitations:
    @pytest.mark.anyio
    async def test_it_is_found(self, tmp_path):
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await _seed(
            store,
            [_stored("source"), _stored("the-week", cites=["source", "other"]), _stored("plain")],
        )

        assert await wraps_citing(store, ["source"]) == ["the-week"]

    @pytest.mark.anyio
    async def test_an_unrelated_wrap_is_left_alone(self, tmp_path):
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await _seed(store, [_stored("source"), _stored("the-week", cites=["something-else"])])

        assert await wraps_citing(store, ["source"]) == []

    @pytest.mark.anyio
    async def test_retracting_the_source_reports_the_wrap_by_name(self, tmp_path):
        """The one that matters.

        Without it the newsroom withdraws an article and leaves a summary on
        the front page quoting its figure, with nothing anywhere aware of the
        connection -- which is what would have happened on 2026-08-27, when
        five articles were retracted for carrying another series' data.
        """
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await _seed(store, [_stored("source"), _stored("the-week", cites=["source"])])

        outcome = await retract_all(store, ["source"], reason="a caching fault")

        assert outcome.retracted == ["source"]
        assert outcome.wraps_to_review == ["the-week"]

    @pytest.mark.anyio
    async def test_the_wrap_is_not_withdrawn_automatically(self, tmp_path):
        """Proportionality. A wrap citing eight stories must not vanish because
        one was withdrawn, and whether the figure was load-bearing in its
        argument is a judgement no machine here can make."""
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await _seed(store, [_stored("source"), _stored("the-week", cites=["source"])])

        await retract_all(store, ["source"], reason="a caching fault")

        assert (await store.read_published("the-week"))["status"] == "published"

    @pytest.mark.anyio
    async def test_the_report_is_logged_so_it_cannot_be_missed(self, tmp_path, caplog):
        """A report nobody reads is a guard that cannot fire, which is the
        defect this codebase found five times in one day. Retraction is never
        automatic, so an operator is always present -- but the warning is what
        reaches them if they only read the log."""
        import logging

        store = ArticleStore(local_dir=tmp_path, account_url="")
        await _seed(store, [_stored("source"), _stored("the-week", cites=["source"])])

        with caplog.at_level(logging.WARNING):
            await retract_all(store, ["source"], reason="a caching fault")

        assert any("the-week" in r.getMessage() for r in caplog.records)

    @pytest.mark.anyio
    async def test_the_source_still_leaves_the_front_page(self, tmp_path):
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await _seed(store, [_stored("source"), _stored("the-week", cites=["source"])])

        await retract_all(store, ["source"], reason="a caching fault")

        index = await store.read_json(ArticleStore.INDEX_BLOB)
        rows = index if isinstance(index, list) else index["articles"]
        assert [r["slug"] for r in rows] == ["the-week"]

    @pytest.mark.anyio
    async def test_a_retracted_wrap_is_not_reported_again(self, tmp_path):
        """Only a reader-facing wrap needs reviewing."""
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await _seed(
            store,
            [_stored("source"), _stored("the-week", cites=["source"], status="retracted")],
        )

        outcome = await retract_all(store, ["source"], reason="a caching fault")

        assert outcome.wraps_to_review == []


# ── the gate inventory ─────────────────────────────────────────────────────
#
# A wrap is the first thing this newsroom publishes that is not about a single
# finding, and every gate was written assuming one article, one signal. These
# tests are the inventory, run rather than reasoned about: each names a gate
# that could have assumed a single signal, and asserts what it actually does.


HOUSE = {"value": 1.0, "unit": "%", "signal_field": "house_prices_lv_2026_q2"}
JOBS = {"value": 2.0, "unit": "%", "signal_field": "unemployment_rate_ee_2026_q2"}


def _wrap_payload(blocks: list[dict]) -> dict:
    return {
        "headline": "Five Baltic readings landed in the week to 27 August",
        "dek": "A week of filings across five beats.",
        "blocks": blocks,
    }


def _generate(blocks: list[dict]):
    from newsroom.pipeline.write import StubWriter, generate_article

    signal = corpus_signal(collect_week(a_week(5), now=NOW))
    payload = _wrap_payload(blocks)
    return generate_article(signal, StubWriter([payload, payload, payload]))


class TestTheWrapPassesTheContractUnchanged:
    def test_a_plausible_wrap_clears_every_check(self):
        """No exemption was needed anywhere. If this fails, some gate has
        started assuming a single finding and the wrap is the thing that
        noticed."""
        result = _generate(
            [
                {
                    "text": "Latvian house prices stood at 1.0%, against the same quarter a year earlier.",
                    "figures": [HOUSE],
                },
                {
                    "text": "Estonian unemployment stood at 2.0%, against the same quarter a year earlier.",
                    "figures": [JOBS],
                },
                {
                    "text": "Across the week portaBaltica published five findings spanning five sections.",
                    "figures": [
                        {"value": 5.0, "signal_field": "findings_covered"},
                        {"value": 5.0, "signal_field": "sections_covered"},
                    ],
                },
                {"text": "The readings do not establish a common cause.", "figures": []},
            ]
        )

        assert result.publishable, [c.name for c in result.verdict.checks if not c.passed]


class TestNoRepeatedFindingsKeepsItsTeethOnAWrap:
    """The check the format looked most likely to break, and it does not.

    It is about repetition WITHIN one piece -- two paragraphs declaring an
    identical, non-empty set of ``signal_field`` names -- so restating a finding
    another article already published is not repetition, while a wrap saying the
    same thing twice still is. The distinction the format needs turned out to be
    the distinction the check already draws.
    """

    def test_a_wrap_that_repeats_itself_is_still_rejected(self):
        result = _generate(
            [
                {
                    "text": "Latvian house prices stood at 1.0%, against the same quarter a year earlier.",
                    "figures": [HOUSE],
                },
                {
                    "text": "House prices in Latvia were 1.0%, measured against the same quarter a year earlier.",
                    "figures": [HOUSE],
                },
                {"text": "No common cause is established.", "figures": []},
            ]
        )

        assert not result.publishable
        assert "no_repeated_findings" in [c.name for c in result.verdict.checks if not c.passed]

    def test_quoting_five_findings_once_each_is_not_repetition(self):
        result = _generate(
            [
                {
                    "text": "Latvian house prices stood at 1.0%, against the same quarter a year earlier.",
                    "figures": [HOUSE],
                },
                {
                    "text": "Estonian unemployment stood at 2.0%, against the same quarter a year earlier.",
                    "figures": [JOBS],
                },
                {"text": "No common cause is established.", "figures": []},
            ]
        )

        assert result.publishable

    def test_comparing_two_then_returning_to_one_is_not_repetition(self):
        """A subset is not a repeat -- which is what lets a wrap compare two
        findings and then dwell on one, the move the format exists for."""
        result = _generate(
            [
                {
                    "text": (
                        "Latvian house prices stood at 1.0% while Estonian unemployment was "
                        "2.0%, both against the same quarter a year earlier."
                    ),
                    "figures": [HOUSE, JOBS],
                },
                {
                    "text": "The 1.0% house-price reading is the weaker, against the same quarter a year earlier.",
                    "figures": [HOUSE],
                },
                {"text": "No common cause is established.", "figures": []},
            ]
        )

        assert result.publishable


class TestTheWrapDoesNotEatTheNewsroom:
    """Suppression keys on ``signal_finding``, and a wrap has no single finding.

    If a published wrap's key collided with the stories it cites, publishing one
    would suppress those stories on the next run -- the wrap consuming the wire
    that feeds it. It does not, because the period is the window.
    """

    def _keys(self, corpus):
        from newsroom.pipeline.rank import finding_key

        signal = corpus_signal(corpus)
        wrap = finding_key(signal.metric, signal.geography, signal.period)
        stories = {finding_key(f.metric, f.geography, f.period) for f in corpus.figures}
        return wrap, stories

    def test_the_wrap_key_is_not_a_story_key(self):
        wrap, stories = self._keys(collect_week(a_week(5), now=NOW))

        assert wrap not in stories

    def test_it_does_not_share_a_family_with_anything(self):
        from newsroom.pipeline.rank import METRIC_FAMILIES, family_of

        signal = corpus_signal(collect_week(a_week(), now=NOW))

        assert signal.metric not in METRIC_FAMILIES
        assert family_of(signal.metric) == signal.metric

    def test_next_week_is_a_different_finding(self):
        """Otherwise the first wrap ever published would suppress every one
        after it."""
        this_week, _ = self._keys(collect_week(a_week(5), now=NOW))
        later = collect_week(
            [figure(f"n{i}", m, geography=g, published="2026-09-02T09:00:00Z")
             for i, (m, g) in enumerate(
                 [("house_prices", "LV"), ("unemployment_rate", "EE"),
                  ("port_goods_throughput", "LT"), ("power_price", "LV")])],
            now=datetime(2026, 9, 3, 12, 0, 0),
        )
        next_week, _ = self._keys(later)

        assert this_week != next_week

    def test_the_same_week_twice_is_the_same_finding(self):
        """The suppression that IS wanted: one wrap per week."""
        first, _ = self._keys(collect_week(a_week(5), now=NOW))
        again, _ = self._keys(collect_week(a_week(4), now=NOW))

        assert first == again


# ── the trigger ────────────────────────────────────────────────────────────


class TestTheWeeklyRunIsVisibleWhenItDoesNothing:
    """A weekly cron that never fires and a quiet week are the same silence.

    One is a broken deployment and the other is the feature working as
    designed. Two GitHub Actions runs have already sat queued here for sixteen
    hours looking exactly like healthy ones, so this is not hypothetical: the
    report is written whatever the outcome, and a MISSING report for a week is
    what says the trigger did not run.
    """

    @pytest.mark.anyio
    async def test_a_thin_week_still_leaves_a_record(self, tmp_path):
        from newsroom.pipeline.weekly import WeeklyOutcome, write_weekly
        from newsroom.pipeline.vintage import VintageLedger, VintageStore

        store = ArticleStore(local_dir=tmp_path, account_url="")
        vintages = VintageStore(local_dir=tmp_path, account_url="")
        await vintages.save(VintageLedger(a_week(2)))

        outcome = await write_weekly(store, writer=None, vintages=vintages, now=NOW)

        assert outcome.outcome == WeeklyOutcome.NOT_ENOUGH
        assert outcome.findings_available == 0  # none of them are reachable
        assert "below the floor" in outcome.detail

    @pytest.mark.anyio
    async def test_the_record_reaches_storage(self, tmp_path):
        import json

        from newsroom.pipeline.weekly import (
            WEEKLY_REPORT_BLOB,
            WeeklyOutcome,
            write_weekly_report,
        )

        store = ArticleStore(local_dir=tmp_path, account_url="")
        outcome = WeeklyOutcome(
            outcome=WeeklyOutcome.NOT_ENOUGH,
            week_start="2026-08-21",
            week_end="2026-08-27",
            findings_available=2,
            detail="2 finding(s) in the week, below the floor of 4",
        )

        document = await write_weekly_report(store, outcome, trigger="timer")

        assert document["outcome"] == "not_enough_findings"
        assert document["trigger"] == "timer"
        assert document["week"] == {"start": "2026-08-21", "end": "2026-08-27"}
        on_disk = json.loads((tmp_path / WEEKLY_REPORT_BLOB).read_text(encoding="utf-8"))
        assert on_disk["detail"] == outcome.detail

    @pytest.mark.anyio
    async def test_a_dated_copy_is_kept(self, tmp_path):
        """`weekly-latest` alone cannot distinguish "ran today and found
        nothing" from "last ran in March"."""
        from newsroom.pipeline.weekly import WeeklyOutcome, write_weekly_report

        store = ArticleStore(local_dir=tmp_path, account_url="")
        outcome = WeeklyOutcome(
            outcome=WeeklyOutcome.NOT_ENOUGH,
            week_start="2026-08-21",
            week_end="2026-08-27",
            findings_available=2,
        )

        document = await write_weekly_report(store, outcome, trigger="timer")
        day = document["finished_at"][:10]

        assert (tmp_path / f"runs/weekly-{day}.json").exists()

    def test_the_outcomes_are_distinguishable(self):
        """Three states, three names. "No wrap" is not one answer."""
        from newsroom.pipeline.weekly import WeeklyOutcome

        assert len({
            WeeklyOutcome.NOT_ENOUGH,
            WeeklyOutcome.REFUSED,
            WeeklyOutcome.PUBLISHED,
        }) == 3


class TestTheTwoCadencesAreConfiguredApart:
    def test_the_weekly_timer_does_not_read_the_daily_setting(self):
        """The disconnected-knob failure, which this project has had once.

        `NEWSROOM_SCHEDULE` sat in Azure being ignored while the decorator
        hardcoded a different cron, so the deployment looked configured for
        three runs a day and ran once. A second timer reading the first's
        setting would reintroduce it, and would also weld the two cadences
        together.
        """
        import pathlib

        source = (
            pathlib.Path(__file__).resolve().parents[2] / "function_app.py"
        ).read_text(encoding="utf-8")
        weekly = source[source.index("def newsroom_weekly") - 900 : source.index("def newsroom_weekly")]

        assert "config.WEEKLY_SCHEDULE" in weekly
        assert "config.SCHEDULE" not in weekly

    def test_the_weekly_schedule_is_a_setting_not_a_constant(self):
        import pathlib

        source = (
            pathlib.Path(__file__).resolve().parents[2] / "pipeline" / "config.py"
        ).read_text(encoding="utf-8")

        assert 'WEEKLY_SCHEDULE = _setting("NEWSROOM_WEEKLY_SCHEDULE"' in source

    def test_infrastructure_supplies_it(self):
        """A setting the app reads and the template never sets falls back to a
        default forever, which is the same disconnected knob one layer down."""
        import pathlib

        bicep = (
            pathlib.Path(__file__).resolve().parents[3] / "infrastructure" / "main.bicep"
        ).read_text(encoding="utf-8")

        assert "NEWSROOM_WEEKLY_SCHEDULE" in bicep
        assert "param newsroomWeeklySchedule string" in bicep

    def test_the_host_interpolation_form_is_not_used(self):
        """`%NAME%` is resolved by the host, which has no default syntax, so a
        missing setting fails the trigger binding and the function never
        registers -- a silent dead timer."""
        import pathlib

        source = (
            pathlib.Path(__file__).resolve().parents[2] / "function_app.py"
        ).read_text(encoding="utf-8")

        assert "%NEWSROOM_WEEKLY_SCHEDULE%" not in source


class TestTheSectionMapMatchesProduction:
    """`sections_covered` is supplied to the writer as a quotable figure, so a
    metric falling through to the wrong beat is a wrong published number.

    A probe of the live ledger found `day_ahead_power_price`, `ghg_emissions`
    and `economic_sentiment` all landing in "economy" -- the map had been
    written against invented names rather than the ones production uses.
    """

    #: Every metric name seen in the live vintage ledger, and where it belongs.
    LIVE = {
        "port_goods_containers": "maritime",
        "port_goods_roro": "maritime",
        "port_goods_throughput": "maritime",
        "transport_services_balance": "trade",
        "ghg_emissions": "environment",
        "economic_sentiment": "economy",
        "day_ahead_power_price": "energy",
        "house_prices": "property",
        "unemployment_rate": "labour",
        "business_registrations": "business",
        "construction_output": "property",
    }

    def test_every_live_metric_lands_on_its_own_beat(self):
        from newsroom.pipeline.weekly import _section_of

        wrong = {
            metric: _section_of(figure("s", metric))
            for metric, expected in self.LIVE.items()
            if _section_of(figure("s", metric)) != expected
        }

        assert not wrong, f"these metrics land on the wrong beat: {wrong}"

    def test_an_unknown_metric_falls_back_rather_than_failing(self):
        from newsroom.pipeline.weekly import _section_of

        assert _section_of(figure("s", "something_new_entirely")) == "economy"


class TestTheWeekIsThePublicationWindowNotTheMeasurementPeriod:
    """The defect that stopped the first wrap being published.

    A dry run against the real corpus produced an article that passed all nine
    checks, took two attempts, was marked publishable, and said:

        "Baltic port goods throughput reached 6,149 thousand tonnes during the
         week of August 21 to August 27, 2026."

    That figure is 2025-Q4. The eight findings spanned nine months and five
    were attributed to the week they were PUBLISHED in. Every number was real,
    traced and correctly bound; only the period the prose attached it to was
    wrong, and nothing checked that.

    The model was not inventing. `signal.period` is the window and the prompt
    frames the piece as being about the signal's period -- the third time the
    writer has been blamed for doing what the guidance said, after the persona
    `closing_move` entries and the analyst's `what_to_watch`.

    So the check asserts the DISTINCTION rather than banning the word: a wrap
    may say the week is when we reported something, never when it was measured.
    """

    def _article(self, *texts, fields=()):
        """Blocks carry figures, because the check resolves them.

        A lexical version of this check could be tested with bare prose. This
        one answers "do the figures this sentence cites share a period?", so a
        block with no figures is correctly silent.
        """
        from newsroom.pipeline.models import Article, Block, Figure

        return Article(
            id="1", slug="s", tier="A", status="published",
            headline="The week in Baltic data",
            section="economy", created_at="2026-08-27T00:00:00Z", provenance={},
            body=[
                Block(
                    type="paragraph",
                    text=t,
                    figures=[Figure(value=1.0, signal_field=f) for f in fields],
                )
                for t in texts
            ],
        )

    def _mixed(self):
        """Two findings from different periods, which is the normal case."""
        return collect_week(
            [
                figure("a", "port_goods_throughput", geography="Baltic", period="2026-Q2"),
                figure("b", "economic_sentiment", geography="EE", period="2026-04"),
            ],
            now=NOW,
        )

    def test_the_live_failure_is_caught(self):
        corpus = self._mixed()
        article = self._article(
            "Baltic port goods throughput reached 6,149 thousand tonnes during "
            "the week of August 21 to August 27, 2026.",
            fields=[_field_name(corpus.figures[0])],
        )

        problems = period_problems(article, corpus)

        assert problems
        assert "publication window" in problems[0]

    def test_a_false_shared_period_claim_is_caught(self):
        """The sentence a lexical check let through.

        It knew "period" and "week" and not "quarter", so
        "…lower than Lithuania's 3233 thousand tonnes in the same quarter"
        passed while the two figures were from 2025-Q4 and 2026-Q1.
        """
        corpus = self._mixed()
        fields = [_field_name(f) for f in corpus.figures]
        article = self._article(
            "Baltic throughput was 6,149 thousand tonnes, lower than Estonia's "
            "89.7 index points in the same quarter.",
            fields=fields,
        )

        problems = period_problems(article, corpus)

        assert problems
        assert "the figures it cites are from" in problems[0]

    def test_a_true_shared_period_claim_is_allowed(self):
        """The other half. `prompts.py` REQUIRES "in the same period" for a
        related measure, and when the cited figures really do share one the
        phrase is true and must survive."""
        corpus = self._mixed()
        same = _field_name(corpus.figures[0])
        article = self._article(
            "Throughput was 6,149 thousand tonnes, against 6,000 in the same period.",
            fields=[same, same],
        )

        assert period_problems(article, corpus) == []

    def test_reporting_in_the_window_is_allowed(self):
        """The window doing its real job: saying why the reader is told now.

        Without this the check would ban the wrap's own premise, and the format
        could not describe itself.
        """
        corpus = self._mixed()
        article = self._article(
            "This week we reported a container record at Lithuania's ports.",
            "In the week to 27 August portaBaltica covered eight findings.",
        )

        assert period_problems(article, corpus) == []

    def test_naming_each_figures_own_period_is_allowed(self):
        corpus = self._mixed()
        article = self._article(
            "Baltic port goods throughput reached 6,149 thousand tonnes in 2026-Q2.",
            "Estonia's economic sentiment stood at 89.7 index points in 2026-04.",
            fields=[_field_name(corpus.figures[0])],
        )

        assert period_problems(article, corpus) == []

    def test_a_single_period_week_may_say_the_same_period(self):
        """When every finding really does report one period, the phrase is
        true and `prompts.py` requires it for a related measure."""
        corpus = collect_week(
            [
                figure("a", "port_goods_throughput", geography="Baltic"),
                figure("b", "economic_sentiment", geography="EE"),
            ],
            now=NOW,
        )
        article = self._article(
            "Economic sentiment stood at 89.7 index points in the same period."
        )

        assert len({f.period for f in corpus.figures}) == 1
        assert period_problems(article, corpus) == []


class TestCitesRecordsWhatWasUsed:
    """The first dry run cited eight articles and quoted five.

    Provenance claimed the piece drew on findings that never appear in it. That
    is a claim we cannot support -- and it has a second cost: a retraction
    elsewhere would send an operator to review a wrap that never used the
    withdrawn figure, and an alert that cries wolf gets ignored.
    """

    def _article_using(self, *fields):
        from newsroom.pipeline.models import Article, Block, Figure

        return Article(
            id="1", slug="s", tier="A", status="published",
            headline="The week in Baltic data",
            section="economy", created_at="2026-08-27T00:00:00Z", provenance={},
            body=[
                Block(
                    type="paragraph",
                    text="Something.",
                    figures=[Figure(value=1.0, signal_field=f) for f in fields],
                )
            ],
        )

    def test_only_the_quoted_articles_are_cited(self):
        corpus = collect_week(a_week(5), now=NOW)
        used = _field_name(corpus.figures[0])

        cites = cites_provenance(corpus, self._article_using(used))["cites"]

        assert cites == [corpus.figures[0].slug]

    def test_the_corpus_counts_are_not_mistaken_for_citations(self):
        """`findings_covered` belongs to no article."""
        corpus = collect_week(a_week(5), now=NOW)

        cites = cites_provenance(
            corpus, self._article_using("findings_covered", "sections_covered")
        )["cites"]

        assert cites == list(corpus.slugs), "fell back rather than citing nothing"

    def test_without_an_article_the_whole_corpus_is_recorded(self):
        corpus = collect_week(a_week(5), now=NOW)

        assert cites_provenance(corpus)["cites"] == list(corpus.slugs)


class TestTheWrapCanActuallyBeStored:
    """Every dry run stopped short of `store.put`, and the first real publish
    crashed on it: `TypeError: Object of type Persona is not JSON serializable`.

    `write_weekly` had been overriding the article's persona with the dominant
    beat's, passing the dataclass rather than the dict shape `Article.persona`
    holds. Nothing caught it because the checks all run on the in-memory
    article, and serialisation is the one step after them.

    So this asserts the article survives the round trip it is actually subject
    to, and that the byline agrees with the section rather than being bolted on
    afterwards.
    """

    async def _publish(self, tmp_path):
        """Through `write_weekly`, not `generate_article`.

        The distinction is the whole point. The bug lived in the step AFTER
        generation, so a test that stopped at `generate_article` passed on the
        broken code -- which is what the first version of this class did.
        """
        from newsroom.pipeline.vintage import VintageLedger, VintageStore
        from newsroom.pipeline.write import StubWriter
        from newsroom.pipeline.weekly import write_weekly

        store = ArticleStore(local_dir=tmp_path, account_url="")
        vintages = VintageStore(local_dir=tmp_path, account_url="")
        figures = a_week(5)
        await vintages.save(VintageLedger(figures))
        await _seed(store, [_stored(fig.slug) for fig in figures])
        payload = _wrap_payload(
            [
                {
                    "text": "Latvian house prices stood at 1.0%, against the same quarter a year earlier.",
                    "figures": [HOUSE],
                },
                {"text": "The data does not establish a common cause.", "figures": []},
            ]
        )
        # The writer answers twice: once for the article, once for the desk.
        # `write_weekly` runs the desk now, and a StubWriter that only knows
        # how to write an article leaves the editor with nothing to say.
        approve = {"decision": "approve", "reason": "runs as filed", "notes": []}
        outcome = await write_weekly(
            store,
            StubWriter([payload, approve, approve]),
            vintages=vintages,
            now=NOW,
        )
        return store, outcome

    @pytest.mark.anyio
    async def test_it_publishes_rather_than_crashing(self, tmp_path):
        """`store.put` raised `TypeError: Object of type Persona is not JSON
        serializable` on the first real publish."""
        _, outcome = await self._publish(tmp_path)

        assert outcome.outcome == "published", outcome.detail

    @pytest.mark.anyio
    async def test_the_stored_persona_is_a_dict(self, tmp_path):
        store, outcome = await self._publish(tmp_path)

        persona = (await store.read_published(outcome.slug))["persona"]
        assert isinstance(persona, dict)
        assert {"id", "name", "byline"} <= set(persona)

    @pytest.mark.anyio
    async def test_the_stored_byline_discloses_ai(self, tmp_path):
        """A persona attached by hand bypasses `render_byline`, which is what
        puts the disclosure there."""
        store, outcome = await self._publish(tmp_path)

        persona = (await store.read_published(outcome.slug))["persona"]
        assert "AI correspondent" in persona["byline"]

    @pytest.mark.anyio
    async def test_the_section_agrees_with_the_byline(self, tmp_path):
        """A maritime correspondent on a piece filed under economy is
        incoherent on the section pages and in the index."""
        store, outcome = await self._publish(tmp_path)

        document = await store.read_published(outcome.slug)
        assert document["section"] == dominant_section(
            collect_week(a_week(5), now=NOW)
        )


    @pytest.mark.anyio
    async def test_the_report_and_the_article_agree_on_citations(self, tmp_path):
        """The first published wrap reported eight citations and stored three.

        The outcome was built from what the corpus OFFERED while the article
        recorded what the prose USED, so the run report and the artefact
        disagreed about the same piece -- and the run report is what an
        operator reads when deciding whether a retraction elsewhere matters.
        """
        store, outcome = await self._publish(tmp_path)

        stored = (await store.read_published(outcome.slug))["provenance"]["cites"]

        assert list(outcome.cites) == list(stored)
        assert str(len(stored)) in outcome.detail


class TestTheWrapGoesPastTheDesk:
    """The format whose failure mode is being about the wrong thing was the one
    shipping without the component whose job is judgement.

    `write_weekly` called `generate_article` and stored. It never called the
    desk, so every wrap carried an empty `provenance.editor` while every other
    tier A article carried a decision, a reason and a named editor.

    Wiring it in is evidence-backed rather than assumed: run five times against
    the wrap that had to be retracted, the desk returned "revise" five times
    out of five and named the fault in its own words -- "the impact paragraph
    asserts a consequence that the data does not establish".
    """

    async def _run(self, tmp_path, *responses):
        from newsroom.pipeline.vintage import VintageLedger, VintageStore
        from newsroom.pipeline.write import StubWriter
        from newsroom.pipeline.weekly import write_weekly

        store = ArticleStore(local_dir=tmp_path, account_url="")
        vintages = VintageStore(local_dir=tmp_path, account_url="")
        figures = a_week(5)
        await vintages.save(VintageLedger(figures))
        await _seed(store, [_stored(f.slug) for f in figures])
        return store, await write_weekly(
            store, StubWriter(list(responses)), vintages=vintages, now=NOW
        )

    def _payload(self):
        return _wrap_payload(
            [
                {
                    "text": "Latvian house prices stood at 1.0%, against the same quarter a year earlier.",
                    "figures": [HOUSE],
                },
                {"text": "The data does not establish a common cause.", "figures": []},
            ]
        )

    @pytest.mark.anyio
    async def test_an_approved_wrap_records_the_decision(self, tmp_path):
        store, outcome = await self._run(
            tmp_path,
            self._payload(),
            {"decision": "approve", "reason": "runs as filed", "notes": []},
        )

        editor = (await store.read_published(outcome.slug))["provenance"]["editor"]
        assert editor["decision"] == "approve"
        assert editor["reason"]
        assert editor["editor"]

    @pytest.mark.anyio
    async def test_a_wrap_the_desk_refuses_is_not_published(self, tmp_path):
        """The point of the whole change. A reject must stop it, not annotate
        it -- and `write_weekly` must notice, because the desk stamps the
        article rather than raising."""
        store, outcome = await self._run(
            tmp_path,
            self._payload(),
            {"decision": "reject", "reason": "asserts a cause the data does not carry", "notes": []},
        )

        assert outcome.outcome == "draft_refused"
        assert "the desk did not approve it" in outcome.detail
        assert "asserts a cause" in outcome.detail

    @pytest.mark.anyio
    async def test_nothing_is_stored_when_the_desk_refuses(self, tmp_path):
        """A refused wrap must not reach storage or the index. Storing it and
        marking it rejected would leave the piece one status flip from the
        front page."""
        store, outcome = await self._run(
            tmp_path,
            self._payload(),
            {"decision": "reject", "reason": "no", "notes": []},
        )

        index = await store.read_json(ArticleStore.INDEX_BLOB)
        rows = index if isinstance(index, list) else (index or {}).get("articles") or []
        assert not any(r.get("slug", "").startswith("the-week") for r in rows)
        assert outcome.slug == ""

    @pytest.mark.anyio
    async def test_a_revise_that_cannot_be_satisfied_holds_the_piece(self, tmp_path):
        """A desk that says "revise" with nothing able to act on it turns every
        fixable fault into a spike -- six of eight articles in a live run,
        before `_revision_for` existed. The callback is supplied, but a
        revision that fails the gate still holds rather than publishes."""
        bad = _wrap_payload([{"text": "Nothing here.", "figures": []}])
        store, outcome = await self._run(
            tmp_path,
            self._payload(),
            {"decision": "revise", "reason": "thin", "notes": ["say more"]},
            bad,
            bad,
            bad,
            {"decision": "reject", "reason": "still thin", "notes": []},
        )

        assert outcome.outcome == "draft_refused"
