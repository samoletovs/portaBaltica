"""The wire probe: does it watch what the collector actually fetches, and can it fail?

Two jobs here, and the first is the important one.

**The parity guard.** ``scripts/wire_check.py`` has to know which sources are on
the wire, and the answer lives inside ``collect_feeds`` as an inline
comprehension in a file this workstream does not own. So the probe mirrors it —
and mirroring is precisely the liability ``AGENTS.md`` catalogues three times:
a guard that restates its subject is a second implementation that can disagree,
silently, in the direction that reports success.

The fix is not to comment about it. It is to run the **real** ``collect_feeds``
against a recording fake and assert the set it actually fetched equals the set
the probe watches. That compares behaviour rather than source text, so it
cannot be satisfied by two implementations that merely look alike, and it goes
red the day somebody changes the filter upstream.

The distinction the guard is built to catch is live right now, which is what
makes it worth having: ``enabled_sources()`` returns 14 and ``collect_feeds``
fetches 7. Watching the former would report a permanent false red on seven
statistical APIs; watching a hand-written list would drift. Only asking the
collector is correct.

**The failure modes.** The rest asserts the probe can actually fail, one shape
per test, including the one that motivated it: HTTP 202 with a zero-byte body,
which ``response.ok`` calls healthy.
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_probe() -> Any:
    """Import ``scripts/wire_check.py`` as a module.

    Loaded by path rather than by adding ``scripts/`` to ``sys.path``, so this
    cannot shadow a same-named module for any other test in the session.
    """
    path = REPO_ROOT / "scripts" / "wire_check.py"
    spec = importlib.util.spec_from_file_location("_wire_check_under_test", path)
    assert spec and spec.loader, f"cannot load {path}"
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


wire_check = _load_probe()


# ── the parity guard ────────────────────────────────────────────────────────


@dataclass
class _RecordingHttp:
    """A ``CollectorHttp`` that fetches nothing and remembers what it was asked for."""

    asked: list[str]

    async def fetch(self, *, source_id: str, url: str, cache_ttl_minutes: Any, **_: Any) -> Any:
        from newsroom.pipeline.collect.httpclient import FetchResult

        self.asked.append(source_id)
        # `item=None` makes `FetchResult.ok` false, so `collect_feeds` logs and
        # moves on without parsing or touching the archive. The point of this
        # fake is the call list, not the payload.
        return FetchResult(source_id, url, None, skipped_reason="probe_parity_test")


class _UnusedArchive:
    """Asserts it is never touched, which is what makes the fake above honest."""

    def read(self, *args: Any, **kwargs: Any) -> bytes:  # pragma: no cover
        raise AssertionError("collect_feeds should not reach the archive when every fetch fails")


def test_probe_watches_exactly_what_the_collector_fetches() -> None:
    from newsroom.pipeline.run import collect_feeds
    from newsroom.pipeline.safety import registry

    recorder = _RecordingHttp(asked=[])
    items, descriptions = asyncio.run(collect_feeds(recorder, _UnusedArchive()))

    assert items == [] and descriptions == {}, "the fake fetched nothing, so nothing should parse"

    actually_fetched = set(recorder.asked)
    watched = {source.id for source in wire_check.wire_sources(registry())}

    assert watched == actually_fetched, (
        "the probe and the collector disagree about what is on the wire.\n"
        f"  collector fetches : {sorted(actually_fetched)}\n"
        f"  probe watches     : {sorted(watched)}\n"
        f"  probe misses      : {sorted(actually_fetched - watched)}\n"
        f"  probe over-reaches: {sorted(watched - actually_fetched)}\n"
        "Everything in 'probe misses' is unwatched while looking covered."
    )


def test_the_parity_guard_could_have_failed() -> None:
    """The companion assertion: prove the comparison above is capable of failing.

    An equality that holds because both sides are empty proves nothing. This
    pins that the collector really did ask for something, so the guard is
    comparing two populated sets rather than agreeing about nothing.
    """
    from newsroom.pipeline.run import collect_feeds

    recorder = _RecordingHttp(asked=[])
    asyncio.run(collect_feeds(recorder, _UnusedArchive()))

    assert recorder.asked, "collect_feeds fetched nothing at all; the parity guard is vacuous"
    assert len(set(recorder.asked)) == len(recorder.asked), "collect_feeds asked for a source twice"


def test_the_probe_does_not_simply_watch_enabled_sources() -> None:
    """`enabled_sources()` is the tempting answer and it is the wrong population.

    Measured: 14 enabled, 7 fetched. This asserts the difference is real rather
    than incidental, because if the two ever coincided the parity guard above
    would keep passing while the probe watched the wrong thing for the wrong
    reason — and nobody would learn that from a green run.
    """
    from newsroom.pipeline.safety import registry

    reg = registry()
    enabled = {s.id for s in reg.enabled_sources()}
    watched = {s.id for s in wire_check.wire_sources(reg)}
    uncovered = {s.id for s in wire_check.uncovered_sources(reg)}

    assert watched < enabled, "every enabled source is on the wire; this test's premise is stale"
    assert uncovered == enabled - watched, "uncovered_sources must be the exact complement"
    assert uncovered, "the probe claims full coverage; then it must say so rather than stay silent"


def test_every_uncovered_source_is_named_in_the_report() -> None:
    """A gap must be stated, not implied.

    A guard covering a smaller population than it appears to is correct about
    everything it looks at and blind to the rest. The only defence is that the
    report says so on every run, including clean ones.
    """
    from newsroom.pipeline.safety import registry

    reg = registry()
    uncovered = wire_check.uncovered_sources(reg)
    verdict = wire_check.evaluate([_ok_result("lsm_en")], uncovered, now=_NOW)
    text = wire_check.render_text(verdict)

    assert not verdict["alert"], "a healthy wire with uncovered sources must not alert"
    for source in uncovered:
        assert source.id in text, f"{source.id} is not probed and not mentioned either"


# ── failure modes ───────────────────────────────────────────────────────────

_NOW = datetime(2026, 8, 28, 6, 17, tzinfo=timezone.utc)
_TODAY = _NOW.date()


@dataclass(frozen=True)
class _FakeSource:
    id: str
    name: str
    tier: str = "C"
    endpoint: str | None = "https://example.test/rss"
    verified: str | None = "2026-08-24 — HTTP 200"


_RSS = (
    b'<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>'
    b"<item><title>One</title><link>https://example.test/1</link>"
    b"<description>d</description></item></channel></rss>"
)


def _ok_result(source_id: str = "lsm_en") -> dict[str, Any]:
    return wire_check.judge_source(
        _FakeSource(id=source_id, name=source_id),
        {"http_status": 200, "body": _RSS, "latency_ms": 12, "transport_error": None},
        today=_TODAY,
    )


@pytest.mark.parametrize(
    ("what", "fetched", "expected_state"),
    [
        (
            "HTTP 202 with a zero-byte body, which response.ok calls healthy",
            {"http_status": 202, "body": b"", "latency_ms": 9, "transport_error": None},
            "empty_body",
        ),
        (
            "HTTP 403 with an error page in the body",
            {"http_status": 403, "body": b"<html>go away</html>", "latency_ms": 9, "transport_error": None},
            "http_error",
        ),
        (
            "HTTP 500",
            {"http_status": 500, "body": b"oops", "latency_ms": 9, "transport_error": None},
            "http_error",
        ),
        (
            "a transport failure with no status at all",
            {"http_status": None, "body": b"", "latency_ms": 9, "transport_error": "Name or service not known"},
            "unreachable",
        ),
        (
            "HTTP 200 carrying something that is not a feed",
            {"http_status": 200, "body": b"<html><body>hello</body></html>", "latency_ms": 9, "transport_error": None},
            "no_items",
        ),
        (
            "HTTP 200 carrying a well-formed feed with no items in it",
            {
                "http_status": 200,
                "body": b'<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>',
                "latency_ms": 9,
                "transport_error": None,
            },
            "no_items",
        ),
        (
            "HTTP 200 with a real feed",
            {"http_status": 200, "body": _RSS, "latency_ms": 9, "transport_error": None},
            "ok",
        ),
    ],
)
def test_judge_source_states(what: str, fetched: dict[str, Any], expected_state: str) -> None:
    result = wire_check.judge_source(_FakeSource(id="s", name="Source"), fetched, today=_TODAY)
    assert result["state"] == expected_state, what


def test_a_2xx_status_is_never_on_its_own_a_pass() -> None:
    """The property, stated directly rather than through the table.

    ep_news is the live counter-example: HTTP 202, zero bytes. Anything keyed
    on the status code alone calls that healthy, which is why the probe keys on
    the parsed item count instead.
    """
    for status in (200, 201, 202, 203, 204):
        result = wire_check.judge_source(
            _FakeSource(id="s", name="Source"),
            {"http_status": status, "body": b"", "latency_ms": 1, "transport_error": None},
            today=_TODAY,
        )
        assert result["state"] == "empty_body", f"HTTP {status} with no body must not pass"


def test_a_source_with_no_endpoint_is_a_problem_not_a_skip() -> None:
    result = wire_check.judge_source(
        _FakeSource(id="s", name="Source", endpoint=None),
        {"http_status": None, "body": b"", "latency_ms": 0, "transport_error": None},
        today=_TODAY,
    )
    assert result["state"] == "misconfigured"


# ── the verdict ─────────────────────────────────────────────────────────────


def _broken_result(source_id: str, *, verified: str | None) -> dict[str, Any]:
    return wire_check.judge_source(
        _FakeSource(id=source_id, name=source_id, verified=verified),
        {"http_status": 202, "body": b"", "latency_ms": 9, "transport_error": None},
        today=_TODAY,
    )


def test_an_empty_wire_alerts() -> None:
    """Zero probed sources means zero failures, which is not the same as health."""
    verdict = wire_check.evaluate([], [], now=_NOW)
    assert verdict["alert"]
    assert "wire is empty" in wire_check.render_text(verdict)


def test_an_empty_wire_does_not_claim_a_source_is_in_trouble() -> None:
    """The headline must not count problems as though they were sources.

    Counting them said "1 wire source in trouble" when there were no wire
    sources at all: a sentence a reader would believe, describing something
    that did not happen.
    """
    headline = wire_check.evaluate([], [], now=_NOW)["headline"]
    assert "1 wire source" not in headline
    assert headline == "the wire is empty"


def test_a_healthy_wire_is_silent() -> None:
    verdict = wire_check.evaluate([_ok_result("a"), _ok_result("b")], [], now=_NOW)
    assert not verdict["alert"]
    assert verdict["problems"] == []


def test_this_suite_covers_both_outcomes() -> None:
    """The companion assertion for every silence asserted above."""
    assert wire_check.evaluate([_ok_result("a")], [], now=_NOW)["alert"] is False
    assert wire_check.evaluate([_broken_result("a", verified=None)], [], now=_NOW)["alert"] is True


def test_a_broken_source_is_named_with_its_detail() -> None:
    verdict = wire_check.evaluate([_ok_result("good"), _broken_result("bad", verified=None)], [], now=_NOW)
    text = wire_check.render_text(verdict)
    assert verdict["alert"]
    assert len(verdict["problems"]) == 1
    assert "bad" in text and "zero-byte body" in text


def test_a_verified_note_that_contradicts_the_reading_is_called_out() -> None:
    """The specific defect that let two dead feeds run for weeks.

    A registry vouching for a feed that is failing right now is not untidiness;
    it is a live falsehood aimed at whoever looks next, and it is why nobody
    looked.
    """
    verdict = wire_check.evaluate([_broken_result("ep_news", verified="2026-08-24 — HTTP 200")], [], now=_NOW)
    text = wire_check.render_text(verdict)
    assert verdict["alert"]
    assert "contradicts this reading" in text


def test_an_old_verified_note_on_a_working_feed_only_notes() -> None:
    """Untidy is not urgent. A daily alert about untidiness becomes wallpaper."""
    stale = wire_check.judge_source(
        _FakeSource(id="s", name="Source", verified="2025-01-01 — HTTP 200"),
        {"http_status": 200, "body": _RSS, "latency_ms": 9, "transport_error": None},
        today=_TODAY,
    )
    verdict = wire_check.evaluate([stale], [], now=_NOW)
    assert not verdict["alert"]
    assert any("verified: note is" in note for note in verdict["notes"])


def test_a_missing_verified_note_is_reported_rather_than_assumed_fine() -> None:
    fine = wire_check.judge_source(
        _FakeSource(id="s", name="Source", verified=None),
        {"http_status": 200, "body": _RSS, "latency_ms": 9, "transport_error": None},
        today=_TODAY,
    )
    verdict = wire_check.evaluate([fine], [], now=_NOW)
    assert not verdict["alert"]
    assert any("no parsable verified" in note for note in verdict["notes"])


@pytest.mark.parametrize(
    ("verified", "expected"),
    [
        ("2026-08-24 — HTTP 200, RSS 2.0", 4),
        ("2026-08-28", 0),
        ("checked recently", None),
        (None, None),
        ("2026-13-45 — nonsense date", None),
        (12345, None),
    ],
)
def test_verified_age_days(verified: Any, expected: Any) -> None:
    assert wire_check.verified_age_days(verified, today=date(2026, 8, 28)) == expected


# ── the network boundary ────────────────────────────────────────────────────


def test_fetch_feed_turns_a_transport_failure_into_data_not_an_exception() -> None:
    """A probe that can throw is a probe that can take the alert down with it."""

    def exploding_opener(*_: Any, **__: Any) -> Any:
        raise OSError("connection reset by peer")

    fetched = wire_check.fetch_feed("https://example.test/rss", timeout=1, opener=exploding_opener)
    assert fetched["transport_error"]
    assert fetched["http_status"] is None
    assert fetched["body"] == b""


def test_fetch_feed_identifies_itself_as_the_pipeline_does() -> None:
    """A probe sending a different user-agent is measuring a different request.

    Content negotiation and bot rules both key on this, and baltictimes
    answering 403 is exactly the kind of result that can depend on it.
    """
    from newsroom.pipeline import config

    seen: dict[str, Any] = {}

    def recording_opener(request: Any, timeout: Any = None) -> Any:
        seen["headers"] = dict(request.headers)
        raise OSError("stop here; the headers are the finding")

    wire_check.fetch_feed("https://example.test/rss", timeout=1, opener=recording_opener)
    headers = {k.lower(): v for k, v in seen["headers"].items()}
    assert headers["user-agent"] == config.USER_AGENT
    assert "xml" in headers["accept"]


def test_run_reports_an_unreadable_registry_rather_than_raising(monkeypatch: pytest.MonkeyPatch) -> None:
    """This is the only thing watching, so it must report its own failure."""

    def broken_registry() -> Any:
        raise RuntimeError("sources.yaml is not valid YAML")

    monkeypatch.setattr(wire_check, "registry", broken_registry)
    verdict = wire_check.run(timeout=1)

    assert verdict["alert"]
    assert "could not be read" in verdict["headline"]
    assert "not valid YAML" in wire_check.render_text(verdict)
