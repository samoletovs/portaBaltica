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

import ast
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
        "The editor agent handles routine decisions; Andre is interrupted only for escalation."
    )


def test_every_tier_c_source_is_pinned_to_the_outlets_own_rss_snippet(
    registry: SourceRegistry,
) -> None:
    tier_c = list(registry.by_tier("C"))
    assert tier_c, (
        "no tier C sources found, so this test asserted nothing. Tier C is the "
        "tier the snippet limit exists for; an empty list here is a silent "
        "retirement of the check, not a clean bill of health."
    )

    for source in tier_c:
        assert source.max_snippet_source == "rss_description_verbatim", (
            f"{source.id} may show more than the outlet's own syndication snippet"
        )


def test_every_source_carries_a_licence_and_an_attribution(
    registry: SourceRegistry,
) -> None:
    sources = list(registry)
    assert sources, "the registry is empty, so this test asserted nothing"

    for source in sources:
        assert source.licence.strip(), f"{source.id} has no licence recorded"
        assert source.attribution.strip(), f"{source.id} has no attribution string"


def test_the_shipped_registry_satisfies_the_loaders_own_contract(
    registry: SourceRegistry,
) -> None:
    # Filter first, then assert the filtered set is non-empty. Asserting only
    # that the *registry* is non-empty would still leave this vacuous: the
    # check lives inside the `if`, so a registry with no B or C source asserts
    # nothing while looking fully exercised.
    restricted = [source for source in registry if source.tier in NO_REWRITE_TIERS]
    assert restricted, (
        f"no sources in {sorted(NO_REWRITE_TIERS)}, so this test asserted nothing. "
        "These are the tiers the rewrite prohibition exists for."
    )

    for source in restricted:
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
    roster = list(personas)
    assert roster, (
        "no correspondents found, so this test asserted nothing. This is the "
        "EU AI Act disclosure check; an empty roster must fail it, not pass it."
    )

    for persona in roster:
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


# ── invariant 0: none of the above can pass by asserting nothing ────────


def _asserts_outside_every_loop(fn: ast.FunctionDef) -> bool:
    """True when the function asserts something regardless of how many times it loops.

    A test whose entire body is ``for x in collection: assert ...`` runs zero
    assertions when the collection is empty, and pytest reports that as PASSED.
    Four tests in this file were that shape, including the tier C snippet
    limit, the licence and attribution check, and the EU AI Act byline
    disclosure -- the three one would least want to stop being checked in
    silence.

    Emptying them needs no code change: deleting entries from ``sources.yaml``
    is enough, and the tier C roster has changed before.
    """
    loops = [node for node in fn.body if isinstance(node, (ast.For, ast.While))]
    if not loops:
        return True

    inside: set[int] = set()
    for loop in loops:
        for node in ast.walk(loop):
            inside.add(id(node))

    return any(
        isinstance(node, ast.Assert) and id(node) not in inside
        for node in ast.walk(fn)
    )


#: The invariants whose silent disappearance would cost the most, named so that
#: moving one to another file turns this red rather than quietly narrowing the
#: guard's reach.
#:
#: WHY A NAMED LIST AND NOT A COUNT. `offenders == []` is true of a compliant
#: file and equally true of a scan that found nothing — measured at 17 tests, at
#: 1, and at 0, and the guard passed all three. A count would close the third
#: case only: seventeen invariants in one file is exactly the size that gets
#: split, and after a split the guard follows whichever half retains it, sees a
#: non-zero number of tests, and goes on reporting green about the invariants it
#: no longer covers. Naming them is what makes the move visible.
#:
#: A *subset* check rather than an equality, because adding an invariant here
#: should not require editing this list — only losing one should.
LOAD_BEARING = frozenset({
    "test_no_tier_c_source_may_permit_rewriting",
    "test_every_tier_c_source_is_pinned_to_the_outlets_own_rss_snippet",
    "test_every_source_carries_a_licence_and_an_attribution",
    "test_the_shipped_registry_satisfies_the_loaders_own_contract",
    "test_every_dashboard_section_routes_to_a_valid_persona",
    "test_every_correspondent_renders_a_byline_that_discloses_ai",
})


def test_no_invariant_in_this_file_can_pass_by_asserting_nothing() -> None:
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))

    tests = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name.startswith("test_")
    ]

    # The coverage check, before the compliance one. Without it this test is the
    # very thing it forbids: an assertion that holds when nothing was examined.
    missing = sorted(LOAD_BEARING - {node.name for node in tests})
    assert missing == [], (
        f"these invariants are no longer in the file this guard scans: {missing}. "
        "If they moved, the guard did not move with them and is now reporting "
        "green about tests it does not cover. Point it at them or split it too."
    )

    offenders = [
        node.name for node in tests if not _asserts_outside_every_loop(node)
    ]

    assert offenders == [], (
        f"these tests assert nothing when their collection is empty: {offenders}. "
        "Materialise the collection, assert it is non-empty, then loop. This file "
        "exists so that loosening the configuration fails the build rather than "
        "shipping quietly -- a check that cannot fail does not do that."
    )
