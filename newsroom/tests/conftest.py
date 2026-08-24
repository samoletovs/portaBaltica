"""Shared fixtures.

The clean articles here are the control condition. Every rejection test starts
from one of them, applies exactly one hostile or broken mutation, and asserts
the specific check that should catch it does catch it.

That structure is the point. A validator test that passes because the validator
does nothing is worse than no test — so :func:`assert_rejected_by` demands a
*named* check fail, and by default demands that it is the *only* check that
fails. A fixture that trips three unrelated gates proves nothing about the gate
under test.
"""

from __future__ import annotations

import copy
from typing import Any, Iterable, Mapping

import pytest

from newsroom.persona_rules import PersonaRegistry
from newsroom.source_registry import SourceRegistry
from newsroom.validator import ValidatorVerdict, validate_article


# ── registries ──────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def registry() -> SourceRegistry:
    """The real ``sources.yaml``. These tests are also a check on it."""
    return SourceRegistry.load()


@pytest.fixture(scope="session")
def personas() -> PersonaRegistry:
    """The real ``personas.yaml``."""
    return PersonaRegistry.load()


# ── the verified signal a tier A article is written from ────────────────

ELECTRICITY_SIGNAL: Mapping[str, Any] = {
    "id": "sig-elering-daily-2026-08-24",
    "detected_at": "2026-08-24T13:05:00Z",
    "payload": {
        "price": {
            "latest": 142.5,
            "year_earlier": 127.2,
            "change_pct": 12.0,
        },
        "spread": 303.5,
        "hours": [
            {"hour": 4, "price": 8.4},
            {"hour": 19, "price": 311.9},
        ],
    },
}


def _tier_a_article() -> dict[str, Any]:
    return {
        "id": "01J0000000000000000000ELEC",
        "slug": "latvian-power-prices-settle-above-last-summer",
        "tier": "A",
        "status": "published",
        "section": "energy",
        "headline": "Latvian power prices settle 12% above last summer",
        "dek": (
            "The day-ahead average reached 142.5 euros per megawatt-hour, "
            "12.0% higher than the same day a year earlier."
        ),
        "body": [
            {
                "type": "paragraph",
                "text": (
                    "Latvian day-ahead electricity settled at an average of 142.5 euros "
                    "per megawatt-hour, 12.0% higher than the same day a year earlier, "
                    "when it cleared at 127.2 euros."
                ),
                "figures": [
                    {"value": 142.5, "unit": "EUR/MWh", "signal_field": "price.latest"},
                    {"value": 12.0, "unit": "%", "signal_field": "price.change_pct"},
                    {"value": 127.2, "unit": "EUR/MWh", "signal_field": "price.year_earlier"},
                ],
            },
            {
                "type": "paragraph",
                "text": (
                    "The spread between the cheapest and most expensive hour widened to "
                    "303.5 euros, against 8.4 euros at the daily low and 311.9 at the peak."
                ),
                "figures": [
                    {"value": 303.5, "unit": "EUR/MWh", "signal_field": "spread"},
                    {"value": 8.4, "unit": "EUR/MWh", "signal_field": "hours[0].price"},
                    {"value": 311.9, "unit": "EUR/MWh", "signal_field": "hours[1].price"},
                ],
            },
        ],
        "persona": {
            "id": "akmensrags",
            "name": "Akmeņrags",
            "beat": "Energy & Markets",
            "byline": "Akmeņrags · AI correspondent, Energy & Markets",
        },
        "provenance": {
            "sources": [
                {
                    "source_id": "elering",
                    "dataset": "nps/price",
                    "retrieved_at": "2026-08-24T13:00:00Z",
                    "url": "https://dashboard.elering.ee/api/nps/price",
                }
            ],
            "signal_id": "sig-elering-daily-2026-08-24",
            "model": "gpt-4o-mini@2024-07-18",
            "prompt_version": "v1",
            "generated_at": "2026-08-24T13:06:00Z",
            "accountable_editor": "Sam Samoletovs",
            "validator": {"passed": False, "checked_at": "", "checks": []},
        },
        "created_at": "2026-08-24T13:06:00Z",
        "countries": ["LV"],
    }


# ── the raw feed items that tiers B and C are checked against ───────────

LSM_RAW_ITEM: Mapping[str, Any] = {
    "source_id": "lsm_en",
    "title": "Riga port cargo turnover falls in July",
    "description": (
        "Cargo handled at the Freeport of Riga fell 4.2% in July compared with a year "
        "earlier, port statistics show."
    ),
    "link": "https://eng.lsm.lv/article/economy/transport/riga-port-cargo-july.a123456/",
    "published": "2026-08-24T09:00:00Z",
}

EC_RAW_ITEM: Mapping[str, Any] = {
    "source_id": "ec_presscorner",
    "title": "Commission approves Baltic grid reinforcement funding",
    "description": "The Commission has approved funding for Baltic grid reinforcement.",
    "full_text": (
        "The European Commission has today approved a support scheme for the "
        "reinforcement of the Baltic electricity grid. The measure was assessed under "
        "State aid rules and found compatible with the internal market."
    ),
    "link": "https://ec.europa.eu/commission/presscorner/detail/en/ip_26_1234",
    "published": "2026-08-24T10:30:00Z",
}


