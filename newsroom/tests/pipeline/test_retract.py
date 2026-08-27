"""Withdrawing an article the newsroom got wrong.

Five of twenty tier A articles were published from the wrong Eurostat cube: a
cache keyed on the URL served six balance-of-payments series and one business
series somebody else's payload. Every gate passed them, because every figure
was a real number correctly traced to its signal — the signal was built from
the wrong table.

This is the machinery for saying so publicly. The corrections policy is the
specification and it is quoted where it decides something.
"""

from __future__ import annotations

import json

import pytest

from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.vintage import PublishedFigure, VintageLedger, VintageStore
from newsroom.pipeline.retract import (
    retract,
    retract_all,
    retraction_note,
    suppression_keys,
)

REASON = (
    "A caching fault served six balance-of-payments series the aggregate "
    "Baltic trade balance, so this article reports a metric it never measured"
)


def _published(slug: str, headline: str, finding: str = "m|Baltic|2026-Q1") -> dict:
    return {
        "id": "01J0",
        "slug": slug,
        "tier": "A",
        "status": "published",
        "headline": headline,
        "section": "trade",
        "created_at": "2026-08-26T14:00:00Z",
        "published_at": "2026-08-26T14:00:00Z",
        "body": [{"type": "paragraph", "text": "The balance widened."}],
        "provenance": {
            "validator": {"passed": True, "checks": []},
            "signal_finding": finding,
        },
    }


class TestTheNoticeSaysWhatWentWrong:
    def test_it_names_the_fault_rather_than_reporting_that_one_occurred(self):
        note = retraction_note(REASON)

        assert "caching fault" in note["description"]
        assert "RETRACTED" in note["description"]

    def test_it_tells_the_reader_the_page_is_deliberately_still_here(self):
        """The policy: "The page stays up, showing why. We do not delete the
        evidence." A reader arriving from the corrections log needs to know
        they are looking at a withdrawn article on purpose."""
        note = retraction_note(REASON)

        assert "remains here" in note["description"]
        assert "No figure in it should be relied on" in note["description"]

    def test_it_does_not_claim_the_source_revised_anything(self):
        """``revisions.py`` says "a restatement by the source, not a reporting
        error", which is true for a revision and a lie for this. Using that
        machinery here would be a second error wearing a correction's clothes.
        """
        note = retraction_note(REASON)

        assert "revised" not in note["description"]
        assert "Statistical agencies" not in note["description"]


class TestRetraction:
    @pytest.mark.anyio
    async def test_it_marks_the_article_and_keeps_the_prose(self, tmp_path):
        """Append-only. We do not quietly replace the text."""
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await store.write_published("a", _published("a", "Baltic goods balance widens"))

        document = await retract(store, "a", reason=REASON)

        assert document is not None
        assert document["status"] == "retracted"
        assert document["body"][0]["text"] == "The balance widened."
        assert len(document["corrections"]) == 1

    @pytest.mark.anyio
    async def test_a_retracted_article_is_no_longer_servable(self, tmp_path):
        from newsroom.pipeline.models import Article

        store = ArticleStore(local_dir=tmp_path, account_url="")
        await store.write_published("a", _published("a", "Baltic goods balance widens"))
        await retract(store, "a", reason=REASON)

        stored = await store.read_published("a")
        assert stored is not None
        article = Article(
            id="1", slug="a", tier="A", status=stored["status"],
            headline=stored["headline"], section="trade",
            created_at=stored["created_at"], provenance=stored["provenance"],
        )
        from newsroom.pipeline.publish import is_servable

        assert not is_servable(article)

    def test_but_it_keeps_its_reader_facing_url(self):
        """The policy promises the page stays up.

        A status-prefixed path would 404 the very page a reader follows a
        correction notice to reach, which is the opposite of not deleting the
        evidence.
        """
        from newsroom.pipeline.models import Article

        article = Article(
            id="1", slug="baltic-goods-balance", tier="A", status="retracted",
            headline="Baltic goods balance widens", section="trade",
            created_at="2026-08-26T14:00:00Z", provenance={},
        )

        assert ArticleStore.blob_name_for(article) == "baltic-goods-balance.json"

    @pytest.mark.anyio
    async def test_it_appends_to_the_public_corrections_log(self, tmp_path):
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await store.write_published("a", _published("a", "Baltic goods balance widens"))

        await retract(store, "a", reason=REASON)

        log = json.loads(
            (tmp_path / ArticleStore.CORRECTIONS_BLOB).read_text(encoding="utf-8")
        )
        assert len(log) == 1
        assert log[0]["slug"] == "a"
        assert "caching fault" in log[0]["description"]

    @pytest.mark.anyio
    async def test_retracting_twice_does_not_double_the_notice(self, tmp_path):
        """An operator must be able to re-run a batch without multiplying
        notices on the page."""
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await store.write_published("a", _published("a", "Baltic goods balance widens"))

        await retract(store, "a", reason=REASON)
        again = await retract(store, "a", reason=REASON)

        assert again is not None
        assert len(again["corrections"]) == 1

    @pytest.mark.anyio
    async def test_an_unknown_slug_is_refused_rather_than_invented(self, tmp_path):
        store = ArticleStore(local_dir=tmp_path, account_url="")

        assert await retract(store, "nope", reason=REASON) is None


