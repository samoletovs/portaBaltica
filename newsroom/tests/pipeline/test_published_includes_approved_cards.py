"""Approved syndicated cards must reach the reader, not just storage.

The editor agent approved 99 tier B/C cards in one production run.
`_store_all` wrote all 99 to Blob storage. The front page went on saying
"Nothing filed here right now", and the index reported one article.

`RunReport.published` — the list `write_index` is built from — only ever
looked at tier A generations, so a card could be validated, approved, stamped
`status = "published"` and written to storage while remaining invisible to
every reader. Storing is not publishing; the index is the only thing that
makes an article findable.

These tests assert the reader-visible outcome rather than the plumbing: an
approved card appears, and a card that was rejected, escalated or left
pending does not.
"""

from __future__ import annotations

from typing import Any

from newsroom.pipeline.models import Article
from newsroom.pipeline.run import RunReport


def card(slug: str, *, status: str, passed: bool = True) -> Article:
    return Article(
        id=slug.upper().replace("-", "")[:26].ljust(26, "X"),
        slug=slug,
        tier="C",
        status=status,
        section="government",
        headline=f"Headline for {slug}",
        dek=None,
        body=[],
        created_at="2026-08-24T10:00:00Z",
        published_at="2026-08-24T10:00:00Z" if status == "published" else None,
        provenance={
            "sources": [{"source_id": "lsm_en", "retrieved_at": "2026-08-24T10:00:00Z"}],
            "validator": {"passed": passed, "checked_at": "2026-08-24T10:00:00Z", "checks": []},
        },
        syndicated={"snippet": "The outlet's own words.", "url": "https://example.org/a"},
    )


def slugs(articles: list[Article]) -> set[str]:
    return {a.slug for a in articles}


class TestApprovedCardsAreFindable:
    def test_an_approved_card_is_in_the_index(self) -> None:
        """The exact production regression: approved, stored, invisible."""
        report = RunReport()
        report.syndicated = [card("approved-card", status="published")]

        assert "approved-card" in slugs(report.published)

    def test_a_pending_card_is_not_published(self) -> None:
        report = RunReport()
        report.syndicated = [card("waiting-card", status="pending_approval")]

        assert report.published == []

    def test_a_rejected_card_is_not_published(self) -> None:
        report = RunReport()
        report.syndicated = [card("rejected-card", status="rejected")]

        assert report.published == []

    def test_a_card_without_a_passing_verdict_is_never_published(self) -> None:
        """Defence in depth against the editor, not against the syndicator.

        If a bug ever set `status = "published"` on a card whose validator
        verdict failed, this is the layer that still refuses to make it
        findable.
        """
        report = RunReport()
        report.syndicated = [card("unvalidated-card", status="published", passed=False)]

        assert report.published == []

    def test_tier_a_articles_are_still_published(self) -> None:
        # The change adds a source of published items; it must not remove one.
        from newsroom.pipeline.write.generator import GenerationResult

        class PassingVerdict:
            passed = True

        article: Any = card("data-story", status="published")
        article.tier = "A"
        report = RunReport()
        report.generated = [
            GenerationResult(
                signal=None,  # type: ignore[arg-type]
                article=article,
                verdict=PassingVerdict(),  # type: ignore[arg-type]
            )
        ]

        assert "data-story" in slugs(report.published)
