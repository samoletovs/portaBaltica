"""Source registry: the registry must refuse to load a loosened contract.

The registry is where ``rewrite_allowed`` stops being a convention. Most of
these tests are malformed registries that must be rejected at load time, because
a misconfiguration that loads successfully is a misconfiguration that ships.
"""

from __future__ import annotations

from typing import Any

import pytest

from newsroom.source_registry import (
    InvalidRegistryError,
    SourceRegistry,
    UnregisteredSourceError,
)


def _document(**overrides: Any) -> dict[str, Any]:
    """A minimal valid registry, with one entry that tests mutate."""
    entry: dict[str, Any] = {
        "id": "example_feed",
        "name": "Example Feed",
        "publisher": "Example Publisher",
        "tier": "C",
        "endpoint": "https://example.org/rss",
        "licence": "Copyright. RSS snippet + link only.",
        "attribution": "Example Feed",
        "rewrite_allowed": False,
        "requires_human_approval": True,
        "max_snippet_source": "rss_description_verbatim",
    }
    entry.update(overrides)
    return {
        "version": 1,
        "defaults": {"rewrite_allowed": False, "requires_human_approval": True},
        "sources": [entry],
    }


# ── the contract the registry refuses to load without ───────────────────


def test_should_reject_a_tier_c_source_that_permits_rewriting() -> None:
    with pytest.raises(InvalidRegistryError, match="may never be rewritten"):
        SourceRegistry.from_mapping(_document(rewrite_allowed=True))


def test_should_reject_a_tier_b_source_that_permits_rewriting() -> None:
    with pytest.raises(InvalidRegistryError, match="may never be rewritten"):
        SourceRegistry.from_mapping(
            _document(tier="B", rewrite_allowed=True, max_snippet_source=None)
        )


def test_should_reject_rewrite_allowed_written_as_a_string() -> None:
    # "false" is truthy in Python. Accepting it would turn a YAML quoting typo
    # into permission to rewrite a copyrighted feed.
    with pytest.raises(InvalidRegistryError, match="must be a boolean"):
        SourceRegistry.from_mapping(_document(rewrite_allowed="false"))


def test_should_reject_a_tier_c_source_that_does_not_pin_the_snippet_source() -> None:
    with pytest.raises(InvalidRegistryError, match="rss_description_verbatim"):
        SourceRegistry.from_mapping(_document(max_snippet_source=None))


def test_should_reject_a_tier_c_source_that_snippets_the_article_body() -> None:
    with pytest.raises(InvalidRegistryError, match="rss_description_verbatim"):
        SourceRegistry.from_mapping(_document(max_snippet_source="content_encoded"))


def test_should_reject_an_unknown_tier() -> None:
    with pytest.raises(InvalidRegistryError, match="tier must be one of"):
        SourceRegistry.from_mapping(_document(tier="D"))


def test_should_reject_a_source_with_no_attribution() -> None:
    with pytest.raises(InvalidRegistryError, match="`attribution` is required"):
        SourceRegistry.from_mapping(_document(attribution=""))


def test_should_reject_a_source_with_no_licence() -> None:
    with pytest.raises(InvalidRegistryError, match="`licence` is required"):
        SourceRegistry.from_mapping(_document(licence=None))


def test_should_reject_duplicate_source_ids() -> None:
    document = _document()
    document["sources"].append(dict(document["sources"][0]))

    with pytest.raises(InvalidRegistryError, match="duplicate source id"):
        SourceRegistry.from_mapping(document)


def test_should_reject_an_empty_registry() -> None:
    with pytest.raises(InvalidRegistryError, match="non-empty `sources`"):
        SourceRegistry.from_mapping({"version": 1, "sources": []})


def test_should_reject_a_registry_with_no_version() -> None:
    document = _document()
    del document["version"]

    with pytest.raises(InvalidRegistryError, match="integer `version`"):
        SourceRegistry.from_mapping(document)


def test_should_reject_a_source_listed_as_both_active_and_unavailable() -> None:
    document = _document()
    document["unavailable"] = [{"id": "example_feed", "name": "Example", "reason": "n/a"}]

    with pytest.raises(InvalidRegistryError, match="both as an active source"):
        SourceRegistry.from_mapping(document)


# ── lookups fail closed ─────────────────────────────────────────────────


def test_should_raise_rather_than_return_false_for_an_unregistered_source(
    registry: SourceRegistry,
) -> None:
    # Returning False would let unregistered content pass the other checks by
    # merely looking un-rewritable.
    with pytest.raises(UnregisteredSourceError, match="not in the registry"):
        registry.rewrite_allowed("some_scraped_blog")


def test_should_raise_with_the_reason_for_a_known_unavailable_source(
    registry: SourceRegistry,
) -> None:
    with pytest.raises(UnregisteredSourceError, match="explicitly unavailable"):
        registry.get("bns")


def test_should_drop_a_feed_item_that_matches_no_registered_source(
    registry: SourceRegistry,
) -> None:
    with pytest.raises(UnregisteredSourceError):
        registry.resolve_feed_item({"link": "https://example.invalid/news/1", "title": "x"})


def test_should_drop_a_feed_item_with_no_identifying_fields(
    registry: SourceRegistry,
) -> None:
    with pytest.raises(UnregisteredSourceError):
        registry.resolve_feed_item({"title": "A headline with no provenance"})


# ── the real registry ───────────────────────────────────────────────────


def test_should_load_the_shipped_registry(registry: SourceRegistry) -> None:
    assert len(registry) > 0
    assert registry.version == 1


def test_should_report_tier_and_rewrite_permission(registry: SourceRegistry) -> None:
    assert registry.tier("eurostat") == "A"
    assert registry.rewrite_allowed("eurostat") is True

    assert registry.tier("lsm_en") == "C"
    assert registry.rewrite_allowed("lsm_en") is False


def test_should_resolve_a_feed_item_by_explicit_source_id(registry: SourceRegistry) -> None:
    source = registry.resolve_feed_item({"source_id": "err_en", "title": "x"})

    assert source.id == "err_en"


def test_should_resolve_a_feed_item_by_its_feed_host(registry: SourceRegistry) -> None:
    source = registry.resolve_feed_item(
        {"link": "https://eng.lsm.lv/article/economy/x.a1/", "feed_url": "https://eng.lsm.lv/rss"}
    )

    assert source.id == "lsm_en"


def test_should_apply_registry_defaults_to_entries_that_omit_them() -> None:
    document = _document()
    del document["sources"][0]["requires_human_approval"]

    loaded = SourceRegistry.from_mapping(document)

    assert loaded.requires_human_approval("example_feed") is True


def test_should_expose_disabled_sources_but_exclude_them_from_enabled(
    registry: SourceRegistry,
) -> None:
    assert "delfi_global" in registry
    assert registry.get("delfi_global").enabled is False
    assert all(source.enabled for source in registry.enabled_sources())