class TestTheIndexLetsGoOfIt:
    """The step that is easy to forget, and the one that matters most.

    ``write_index`` MERGES the existing index with the current run's articles,
    keyed on slug — so an article that stops being servable does not leave the
    index by itself. Left there, a retracted story stays on the front page and
    in the feed, and its ``signal_finding`` goes on suppressing the corrected
    version: the newsroom would withdraw a wrong article and then refuse to
    replace it.
    """

    @pytest.mark.anyio
    async def test_retract_all_removes_them_from_the_front_page(self, tmp_path):
        store = ArticleStore(local_dir=tmp_path, account_url="")
        (tmp_path / "index.json").write_text(
            json.dumps({"articles": [
                {"slug": "a", "signal_finding": "goods|Baltic|2026-Q1"},
                {"slug": "keep", "signal_finding": "other|Baltic|2026-Q1"},
            ]}),
            encoding="utf-8",
        )
        await store.write_published("a", _published("a", "Baltic goods balance widens"))

        await retract_all(store, ["a"], reason=REASON)

        index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
        assert [e["slug"] for e in index["articles"]] == ["keep"]

    @pytest.mark.anyio
    async def test_and_so_the_corrected_article_is_no_longer_suppressed(self, tmp_path):
        """The whole point. Ranking reads ``signal_finding`` out of the index."""
        store = ArticleStore(local_dir=tmp_path, account_url="")
        (tmp_path / "index.json").write_text(
            json.dumps({"articles": [
                {"slug": "a", "signal_finding": "goods_balance|Baltic|2026-Q1"},
            ]}),
            encoding="utf-8",
        )
        await store.write_published(
            "a", _published("a", "Baltic goods balance widens", "goods_balance|Baltic|2026-Q1")
        )
        assert await store.published_findings() == {"goods_balance|Baltic|2026-Q1"}

        await retract_all(store, ["a"], reason=REASON)

        assert await store.published_findings() == set(), (
            "the retracted finding still suppresses, so the corrected article "
            "can never be written"
        )

    def test_suppression_keys_reads_the_finding_off_the_document(self):
        keys = suppression_keys([_published("a", "h", "goods_balance|Baltic|2026-Q1")])

        assert keys == ["goods_balance|Baltic|2026-Q1"]

    def test_a_document_without_a_finding_contributes_nothing(self):
        """Articles published before the field existed carry none."""
        document = _published("a", "h")
        document["provenance"].pop("signal_finding")

        assert suppression_keys([document]) == []


