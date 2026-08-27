"""A link-out card is dated by its outlet, not by our timer.

WHAT THIS FIXES
---------------
``published_at`` on a syndicated card was left unset at build time and filled in
by the editor with its own decision time. Measured against the live index, that
produced a rail in which 105 of 154 cards claimed to have been published inside
the same two minutes — the moment the timer ran — and an ERR story from three
days earlier was dated tonight.

It was not only cosmetic. Stamping syndication with the run time made every
link-out newer than every article the newsroom had ever written, which is the
mechanism by which the rail was able to evict our own reporting from the index.
See test_index_reserves_our_work.py for the other half.
"""

from __future__ import annotations

from newsroom.pipeline.collect.rss import feed_published_at
from newsroom.pipeline.models import FeedItem
from newsroom.pipeline.safety import registry
from newsroom.pipeline.syndicate import build_card

RUN_TIME = "2026-08-25T22:34:00Z"


def item(published: str | None) -> FeedItem:
    return FeedItem(
        source_id="err_en",
        title="Estlink 1 undersea electricity cable to undergo maintenance this week",
        link="https://news.err.ee/1610118589/estlink-1",
        description="The cable will be out of service.",
        published=published,
        guid="err-1610118589",
        raw_blob="raw/err.xml",
    )


def card_for(published: str | None):
    return build_card(item(published), registry().get("err_en"), now=RUN_TIME)


class TestTheOutletsDateIsUsed:
    def test_an_rfc_2822_feed_date_is_carried_through(self) -> None:
        # The shape ERR and LSM actually send.
        card = card_for("Tue, 25 Aug 2026 09:55:00 +0300")

        assert card.published_at == "2026-08-25T06:55:00Z"
        assert card.published_at != RUN_TIME, "the card was dated by our timer"

    def test_an_iso_feed_date_is_carried_through(self) -> None:
        card = card_for("2026-08-23T08:18:00Z")

        assert card.published_at == "2026-08-23T08:18:00Z"

    def test_a_three_day_old_story_is_not_dated_tonight(self) -> None:
        card = card_for("Sun, 23 Aug 2026 08:18:00 GMT")

        assert card.published_at is not None
        assert card.published_at.startswith("2026-08-23"), (
            "a story the outlet published on the 23rd must not appear in the rail "
            "as published during tonight's run"
        )

    def test_our_own_retrieval_time_is_still_recorded(self) -> None:
        # The outlet's date replaces ours in published_at; it does not erase the
        # fact of when we fetched it.
        card = card_for("Tue, 25 Aug 2026 09:55:00 +0300")

        assert card.created_at == RUN_TIME
        assert card.provenance["sources"][0]["retrieved_at"] == RUN_TIME


class TestAnUnreadableDateIsRefusedRatherThanGuessed:
    def test_a_missing_date_leaves_it_unset(self) -> None:
        assert card_for(None).published_at is None

    def test_an_unparseable_date_leaves_it_unset(self) -> None:
        assert card_for("last Thursday-ish").published_at is None

    def test_the_editor_then_supplies_one_so_the_card_can_still_publish(self) -> None:
        from newsroom.pipeline.editor import EditorAction, EditorOutcome, _apply_outcome

        card = card_for(None)
        outcome = EditorOutcome(
            article_id=card.id,
            action=EditorAction.APPROVE,
            reason="Routine Baltic item.",
            editor="Dace Saulkrasti",
            decided_at=RUN_TIME,
        )
        _apply_outcome(card, outcome)

        assert card.published_at == RUN_TIME, (
            "a card with no readable date must still get one, or it sorts to the "
            "bottom of the index forever"
        )

    def test_the_editor_does_not_overwrite_a_date_it_did_not_set(self) -> None:
        from newsroom.pipeline.editor import EditorAction, EditorOutcome, _apply_outcome

        card = card_for("Tue, 25 Aug 2026 09:55:00 +0300")
        _apply_outcome(
            card,
            EditorOutcome(
                article_id=card.id,
                action=EditorAction.APPROVE,
                reason="Routine.",
                editor="Dace Saulkrasti",
                decided_at=RUN_TIME,
            ),
        )

        assert card.published_at == "2026-08-25T06:55:00Z"
        assert card.provenance["approved_at"] == RUN_TIME


class TestTheParser:
    def test_it_normalises_to_the_schema_shape(self) -> None:
        # The schema's date-time wants a Z suffix, not +00:00.
        assert feed_published_at("Tue, 25 Aug 2026 09:55:00 +0300").endswith("Z")

    def test_a_naive_timestamp_is_read_as_utc(self) -> None:
        assert feed_published_at("2026-08-25T09:55:00") == "2026-08-25T09:55:00Z"

    def test_rubbish_is_refused(self) -> None:
        for value in ("", None, "not a date", "2026-13-45T99:99:99Z"):
            assert feed_published_at(value) is None

