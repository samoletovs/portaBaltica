#!/usr/bin/env python3
"""Probe the newsroom's wire and its output, because nothing else does.

WHY THIS EXISTS
---------------
`/api/system-status` watches the twelve *dashboard* sources, and `#188` gave
that detection a way to reach a human. The newsroom had neither: no probe on
the feeds it reads, and nothing at all watching whether it still publishes
journalism of its own.

Two feeds were found dead by reading Application Insights traces by hand, and
both had been failing in every run since at least 2026-08-27:

    ep_news      HTTP 202 with a ZERO-byte body
    baltictimes  HTTP 403 on every path tried

Both failed soft. Both still carried ``verified: "2026-08-24 - HTTP 200"`` in
the registry — a stale verification, which is worse than none, because the next
reader concludes the feed is fine and stops looking. Disabling those two fixed
two instances and left the class wide open. This closes the class.

THE TWO QUESTIONS, AND WHY ONE MONITOR ASKS BOTH
------------------------------------------------
This file asks about the newsroom's **inputs** — do its feeds deliver — and
about its **output** — is it still publishing original journalism. They fail
independently, and the second failure is invisible from the first: every feed
can be perfectly healthy while the portal publishes nothing of its own and
fills the front page with syndicated link-out cards.

They live together because to a reader they are the same failure — no news —
and because splitting them would mean a second issue, a second label and a
second stream of notification competing for the same attention. See
``judge_drought`` for what the existing checks do and do not cover.

WHY ``response.ok`` IS NOT THE TEST
-----------------------------------
``ep_news`` is the counter-example living in this repository: HTTP **202**, zero
bytes of body, and every check written against ``response.ok`` calls it healthy.
A status code is a proxy for "did we get content", and that proxy has already
been beaten here.

So the property asserted is the one the pipeline actually needs: **the body
parses as a feed and yields at least one item.** That is not a paraphrase of
the pipeline's definition — it *is* the pipeline's definition, because this
calls ``parse_feed`` from ``newsroom.pipeline.collect.rss``, the same function
``collect_feeds`` parses with. A feed that stops satisfying it is a feed that
contributes nothing to an edition, whatever the status line says.

WHY THIS IS PYTHON
------------------
Because the registry is. ``AGENTS.md`` is emphatic that a guard must not
restate the enumeration it guards, and this repository has shipped that fault
three times — including a status probe that drifted from the app it was
probing. Reimplementing "which sources are on the wire" in JavaScript would be
exactly that. This asks the registry instead.

WHICH SOURCES, AND WHY NOT ALL SEVENTEEN
----------------------------------------
The subject is what ``collect_feeds`` fetches, which is **not**
``enabled_sources()``. Measured against the live registry:

    17  registered
    14  enabled
     7  actually fetched   <- enabled AND tier B or C

The seven enabled sources this probe does not cover are all tier A — Eurostat,
ECB, Elering, data.gov.lv, Statistics Estonia, data.gov.lt, Open-Meteo. They
are statistical APIs rather than feeds; several carry URL *templates* rather
than URLs, and "parses as a feed with at least one item" is not a meaningful
question to ask of them. Probing them here would report a permanent, false red.

That gap is *stated in every report* rather than left implicit. A guard that
covers a smaller population than it appears to is correct about everything it
looks at and blind to the rest, which is the failure mode this file is written
against — so the report names the sources it did not probe, every time, and
makes no claim about whether something else covers them.

ONE VANTAGE, AND WHAT A READING FROM IT DOES NOT LICENCE
--------------------------------------------------------
This runs on a GitHub Actions runner. The collector runs in Azure. Those are
different networks, so every line below is a reading of **one path** and only
indirectly a statement about the publisher — and on 2026-09-01 that distinction
produced a false alarm this file now refuses to repeat.

``err_en`` answered HTTP 403 to the runner at 06:54Z. Measured against the same
feed, with the user agent this probe already takes from the pipeline:

    GitHub Actions runner   2026-09-01 06:54Z   HTTP 403,  1070 bytes,  0 items
    a third network         2026-09-01 07:15Z   HTTP 200, 35465 bytes
    the collector, in Azure 2026-08-31 14:08Z   27 items attributed and published

The report nevertheless said the registry's ``verified: "… HTTP 200 …"`` note
"contradicts this reading" and told the reader to fix it. It does not contradict
it. A 403 is the server declining **this caller**, which is exactly as
consistent with "it blocks this runner" as with "it is down" — so acting on that
advice would have written a false claim about a third party into the file the
newsroom trusts to say what is safe to use.

The registry carries its own control, which is what makes this checkable rather
than a story. ``baltictimes`` records ``verified: "2026-08-28 — HTTP 403.
Dead."`` and answers 403 from that third network too, on the same day and from
the same machine that ``err_en`` answered 200 to. One of those two 403s is a
dead publisher and the other is a blocked vantage, and **they produce the
identical ``FAIL … HTTP 403`` line**.

The remedy is the one ``AGENTS.md`` prescribes for two states with one artefact:
a new field rather than new logic. ``vantage_specific`` marks a reading that
names *this caller* — a refusal status, or a transport failure that answered
nothing — and the "fix the note" advice fires only where the reading does not.
Nothing is made quieter: a refusal still alerts, because a block reaching this
runner today may reach Azure tomorrow. What changes is what the alert claims.

Two supporting changes fall out of the same morning. The probe now says **where
it stood**, because "7 enabled source(s) outside this probe" was already the
right instinct about a coverage gap and this is the same omission one level
down. And it keeps a short excerpt of a failing response body, which it used to
measure and discard: the 1070 bytes that would have settled the question existed
only inside the process that threw them away, and the reader sent to the run log
for them found a byte count.

ABSENCE RESOLVES TO AN ALERT
----------------------------
The same rule as `scripts/source-alert.mjs`, and it matters more here. These
sources fail **soft** by design, and that is correct: one dead feed must not
take an edition down. The consequence is that the pipeline keeps running, keeps
publishing, and keeps saying nothing. This probe is the only thing that will
ever make a dead feed visible — so a probe that itself fails soft is worthless.
A transport error, an unreadable registry, an empty wire, a body that yields no
items, or a run report that cannot say when the newsroom last published are all
alerts here, never passes.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from newsroom.pipeline import config  # noqa: E402
from newsroom.pipeline.collect.rss import parse_feed  # noqa: E402
from newsroom.pipeline.safety import registry  # noqa: E402

#: A `verified:` note older than this is worth mentioning. It is deliberately
#: generous: an old date on a *working* feed is untidy, not urgent, and a daily
#: alert about untidiness is how an alert channel becomes wallpaper.
STALE_VERIFICATION_DAYS = 45

#: HTTP statuses in which the server answered and declined **this caller**.
#:
#: This is read off the status semantics (RFC 9110), not off the body, and the
#: difference is the whole point. Classifying a 403 by looking for "Cloudflare"
#: or "Access denied" in the response would be a word list encoding the examples
#: we happen to have seen — ``AGENTS.md`` records four checks written that way in
#: a single day, every one beaten by ordinary prose their author had not thought
#: of. A status, by contrast, *is* the structure:
#:
#:     401  you are not authenticated          -> about the caller
#:     403  you are not allowed                -> about the caller
#:     407  your proxy did not authenticate    -> about the path
#:     429  you have asked too often           -> about the caller
#:     451  you are refused for legal reasons  -> about the caller, often by geography
#:
#: Every one of those is the server saying *not you*, so it is as consistent with
#: "it refuses this vantage" as with "it refuses everyone" — and a probe standing
#: in one place cannot tell those apart. 404, 410 and 5xx are excluded because
#: they are the server describing the *resource* or *itself*, which is a claim a
#: single vantage may reasonably repeat.
CALLER_DECLINED_STATUSES = frozenset({401, 403, 407, 429, 451})

#: Where the newsroom's collector actually fetches these feeds from. Stated as a
#: constant so the report can say plainly that this probe is not standing there,
#: rather than leaving a reader to infer it from `runs-on:` in a workflow file.
COLLECTOR_VANTAGE = "portabaltica-func, Azure northeurope"

#: How much of a failing response body to carry into the report. Long enough for
#: a WAF's own explanation of itself, short enough for a Telegram message.
BODY_EXCERPT_CHARS = 300

#: Answers with the caller's own egress address, in plain text. Read only when a
#: reading has already turned on which network we are standing in, so a healthy
#: run never touches it.
EGRESS_IP_URL = "https://api.ipify.org"

#: How long the newsroom may go without publishing an original article before
#: that is worth waking somebody for.
#:
#: WHERE THIS NUMBER COMES FROM, because a wrong one here is worse than none.
#: The pipeline is *designed* to have quiet days — a run that finds nothing
#: worth writing about says so and stops — so alerting on one would be crying
#: wolf, and `AGENTS.md` is explicit that a gate people learn to route around is
#: worse than no gate at all.
#:
#: Measured against the live article index on 2026-08-28 (25 tier A articles,
#: 2026-08-24T19:59Z → 2026-08-27T17:10Z):
#:
#:     history span            69.2 hours (2.88 days)
#:     days with 0 originals   0 of 4
#:     gap between originals   p50 0.2h,  p90 15.3h,  max 26.2h
#:
#: **The record contains no drought at all**, so this budget is not a percentile
#: of observed droughts — there is no such distribution to take one from, and
#: inventing a number from a four-day sample of an unusually busy period would
#: be false precision. It is derived from the schedule instead.
#:
#: `SCHEDULE` is `0 0 14 * * *`, one timer run a day. So a single quiet day puts
#: at most ~48h between originals: publish at 14:05, nothing the next day,
#: publish again at 14:05 the day after. A 48-hour budget would therefore fire
#: on exactly the behaviour the pipeline is built to have. 72 hours is three
#: consecutive scheduled runs producing nothing, which no single quiet day can
#: reach, and it sits 2.7× above the worst gap ever observed.
#:
#: Revisit it when there is a real distribution to revisit it against.
MAX_HOURS_WITHOUT_ORIGINAL = 72

#: The newsroom's own run report. Public, no credential — the same blob base
#: `api/shared/newsroom.js` reads finished articles from.
RUN_REPORT_URL = (
    "https://stportabalticabpmff5so.blob.core.windows.net/articles/runs/latest.json"
)

#: The registry's `verified:` values begin with an ISO date, then an em-dash and
#: a human note: `2026-08-24 — HTTP 200, RSS 2.0`. Only the date is parsed.
_VERIFIED_DATE = re.compile(r"^\s*(\d{4}-\d{2}-\d{2})")

#: An egress lookup's answer has to look like an address before it is believed.
#: The opener is injectable for tests, and a double handing back a feed body must
#: not put 35 kilobytes of RSS into an alert.
_ADDRESS_SHAPED = re.compile(r"^[0-9a-fA-F:.]{7,45}$")

#: Control characters, minus tab/newline/carriage-return, which the whitespace
#: collapse below handles. A third party's bytes must not be able to move a
#: cursor around in somebody's terminal.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

EXIT_CLEAN = 0
EXIT_ALERT = 1
EXIT_USAGE = 2


# ── which sources ───────────────────────────────────────────────────────────


def wire_sources(reg: Any) -> tuple[Any, ...]:
    """The sources ``collect_feeds`` fetches: enabled, and tier B or C.

    This mirrors ``newsroom/pipeline/run.py``. Mirroring is a liability — a
    guard that restates its subject is a second implementation that can
    disagree — and there is no shared helper to call instead, because the
    filter is written inline inside ``collect_feeds`` and that file belongs to
    another workstream.

    So the drift is closed by a test rather than by a comment:
    ``newsroom/tests/test_wire_probe.py`` runs the **real** ``collect_feeds``
    against a recording fake and asserts the set it actually fetched equals the
    set returned here. That compares behaviour, not source text, so it cannot
    be satisfied by two implementations that merely look alike, and it goes red
    the day someone changes the filter upstream.
    """
    enabled_ids = {source.id for source in reg.enabled_sources()}
    return tuple(
        source
        for tier in ("B", "C")
        for source in reg.by_tier(tier)
        if source.id in enabled_ids
    )


def uncovered_sources(reg: Any) -> tuple[Any, ...]:
    """Enabled sources this probe does *not* look at, so the gap is never implicit."""
    on_wire = {source.id for source in wire_sources(reg)}
    return tuple(source for source in reg.enabled_sources() if source.id not in on_wire)


# ── where this reading was taken ────────────────────────────────────────────


def describe_vantage(env: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Where this probe is standing, read from the environment rather than guessed.

    Free, and it cannot fail: no network call, no third party, nothing to time
    out inside an alerting path. The egress address is a separate, optional
    lookup — see ``fetch_egress_ip`` — because it costs a request and is only
    worth making once a reading has turned on which network we are in.

    The point of the field is the contrast it sets up. This probe answers "can
    *I* fetch this feed"; the question anybody actually has is "can the
    *collector* fetch this feed", and those differ by a whole network.
    ``AGENTS.md`` names that gap directly: a control validates the mechanism, not
    the mapping from the question to the measurement. Naming both ends is the
    cheapest honest thing available, and it is the same instinct as the coverage
    gap this report already states every time.
    """
    env = os.environ if env is None else env
    if str(env.get("GITHUB_ACTIONS", "")).strip().lower() == "true":
        where = str(env.get("RUNNER_ENVIRONMENT") or "unspecified")
        name = f"GitHub Actions ({where} runner)"
    else:
        # Not "a developer machine": this is what the environment does not say,
        # and a probe run from anywhere else must not be described as one.
        name = "a host that does not identify itself as GitHub Actions"
    return {"name": name, "egress_ip": None, "collector": COLLECTOR_VANTAGE}