# ─────────────────────────────────────────────────────────────────────────────
# The second-order failure, which is nastier than the first.
#
# Fixing the cache collision made the collector read the correct series for the
# first time. The vintage ledger still held the COLLIDED value, so the revision
# watch compared 130.9 against the true 120.3, found a difference, and filed a
# public note saying Eurostat had revised a figure it never published.
#
# Any system that remembers what it previously believed and compares that to
# what it now sees will do this after any correctness fix. It is not specific to
# caching, so the guard is not either.
# ─────────────────────────────────────────────────────────────────────────────


def _figure(slug: str, metric: str, value: float, period: str = "2026-Q1") -> PublishedFigure:
    return PublishedFigure(
        metric=metric,
        metric_label=metric.replace("_", " "),
        geography="Baltic",
        period=period,
        value=value,
        unit="million EUR",
        slug=slug,
        article_id="01J0",
        headline="h",
        observed_at="2026-08-26T14:00:00Z",
        published_at="2026-08-26T14:00:00Z",
    )


class TestTheLedgerLetsGoOfIt:
    def test_forget_drops_every_figure_belonging_to_the_article(self):
        ledger = VintageLedger(
            [
                _figure("wrong", "goods_balance", 1088.6),
                _figure("wrong", "goods_balance", 1088.6, period="2025-Q4"),
                _figure("kept", "house_prices", 10.9),
            ]
        )

        assert ledger.forget(["wrong"]) == 2
        assert [f.slug for f in ledger] == ["kept"]

    def test_forgetting_an_unknown_slug_changes_nothing(self):
        ledger = VintageLedger([_figure("kept", "house_prices", 10.9)])

        assert ledger.forget(["never-published"]) == 0
        assert len(ledger) == 1

    @pytest.mark.anyio
    async def test_retract_all_makes_the_ledger_forget(self, tmp_path):
        """The load-bearing one.

        Without this, the newsroom withdraws an article and the ledger keeps
        generating claims from its remembered value — so tomorrow's run files a
        correction against a story we already retracted, asserting that the
        statistical office restated a number it never published.
        """
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await store.write_published("wrong", _published("wrong", "Baltic goods balance widens"))

        vintages = VintageStore(local_dir=tmp_path, account_url="")
        await vintages.save(VintageLedger([_figure("wrong", "goods_balance", 1088.6)]))

        await retract_all(store, ["wrong"], reason=REASON, vintages=vintages)

        assert len(await vintages.load()) == 0, (
            "the retracted article's figure is still in the ledger, so the "
            "revision watch will keep reporting it as a source restatement"
        )


class TestWithdrawingOurOwnBadCorrection:
    def test_the_note_can_supersede_an_earlier_one(self):
        note = retraction_note(
            REASON,
            withdraws="this figure had been revised down to 120.3 by the source",
        )

        assert "withdraws an earlier note" in note["description"]
        assert "That note was wrong" in note["description"]

    def test_it_says_the_office_published_no_such_revision(self):
        """The false note accused a third party of restating data. Naming that
        plainly is the whole point: "an error occurred" asks for trust, and
        saying which claim was wrong and about whom earns it."""
        note = retraction_note(REASON, withdraws="the source revised it")

        assert "published no such revision" in note["description"]

    def test_without_withdraws_the_note_is_unchanged(self):
        """A retraction that supersedes nothing must not mention one."""
        note = retraction_note(REASON)

        assert "earlier note" not in note["description"]

    @pytest.mark.anyio
    async def test_the_superseding_note_reaches_the_public_log(self, tmp_path):
        store = ArticleStore(local_dir=tmp_path, account_url="")
        await store.write_published("wrong", _published("wrong", "Bankruptcies spike"))

        await retract_all(
            store,
            ["wrong"],
            reason=REASON,
            vintages=VintageStore(local_dir=tmp_path, account_url=""),
            withdraws={"wrong": "the source revised it down to 120.3"},
        )

        log = json.loads((tmp_path / ArticleStore.CORRECTIONS_BLOB).read_text(encoding="utf-8"))
        assert len(log) == 1
        assert "published no such revision" in log[0]["description"]
