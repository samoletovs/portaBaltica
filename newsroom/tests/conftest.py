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
            "name": "Marek Akmeņrags",
            "beat": "Energy & Markets",
            "byline": "Marek Akmeņrags · AI correspondent, Energy & Markets",
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
            "accountable_editor": "Andre Kõpu",
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
            "accountable_editor": "Andre Kõpu",
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
            "accountable_editor": "Andre Kõpu",
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


# ── the network is not available to a unit test ─────────────────────────
#
# The JavaScript suite reached the internet from two files for months, and
# nothing said so: `api/economy-data` and `api/historical-data` call
# `https.request`, the mocks stubbed only `https.get`, and the escaping calls
# went to CSP PxWeb — 1-12s per table, under a 5000ms test timeout. Roughly one
# push in thirteen went red for a reason unrelated to its content. That is fixed
# in `tests/noNetwork.ts`; this is the same guard for the Python side.
#
# Measured before writing it, by wrapping `socket.socket.connect`,
# `connect_ex` and `getaddrinfo` and running all 1681 tests: **126 connections,
# every one of them to loopback, and zero DNS lookups**. So nothing here reaches
# the internet today and this guard changes no behaviour. It exists to keep that
# true — the newsroom pipeline calls Eurostat, Azure OpenAI and a dozen RSS
# feeds, so the transports are all present and one unmocked call is all it takes.
#
# **Loopback must be allowed, and that is measured rather than cautious.** Those
# 126 connections are asyncio's event-loop self-pipe, which on Windows is a
# socket pair over 127.0.0.1: a file with async tests produces 23 of them and a
# file without produces 0. A guard that blocked loopback would break every async
# test in the suite.
#
# A blocked attempt is also *recorded*, not only raised. Pipeline code catches
# broadly around its network calls, so an exception alone could be swallowed and
# leave the test green with a silent new dependency. The autouse fixture below
# fails the specific test that reached out, which an exception on its own would
# not name.

import errno as _errno
import ipaddress as _ipaddress
import socket as _socket

_BLOCKED: list[str] = []

_real_connect = _socket.socket.connect
_real_connect_ex = _socket.socket.connect_ex


class NetworkAccessDenied(OSError):
    """A unit test tried to open a socket to something that is not loopback."""


def _is_local(address: object) -> bool:
    """Whether an address is loopback, a unix path, or otherwise not the internet.

    Anything that is not an ``(host, port)`` tuple is local by construction: an
    AF_UNIX path or a Windows pipe cannot leave the machine. A hostname that is
    not ``localhost`` is treated as remote, because resolving it to find out
    would be the network access this is trying to prevent.
    """
    if not isinstance(address, tuple) or not address:
        return True
    host = address[0]
    if host in ("", "localhost"):
        return True
    try:
        return _ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _describe(address: object) -> str:
    if isinstance(address, tuple) and len(address) >= 2:
        return f"{address[0]}:{address[1]}"
    return repr(address)


def _denied(address: object) -> NetworkAccessDenied:
    target = _describe(address)
    _BLOCKED.append(target)
    return NetworkAccessDenied(
        _errno.ECONNREFUSED,
        f"connect {target} refused by the portaBaltica test guard. A unit test "
        "may not reach the network. Stub the call, or make it an explicitly "
        "live check that runs outside this suite.",
    )


def _guarded_connect(self, address):  # type: ignore[no-untyped-def]
    if _is_local(address):
        return _real_connect(self, address)
    raise _denied(address)


def _guarded_connect_ex(self, address):  # type: ignore[no-untyped-def]
    # `connect_ex` reports an errno rather than raising, which is exactly how a
    # caller could ignore this one. It is recorded either way, and the autouse
    # fixture is what turns that record into a failure.
    if _is_local(address):
        return _real_connect_ex(self, address)
    _denied(address)
    return _errno.ECONNREFUSED


_socket.socket.connect = _guarded_connect
_socket.socket.connect_ex = _guarded_connect_ex


def pytest_configure(config: pytest.Config) -> None:
    # `--strict-markers` is set in pytest.ini, so this has to be registered.
    config.addinivalue_line(
        "markers",
        "expects_blocked_network: the test deliberately provokes the network "
        "guard, so its blocked attempts are not a failure.",
    )


@pytest.fixture(autouse=True)
def _network_stayed_local(request: pytest.FixtureRequest):
    """Fail the test that reached out, rather than the run that noticed.

    Raising is not enough on its own: the code under test may catch broadly, in
    which case the test passes and the new dependency is invisible. This names
    the offender.
    """
    before = len(_BLOCKED)
    yield
    attempts = _BLOCKED[before:]
    if request.node.get_closest_marker("expects_blocked_network"):
        return
    assert not attempts, (
        "this test tried to reach " + ", ".join(sorted(set(attempts))) + ". "
        "A unit test may not use the network: stub the call, or move the check "
        "somewhere that is honest about being live."
    )
