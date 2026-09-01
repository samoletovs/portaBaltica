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
from datetime import date, datetime, timedelta, timezone
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


# ── the newsroom's output ───────────────────────────────────────────────────


def _report(last_original_at: Any = "2026-08-27T17:13:00Z", runs: Any = 0) -> dict[str, Any]:
    return {"body": {"liveness": {"last_original_at": last_original_at, "runs_without_originals": runs}}, "error": None}


def test_a_recent_original_is_not_a_drought() -> None:
    d = wire_check.judge_drought(_report("2026-08-28T06:00:00Z"), now=_NOW)
    assert d["state"] == "ok"
    assert d["hours"] == 0.3


def test_the_budget_tolerates_a_designed_quiet_day() -> None:
    """The pipeline is built to have quiet days, so one must not alert.

    A single quiet day puts at most ~48h between originals on a daily schedule:
    publish at 14:05, nothing the next day, publish again at 14:05 the day
    after. A budget that fired at 48h would fire on intended behaviour, and
    `AGENTS.md` is explicit that a gate people route around is worse than none.
    """
    quiet_day = _NOW - timedelta(hours=47)
    d = wire_check.judge_drought(_report(quiet_day.isoformat().replace("+00:00", "Z")), now=_NOW)
    assert d["state"] == "ok", "one quiet day must not alert"

    two_quiet_days = _NOW - timedelta(hours=71)
    d = wire_check.judge_drought(_report(two_quiet_days.isoformat().replace("+00:00", "Z")), now=_NOW)
    assert d["state"] == "ok", "two consecutive quiet days must not alert either"


def test_three_scheduled_runs_without_an_original_is_a_drought() -> None:
    drought = _NOW - timedelta(hours=73)
    d = wire_check.judge_drought(_report(drought.isoformat().replace("+00:00", "Z")), now=_NOW)
    assert d["state"] == "drought"
    assert "72h" in d["detail"]


def test_the_budget_is_above_every_gap_ever_observed() -> None:
    """Measured on the live index, 2026-08-28: the worst gap between originals
    was 26.2 hours across 25 articles. A budget below that would have fired on
    a period in which the newsroom was working normally.
    """
    assert wire_check.MAX_HOURS_WITHOUT_ORIGINAL > 26.2


def test_an_unreadable_run_report_alerts() -> None:
    """This is the only thing asking, so 'I could not tell' is not 'fine'."""
    d = wire_check.judge_drought({"body": None, "error": "HTTPError: 404"}, now=_NOW)
    assert d["state"] == "unreadable"
    assert d["state"] in wire_check.DROUGHT_PROBLEM_STATES


@pytest.mark.parametrize(
    "liveness",
    [
        {},
        {"runs_without_originals": 0},
        {"last_original_at": None},
        {"last_original_at": ""},
        {"last_original_at": "not a timestamp"},
        {"last_original_at": 17},
    ],
)
def test_a_report_that_cannot_say_when_alerts(liveness: dict[str, Any]) -> None:
    """A report with no usable watermark is not evidence that it published recently."""
    d = wire_check.judge_drought({"body": {"liveness": liveness}, "error": None}, now=_NOW)
    assert d["state"] in wire_check.DROUGHT_PROBLEM_STATES


def test_a_report_with_no_liveness_block_at_all_alerts() -> None:
    d = wire_check.judge_drought({"body": {"finished_at": "2026-08-28T06:00:00Z"}, "error": None}, now=_NOW)
    assert d["state"] == "unknown"


def test_the_counter_is_reported_but_never_decides() -> None:
    """`runs_without_originals` counts runs of any trigger, so it cannot be the gate.

    `runreport.py` increments it once per run and resets it to zero the moment
    any run publishes an original, regardless of trigger. Measured over
    2026-08-24→27 there were 4 timer runs against 52 manual ones, so an
    afternoon of manual experimentation crosses any run-count threshold and a
    single manual run resets a genuine multi-day timer drought.

    This pins the separation directly: a huge counter with a recent original is
    fine, and a zero counter with an ancient original is a drought. If anyone
    ever wires the counter into the verdict, one of these two goes red.
    """
    old = (_NOW - timedelta(hours=200)).isoformat().replace("+00:00", "Z")
    recent = (_NOW - timedelta(hours=1)).isoformat().replace("+00:00", "Z")

    noisy_but_producing = wire_check.judge_drought(_report(recent, runs=999), now=_NOW)
    assert noisy_but_producing["state"] == "ok", "a big run counter must not alert on its own"
    assert noisy_but_producing["runs_without_originals"] == 999, "but it must still be reported"

    quiet_but_reset = wire_check.judge_drought(_report(old, runs=0), now=_NOW)
    assert quiet_but_reset["state"] == "drought", "a zeroed counter must not suppress a real drought"


def test_the_gap_this_closes_is_the_run_that_did_not_try() -> None:
    """Pins what `/api/system-status` covers, so this check's reason to exist is testable.

    Read from `api/system-status/index.js`, its newsroom rule is::

        generated > 0 and publishable == 0   ->  stale

    Reproduced here as the *subject under description*, not as a second
    implementation of it: nothing imports this, and it exists only so the
    boundary is written down as executable fact rather than as a claim in a
    comment. The row that matters is the last one.
    """

    def existing_check_says_stale(generated: int, publishable: int) -> bool:
        return generated > 0 and publishable == 0

    assert existing_check_says_stale(8, 0), "wrote articles, published none -> already caught"
    assert not existing_check_says_stale(8, 2), "produced -> correctly green"
    assert not existing_check_says_stale(0, 0), (
        "THE GAP: a run that generated nothing at all stays green, for ever, "
        "because it fails the first clause. That is the quiet day, and a "
        "sequence of them is a drought no existing check can see."
    )


def test_a_drought_with_healthy_feeds_does_not_claim_a_source_is_in_trouble() -> None:
    """The headline must name what is actually wrong.

    Counting `problems` would report a drought behind seven perfect feeds as
    "1 wire source in trouble" -- a sentence a reader would believe, describing
    something that did not happen. Same class as the empty-wire headline that
    was fixed before it shipped, arriving from a second direction.
    """
    drought = wire_check.judge_drought(
        _report((_NOW - timedelta(hours=100)).isoformat().replace("+00:00", "Z")), now=_NOW
    )
    verdict = wire_check.evaluate([_ok_result("lsm_en")], [], now=_NOW, drought=drought)
    text = wire_check.render_text(verdict)

    assert verdict["alert"]
    assert "wire source" not in verdict["headline"], verdict["headline"]
    assert verdict["headline"] == "the wire is fine and no original journalism is being published"
    assert "DROUGHT" in text


