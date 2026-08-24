"""CI gate: the invariants the legal position rests on.

These do not test code. They test the *configuration* the code enforces, and
they exist so that loosening it fails the build rather than shipping quietly.

Two are load-bearing:

* No tier C source may have ``rewrite_allowed`` set to anything but ``false``.
  Tier C is third-party journalism. Rewriting it engages the press publishers'
  neighbouring right under EU DSM Directive 2019/790 Art. 15 — transposed in LV,
  EE and LT since 2021 — and matches Google's March 2024 definition of scaled
  content abuse. One flipped boolean is the whole exposure.
* Every dashboard section must route to a real correspondent. An unrouted
  section means an article with no byline, which means an article with no
  disclosure.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator

from newsroom.persona_rules import AI_DISCLOSURE, PersonaRegistry
from newsroom.source_registry import NO_REWRITE_TIERS, SourceRegistry
from newsroom.validator import CHECK_NAMES

REPO_ROOT = Path(__file__).resolve().parents[2]
NEWSROOM = REPO_ROOT / "newsroom"
SCHEMA_PATH = NEWSROOM / "schemas" / "article.schema.json"
NEWS_TYPES_PATH = REPO_ROOT / "src" / "news-types.ts"


@pytest.fixture(scope="module")
def raw_sources() -> dict[str, Any]:
    """The registry as written on disk, before defaults are applied.

    Read raw on purpose: the point is to catch what a human typed, not what the
    loader inferred.
    """
    return yaml.safe_load((NEWSROOM / "sources.yaml").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


# ── invariant 1: restricted sources are never rewritable ────────────────


def test_no_tier_c_source_may_permit_rewriting(raw_sources: dict[str, Any]) -> None:
    offenders = [
        (entry.get("id"), entry.get("rewrite_allowed"))
        for entry in raw_sources["sources"]
        if entry.get("tier") == "C" and entry.get("rewrite_allowed") is not False
    ]

    assert offenders == [], (
        f"tier C sources with rewrite_allowed not exactly false: {offenders}. "
        "Tier C is third-party journalism; rewriting it engages EU DSM Art. 15 "
        "and Google's scaled content abuse policy. This must stay false."
    )


def test_every_tier_c_source_declares_rewrite_allowed_explicitly(
    raw_sources: dict[str, Any],
) -> None:
    # Inheriting it from `defaults` would put the whole legal position behind a
    # single line somebody could edit without seeing any tier C entry.
    missing = [
        entry.get("id")
        for entry in raw_sources["sources"]
        if entry.get("tier") == "C" and "rewrite_allowed" not in entry
    ]

    assert missing == [], f"tier C sources not declaring rewrite_allowed: {missing}"


def test_no_tier_b_source_may_permit_rewriting(raw_sources: dict[str, Any]) -> None:
    offenders = [
        (entry.get("id"), entry.get("rewrite_allowed"))
        for entry in raw_sources["sources"]
        if entry.get("tier") == "B" and entry.get("rewrite_allowed") is not False
    ]

    assert offenders == [], (
        f"tier B sources with rewrite_allowed not exactly false: {offenders}. "
        "Tier B is licensed for verbatim reproduction, not for rewriting."
    )


def test_the_registry_default_for_rewriting_is_denial(raw_sources: dict[str, Any]) -> None:
    assert raw_sources["defaults"]["rewrite_allowed"] is False


def test_tier_b_and_c_sources_do_not_recreate_a_human_approval_queue(
    raw_sources: dict[str, Any],
) -> None:
    offenders = [
        entry.get("id")
        for entry in raw_sources["sources"]
        if entry.get("tier") in {"B", "C"} and entry.get("requires_human_approval") is not False
    ]

    assert offenders == [], (
        f"tier B/C sources still require human approval: {offenders}. "
        "The editor agent handles routine decisions; Sam is interrupted only for escalation."
    )


def test_every_tier_c_source_is_pinned_to_the_outlets_own_rss_snippet(
    registry: SourceRegistry,
) -> None:
    for source in registry.by_tier("C"):
        assert source.max_snippet_source == "rss_description_verbatim", (
            f"{source.id} may show more than the outlet's own syndication snippet"
        )


def test_every_source_carries_a_licence_and_an_attribution(
    registry: SourceRegistry,
) -> None:
    for source in registry:
        assert source.licence.strip(), f"{source.id} has no licence recorded"
        assert source.attribution.strip(), f"{source.id} has no attribution string"


def test_the_shipped_registry_satisfies_the_loaders_own_contract(
    registry: SourceRegistry,
) -> None:
    for source in registry:
        if source.tier in NO_REWRITE_TIERS:
            assert source.rewrite_allowed is False


# ── invariant 2: every section routes to a real correspondent ───────────


def test_every_dashboard_section_routes_to_a_valid_persona(
    schema: dict[str, Any], personas: PersonaRegistry
) -> None:
    sections = schema["properties"]["section"]["enum"]

    unrouted = [section for section in sections if section not in personas.routing]
    assert unrouted == [], (
        f"sections with no correspondent: {unrouted}. An unrouted section means "
        "an article with no byline, and therefore no AI disclosure."
    )

    invalid = [
        (section, persona_id)
        for section, persona_id in personas.routing.items()
        if persona_id not in personas.ids()
    ]
    assert invalid == [], f"routing points at correspondents that do not exist: {invalid}"


def test_routing_covers_no_section_the_schema_does_not_define(
    schema: dict[str, Any], personas: PersonaRegistry
) -> None:
    sections = set(schema["properties"]["section"]["enum"])

    unknown = sorted(set(personas.routing) - sections)
    assert unknown == [], f"routing names sections the schema does not allow: {unknown}"


def test_every_correspondent_renders_a_byline_that_discloses_ai(
    personas: PersonaRegistry,
) -> None:
    for persona in personas:
        assert AI_DISCLOSURE in persona.byline, f"{persona.id} byline hides its nature"


def test_the_schema_persona_enum_matches_the_shipped_correspondents(
    schema: dict[str, Any], personas: PersonaRegistry
) -> None:
    schema_ids = set(schema["properties"]["persona"]["properties"]["id"]["enum"])

    assert schema_ids == set(personas.ids())


# ── the schema contract ─────────────────────────────────────────────────


def test_the_article_schema_is_itself_a_valid_json_schema(schema: dict[str, Any]) -> None:
    Draft202012Validator.check_schema(schema)


def test_the_validator_implements_exactly_the_checks_the_schema_declares(
    schema: dict[str, Any],
) -> None:
    declared = tuple(
        schema["properties"]["provenance"]["properties"]["validator"]["properties"]["checks"][
            "items"
        ]["properties"]["name"]["enum"]
    )

    assert CHECK_NAMES == declared, (
        "the validator and the publication contract have drifted apart"
    )


def test_the_typescript_mirror_declares_the_same_checks() -> None:
    source = NEWS_TYPES_PATH.read_text(encoding="utf-8")
    block = re.search(
        r"export type ValidatorCheckName =(.*?);", source, re.DOTALL
    )
    assert block is not None, "ValidatorCheckName not found in the TypeScript mirror"

    mirrored = tuple(re.findall(r"'([a-z_]+)'", block.group(1)))

    assert mirrored == CHECK_NAMES, "the TypeScript mirror has drifted from the schema"


@pytest.mark.parametrize("fixture_name", ["tier_a_article", "tier_b_article", "tier_c_article"])
def test_the_test_fixtures_conform_to_the_publication_schema(
    fixture_name: str, schema: dict[str, Any], request: pytest.FixtureRequest
) -> None:
    # If the fixtures were not schema-valid, every validator test would be
    # exercising a shape the pipeline can never produce.
    article = request.getfixturevalue(fixture_name)

    Draft202012Validator(schema).validate(article)