def _tier_c_article() -> dict[str, Any]:
    return {
        "id": "01J0000000000000000000LSM1",
        "slug": "riga-port-cargo-turnover-falls-in-july",
        "tier": "C",
        "status": "pending_approval",
        "section": "maritime",
        "headline": LSM_RAW_ITEM["title"],
        "syndicated": {
            "source_id": "lsm_en",
            "original_url": LSM_RAW_ITEM["link"],
            "attribution": "LSM.lv English",
            "snippet": LSM_RAW_ITEM["description"],
            "snippet_is_verbatim": True,
        },
        "provenance": {
            "sources": [
                {
                    "source_id": "lsm_en",
                    "retrieved_at": "2026-08-24T09:05:00Z",
                    "url": LSM_RAW_ITEM["link"],
                }
            ],
            "generated_at": "2026-08-24T09:05:00Z",
            "accountable_editor": "Sam Samoletovs",
            "validator": {"passed": False, "checked_at": "", "checks": []},
        },
        "created_at": "2026-08-24T09:05:00Z",
        "countries": ["LV"],
    }


def _tier_b_article() -> dict[str, Any]:
    return {
        "id": "01J00000000000000000000EC1",
        "slug": "commission-approves-baltic-grid-reinforcement-funding",
        "tier": "B",
        "status": "pending_approval",
        "section": "energy",
        "headline": EC_RAW_ITEM["title"],
        "syndicated": {
            "source_id": "ec_presscorner",
            "original_url": EC_RAW_ITEM["link"],
            "attribution": "Source: European Commission",
            "snippet": EC_RAW_ITEM["description"],
            "full_text": EC_RAW_ITEM["full_text"],
            "snippet_is_verbatim": True,
        },
        "provenance": {
            "sources": [
                {
                    "source_id": "ec_presscorner",
                    "retrieved_at": "2026-08-24T10:35:00Z",
                    "url": EC_RAW_ITEM["link"],
                }
            ],
            "generated_at": "2026-08-24T10:35:00Z",
            "accountable_editor": "Sam Samoletovs",
            "validator": {"passed": False, "checked_at": "", "checks": []},
        },
        "created_at": "2026-08-24T10:35:00Z",
        "countries": ["Baltic", "EU"],
    }


@pytest.fixture
def tier_a_article() -> dict[str, Any]:
    """A clean, fully traceable original data-journalism article."""
    return _tier_a_article()


@pytest.fixture
def tier_b_article() -> dict[str, Any]:
    """A clean verbatim EC press release."""
    return _tier_b_article()


@pytest.fixture
def tier_c_article() -> dict[str, Any]:
    """A clean link-out card: headline, the outlet's own snippet, and a link."""
    return _tier_c_article()


@pytest.fixture
def signal() -> dict[str, Any]:
    return copy.deepcopy(dict(ELECTRICITY_SIGNAL))


@pytest.fixture
def lsm_raw_item() -> dict[str, Any]:
    return copy.deepcopy(dict(LSM_RAW_ITEM))


@pytest.fixture
def ec_raw_item() -> dict[str, Any]:
    return copy.deepcopy(dict(EC_RAW_ITEM))


# ── running and asserting ───────────────────────────────────────────────


@pytest.fixture
def validate(registry: SourceRegistry, personas: PersonaRegistry):
    """Run the validator with the real registries bound in."""

    def _validate(
        article: Mapping[str, Any],
        *,
        signal: Mapping[str, Any] | None = None,
        raw_feed_item: Mapping[str, Any] | None = None,
    ) -> ValidatorVerdict:
        return validate_article(
            article,
            registry=registry,
            personas=personas,
            signal=signal,
            raw_feed_item=raw_feed_item,
        )

    return _validate


def assert_rejected_by(
    verdict: ValidatorVerdict,
    check_name: str,
    *,
    only: bool = True,
    also: Iterable[str] = (),
) -> None:
    """Assert the article was rejected, by the check we meant to exercise.

    ``only`` defaults to true so a fixture cannot appear to prove a check works
    when in fact some unrelated gate rejected it.
    """
    assert not verdict.passed, (
        f"expected rejection by {check_name!r} but the article passed every check"
    )

    failed = {check.name for check in verdict.failures()}
    assert check_name in failed, (
        f"expected {check_name!r} to fail; failing checks were {sorted(failed) or 'none'}"
    )

    failing_check = next(check for check in verdict.checks if check.name == check_name)
    assert failing_check.detail, f"{check_name!r} failed without saying why"

    if only:
        expected = {check_name, *also}
        assert failed == expected, (
            f"expected exactly {sorted(expected)} to fail, got {sorted(failed)}. "
            "A fixture that trips unrelated gates does not prove this one works."
        )


def assert_all_passed(verdict: ValidatorVerdict) -> None:
    """Assert a clean article clears every gate, with the reason if it does not."""
    assert verdict.passed, f"clean article was rejected: {verdict.failure_summary()}"