def test_a_drought_and_a_dead_feed_are_both_named() -> None:
    drought = wire_check.judge_drought(
        _report((_NOW - timedelta(hours=100)).isoformat().replace("+00:00", "Z")), now=_NOW
    )
    verdict = wire_check.evaluate(
        [_ok_result("good"), _broken_result("bad", verified=None)], [], now=_NOW, drought=drought
    )
    assert verdict["alert"]
    assert len(verdict["problems"]) == 2
    assert "1 wire source in trouble, and no original journalism" == verdict["headline"]


def test_the_drought_line_is_printed_even_when_healthy() -> None:
    """Reported on every run, not only when it is bad.

    A figure that appears only on failure cannot be watched trending towards
    failure, and a reader has no way to tell 'healthy' from 'not measured'.
    """
    verdict = wire_check.evaluate([_ok_result()], [], now=_NOW, drought=wire_check.judge_drought(_report(), now=_NOW))
    assert "original journalism:" in wire_check.render_text(verdict)


def test_an_omitted_drought_is_not_reported_as_healthy() -> None:
    """Absence must not certify. `drought=None` means 'not measured', and the
    report says nothing rather than printing a reassuring line."""
    verdict = wire_check.evaluate([_ok_result()], [], now=_NOW)
    assert verdict["drought"] is None
    assert "original journalism:" not in wire_check.render_text(verdict)


def test_fetch_run_report_turns_every_failure_into_data() -> None:
    def exploding(*_: Any, **__: Any) -> Any:
        raise OSError("connection reset by peer")

    fetched = wire_check.fetch_run_report(timeout=1, opener=exploding)
    assert fetched["body"] is None
    assert "connection reset" in fetched["error"]
    assert wire_check.judge_drought(fetched, now=_NOW)["state"] == "unreadable"





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

# ── one vantage, and what a reading from it licences ────────────────────────
#
# The defect these close, stated once: `FAIL err_en HTTP 403` and
# `FAIL baltictimes HTTP 403` are the same line, and on 2026-09-01 one of them
# was a dead publisher and the other was a blocked runner. Measured with the
# probe's own user agent from a third network on that day, err_en answered 200
# with 50 items while baltictimes answered 403 — and the collector, in Azure,
# had published 27 ERR-attributed cards the afternoon before. The report told
# the reader the registry "contradicts this reading" and to fix the note.


def _refused(source_id: str = "err_en", *, status: int = 403, verified: str | None = "2026-08-28 — HTTP 200") -> dict[str, Any]:
    return wire_check.judge_source(
        _FakeSource(id=source_id, name=source_id, verified=verified),
        {
            "http_status": status,
            "body": b"<html><title>Access denied</title>error code: 1020</html>",
            "latency_ms": 417,
            "transport_error": None,
        },
        today=_TODAY,
    )


@pytest.mark.parametrize(
    ("status", "expected", "why"),
    [
        (401, True, "not authenticated is a statement about the caller"),
        (403, True, "not allowed is a statement about the caller"),
        (407, True, "proxy authentication is a statement about the path"),
        (429, True, "rate limiting is a statement about the caller"),
        (451, True, "a legal or geographic refusal is aimed at the caller"),
        (404, False, "a missing resource is a statement about the resource"),
        (410, False, "a withdrawn resource is a statement about the resource"),
        (500, False, "a server error is the server describing itself"),
        (503, False, "unavailable is the server describing itself"),
    ],
)
def test_only_a_refusal_status_names_this_caller(status: int, expected: bool, why: str) -> None:
    """Read off RFC 9110 semantics, never off the body.

    Both halves are asserted, because a rule that marked everything would be as
    useless as one that marked nothing: 4xx-decline statuses are the server
    saying *not you*, and 404/410/5xx are the server describing the resource or
    itself, which a single vantage may reasonably repeat.
    """
    assert _refused(status=status)["vantage_specific"] is expected, why


def test_a_transport_failure_is_a_reading_of_the_path() -> None:
    """Nothing was answered, so there is no statement by the publisher to repeat."""
    result = wire_check.judge_source(
        _FakeSource(id="s", name="Source"),
        {"http_status": None, "body": b"", "latency_ms": 9, "transport_error": "connection reset"},
        today=_TODAY,
    )
    assert result["state"] == "unreachable"
    assert result["vantage_specific"] is True


def test_the_fix_the_note_advice_does_not_fire_on_a_refusal() -> None:
    """The false sentence, named: a 403 does not contradict a 200 seen elsewhere.

    err_en's registry note recorded HTTP 200 four days earlier and was true. The
    report called it contradicted and told the reader to fix it, which would have
    written a false claim about a third party into the file the newsroom trusts
    to say what is safe to use.
    """
    verdict = wire_check.evaluate([_refused()], [], now=_NOW)
    text = wire_check.render_text(verdict)

    assert "contradicts this reading" not in text
    assert "fix the note as well as the feed" not in text
    assert "does NOT contradict it" in text
    assert "a verified: line is a claim about the publisher" in text


def test_the_fix_the_note_advice_still_fires_where_it_was_written_for() -> None:
    """The companion, and the reason the advice is kept rather than deleted.

    ep_news answered HTTP 202 with nothing in it while the registry vouched for
    it. Nothing about that names this caller, so the original sentence is right
    and must survive.
    """
    verdict = wire_check.evaluate([_broken_result("ep_news", verified="2026-08-24 — HTTP 200")], [], now=_NOW)
    text = wire_check.render_text(verdict)

    assert "contradicts this reading" in text
    assert "fix the note as well as the feed" in text