def fetch_egress_ip(*, timeout: float = 5.0, opener: Any = None) -> str | None:
    """Which address this probe leaves from, when that has become the question.

    Evidence only, and it decides nothing. It is here because it turns "somewhere
    inside GitHub Actions" into a fact somebody can paste into a support request
    or check against a published range — which is precisely the step between the
    guess "they may block CI ranges" and knowing.

    Never raises, and never returns something merely because a request
    succeeded: the answer is checked for the shape of an address first. An
    unreadable one is ``None``, which renders as an absent field rather than as a
    confident wrong address.
    """
    request = urllib.request.Request(
        EGRESS_IP_URL,
        headers={"User-Agent": config.USER_AGENT, "Accept": "text/plain"},
    )
    try:
        open_url = opener or urllib.request.urlopen
        with open_url(request, timeout=timeout) as response:
            text = response.read().decode("utf-8", "replace").strip()
    except Exception:  # noqa: BLE001 - an address we cannot read is a detail, not a failure
        return None
    return text if _ADDRESS_SHAPED.match(text) else None


def body_excerpt(body: bytes) -> str | None:
    """A short, safe rendering of a failing response body, as evidence for a human.

    WHY THE BODY IS KEPT AT ALL
    ---------------------------
    Because throwing it away cost the programme its decisive artefact. This probe
    used to compute ``len(body)`` and discard the bytes, so ``err_en`` was
    reported as ``HTTP 403 … 1070B`` and the 1070 bytes — which say who refused
    us and why, in as many words — existed only inside the process that dropped
    them. Somebody then went to the run log for a body the run log had never
    carried. A probe holding the discriminating evidence and reporting a summary
    statistic of it is the cheapest kind of self-inflicted blindness there is.

    WHY IT IS EVIDENCE AND NEVER A DECISION
    ---------------------------------------
    Nothing in this file matches on what is in here, and nothing should. The
    verdict is taken from the status code's own semantics — see
    ``CALLER_DECLINED_STATUSES`` — so a WAF vendor nobody has met yet is
    classified correctly while still being quoted verbatim to the reader.
    """
    if not body:
        return None
    text = _CONTROL_CHARS.sub(" ", body.decode("utf-8", "replace"))
    # Backticks are neutralised because this is interpolated into a fenced block
    # in a GitHub issue body. A response containing ``` would close the fence
    # early and let a third party's bytes decide how our own alert renders.
    text = " ".join(text.replace("`", "'").split())
    if not text:
        return None
    if len(text) > BODY_EXCERPT_CHARS:
        text = f"{text[:BODY_EXCERPT_CHARS].rstrip()}… ({len(body)} bytes in total)"
    return text


