"""Tier B/C syndication tests."""

from __future__ import annotations

from newsroom.pipeline.models import FeedItem
from newsroom.pipeline.safety import registry
from newsroom.pipeline.syndicate import (
    build_card,
    is_baltic_relevant,
    pending_approval_queue,
    syndicate,
)

SNIPPET = "Latvia's parliament approved the budget in a late-night sitting."


def feed_item(source_id: str = "lsm_en", **overrides) -> FeedItem:
    defaults = dict(
        source_id=source_id,
        title="Saeima approves the 2027 budget after a long debate",
        link="https://eng.lsm.lv/article/1",
        description=SNIPPET,
        published="Mon, 24 Aug 2026 08:00:00 +0000",
        guid="lsm-1",
        raw_blob="2026-08-24/lsm_en/x.raw",
    )
    defaults.update(overrides)
    return FeedItem(**defaults)  # type: ignore[arg-type]


class TestTierC:
    def test_should_reproduce_the_snippet_byte_for_byte(self):
        cards = syndicate([feed_item()], raw_descriptions={"lsm-1": SNIPPET})

        assert len(cards) == 1
        card = cards[0]
        assert card.syndicated["snippet"] == SNIPPET
        assert card.syndicated["snippet_is_verbatim"] is True
        assert card.provenance["validator"]["passed"] is True

    def test_should_route_to_pending_approval_not_published(self):
        cards = syndicate([feed_item()], raw_descriptions={"lsm-1": SNIPPET})

        assert cards[0].status == "pending_approval"

    def test_should_never_carry_a_correspondent_byline(self):
        cards = syndicate([feed_item()], raw_descriptions={"lsm-1": SNIPPET})

        assert cards[0].persona is None

    def test_should_never_carry_generated_prose(self):
        cards = syndicate([feed_item()], raw_descriptions={"lsm-1": SNIPPET})

        assert cards[0].body == []

    def test_should_reject_a_card_whose_snippet_cannot_be_verified(self):
        cards = syndicate([feed_item()], raw_descriptions={})

        assert cards[0].status == "rejected"

    def test_should_reject_a_card_whose_snippet_drifted_from_the_archive(self):
        cards = syndicate([feed_item()], raw_descriptions={"lsm-1": "Something else entirely."})

        assert cards[0].status == "rejected"

    def test_should_carry_the_registry_attribution(self):
        cards = syndicate([feed_item()], raw_descriptions={"lsm-1": SNIPPET})

        assert cards[0].syndicated["attribution"] == registry().get("lsm_en").attribution

    def test_should_drop_a_headline_too_short_for_the_schema(self):
        cards = syndicate([feed_item(title="Brief")], raw_descriptions={"lsm-1": SNIPPET})

        assert cards == []


class TestTierB:
    def test_should_store_licensed_material_as_full_text(self):
        item = feed_item(
            source_id="ec_presscorner",
            title="Commission approves Baltic energy interconnection support",
            link="https://ec.europa.eu/item/1",
            description="The Commission today approved support for Latvia and Estonia.",
            guid="ec-1",
        )

        cards = syndicate([item])

        assert len(cards) == 1
        assert cards[0].tier == "B"
        assert cards[0].syndicated["full_text"].startswith("The Commission today approved")
        assert "snippet" not in cards[0].syndicated

    def test_should_filter_eu_material_without_baltic_relevance(self):
        item = feed_item(
            source_id="ec_presscorner",
            title="Commission adopts a directive on Iberian rail interoperability",
            description="A measure concerning Spain and Portugal only.",
            guid="ec-2",
        )

        assert syndicate([item]) == []

    def test_should_keep_eu_material_that_mentions_a_baltic_state(self):
        item = feed_item(
            source_id="ec_presscorner",
            title="Commission adopts a directive affecting Lithuania",
            description="A measure concerning Lithuania.",
            guid="ec-3",
        )

        assert len(syndicate([item])) == 1


class TestRelevanceFilter:
    def test_should_match_on_a_country_name(self):
        assert is_baltic_relevant(feed_item(description="A measure concerning Estonia."))

    def test_should_match_on_a_capital_city(self):
        assert is_baltic_relevant(feed_item(title="New route to Tallinn", description=""))

    def test_should_not_match_unrelated_material(self):
        assert not is_baltic_relevant(
            feed_item(title="Rail interoperability in Iberia", description="Spain and Portugal.")
        )


class TestApprovalHandoff:
    def test_should_expose_exactly_what_an_approver_needs(self):
        cards = syndicate([feed_item()], raw_descriptions={"lsm-1": SNIPPET})

        queue = pending_approval_queue(cards)

        assert len(queue) == 1
        entry = queue[0]
        assert entry["text_to_reproduce"] == SNIPPET
        assert entry["original_url"] == "https://eng.lsm.lv/article/1"
        assert entry["attribution"] == "LSM.lv English"
        assert entry["actions"] == ["approve", "reject"]

    def test_should_not_offer_editing_because_editing_is_rewriting(self):
        cards = syndicate([feed_item()], raw_descriptions={"lsm-1": SNIPPET})

        assert pending_approval_queue(cards)[0]["editing_permitted"] is False

    def test_should_omit_rejected_cards_from_the_queue(self):
        cards = syndicate([feed_item()], raw_descriptions={})

        assert pending_approval_queue(cards) == []


class TestRegistryEnforcement:
    def test_tier_a_items_are_not_syndicated(self):
        assert syndicate([feed_item(source_id="eurostat")]) == []

    def test_building_a_card_for_a_tier_a_source_raises(self):
        import pytest

        with pytest.raises(ValueError, match="not syndicated material"):
            build_card(feed_item(source_id="eurostat"), registry().get("eurostat"))

    def test_every_tier_c_source_forbids_rewriting(self):
        for source in registry().by_tier("C"):
            assert source.rewrite_allowed is False, source.id

    def test_an_unregistered_source_is_dropped(self):
        from newsroom.pipeline.safety import UnregisteredSourceError
        import pytest

        with pytest.raises(UnregisteredSourceError):
            syndicate([feed_item(source_id="some_scraped_blog")])
