"""Two ways syndication rejected itself in production, found by running it.

A live run on 2026-08-26 published 104 syndicated cards and rejected these:

    ec_presscorner card rejected: snippet_verbatim:
      syndicated.snippet_is_verbatim is not true;
      the ingester did not assert verbatim copy                        (x3)

    euobserver card rejected: no_rewrite_of_restricted_source:
      headline '...(Ukraine Battlefield up' does not byte-match the
      feed title '...(Ukraine Battlefield update, Day 1,643)'          (x2)

Neither is a content judgement. Both are the pipeline refusing its own output.

1. ``build_card`` sets ``snippet_is_verbatim`` only on the tier C branch, while
   ``check_snippet_verbatim`` requires it for any syndicated block. So *every*
   tier B press release is rejected, always, and the licensed-reproduction tier
   has never published anything.

2. ``build_card`` truncates the headline to the schema's 140 characters and the
   validator then byte-compares it against the outlet's feed title. For any
   headline longer than 140 characters those two rules cannot both hold, so the
   card is guaranteed to fail. EUobserver runs a numbered daily series whose
   headlines are reliably longer than that.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline.models import FeedItem
from newsroom.pipeline.safety import registry
from newsroom.pipeline.syndicate import build_card, syndicate
from newsroom.pipeline.safety import validate

RUN_TIME = "2026-08-26T10:57:00Z"

LONG_TITLE = (
    "Russian forces in Donetsk salient are at risk of being cut off, after daring "
    "Ukrainian manoeuvre on independence day (Ukraine Battlefield update, Day 1,643)"
)


def feed_item(source_id: str, title: str, description: str, guid: str = "g1") -> FeedItem:
    return FeedItem(
        source_id=source_id,
        title=title,
        link="https://example.invalid/story",
        description=description,
        published="Tue, 25 Aug 2026 09:55:00 +0300",
        guid=guid,
        raw_blob="raw/feed.xml",
    )


class TestTierBPressReleasesCanPublish:
    """The licensed tier had a 100% rejection rate in production."""

    def test_a_tier_b_card_asserts_verbatim_reproduction(self) -> None:
        source = registry().get("ec_presscorner")
        assert source.tier == "B", "fixture assumes ec_presscorner is tier B"

        card = build_card(
            feed_item("ec_presscorner", "Commission adopts the 2027 work programme", "Body text."),
            source,
            now=RUN_TIME,
        )

        assert card is not None
        assert card.syndicated["snippet_is_verbatim"] is True, (
            "build_card sets this only on the tier C branch, so check_snippet_verbatim "
            "rejects every tier B press release the newsroom has ever built"
        )

    def test_a_tier_b_card_passes_the_validator(self) -> None:
        source = registry().get("ec_presscorner")
        item = feed_item("ec_presscorner", "Commission adopts the 2027 work programme", "Body text.")
        card = build_card(item, source, now=RUN_TIME)

        verdict = validate(
            card.to_json(),
            raw_feed_item={"title": item.title, "description": item.description},
        )

        snippet_check = next(c for c in verdict.checks if c.name == "snippet_verbatim")
        assert snippet_check.passed, snippet_check.detail

    def test_tier_b_still_reproduces_into_full_text_not_snippet(self) -> None:
        # The flag must not be bought by turning a licensed press release into a
        # tier C snippet; the tiers mean different things.
        source = registry().get("ec_presscorner")
        card = build_card(
            feed_item("ec_presscorner", "Commission adopts the 2027 work programme", "Body text."),
            source,
            now=RUN_TIME,
        )

        assert card.syndicated.get("full_text") == "Body text."
        assert "snippet" not in card.syndicated


class TestALongHeadlineIsNotTruncatedIntoARewrite:
    """Truncating an outlet's headline and then claiming it is verbatim."""

    def test_the_headline_is_reproduced_whole(self) -> None:
        source = registry().get("euobserver")
        item = feed_item("euobserver", LONG_TITLE, "A snippet.")

        card = build_card(item, source, now=RUN_TIME)

        assert card is not None
        assert card.headline == LONG_TITLE, (
            "the headline was truncated, so the byte-match against the feed title "
            "cannot succeed and the card is rejected every time"
        )

    def test_a_long_headline_card_passes_the_validator(self) -> None:
        source = registry().get("euobserver")
        item = feed_item("euobserver", LONG_TITLE, "A snippet.")
        card = build_card(item, source, now=RUN_TIME)

        verdict = validate(
            card.to_json(),
            raw_feed_item={"title": item.title, "description": item.description},
        )

        rewrite_check = next(
            c for c in verdict.checks if c.name == "no_rewrite_of_restricted_source"
        )
        assert rewrite_check.passed, rewrite_check.detail

    def test_the_schema_accepts_a_real_outlet_headline(self) -> None:
        source = registry().get("euobserver")
        item = feed_item("euobserver", LONG_TITLE, "A snippet.")
        card = build_card(item, source, now=RUN_TIME)

        verdict = validate(
            card.to_json(),
            raw_feed_item={"title": item.title, "description": item.description},
        )

        assert verdict.passed, verdict.failure_summary()

    def test_a_headline_too_short_for_the_schema_is_still_dropped(self) -> None:
        source = registry().get("euobserver")

        assert build_card(feed_item("euobserver", "Short", "A snippet."), source, now=RUN_TIME) is None

    @pytest.mark.parametrize("length", [141, 200, 400])
    def test_headlines_of_any_realistic_length_survive(self, length: int) -> None:
        source = registry().get("euobserver")
        title = "Baltic " + "x" * (length - 7)
        item = feed_item("euobserver", title, "A snippet.")

        card = build_card(item, source, now=RUN_TIME)

        assert card is not None, f"a {length}-character headline was dropped entirely"
        assert card.headline == title


class TestTheWholeSyndicationPassSurvives:
    def test_a_mixed_batch_publishes_rather_than_rejecting_itself(self) -> None:
        items = [
            feed_item("ec_presscorner", "Commission adopts the 2027 work programme", "Body.", "a"),
            feed_item("euobserver", LONG_TITLE, "A snippet.", "b"),
        ]
        raw = {i.guid: i.description for i in items}

        cards = syndicate(items, raw_descriptions=raw, now=RUN_TIME)

        rejected = [c for c in cards if c.status == "rejected"]
        assert not rejected, (
            "cards rejected: "
            + "; ".join(
                f"{c.syndicated['source_id']}: "
                f"{c.provenance['validator'].get('failure_summary') or c.provenance['validator']}"
                for c in rejected
            )
        )

