"""Persona rules: bylines are built, never written; claims are caught."""

from __future__ import annotations

from typing import Any

import pytest

from newsroom.persona_rules import (
    AI_DISCLOSURE,
    InvalidPersonaConfigError,
    PersonaRegistry,
    UnknownPersonaError,
)


def _document(**overrides: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "version": 1,
        "shared": {"accountable_editor": "Sam Samoletovs", "byline_suffix": AI_DISCLOSURE},
        "personas": [
            {
                "id": "nida",
                "name": "Ilze Bērziņa",
                "beat": "Economy & Labour",
                "sections": ["economy"],
                "voice": {"summary": "Patient."},
            }
        ],
        "routing": {"economy": "nida"},
    }
    document.update(overrides)
    return document


# ── configuration that must be refused ──────────────────────────────────


def test_should_reject_a_routing_entry_pointing_at_an_unknown_persona() -> None:
    with pytest.raises(InvalidPersonaConfigError, match="unknown persona"):
        PersonaRegistry.from_mapping(_document(routing={"economy": "marta"}))


def test_should_reject_a_byline_suffix_that_is_not_the_disclosure_token() -> None:
    # The validator looks for this exact substring. Changing it here without
    # changing the validator would silently disable the disclosure gate.
    document = _document()
    document["shared"]["byline_suffix"] = "AI reporter"

    with pytest.raises(InvalidPersonaConfigError, match="byline_suffix"):
        PersonaRegistry.from_mapping(document)


def test_should_reject_a_persona_with_no_beat() -> None:
    document = _document()
    del document["personas"][0]["beat"]

    with pytest.raises(InvalidPersonaConfigError, match="`beat` is required"):
        PersonaRegistry.from_mapping(document)


def test_should_reject_duplicate_persona_ids() -> None:
    document = _document()
    document["personas"].append(dict(document["personas"][0]))

    with pytest.raises(InvalidPersonaConfigError, match="duplicate persona id"):
        PersonaRegistry.from_mapping(document)


def test_should_reject_an_empty_routing_map() -> None:
    with pytest.raises(InvalidPersonaConfigError, match="non-empty `routing`"):
        PersonaRegistry.from_mapping(_document(routing={}))


def test_should_raise_for_an_unknown_persona_id(personas: PersonaRegistry) -> None:
    with pytest.raises(UnknownPersonaError):
        personas.get("marta")


def test_should_raise_for_a_section_with_no_routed_correspondent(
    personas: PersonaRegistry,
) -> None:
    with pytest.raises(UnknownPersonaError, match="no routed correspondent"):
        personas.persona_for_section("sport")


# ── bylines ─────────────────────────────────────────────────────────────


def test_should_build_a_byline_that_discloses_ai_authorship(
    personas: PersonaRegistry,
) -> None:
    assert personas.byline_for("kolka") == "Gintaras Vaitkus · AI correspondent, Maritime & Trade"


def test_should_build_a_disclosed_byline_for_every_correspondent(
    personas: PersonaRegistry,
) -> None:
    for persona in personas:
        assert AI_DISCLOSURE in persona.byline
        assert persona.byline.startswith(persona.name)
        assert persona.byline.endswith(persona.beat)


def test_should_not_accept_a_byline_missing_the_disclosure(
    personas: PersonaRegistry,
) -> None:
    assert personas.byline_discloses_ai("Gintaras Vaitkus · Maritime correspondent") is False
    assert personas.byline_discloses_ai(None) is False
    assert personas.byline_discloses_ai("") is False


def test_should_route_a_section_to_its_correspondent(personas: PersonaRegistry) -> None:
    assert personas.persona_for_section("energy").id == "akmensrags"
    assert personas.persona_for_section("maritime").id == "kolka"
    assert personas.byline_for_section("environment").startswith("Kadri Lepik")


def test_should_route_deterministically(personas: PersonaRegistry) -> None:
    first = [personas.persona_for_section("economy").id for _ in range(5)]

    assert set(first) == {"nida"}


# ── forbidden claims ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "I visited the terminal at Ventspils.",
        "We spoke to the transmission operator.",
        "Our correspondent attended the auction.",
        "Sources told us the auction cleared early.",
        "We phoned the regulator for comment.",
        "When we asked, the operator declined.",
        "In an interview with us, the operator confirmed it.",
        "Gintaras Vaitkus travelled to the port of Klaipėda.",
        "The minister told this reporter the plan was on track.",
    ],
)
def test_should_flag_claims_of_lived_experience(
    personas: PersonaRegistry, text: str
) -> None:
    assert personas.find_forbidden_claims(text), f"claim went undetected: {text!r}"


@pytest.mark.parametrize(
    "text",
    [
        "The data shows cargo volumes fell against the same month a year earlier.",
        "Cargo travelled through Ventspils on its way to Poland.",
        "The vessel called at Riga before sailing for Gdansk.",
        "Elering published the day-ahead prices at 13:00 CET.",
        "The dataset was retrieved on 2026-08-24 and covers the whole year.",
    ],
)
def test_should_not_flag_ordinary_data_prose(
    personas: PersonaRegistry, text: str
) -> None:
    assert personas.find_forbidden_claims(text) == [], (
        f"false positive on ordinary prose: {text!r}"
    )


def test_should_report_a_non_canonical_byline_as_a_problem(
    personas: PersonaRegistry,
) -> None:
    problems = personas.validate_output(
        "kolka",
        "The data shows cargo fell against a year earlier.",
        byline="Marta Ozola · AI correspondent, Maritime & Trade",
    )

    assert any("canonical" in problem for problem in problems)


def test_should_report_a_byline_missing_the_disclosure_as_a_problem(
    personas: PersonaRegistry,
) -> None:
    problems = personas.validate_output(
        "kolka", "The data shows cargo fell.", byline="Gintaras Vaitkus · Maritime correspondent"
    )

    assert any(AI_DISCLOSURE in problem for problem in problems)


def test_should_report_no_problems_for_compliant_output(
    personas: PersonaRegistry,
) -> None:
    problems = personas.validate_output(
        "kolka",
        "The data shows cargo volumes fell 4.2% against the same month a year earlier.",
        byline="Gintaras Vaitkus · AI correspondent, Maritime & Trade",
    )

    assert problems == ()


def test_should_raise_when_validating_output_for_a_fabricated_correspondent(
    personas: PersonaRegistry,
) -> None:
    with pytest.raises(UnknownPersonaError):
        personas.validate_output("marta", "Anything at all.")


def test_should_expose_the_declared_shared_constraints(
    personas: PersonaRegistry,
) -> None:
    assert personas.accountable_editor == "Sam Samoletovs"
    assert personas.forbidden_claims
    assert personas.required_behaviour