def test_a_lone_refusal_on_a_one_source_wire_still_alerts() -> None:
    """Renamed from ``test_a_refusal_is_still_an_alert``, because that is no
    longer the property and the test was passing for a reason its own docstring
    did not give.

    It said "nothing here is softened; a refusal still alerts". Since #349 a
    refusal may be severity ``unresolved`` and exit 0 — and this case still
    alerts anyway, for a different reason the old name concealed: ``_refused()``
    builds a wire of exactly one source, so nothing delivered, so the coverage
    floor refuses to downgrade it. The assertion never exercised the rule it
    claimed to.

    ``test_the_production_reading_is_reported_and_does_not_ring`` is the case the
    old name implied, and it is the one that changed.
    """
    verdict = wire_check.evaluate([_refused()], [], now=_NOW)
    assert verdict["summary"]["healthy"] == 0, "the reason this alerts, stated"
    assert verdict["severity"] == wire_check.SEVERITY_ALERT
    assert verdict["alert"] is True
    assert len(verdict["problems"]) == 1


def test_the_headline_does_not_blame_the_publisher_when_every_problem_is_ours() -> None:
    """The issue title is the whole of what most people read.

    It arrives in a notification at breakfast, and "1 wire source in trouble" is
    the sentence that sends somebody to disable a feed that answers 200 from
    everywhere except one runner.
    """
    headline = wire_check.evaluate([_refused()], [], now=_NOW)["headline"]
    assert headline == "1 wire source refused or unreachable from this vantage"


def test_a_mixed_reading_does_not_claim_every_problem_is_ours() -> None:
    """The negative control for the headline above."""
    verdict = wire_check.evaluate(
        [_refused(), _broken_result("ep_news", verified=None)], [], now=_NOW
    )
    assert verdict["headline"] == "2 wire sources in trouble"
    assert verdict["summary"]["vantage_specific"] == 1


def test_a_fixture_without_the_new_field_still_alerts_rather_than_raising() -> None:
    """The rehearsal path judges hand-written JSON, and a probe that raises is silent.

    Absence resolves to the pre-existing branch, which is the louder of the two
    and never a silence.
    """
    legacy = {
        "id": "x", "name": "X", "tier": "C", "endpoint": "https://x.test/rss",
        "http_status": 403, "bytes": 10, "items": 0, "latency_ms": 5,
        "verified": "2026-08-24 — HTTP 200", "verified_age_days": 4,
        "state": "http_error", "detail": "answered HTTP 403",
    }
    verdict = wire_check.evaluate([legacy], [], now=_NOW)
    assert verdict["alert"] is True
    assert "contradicts this reading" in wire_check.render_text(verdict)


# ── the body it used to throw away ──────────────────────────────────────────


def test_the_failing_body_is_carried_into_the_report() -> None:
    """The artefact that did not exist: 1070 bytes reported as the number 1070.

    A reader sent to the run log to see whether a 403 was a WAF or a geo-block
    found a byte count, because the probe measured the body and discarded it.
    """
    text = wire_check.render_text(wire_check.evaluate([_refused()], [], now=_NOW))
    assert "error code: 1020" in text


def test_a_body_that_arrives_with_http_200_is_kept_too() -> None:
    """A challenge page served as 200 is a block the status code cannot show."""
    result = wire_check.judge_source(
        _FakeSource(id="s", name="Source"),
        {
            "http_status": 200,
            "body": b"<html>Checking your browser before accessing</html>",
            "latency_ms": 9,
            "transport_error": None,
        },
        today=_TODAY,
    )
    assert result["state"] == "no_items"
    assert "Checking your browser" in result["body_excerpt"]


def test_a_healthy_source_carries_no_excerpt() -> None:
    """The negative control: this is evidence about a failure, not a body dump."""
    assert _ok_result()["body_excerpt"] is None


def test_the_body_is_evidence_and_decides_nothing() -> None:
    """No word list. Two bodies a lexical check would separate; one verdict.

    `AGENTS.md` records four checks written as vocabularies in a single day, all
    four beaten by phrasing their author had not imagined. The status code is the
    structure here; the body is quoted to a human and read by nothing.
    """
    named = wire_check.judge_source(
        _FakeSource(id="s", name="S"),
        {"http_status": 403, "body": b"Attention Required! | Cloudflare", "latency_ms": 1, "transport_error": None},
        today=_TODAY,
    )
    silent = wire_check.judge_source(
        _FakeSource(id="s", name="S"),
        {"http_status": 403, "body": b"nope", "latency_ms": 1, "transport_error": None},
        today=_TODAY,
    )
    assert named["state"] == silent["state"] == "http_error"
    assert named["vantage_specific"] == silent["vantage_specific"] is True


def test_an_excerpt_cannot_close_the_issue_body_fence() -> None:
    """A third party's bytes must not decide how our own alert renders.

    The report is interpolated into a fenced block in a GitHub issue, so a body
    containing a fence would end it early.
    """
    excerpt = wire_check.body_excerpt(b"```\nnow I am outside the fence\n```")
    assert "`" not in excerpt


def test_an_excerpt_is_bounded_and_says_it_was_cut() -> None:
    excerpt = wire_check.body_excerpt(b"x" * 9000)
    assert len(excerpt) < 400
    assert "9000 bytes in total" in excerpt


def test_an_excerpt_strips_control_characters() -> None:
    """A response must not be able to move a cursor around in somebody's terminal."""
    excerpt = wire_check.body_excerpt(b"before\x1b[2Jafter\x00end")
    assert "\x1b" not in excerpt and "\x00" not in excerpt
    assert "before" in excerpt and "end" in excerpt


def test_an_empty_body_has_no_excerpt_rather_than_an_empty_one() -> None:
    assert wire_check.body_excerpt(b"") is None
    assert wire_check.body_excerpt(b"   \n\t ") is None


# ── saying where it stood ───────────────────────────────────────────────────