# ── one source ──────────────────────────────────────────────────────────────


def verified_age_days(verified: str | None, *, today: date) -> int | None:
    """Whole days since the registry says someone last checked. None if it cannot tell."""
    if not isinstance(verified, str):
        return None
    match = _VERIFIED_DATE.match(verified)
    if not match:
        return None
    try:
        stamped = date.fromisoformat(match.group(1))
    except ValueError:
        return None
    return (today - stamped).days


def fetch_feed(url: str, *, timeout: float, opener: Any = None) -> dict[str, Any]:
    """Fetch one feed the way the pipeline does, and report what came back.

    The user-agent and Accept header are taken from the pipeline's own config
    and default rather than invented here. A probe that identifies itself
    differently from the app is measuring a different request: content
    negotiation and bot rules both key on these, and ``baltictimes`` returning
    403 is exactly the kind of answer that can depend on them.

    Never raises. Every failure is data, because a probe that can throw is a
    probe that can take the alert down with it.
    """
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": config.USER_AGENT,
            "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
            "Accept-Encoding": "identity",
        },
    )
    started = time.monotonic()
    try:
        open_url = opener or urllib.request.urlopen
        with open_url(request, timeout=timeout) as response:
            body = response.read()
            return {
                "http_status": getattr(response, "status", None),
                "body": body,
                "latency_ms": round((time.monotonic() - started) * 1000),
                "transport_error": None,
            }
    except urllib.error.HTTPError as exc:
        # An HTTP error still carries a status, which is the useful part: 403
        # and 500 mean different things to whoever has to fix it.
        try:
            body = exc.read()
        except Exception:  # noqa: BLE001 - the body is a bonus, not the finding
            body = b""
        return {
            "http_status": exc.code,
            "body": body,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "transport_error": None,
        }
    except (urllib.error.URLError, ssl.SSLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        return {
            "http_status": None,
            "body": b"",
            "latency_ms": round((time.monotonic() - started) * 1000),
            "transport_error": str(reason) or exc.__class__.__name__,
        }


def judge_source(source: Any, fetched: dict[str, Any], *, today: date) -> dict[str, Any]:
    """Turn one fetch into a verdict about one source.

    The order matters. Transport failure, then HTTP status, then an empty body,
    then item count — each is a distinct thing to tell somebody, and collapsing
    them into "broken" would throw away the part that says what to do next.
    """
    body: bytes = fetched.get("body") or b""
    http_status = fetched.get("http_status")
    result: dict[str, Any] = {
        "id": source.id,
        "name": source.name,
        "tier": source.tier,
        "endpoint": source.endpoint,
        "http_status": http_status,
        "bytes": len(body),
        "items": 0,
        "latency_ms": fetched.get("latency_ms"),
        "verified": source.verified,
        "verified_age_days": verified_age_days(source.verified, today=today),
        "state": "ok",
        "detail": None,
        # Does this reading name *this caller* rather than the publisher? See
        # CALLER_DECLINED_STATUSES for what sets it.
        #
        # False is not a claim that another vantage would see the same thing. It
        # is the absence of a claim that it would not — which is why it is the
        # branch that keeps the louder, pre-existing advice.
        "vantage_specific": False,
        # What the server actually said, when it said no. Evidence for a human;
        # nothing in this file reads it. See body_excerpt.
        "body_excerpt": None,
    }

    if fetched.get("transport_error"):
        result["state"] = "unreachable"
        # Nothing was answered, so there is no statement by the publisher here to
        # repeat. Whatever else it is, it is a fact about the path from here.
        result["vantage_specific"] = True
        result["detail"] = f"could not be reached: {fetched['transport_error']}"
        return result

    if not source.endpoint:
        result["state"] = "misconfigured"
        result["detail"] = "is on the wire but the registry gives it no endpoint to fetch"
        return result

    if isinstance(http_status, int) and http_status >= 400:
        result["state"] = "http_error"
        result["vantage_specific"] = http_status in CALLER_DECLINED_STATUSES
        result["body_excerpt"] = body_excerpt(body)
        result["detail"] = f"answered HTTP {http_status}"
        return result

    # The ep_news case, and the reason this probe exists in the shape it does:
    # HTTP 202 with nothing in it. `response.ok` is true here.
    if len(body) == 0:
        result["state"] = "empty_body"
        result["detail"] = (
            f"answered HTTP {http_status} with a zero-byte body, which every check "
            "written against response.ok reads as success"
        )
        return result

    items = parse_feed(body, source_id=source.id, raw_blob="probe", retrieved_at=None)
    result["items"] = len(items)
    if not items:
        # The other place the body is the only evidence there is: a challenge
        # page served with HTTP 200 is a block that the status code cannot show.
        result["body_excerpt"] = body_excerpt(body)
        result["state"] = "no_items"
        result["detail"] = (
            f"answered HTTP {http_status} with {len(body)} bytes that yielded no feed "
            "items, so it contributes nothing to an edition"
        )
        return result

    return result


BROKEN_STATES = frozenset({"unreachable", "http_error", "empty_body", "no_items", "misconfigured"})


def vantage_caveat(
    result: Mapping[str, Any], *, verified_age: int | None, vantage: Mapping[str, Any] | None
) -> str:
    """What a reading that names *this caller* does, and does not, licence.

    This is the sentence that replaces "fix the note as well as the feed" when
    the probe cannot know whether the publisher is refusing everyone or refusing
    us. It says three things and no more: what was measured, from where, and
    that a `verified:` line is a claim about a third party rather than about our
    own network.

    It does not soften the alert. The reading still counts as a problem, still
    fails the run, and still opens the issue — because a block that reaches this
    runner today may reach the collector tomorrow, and "we cannot yet say which"
    is a reason to look rather than a reason to wait.
    """
    where = (vantage or {}).get("name") or "this probe's own network"
    address = (vantage or {}).get("egress_ip")
    if address:
        where = f"{where}, egress {address}"
    collector = (vantage or {}).get("collector") or COLLECTOR_VANTAGE

    if result.get("state") == "unreachable":
        what = "Nothing was answered at all, so this is a reading of the path from here"
    else:
        what = (
            f"HTTP {result.get('http_status')} is the server declining this caller, which is "
            "as consistent with it blocking this vantage as with it refusing everyone"
        )

    line = f"{what} — measured from {where}, while the collector fetches from {collector}. "

    verified = result.get("verified")
    if verified and verified_age is not None and verified_age <= STALE_VERIFICATION_DAYS:
        line += (
            f'The registry records verified: "{verified}" ({verified_age} day(s) ago) and this '
            "reading does NOT contradict it. "
        )
    line += (
        "Confirm the publisher refuses a second vantage before recording this against the "
        "source: a verified: line is a claim about the publisher, and this is a reading of "
        "one network path."
    )
    return line


# ── the newsroom's output ───────────────────────────────────────────────────


def fetch_run_report(
    url: str = RUN_REPORT_URL, *, timeout: float = 20.0, opener: Any = None
) -> dict[str, Any]:
    """Read the newsroom's run report. Never raises; every failure is data."""
    request = urllib.request.Request(
        url,
        headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"},
    )
    try:
        open_url = opener or urllib.request.urlopen
        with open_url(request, timeout=timeout) as response:
            return {"body": json.loads(response.read().decode("utf-8")), "error": None}
    except Exception as exc:  # noqa: BLE001 - a report we cannot read is a question we cannot answer
        return {"body": None, "error": f"{exc.__class__.__name__}: {exc}"}


def judge_drought(fetched: Mapping[str, Any], *, now: datetime) -> dict[str, Any]:
    """Has the newsroom published an original article recently enough?

    WHY THIS ASKS A DIFFERENT QUESTION FROM /api/system-status
    ----------------------------------------------------------
    That endpoint already probes this exact blob, and probes it well: its
    ``newsroom-run`` check reads ``finished_at``, judges it against the report's
    own ``stale_after_hours``, and — a detail worth crediting — marks the
    pipeline *stale* when it generated originals and published none of them.

    What no existing check covers is the run that **did not try**. Read from
    ``api/system-status/index.js``, the rule is::

        generated > 0 and publishable == 0   ->  stale

    so a run reporting ``generated: 0`` — the quiet day, "0 selected" — fails
    the first clause and stays green. ``finished_at`` advances on every run
    whatever came out of it, and the wire keeps syndicated cards flowing, so the
    portal can go indefinitely without original journalism while every monitor
    on it is green. That is the gap this closes.

    WHY ELAPSED TIME AND NOT ``runs_without_originals``
    ---------------------------------------------------
    The report carries a ready-made counter and it is the wrong instrument.
    ``runreport.py`` increments it once per **run** and resets it to zero the
    moment any run publishes an original, with no regard to what triggered the
    run. Measured over 2026-08-24→27: 4 timer runs against 52 manual ones. So
    the counter mixes two populations at 13:1 — an afternoon of manual
    experimentation crosses any run-count threshold, and a single manual run
    resets a genuine multi-day timer drought to zero.

    ``AGENTS.md`` already names this mistake in this codebase: the newsroom's
    own streak detector "walked the deltas between *readings* and stated the
    result as a claim about *periods*", and the ruling was **count the periods,
    not the observations**. A drought is a claim about elapsed time, so it is
    measured in elapsed time. The counter is still reported as context, and
    decides nothing.
    """
    body = fetched.get("body")

    if fetched.get("error") or not isinstance(body, Mapping):
        return {
            "state": "unreadable",
            "detail": (
                "the newsroom run report could not be read "
                f"({fetched.get('error') or 'it was not a JSON object'}), so whether the "
                "newsroom is still publishing original journalism is unknown"
            ),
            "last_original_at": None,
            "hours": None,
            "runs_without_originals": None,
        }

    liveness = body.get("liveness")
    liveness = liveness if isinstance(liveness, Mapping) else {}
    runs_without = liveness.get("runs_without_originals")
    last_at = liveness.get("last_original_at")

    result: dict[str, Any] = {
        "state": "ok",
        "detail": None,
        "last_original_at": last_at if isinstance(last_at, str) else None,
        "hours": None,
        # Reported, never decisive. See the docstring.
        "runs_without_originals": runs_without if isinstance(runs_without, int) else None,
    }

    if not isinstance(last_at, str) or not last_at:
        # Absence resolves to an alert. A report that cannot say when it last
        # produced original journalism is not evidence that it recently did.
        result["state"] = "unknown"
        result["detail"] = (
            "the run report carries no liveness.last_original_at, so nothing records when "
            "the newsroom last published an original article"
        )
        return result

    try:
        stamp = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
    except ValueError:
        result["state"] = "unknown"
        result["detail"] = f"liveness.last_original_at is not a readable timestamp: {last_at!r}"
        return result

    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)

    hours = (now - stamp).total_seconds() / 3600.0
    result["hours"] = round(hours, 1)

    if hours > MAX_HOURS_WITHOUT_ORIGINAL:
        result["state"] = "drought"
        result["detail"] = (
            f"no original article has been published for {hours:.1f} hours "
            f"(budget {MAX_HOURS_WITHOUT_ORIGINAL}h, which is three scheduled runs). The wire "
            "may still be full of syndicated cards, and every other check stays green through "
            "this"
        )

    return result


