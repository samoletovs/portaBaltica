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
) -> PublishedFigure:
    return PublishedFigure(
        metric=metric,
        metric_label=metric.replace("_", " "),
        geography=geography,
        period="2026-Q2",
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


HOUSE = {"value": 1.0, "unit": "%", "signal_field": "house_prices_lv"}
JOBS = {"value": 2.0, "unit": "%", "signal_field": "unemployment_rate_ee"}


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