def test_the_vantage_is_read_from_the_environment_not_guessed() -> None:
    """Asserted with startswith, and that is not fussiness.

    Written as `"GitHub Actions" in name` this test could not fail: the honest
    non-CI description is "a host that does not identify itself as GitHub
    Actions", which contains the substring, so replacing the whole environment
    check with `if False:` left it green. A planted fault found that; reading it
    did not.
    """
    described = wire_check.describe_vantage(
        {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted"}
    )
    assert described["name"].startswith("GitHub Actions")
    assert "github-hosted" in described["name"]
    assert described["collector"] == wire_check.COLLECTOR_VANTAGE
    assert described["egress_ip"] is None, "no network call is made to describe a vantage"


def test_a_host_that_does_not_say_it_is_ci_is_not_called_ci() -> None:
    """The negative control, and it is the one that matters.

    A probe run from anywhere else must not be described as a runner, because the
    whole value of the field is the contrast it draws with Azure.

    Asserted as a property rather than as absence of a substring: the honest
    description *names* GitHub Actions in order to say it is not that, so
    `"GitHub Actions" not in name` fails on correct output. This is the
    file's own rule about lexical checks arriving in its own test.
    """
    plain = wire_check.describe_vantage({})["name"]
    runner = wire_check.describe_vantage({"GITHUB_ACTIONS": "true"})["name"]

    assert plain != runner
    assert not plain.startswith("GitHub Actions")
    assert "does not identify itself" in plain


@pytest.mark.parametrize("value", ["", "false", "False", "0", "no", "  "])
def test_only_a_true_flag_counts_as_ci(value: str) -> None:
    """Absence and denial resolve the same way, and neither invents a runner."""
    assert not wire_check.describe_vantage({"GITHUB_ACTIONS": value})["name"].startswith(
        "GitHub Actions"
    )


def test_the_report_says_where_it_stood_and_where_the_collector_stands() -> None:
    """The coverage-gap instinct, one level down.

    This report already names the sources it does not cover, every time. It said
    nothing about standing on a different network from the collector, which is
    the same omission about a different axis.
    """
    verdict = wire_check.evaluate(
        [_ok_result()], [], now=_NOW, vantage=wire_check.describe_vantage({"GITHUB_ACTIONS": "true"})
    )
    text = wire_check.render_text(verdict)
    assert "vantage GitHub Actions" in text
    assert wire_check.COLLECTOR_VANTAGE in text


def test_a_verdict_with_no_vantage_still_renders() -> None:
    """Absence is an absent line, never an invented one."""
    text = wire_check.render_text(wire_check.evaluate([_ok_result()], [], now=_NOW))
    assert "vantage" not in text


def test_the_egress_lookup_refuses_an_answer_that_is_not_an_address() -> None:
    """The control on the control: a successful request is not by itself an answer.

    The opener is injectable, so a double handing back a feed body must not put
    35 kilobytes of RSS into an alert.
    """

    class _Response:
        def __init__(self, payload: bytes) -> None:
            self._payload = payload

        def read(self) -> bytes:
            return self._payload

        def __enter__(self) -> Any:
            return self

        def __exit__(self, *_: Any) -> bool:
            return False

    assert wire_check.fetch_egress_ip(opener=lambda *_a, **_k: _Response(b"<rss>lots</rss>")) is None
    assert wire_check.fetch_egress_ip(opener=lambda *_a, **_k: _Response(b" 20.1.2.3\n")) == "20.1.2.3"


def test_the_egress_lookup_never_raises() -> None:
    def exploding(*_: Any, **__: Any) -> Any:
        raise OSError("no route to host")

    assert wire_check.fetch_egress_ip(opener=exploding) is None


def test_the_egress_lookup_is_not_made_on_a_healthy_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """A daily alert must not acquire a daily third-party dependency it never reads."""
    calls: list[int] = []
    monkeypatch.setattr(wire_check, "fetch_egress_ip", lambda **_: calls.append(1))
    monkeypatch.setattr(wire_check, "wire_sources", lambda _reg: ())
    monkeypatch.setattr(wire_check, "uncovered_sources", lambda _reg: ())
    monkeypatch.setattr(wire_check, "fetch_run_report", lambda **_: {"body": None, "error": "skip"})
    wire_check.run(timeout=1)
    assert calls == []

# ── where the alert is delivered ────────────────────────────────────────────
#
# A rehearsal drives the real notification path on purpose. What it must not do
# is write into the production incident record, and it did: `wire-alert.yml`
# passed a hardcoded `label: wire-alert`, so a rehearsal at 2026-09-01T08:18:15Z
# retitled live issue #335 and replaced its body while that outage was still
# happening. The nginx/Cloudflare payload was gone from the top of the issue for
# nine minutes.


def _live() -> dict[str, Any]:
    return wire_check.evaluate([_ok_result()], [], now=_NOW)


def _fixture() -> dict[str, Any]:
    verdict = wire_check.evaluate([_ok_result()], [], now=_NOW)
    verdict["source"] = "fixture:rehearsal.json"
    return verdict


def test_a_rehearsal_is_routed_away_from_the_live_issue() -> None:
    assert wire_check.alert_routing(_live())["label"] == "wire-alert"
    assert wire_check.alert_routing(_fixture())["label"] == "wire-alert-rehearsal"


def test_the_two_labels_are_compared_by_equality_not_by_substring() -> None:
    """The trap this suite has already been bitten by once, in this same family.

    `"wire-alert" in "wire-alert-rehearsal"` is True, so any assertion written
    with `in` passes whichever label is returned and certifies nothing. It is the
    same shape as `"GitHub Actions" in "a host that does not identify itself as
    GitHub Actions"`, which a planted fault caught in the vantage work.

    So the property is asserted as inequality, which no substring relation can
    satisfy -- and the substring relation is asserted to exist, so that a rename
    making `in` accidentally safe cannot quietly delete the reason for this test.
    """
    live = wire_check.alert_routing(_live())["label"]
    rehearsal = wire_check.alert_routing(_fixture())["label"]

    assert live != rehearsal
    assert live in rehearsal, "the substring relation that makes `in` useless here"


def test_the_rehearsal_says_so_in_the_title_not_only_in_the_body() -> None:
    """The title is what arrives in a notification, and is the whole of what most
    people read. The body already said `source fixture:...`, honestly, and that
    does not help somebody looking at a list of issues."""
    assert "rehearsal" in wire_check.alert_routing(_fixture())["subject"]
    assert "rehearsal" not in wire_check.alert_routing(_live())["subject"]


def test_the_routing_is_derived_from_what_was_judged() -> None:
    """Asked of the application rather than restated from the workflow input.

    A run given --fixture without setting `rehearse` is still a rehearsal, and
    routing on `source` reports it as one. Routing on the input would not.
    """
    for source, expected in (
        ("newsroom/sources.yaml", "wire-alert"),
        ("fixture:rehearsal.json", "wire-alert-rehearsal"),
        ("fixture:/tmp/anything.json", "wire-alert-rehearsal"),
    ):
        assert wire_check.alert_routing({"source": source})["label"] == expected, source


@pytest.mark.parametrize("verdict", [{}, {"source": None}, {"source": ""}])
def test_a_verdict_that_cannot_say_is_routed_to_the_live_issue(verdict: dict[str, Any]) -> None:
    """Which way does absence resolve, chosen rather than inherited.

    This is the one place in this file where absence does NOT resolve to the
    loudest reading, and the choice is deliberate: a dead monitor during a real
    outage must reach the real issue. Being wrong the other way costs a
    rehearsal touching the live issue, which is what already happens today.
    """
    assert wire_check.alert_routing(verdict)["label"] == "wire-alert"
    assert wire_check.alert_routing(verdict)["subject"] == "Newsroom wire"


def test_the_routing_reaches_the_json_the_workflow_reads() -> None:
    """The seam. The workflow reads report.json, so routing has to be in it.

    A field computed correctly and never written is the producer-side half of
    the seam failure this repository sweeps for.
    """
    import json
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "report.json"
        fixture = Path(tmp) / "rehearsal.json"
        fixture.write_text(json.dumps({"results": []}), encoding="utf-8")

        wire_check.main(["--fixture", str(fixture), "--json", str(path)])
        payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["routing"]["label"] == "wire-alert-rehearsal"
    assert payload["routing"]["subject"] == "Newsroom wire (rehearsal)"


def test_a_live_run_writes_the_live_routing_into_that_json(monkeypatch: pytest.MonkeyPatch) -> None:
    """The companion, so the test above cannot pass by always saying rehearsal."""
    import json
    import tempfile

    monkeypatch.setattr(wire_check, "wire_sources", lambda _reg: ())
    monkeypatch.setattr(wire_check, "uncovered_sources", lambda _reg: ())
    monkeypatch.setattr(wire_check, "fetch_run_report", lambda **_: {"body": None, "error": "skip"})

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "report.json"
        wire_check.main(["--json", str(path), "--timeout", "1"])
        payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["routing"]["label"] == "wire-alert"
    assert payload["routing"]["subject"] == "Newsroom wire"


# ── the workflow reads what the probe writes ────────────────────────────────


def _wire_alert_yaml() -> dict[str, Any]:
    import yaml

    return yaml.safe_load((REPO_ROOT / ".github" / "workflows" / "wire-alert.yml").read_text(encoding="utf-8"))


def test_the_workflow_no_longer_hardcodes_the_live_label() -> None:
    """The consumer half of the seam, asserted against the workflow itself.

    `label: wire-alert` as a literal is the defect: it is what sent a rehearsal
    into the production incident record, and no amount of correctness in
    alert_routing fixes it while the caller ignores the answer.
    """
    notify = _wire_alert_yaml()["jobs"]["notify"]["with"]

    assert notify["label"] != "wire-alert", "a literal here ignores the probe's answer"
    assert "needs.check.outputs.label" in notify["label"]
    assert "needs.check.outputs.subject" in notify["subject"]


def test_the_workflow_falls_back_to_the_live_issue_when_the_job_dies() -> None:
    """A check job that dies emits no outputs at all, and an empty label would
    make `gh issue list --label ''` match nothing -- losing the alert at the
    moment it matters most."""
    notify = _wire_alert_yaml()["jobs"]["notify"]["with"]

    assert "'wire-alert'" in notify["label"]
    assert "'Newsroom wire'" in notify["subject"]


def test_the_check_job_publishes_the_routing_it_computes() -> None:
    """Producer and consumer named together: the notify job reads
    `needs.check.outputs.label`, so the check job has to declare it."""
    outputs = _wire_alert_yaml()["jobs"]["check"]["outputs"]

    assert "label" in outputs and "subject" in outputs
    assert "steps.judge.outputs.label" in outputs["label"]
    assert "steps.judge.outputs.subject" in outputs["subject"]

def test_the_workflow_passes_the_rehearsal_flag_the_probe_already_wrote() -> None:
    """A seam orphan, and it rang the real alarm.

    Both probes have written `routing.rehearsal` since #340 and #343, and NOTHING
    read it -- measured on master at 752a335: 2 producers, 0 consumers. #340 and
    #343 routed a rehearsal away from the production issue and stopped there,
    because the issue is where a rehearsal leaves a lasting mark. It is not where
    a rehearsal is loudest.

    Measured, Telegram message 1173 at 2026-09-01T08:18Z, a rehearsal in the real
    chat:

        portaBaltica newsroom wire: ALERT - 1 wire source refused or ...
        checked 2026-09-01T08:17:59Z
        source  fixture:rehearsal.json      <- line 3, below the preview

    The body was honest and the notification was not.
    """
    flow = _wire_alert_yaml()

    assert "rehearsal" in flow["jobs"]["check"]["outputs"]
    assert "steps.judge.outputs.rehearsal" in flow["jobs"]["check"]["outputs"]["rehearsal"]
    assert "needs.check.outputs.rehearsal" in flow["jobs"]["notify"]["with"]["rehearsal"]


def test_a_lost_rehearsal_flag_resolves_to_a_real_alarm() -> None:
    """Which way does absence resolve, and here it is not a free choice.

    Dressing a real alarm as a rehearsal is the one direction that could get a
    live outage ignored, so absence must resolve to 'false' at every step of the
    chain -- in the check job, which defaults it when the report carries no
    routing, and in the notify job, which covers the check job dying outright.
    """
    flow_text = (REPO_ROOT / ".github" / "workflows" / "wire-alert.yml").read_text(encoding="utf-8")

    assert 'routing.get("rehearsal") or "false"' in flow_text
    assert "needs.check.outputs.rehearsal || 'false'" in flow_text

# ── the third state ─────────────────────────────────────────────────────────
#
# The defect, stated once. This probe reasoned about vantage ambiguity in its
# prose and then acted as though it were certain: `alert` was `bool(problems)`,
# so a reading it had explicitly declared inconclusive about the publisher
# exited 1 and rang the same Telegram alarm, in the same channel, as a confirmed
# outage. Measured across every run GitHub still retains, keyed on each run's
# own `source` field: 10 failures, of which 3 were fixtures, 2 were the check
# job killed on purpose, and all 5 remaining were `err_en` alone with 6 of 7
# sources delivering. An alarm wrong every time it fires is wallpaper.
#
# Every test below is one clause of the conjunction in `evaluate`, because each
# is a separate way this could go quiet during a real outage, and a single "is
# it bad" assertion would not tell you which one had stopped working.


def _wire(*, delivering: int = 6) -> list[dict[str, Any]]:
    """The shape of the live wire: several sources delivering, and room for one more."""
    return [_ok_result(f"s{n}") for n in range(delivering)]


def test_the_production_reading_is_reported_and_does_not_ring() -> None:
    """2026-09-01, five times: six sources delivering and err_en answering 403.

    This is the reading the whole change exists for, and it is the one case the
    old suite never built -- every refusal test used a one-source wire, where
    the coverage floor alerts for an unrelated reason.
    """
    verdict = wire_check.evaluate(_wire() + [_refused()], [], now=_NOW)

    assert verdict["severity"] == wire_check.SEVERITY_UNRESOLVED
    assert verdict["alert"] is False
    assert verdict["summary"]["answered_refusals"] == 1
    assert verdict["headline"] == "1 wire source refused this vantage; 6 still delivering"


def test_an_unresolved_reading_is_never_rendered_as_ok() -> None:
    """The shape's refusal, and the reason `render_text` needed a third mark.

    `mark = "ALERT" if verdict["alert"] else "OK"` would print OK over a source
    that failed to deliver -- swapping a false alarm for a false all-clear,
    which is the worse of the two and the obvious way to get this wrong.
    """
    text = wire_check.render_text(wire_check.evaluate(_wire() + [_refused()], [], now=_NOW))

    assert text.startswith("portaBaltica newsroom wire: UNRESOLVED")
    assert "OK" not in text.splitlines()[0]
    # The reading is still there in full: the failing row, the body the server
    # sent, and the caveat naming both vantages.
    assert "FAIL err_en" in text
    assert "Access denied" in text
    assert "does NOT contradict it" in text
    assert "reported, not alerting" in text
    assert "Problems:" not in text, "a heading that reasserts the certainty just withdrawn"


def test_the_exit_code_a_workflow_reads_is_clean_for_an_unresolved_reading() -> None:
    """The seam. `evaluate` deciding severity changes nothing unless `main` agrees."""
    import json
    import tempfile

    fixture = {"results": [_ok_result("good"), _refused()]}
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "f.json"
        path.write_text(json.dumps(fixture, default=str), encoding="utf-8")
        report = Path(tmp) / "r.json"
        code = wire_check.main(["--fixture", str(path), "--json", str(report)])
        payload = json.loads(report.read_text(encoding="utf-8"))

    assert code == wire_check.EXIT_CLEAN
    assert payload["routing"]["severity"] == wire_check.SEVERITY_UNRESOLVED


def test_the_exit_code_a_workflow_reads_rings_for_a_real_outage() -> None:
    """The companion, so the assertion above cannot be satisfied by always
    returning zero -- which is the single most dangerous line this change could
    have introduced, and the one a test of the quiet path alone would miss."""
    import json
    import tempfile

    fixture = {"results": [_ok_result("good"), _broken_result("dead", verified=None)]}
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "f.json"
        path.write_text(json.dumps(fixture, default=str), encoding="utf-8")
        report = Path(tmp) / "r.json"
        code = wire_check.main(["--fixture", str(path), "--json", str(report)])
        payload = json.loads(report.read_text(encoding="utf-8"))

    assert code == wire_check.EXIT_ALERT
    assert payload["routing"]["severity"] == wire_check.SEVERITY_ALERT


# ── every way it must still ring ────────────────────────────────────────────
#
# The half that matters. Making an alarm quieter is easy to get wrong in the one
# direction nobody notices, so each clause is asserted against the SAME base
# reading that goes quiet above -- six delivering plus a refusal -- with exactly
# one thing added. Anything that still rings, rings because of that one thing.


def test_a_refusal_beside_a_genuinely_dead_feed_rings() -> None:
    """The mixed reading. One inconclusive source may not vouch for another."""
    verdict = wire_check.evaluate(
        _wire() + [_refused(), _broken_result("ep_news", verified=None)], [], now=_NOW
    )
    assert verdict["severity"] == wire_check.SEVERITY_ALERT
    assert verdict["alert"] is True


def test_a_refusal_beside_a_transport_failure_rings() -> None:
    """The safety property the whole downgrade rests on, asserted directly.

    A WAF answers and a dead host does not, so a source that is *gone* -- DNS
    withdrawn, connection refused, TLS failed, timed out -- arrives as a
    transport failure. `judge_source` marks it `vantage_specific` and is right
    to; it is deliberately NOT counted as an answered refusal, so it rings.
    """
    unreachable = wire_check.judge_source(
        _FakeSource(id="gone", name="gone"),
        {"http_status": None, "body": b"", "latency_ms": 9, "transport_error": "Name or service not known"},
        today=_TODAY,
    )
    assert unreachable["vantage_specific"] is True, "the field it shares with a refusal"

    verdict = wire_check.evaluate(_wire() + [_refused(), unreachable], [], now=_NOW)
    assert verdict["severity"] == wire_check.SEVERITY_ALERT
    assert verdict["summary"]["vantage_specific"] == 2
    assert verdict["summary"]["answered_refusals"] == 1, "the two populations differ, and that is the point"


def test_a_wire_where_nothing_delivered_rings() -> None:
    """The coverage floor. Zero delivering means this probe learned nothing.

    Not a threshold somebody chose -- it is the boundary between holding
    evidence that the wire works and holding none, so it needs no invented
    number to defend.
    """
    verdict = wire_check.evaluate([_refused("a"), _refused("b")], [], now=_NOW)
    assert verdict["severity"] == wire_check.SEVERITY_ALERT
    assert verdict["summary"]["healthy"] == 0


def test_one_delivering_source_is_the_boundary() -> None:
    """The companion, so the floor above is a boundary rather than a blanket."""
    assert wire_check.evaluate(
        _wire(delivering=1) + [_refused()], [], now=_NOW
    )["severity"] == wire_check.SEVERITY_UNRESOLVED


def test_a_refusal_during_a_drought_rings() -> None:
    """A quiet wire cannot excuse a silent newsroom. The drought is a different
    question and fails in a way no feed check can see."""
    drought = {
        "state": "drought", "detail": "no original article has been published for 96.0 hours",
        "last_original_at": "2026-08-24T12:00:00Z", "hours": 96.0, "runs_without_originals": 0,
    }
    verdict = wire_check.evaluate(_wire() + [_refused()], [], now=_NOW, drought=drought)
    assert verdict["severity"] == wire_check.SEVERITY_ALERT


def test_an_unreadable_run_report_beside_a_refusal_rings() -> None:
    """Absence resolves to alerting, and a refusal must not absorb it."""
    unknown = wire_check.judge_drought({"body": None, "error": "HTTPError: 500"}, now=_NOW)
    verdict = wire_check.evaluate(_wire() + [_refused()], [], now=_NOW, drought=unknown)
    assert verdict["severity"] == wire_check.SEVERITY_ALERT


@pytest.mark.parametrize("status", [404, 410, 500, 503])
def test_a_status_about_the_resource_or_the_server_is_never_downgraded(status: int) -> None:
    """404 and 410 describe the resource; 5xx is the server describing itself.

    None of those is the server saying *not you*, so a single vantage may
    reasonably repeat them and there is nothing ambiguous to withdraw.
    """
    verdict = wire_check.evaluate(_wire() + [_refused(status=status)], [], now=_NOW)
    assert verdict["severity"] == wire_check.SEVERITY_ALERT


@pytest.mark.parametrize("status", [401, 403, 407, 429, 451])
def test_every_declining_status_is_downgraded(status: int) -> None:
    """The companion. A rule that downgraded nothing would pass every test above."""
    verdict = wire_check.evaluate(_wire() + [_refused(status=status)], [], now=_NOW)
    assert verdict["severity"] == wire_check.SEVERITY_UNRESOLVED


def test_a_challenge_page_served_with_http_200_still_rings() -> None:
    """The block a status code cannot show, and the reason `no_items` exists.

    Cloudflare's interstitial arrives as 200 with a body that yields no feed
    items. Nothing about it names this caller in the status line, so it is not a
    refusal, and it must not ride out on one.
    """
    challenge = wire_check.judge_source(
        _FakeSource(id="cf", name="cf"),
        {"http_status": 200, "body": b"<html>Just a moment...</html>", "latency_ms": 20, "transport_error": None},
        today=_TODAY,
    )
    assert challenge["state"] == "no_items"
    assert wire_check.evaluate(_wire() + [challenge], [], now=_NOW)["severity"] == wire_check.SEVERITY_ALERT


def test_an_empty_wire_is_not_reachable_through_the_quiet_path() -> None:
    """Zero sources means zero refusals, so every count agrees the wire is
    perfect. That arithmetic is what the empty-wire guard exists against, and a
    new severity is a new way to arrive at it."""
    verdict = wire_check.evaluate([], [], now=_NOW)
    assert verdict["severity"] == wire_check.SEVERITY_ALERT
    assert verdict["alert"] is True


def test_a_fixture_that_omits_the_field_cannot_be_downgraded_by_its_status() -> None:
    """Absence resolves to ringing, and the downgrade is a conjunction because
    of it.

    A hand-written rehearsal fixture carrying a 403 and no `vantage_specific`
    key predates this change. Keying the downgrade on the status alone would
    silently reclassify every one of them -- so the status is necessary and not
    sufficient, and the field has to be present and true.
    """
    legacy = {
        "id": "x", "name": "X", "tier": "C", "endpoint": "https://x.test/rss",
        "http_status": 403, "bytes": 10, "items": 0, "latency_ms": 5,
        "verified": "2026-08-24 - HTTP 200", "verified_age_days": 4,
        "state": "http_error", "detail": "answered HTTP 403",
    }
    verdict = wire_check.evaluate(_wire() + [legacy], [], now=_NOW)
    assert verdict["severity"] == wire_check.SEVERITY_ALERT


@pytest.mark.parametrize("verdict", [{}, {"severity": None}, {"severity": "nonsense"}, {"alert": True}])
def test_a_verdict_that_cannot_say_its_severity_rings(verdict: dict[str, Any]) -> None:
    """`severity_of` is the fallback for the two verdicts built by hand -- the
    unreadable registry, and the unreadable fixture -- and for a report written
    by an older revision of this script. None of them may reach the one state
    that suppresses an exit code."""
    assert wire_check.severity_of(verdict) != wire_check.SEVERITY_UNRESOLVED


def test_severity_of_can_still_say_ok() -> None:
    """The companion, so the assertion above is not satisfied by a constant."""
    assert wire_check.severity_of({"alert": False}) == wire_check.SEVERITY_OK
    assert wire_check.severity_of({"severity": "unresolved"}) == wire_check.SEVERITY_UNRESOLVED


def test_the_hand_built_verdicts_name_their_severity(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stated rather than inferred. A monitor reporting its own failure should
    not depend on a fallback to be heard."""
    def _boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("sources.yaml is not readable")

    monkeypatch.setattr(wire_check, "registry", _boom)
    verdict = wire_check.run(timeout=1)

    assert verdict["severity"] == wire_check.SEVERITY_ALERT
    assert verdict["alert"] is True


# ── where an unresolved reading is delivered ────────────────────────────────


def _unresolved() -> dict[str, Any]:
    return wire_check.evaluate(_wire() + [_refused()], [], now=_NOW)


def test_an_unresolved_reading_cannot_close_the_live_outage_issue() -> None:
    """The trap this routing exists to avoid, and it is not tidiness.

    `alert-notify.yml` has two modes, and `alert: 'false'` is not "say nothing":
    it finds the open issue carrying the label it was given, comments
    **"Recovered."** and closes it. Routing an unresolved reading to
    `wire-alert` would therefore close the live outage issue as recovered, on
    the strength of a reading that has just said it cannot tell whether anything
    recovered -- a false word in the one place a reader goes to find out.
    """
    live = wire_check.alert_routing(wire_check.evaluate(_wire(), [], now=_NOW))
    unresolved = wire_check.alert_routing(_unresolved())

    assert live["label"] == "wire-alert"
    assert unresolved["label"] == "wire-vantage"
    assert unresolved["label"] != live["label"]
    # Neither name contains the other, so no assertion written with `in` can
    # pass whichever label is returned -- the trap this suite was bitten by once.
    assert live["label"] not in unresolved["label"]
    assert unresolved["label"] not in live["label"]


def test_an_unresolved_rehearsal_is_routed_away_from_both_live_issues() -> None:
    """Two dimensions, four labels, and a rehearsal must not touch either record."""
    verdict = _unresolved()
    verdict["source"] = "fixture:rehearsal.json"
    routing = wire_check.alert_routing(verdict)

    assert routing["label"] == "wire-vantage-rehearsal"
    assert routing["rehearsal"] == "true"
    assert "vantage" in routing["subject"] and "rehearsal" in routing["subject"]


def test_the_severity_reaches_the_json_the_workflow_reads() -> None:
    """The seam, producer side. The workflow keys its annotation on this field,
    so a severity computed correctly and never written is the half of a seam
    failure this repository sweeps for."""
    assert wire_check.alert_routing(_unresolved())["severity"] == wire_check.SEVERITY_UNRESOLVED
    assert wire_check.alert_routing(wire_check.evaluate(_wire(), [], now=_NOW))["severity"] == wire_check.SEVERITY_OK


# ── the workflow reads it, and absence resolves to ringing ──────────────────


def test_the_check_job_publishes_the_severity_it_computes() -> None:
    """Producer and consumer named together."""
    outputs = _wire_alert_yaml()["jobs"]["check"]["outputs"]
    assert "severity" in outputs
    assert "steps.judge.outputs.severity" in outputs["severity"]


def test_a_report_with_no_severity_still_rings() -> None:
    """The one state that suppresses a notification must be reachable only by
    being named -- in the probe, and again in the YAML that reads it."""
    flow_text = (REPO_ROOT / ".github" / "workflows" / "wire-alert.yml").read_text(encoding="utf-8")
    assert 'routing.get("severity") or "alert"' in flow_text


def test_the_workflow_rings_when_either_signal_says_so() -> None:
    """Two independent sources failing in opposite directions: the exit code
    catches a crash that never reached a verdict, the severity catches a verdict
    that never reached the exit code. Silence needs both to agree."""
    flow_text = (REPO_ROOT / ".github" / "workflows" / "wire-alert.yml").read_text(encoding="utf-8")
    assert '[ "$code" -eq 0 ] && [ "$severity" != "alert" ]' in flow_text


def test_an_unresolved_reading_is_visible_on_a_green_run() -> None:
    """Reported, recorded and visible is the whole justification for not
    ringing. A green run with nothing on it would be a silence."""
    flow_text = (REPO_ROOT / ".github" / "workflows" / "wire-alert.yml").read_text(encoding="utf-8")
    assert "::warning::" in flow_text
    assert "GITHUB_STEP_SUMMARY" in flow_text


# ── the rehearsals, judged rather than described ────────────────────────────


def _rehearsal_fixtures() -> dict[str, str]:
    """Every `--fixture` body in the workflow, extracted from the workflow.

    Asked of the file rather than retyped here: a copy of these fixtures in the
    test would be a second implementation that agrees with itself on the day it
    is written and then disagrees silently.
    """
    import re

    import yaml

    doc = yaml.safe_load((REPO_ROOT / ".github" / "workflows" / "wire-alert.yml").read_text(encoding="utf-8"))
    run = next(s for s in doc["jobs"]["check"]["steps"] if s.get("id") == "rehearsal")["run"]

    fixtures: dict[str, str] = {}
    for arm in re.findall(r"^  ([a-z-]+)\)$", run, re.M):
        # Bounded by this arm's own `;;`. Without that bound the search runs on
        # into the NEXT arm's heredoc, and `empty-wire` -- whose body is a
        # printf rather than a heredoc -- silently picks up the drought fixture
        # and is judged as a drought. Measured while writing this: it read as a
        # real result, because a drought is a plausible thing for a rehearsal to
        # produce.
        segment = run.split(f"\n  {arm})\n", 1)[1].split("\n    ;;", 1)[0]
        heredoc = re.search(r"<<'JSON'\n(.*?)\n\s*JSON\n", segment, re.S)
        if heredoc:
            fixtures[arm] = "\n".join(
                line[2:] if line.startswith("  ") else line for line in heredoc.group(1).split("\n")
            )
            continue
        printf = re.search(r"printf '(.*?)\\n' > rehearsal\.json", segment)
        if printf:
            fixtures[arm] = printf.group(1)
    return fixtures


def test_every_rehearsal_the_dropdown_offers_has_a_fixture() -> None:
    """The enumeration rule: the set the guard walks must equal the set the
    behaviour walks. A dropdown option with no `case` arm produces a run that
    probes the live wire while the operator believes they are rehearsing."""
    import yaml

    doc = yaml.safe_load((REPO_ROOT / ".github" / "workflows" / "wire-alert.yml").read_text(encoding="utf-8"))
    offered = set(doc[True]["workflow_dispatch"]["inputs"]["rehearse"]["options"]) - {"no"}
    fixtures = _rehearsal_fixtures()

    assert fixtures, "extracted nothing -- a broken instrument, not an empty workflow"
    assert set(fixtures) == offered
    assert len(set(fixtures.values())) == len(fixtures), "two arms sharing one body"


def test_exactly_one_rehearsal_is_quiet_and_the_rest_ring() -> None:
    """Judged by running each fixture through the probe, not by reading the YAML.

    `blocked-vantage` now rehearses the quiet path, which is worth rehearsing --
    it is how you find out the state is reachable and legible once reached. The
    assertion that matters is the other four: a change making rehearsals quiet
    in general would pass a test that only checked the one.
    """
    import json

    quiet, loud = [], []
    for arm, body in sorted(_rehearsal_fixtures().items()):
        verdict = wire_check.evaluate(
            json.loads(body)["results"], [], now=_NOW, drought=json.loads(body).get("drought")
        )
        (quiet if verdict["severity"] != wire_check.SEVERITY_ALERT else loud).append(arm)

    assert quiet == ["blocked-vantage"]
    assert loud == ["dead-feed", "drought", "empty-wire", "total-refusal"]


def test_the_loud_escalation_has_a_rehearsal_of_its_own() -> None:
    """`blocked-vantage` stopped ringing, so the case that proves a refusal can
    still ring needed one. `total-refusal` is the same 403 with nothing left
    delivering -- the two fixtures differ only in whether anything got through."""
    import json

    fixtures = _rehearsal_fixtures()
    quiet = json.loads(fixtures["blocked-vantage"])["results"]
    loud = json.loads(fixtures["total-refusal"])["results"]

    assert {r["http_status"] for r in loud} == {403}
    assert any(r["state"] == "ok" for r in quiet), "one gets through"
    assert not any(r["state"] == "ok" for r in loud), "none does"