#: Drought states that alert. `ok` is the only one that does not, so a state
#: this file has never heard of cannot resolve to silence.
DROUGHT_PROBLEM_STATES = frozenset({"unreadable", "unknown", "drought"})


# ── the whole wire ──────────────────────────────────────────────────────────


def evaluate(
    results: Sequence[dict[str, Any]],
    uncovered: Iterable[Any],
    *,
    now: datetime,
    drought: Mapping[str, Any] | None = None,
    vantage: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Decide whether this reading is worth waking somebody for.

    Alerting:
      * a wire source that is unreachable, erroring, empty, or yielding nothing;
      * an **empty wire** — zero sources probed. Zero sources means zero failing
        sources, so every count agrees the wire is perfect. That arithmetic is
        exactly how "no data" reads as "no problem", and it is the shape this
        whole file is built against.
      * a ``verified:`` note that *contradicts* what was just measured. A
        registry claiming a recent successful check on a feed that is failing
        right now is not untidiness, it is a live falsehood aimed at the next
        person who looks — and it is the specific thing that let ep_news and
        baltictimes run for weeks.

        That advice fires only where the reading is *about the publisher*. A
        refusal or an unreachable path names this caller instead, and a note
        recording a 200 from somewhere else does not contradict it; saying it
        did is how a false claim about a third party gets written into the
        registry. Those readings get ``vantage_caveat`` and still alert.

    Noting, never alerting:
      * a merely old ``verified:`` date on a feed that works;
      * the sources this probe does not cover.
    """
    problems: list[str] = []
    notes: list[str] = []
    feed_problems = 0
    vantage_problems = 0

    if not results:
        problems.append(
            "The wire is empty: no enabled tier B or C source was probed. Zero sources "
            "means zero failures, so this reads as perfect health and is not."
        )

    for result in results:
        if result["state"] in BROKEN_STATES:
            line = f"{result['name']} ({result['id']}) {result['detail']}."
            age = result["verified_age_days"]
            # `.get` rather than `[]`: this also judges hand-written rehearsal
            # fixtures, and a probe that can raise is a probe that can take the
            # alert down with it. A missing key resolves to the pre-existing
            # branch, which is the louder of the two and never a silence.
            if result.get("vantage_specific"):
                vantage_problems += 1
                line += " " + vantage_caveat(result, verified_age=age, vantage=vantage)
            elif age is not None and age <= STALE_VERIFICATION_DAYS:
                # The registry is actively vouching for a feed that is down.
                line += (
                    f" The registry still records verified: \"{result['verified']}\" "
                    f"({age} day(s) ago), which contradicts this reading — fix the note "
                    "as well as the feed, or the next reader will conclude it is fine."
                )
            problems.append(line)
            feed_problems += 1
            continue

        age = result["verified_age_days"]
        if age is None:
            notes.append(
                f"{result['name']} ({result['id']}) carries no parsable verified: date, "
                f"so nothing records when a human last looked. {result['items']} items today."
            )
        elif age > STALE_VERIFICATION_DAYS:
            notes.append(
                f"{result['name']} ({result['id']}) is working ({result['items']} items) but "
                f"its verified: note is {age} days old."
            )

    uncovered = list(uncovered)
    if uncovered:
        names = ", ".join(sorted(s.id for s in uncovered))
        notes.append(
            f"Not probed by this check ({len(uncovered)}): {names}. These are enabled but "
            "collect_feeds does not fetch them, and they are statistical APIs rather than "
            "feeds, so 'parses as a feed' is not a question they can answer. This probe "
            "makes no claim about whether anything else covers them."
        )

    # The newsroom's output, which is a different question from its inputs and
    # fails in a way none of the feed checks above can see: every feed can be
    # delivering perfectly while the portal publishes no journalism of its own.
    if drought is not None:
        if drought["state"] in DROUGHT_PROBLEM_STATES:
            problems.append(f"Original journalism: {drought['detail']}.")
        else:
            hours = drought["hours"]
            runs = drought["runs_without_originals"]
            notes.append(
                f"Last original article {hours}h ago, inside the {MAX_HOURS_WITHOUT_ORIGINAL}h "
                f"budget (runs_without_originals={runs}, reported for context only — it counts "
                "runs of any trigger, so it is not what the budget is measured against)."
            )

    healthy = sum(1 for r in results if r["state"] == "ok")
    total_items = sum(r["items"] for r in results)
    alert = bool(problems)
    drought_problem = drought is not None and drought["state"] in DROUGHT_PROBLEM_STATES

    # The headline names what is actually wrong. Counting `problems` and calling
    # the total "wire sources in trouble" would report a drought with seven
    # healthy feeds as "1 wire source in trouble" -- a sentence a reader would
    # believe, describing something that did not happen. That is the same error
    # an empty wire produced before it was fixed, arriving from a second
    # direction, which is why the count is now built from the specific thing
    # rather than from the length of a mixed list.
    if not results and problems:
        headline = "the wire is empty"
    elif feed_problems and drought_problem:
        headline = (
            f"{feed_problems} wire source{'' if feed_problems == 1 else 's'} in trouble, "
            "and no original journalism"
        )
    elif drought_problem:
        headline = "the wire is fine and no original journalism is being published"
    elif feed_problems and vantage_problems == feed_problems:
        # Every problem names this caller, so the headline must not assert the
        # publishers are in trouble. The issue title is the whole of what most
        # people read -- it arrives in a notification at breakfast -- and "1 wire
        # source in trouble" is what sends somebody to disable a working feed.
        headline = (
            f"{feed_problems} wire source{'' if feed_problems == 1 else 's'} "
            "refused or unreachable from this vantage"
        )
    elif alert:
        headline = f"{feed_problems} wire source{'' if feed_problems == 1 else 's'} in trouble"
    else:
        headline = f"all {healthy} wire sources delivering ({total_items} items)"

    return {
        "alert": alert,
        "headline": headline,
        "problems": problems,
        "notes": notes,
        "summary": {
            "probed": len(results),
            "healthy": healthy,
            "broken": len(results) - healthy,
            "items": total_items,
            "uncovered": len(uncovered),
            "vantage_specific": vantage_problems,
        },
        "results": results,
        "drought": dict(drought) if drought is not None else None,
        "vantage": dict(vantage) if vantage is not None else None,
        "source": "newsroom/sources.yaml",
        "checkedAt": now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }


def render_text(verdict: dict[str, Any]) -> str:
    """The report as plain text, for the issue body and the Telegram message alike.

    Plain text and no markup, matching `telegram-check.yml`: none of this is
    trusted markup, and an unescaped entity in a publisher's name must never be
    able to fail a delivery.
    """
    mark = "ALERT" if verdict["alert"] else "OK"
    lines = [
        f"portaBaltica newsroom wire: {mark} — {verdict['headline']}",
        f"checked {verdict['checkedAt']}",
        f"source  {verdict['source']}",
    ]

    # Where this reading was taken, printed on every run and not only when it
    # matters, so a reader never has to work out from a workflow file that the
    # probe and the collector sit on different networks.
    v = verdict.get("vantage")
    if v:
        where = v.get("name") or "not recorded"
        if v.get("egress_ip"):
            where = f"{where}, egress {v['egress_ip']}"
        lines.append(
            f"vantage {where} — the collector fetches from "
            f"{v.get('collector') or COLLECTOR_VANTAGE}"
        )

    lines.append("")

    s = verdict["summary"]
    lines.append(
        f"{s['healthy']}/{s['probed']} wire sources delivering, {s['items']} items, "
        f"{s['uncovered']} enabled source(s) outside this probe"
    )

    # The output line, always printed, so a reader sees the newsroom's own
    # journalism reported beside the feeds that supply it rather than having to
    # infer it from their health.
    d = verdict.get("drought")
    if d is not None:
        if d["hours"] is None:
            lines.append(f"original journalism: UNKNOWN — {d['detail']}")
        else:
            flag = "DROUGHT" if d["state"] == "drought" else "ok"
            lines.append(
                f"original journalism: {flag} — last original {d['hours']}h ago "
                f"(budget {MAX_HOURS_WITHOUT_ORIGINAL}h, at {d['last_original_at']})"
            )

    if verdict["results"]:
        lines.append("")
        for r in sorted(verdict["results"], key=lambda r: (r["state"] == "ok", r["id"])):
            flag = "ok  " if r["state"] == "ok" else "FAIL"
            status = r["http_status"] if r["http_status"] is not None else "---"
            lines.append(
                f"  {flag} {r['id']:<20} HTTP {str(status):<4} "
                f"{r['bytes']:>7}B  {r['items']:>3} items  {r['latency_ms']}ms"
            )
            # What the server said, under the line saying how much of it there
            # was. The byte count on its own is what sent a reader to the run log
            # for a body the run log never had.
            if r.get("body_excerpt"):
                lines.append(f"       said: {r['body_excerpt']}")

    if verdict["problems"]:
        lines.append("")
        lines.append("Problems:")
        for p in verdict["problems"]:
            lines.append(f"  - {p}")

    if verdict["notes"]:
        lines.append("")
        lines.append("Noted, not alerting:")
        for n in verdict["notes"]:
            lines.append(f"  - {n}")

    return "\n".join(lines)


def run(*, timeout: float, opener: Any = None, now: datetime | None = None) -> dict[str, Any]:
    """Load the registry, probe the wire and the newsroom's output, and judge both.

    A registry that will not load is an alert rather than an exception: this is
    the only thing watching, and it must report its own failure rather than
    exit with a traceback the workflow has to guess at.
    """
    moment = now or datetime.now(timezone.utc)
    where = describe_vantage()

    try:
        reg = registry()
        sources = wire_sources(reg)
        uncovered = uncovered_sources(reg)
    except Exception as exc:  # noqa: BLE001 - a registry we cannot read is a wire we cannot clear
        return {
            "alert": True,
            "headline": "the source registry could not be read",
            "problems": [f"Could not load newsroom/sources.yaml: {exc}."],
            "notes": [],
            "summary": {
                "probed": 0,
                "healthy": 0,
                "broken": 0,
                "items": 0,
                "uncovered": 0,
                "vantage_specific": 0,
            },
            "results": [],
            "drought": None,
            "vantage": where,
            "source": "newsroom/sources.yaml",
            "checkedAt": moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        }

    today = moment.date()
    results = []
    for source in sources:
        fetched = (
            fetch_feed(source.endpoint, timeout=timeout, opener=opener)
            if source.endpoint
            else {"http_status": None, "body": b"", "latency_ms": 0, "transport_error": None}
        )
        results.append(judge_source(source, fetched, today=today))

    # Pay for the egress lookup only once a reading has turned on which network
    # this is. A healthy run must not acquire a daily third-party dependency for
    # a field nothing would read, and an alerting path must not wait on one.
    if any(r.get("vantage_specific") for r in results):
        where["egress_ip"] = fetch_egress_ip(timeout=min(timeout, 5.0), opener=opener)

    drought = judge_drought(fetch_run_report(timeout=timeout, opener=opener), now=moment)

    return evaluate(results, uncovered, now=moment, drought=drought, vantage=where)


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Probe every feed the newsroom's collector fetches.",
        epilog="exit: 0 clean, 1 alert, 2 bad usage",
    )
    parser.add_argument("--timeout", type=float, default=20.0, help="per-feed deadline in seconds")
    parser.add_argument("--json", dest="json_path", help="also write the verdict as JSON")
    parser.add_argument(
        "--fixture",
        help="judge a JSON file of pre-recorded results instead of fetching, for rehearsing the alert path",
    )
    args = parser.parse_args(argv)

    if args.timeout <= 0:
        parser.error("--timeout must be positive")

    if args.fixture:
        # A fixture that cannot be read is still an alert. The rehearsal path
        # must not be the one route in this file where failure means silence.
        try:
            recorded = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
            verdict = evaluate(
                recorded["results"],
                [],
                now=datetime.now(timezone.utc),
                # A fixture may rehearse the drought path too. Omitting the key
                # leaves the drought unreported rather than reported as healthy:
                # `evaluate` prints nothing for `None`, so a fixture cannot
                # accidentally certify output it said nothing about.
                drought=recorded.get("drought"),
                vantage=describe_vantage(),
            )
            verdict["source"] = f"fixture:{args.fixture}"
        except Exception as exc:  # noqa: BLE001
            verdict = {
                "alert": True,
                "headline": "the fixture could not be read",
                "problems": [f"Could not read {args.fixture}: {exc}."],
                "notes": [],
                "summary": {
                    "probed": 0,
                    "healthy": 0,
                    "broken": 0,
                    "items": 0,
                    "uncovered": 0,
                    "vantage_specific": 0,
                },
                "results": [],
                "drought": None,
                "vantage": describe_vantage(),
                "source": f"fixture:{args.fixture}",
                "checkedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            }
    else:
        verdict = run(timeout=args.timeout)

    text = render_text(verdict)
    print(text)

    if args.json_path:
        payload = dict(verdict)
        payload["text"] = text
        Path(args.json_path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    return EXIT_ALERT if verdict["alert"] else EXIT_CLEAN


if __name__ == "__main__":  # pragma: no cover - CLI wiring, exercised by the workflow
    sys.exit(main(sys.argv[1:]))
