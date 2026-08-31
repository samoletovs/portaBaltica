"""What happened on the last run, written where something can read it.

WHY THIS EXISTS
---------------
On 2026-08-25 the timer fired on schedule, the run completed inside its
timeout, and every tier A article it produced was rejected. The wire published
one syndicated card. Nothing anywhere said so.

That was not a monitoring gap that happened to be open. Application Insights is
receiving nothing from this app — no requests, no traces, no exceptions, no
custom events — and the Log Analytics workspace has no tables at all, despite
the connection string being present. So the only evidence a run had happened
was the articles it published, which meant a run that published nothing was
indistinguishable from a timer that never fired.

This is the same failure mode as a data source that silently freezes, which
this project has already been bitten by twice — the Riga OData endpoint and the
maritime CSVs that have been header-only since March. Both are caught because
``/api/system-status`` probes them and a human can see the result. A newsroom
that stops publishing deserves the same treatment.

WHAT IT IS NOT
--------------
It is not telemetry and it does not replace it. It is one small JSON document
per run, written to the container the site already reads from, using the
managed identity that already has permission. It cannot fail the run: the
caller wraps it, and a write that does not happen costs visibility, not
articles.

THE CONTRACT
------------
``articles/runs/latest.json`` always holds the most recent run.
``articles/runs/<YYYY-MM-DD>/<HHMMSS>.json`` holds the history, so a bad
afternoon can be reconstructed rather than inferred.

The shape is deliberately flat and boring, because something else has to
consume it — a status probe belongs on the API side, which this package does
not own. ``stale_after_hours`` is included so a probe does not have to hardcode
the schedule: it can compare ``finished_at`` against now and say "overdue"
without knowing anything about cron.

``liveness`` answers the question a single report cannot. A run that publishes
nothing is not necessarily broken — some days genuinely have no news, and a
probe that alarms on one quiet run is a probe someone mutes within a week.
Thirty consecutive silent runs is a different thing, and telling them apart
needs history. So the count is carried forward from the previous report rather
than recomputed, and one fetch answers both "is it alive" and "is it working".

WHY A REJECTION SAYS WHY
------------------------
The 14:00Z run of 2026-08-28 generated eight original articles across 21
attempts and published two. The report named the six that died and not one word
about why, so a reader could not tell the pipeline **working** — six bad drafts
correctly caught — from the pipeline **misfiring**, and those two produce a
byte-identical document. That is not a hypothetical distinction here: ``#171``
was *"Stop comparison_basis_stated rejecting a basis that is stated"* — nine of
nine rejections false, the check wrong and the writer right — and it was found
by a human reading the output, because a rejection left nothing behind to read.

Nothing had to be measured to fix it. ``write/generator.py`` has recorded the
gate, the checks and the detail on ``provenance.rejection`` since the day it
took 200 blobs to establish what was killing the wire — this file simply threw
it away and kept the slug. A computed answer discarded at the reporting layer,
which is the same defect shape as a freshness verdict the render layer drops.

So ``rejections`` carries one entry per rejected article and ``rejected_checks``
counts how many of them each check refused. The aggregate is the one that
answers the question fastest: six rejections spread across six checks is a
pipeline doing its job, and six rejections all naming one check is a check to go
and read. On the run above it was four of six for ``comparison_basis_stated``
and four of six for ``no_unsupported_mechanism`` — the first of those being the
check ``#171`` had already had to fix once, which is the whole argument for
putting the number somewhere a reader trips over it.

Two things it deliberately does not do. It does not restate the draft: the check
names are the queryable part and the detail is bounded, because this document is
fetched by a status probe on a schedule and a reason is not a payload — the full
text stays on the draft at ``rejected/<day>/<slug>.json``. And a rejection whose
reason was never recorded is **not** dropped and **not** given an empty one; it
appears carrying ``gate_unavailable``, mutually exclusive with ``gate``, exactly
as ``revision_unavailable`` sits beside ``revision`` on the article itself. A
missing reason is the one fault this section exists to make visible, so it must
not be the one thing the section can hide.

WHY THE CAUSAL PANEL IS COUNTED TWICE
-------------------------------------
Stage 6b asks several AI analysts *why* a figure moved, so an article can offer
a candidate cause instead of closing "the data does not show what drove the
change". It shipped, and no run-level instrument was told: ``summary()``
enumerates every enrichment stage that explains a thin wire and stopped one
short of the newest one, and this document had no key for it at all.

The counts that matter are ``articles_offered_a_cause`` and
``articles_stating_a_cause``, and the second is the one that could not be
inferred from anything else. An article naming no cause has two explanations —
the panel proposed nothing admissible, or it filed causes the correspondent
then used none of — and they are the same artefact, the same published count
and the same summary line. ``provenance.hypotheses`` had recorded which, per
article, since the day the panel shipped; nothing read it, so a run whose every
writer ignored the panel was indistinguishable from a run in which the panel
genuinely had nothing to say.

The shortfall between the two is a number to act on, not a gate. Nothing
rejects an article for staying silent and nothing should: the panel is depth,
and a check that fires on a true sentence is a worse defect than the thinness
it was aimed at. A shortfall that persists is the panel's *prompt* asking for
work, which is the same instrument as a rising ``discarded``.
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from newsroom.pipeline import config
from newsroom.pipeline.models import isoformat, utcnow
from newsroom.pipeline.publish import ArticleStore
from newsroom.validator import states_a_panel_cause

log = logging.getLogger(__name__)

#: Where the latest report lives, relative to the articles container root.
LATEST_BLOB = "runs/latest.json"

#: How long after a run the report should be treated as stale. The schedule is
#: at most three runs a day, so a report older than this means a run was missed
#: rather than merely being between runs. Stated in the document so a consumer
#: does not have to know the cron expression.
STALE_AFTER_HOURS = 26

REPORT_VERSION = 1

#: How much of a rejection's detail this document carries. The check names are
#: never cut — they are the part a reader filters on — but the detail can run
#: past 600 characters, most of it the same instruction repeated verbatim for
#: every occurrence of a fault. This file is fetched by a status probe on a
#: schedule, so the detail is a pointer to the evidence rather than the evidence
#: itself; the full text is on the stored draft. A cut is always marked and
#: measured, because a sentence that merely stops is indistinguishable from one
#: the pipeline wrote that way.
MAX_REJECTION_DETAIL = 200

#: Said when a rejection carries no recorded reason. It occupies the ``gate``
#: field's place without occupying its namespace: a consumer asking
#: ``"gate" in rejection`` is asking exactly "do we know why this died", and no
#: value of ``gate`` can answer yes by accident. Same construction as
#: ``revision_unavailable`` on the article, and for the same reason — a
#: placeholder that looks like an answer earns trust it has not verified.
UNRECORDED_REASON = (
    "the pipeline recorded no reason on this draft, so why it was refused "
    "cannot be told from this run alone"
)


def _history_blob(finished_at: str) -> str:
    day = finished_at[:10]
    stamp = finished_at[11:19].replace(":", "")
    return f"runs/{day}/{stamp}.json"


def _revision_stamp() -> dict[str, str]:
    """Which revision produced this run, or an explicit statement that we do not
    know.

    THE ARTICLE'S STAMP DOES NOT COVER THIS DOCUMENT, AND THE GAP HAS TEETH.
    Every published article already carries ``provenance.revision``, so the code
    behind a run was nominally recoverable: read ``published_slugs[0]``, fetch
    it, read its provenance. That works on every run except the one where it
    matters. A run that published nothing has an empty ``published_slugs``, and
    the revision becomes unrecoverable **precisely when the question is "what
    was deployed when this went wrong"**.

    This document is the thing a person reads after a bad afternoon — it says so
    at ``rejections`` — and it was the one artefact of the run that could not say
    which code produced it.

    Built by calling the article's own helper rather than re-reading
    ``config.REVISION`` here. Two readers of one setting drift, and the drift is
    silent in the direction that reports success: this document could name one
    revision while every article beside it named another, and nothing would
    disagree. It is the same reason ``statusChecks.js`` calls ``buildUrl``
    instead of restating the query.
    """
    from .write.generator import _revision_record

    return _revision_record()


def _sections_of(articles: Any) -> dict[str, int]:
    """How many articles each beat filed, highest first."""
    counts: dict[str, int] = {}
    for article in articles or ():
        section = getattr(article, "section", None)
        if isinstance(section, str) and section:
            counts[section] = counts.get(section, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def _clip(detail: str) -> str:
    """The detail, cut to length with the cut stated in characters."""
    if len(detail) <= MAX_REJECTION_DETAIL:
        return detail
    return f"{detail[:MAX_REJECTION_DETAIL]}… (+{len(detail) - MAX_REJECTION_DETAIL} more)"


def _reason_for(article: Any) -> dict[str, Any]:
    """Why one draft was refused, read off the artefact the writer stamped.

    Defensive in the same way the rest of this module is, and with one rule that
    matters more than the others: **every rejected article gets an entry**. The
    tempting shape is to skip an article carrying no reason, which reads as
    tidiness and is the failure this whole section exists to prevent — a
    rejection that leaves no trace is precisely what could not be told apart
    from a rejection that never happened.
    """
    entry: dict[str, Any] = {"slug": str(getattr(article, "slug", "") or "")}

    provenance = getattr(article, "provenance", None)
    record = provenance.get("rejection") if isinstance(provenance, Mapping) else None
    gate = record.get("gate") if isinstance(record, Mapping) else None
    if not isinstance(record, Mapping) or not isinstance(gate, str) or not gate:
        entry["gate_unavailable"] = UNRECORDED_REASON
        return entry

    entry["gate"] = gate
    raw_checks = record.get("checks")
    # A string is iterable, and iterating one gives characters. Guard the type
    # rather than the emptiness: `checks: "figures_traceable"` would otherwise
    # become seventeen single-letter check names, each counted in the aggregate.
    if isinstance(raw_checks, (list, tuple)):
        entry["checks"] = [str(check) for check in raw_checks if str(check)]
    else:
        entry["checks"] = []
    detail = record.get("detail")
    if isinstance(detail, str) and detail:
        entry["detail"] = _clip(detail)
    return entry


def _checks_of(reasons: list[dict[str, Any]]) -> dict[str, int]:
    """How many rejections each check refused, most-refused first.

    **Rejections, not failures.** An article that fails three checks contributes
    one to each of three names, so these values sum to more than the rejected
    count and adding them up says nothing. The question this answers is the only
    one that separates a working gate from a broken one at a glance: is the
    pipeline catching six different faults, or is one check eating the wire?
    """
    counts: dict[str, int] = {}
    for reason in reasons:
        for check in dict.fromkeys(reason.get("checks") or ()):
            counts[check] = counts.get(check, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def _causal_panel(report: Any, published: list[Any]) -> dict[str, Any]:
    """What the causal panel produced, and how much of it reached a reader.

    Two numbers carry this and neither is useful alone.
    ``articles_offered_a_cause`` counts published articles whose panel filed at
    least one admissible hypothesis. ``articles_stating_a_cause`` counts how
    many of those actually put one in the prose. The gap between them is the
    only place the newsroom can see the panel being paid for and then ignored,
    and it was invisible: an article closing "the data does not show what drove
    the change" is the same artefact whether nobody looked or four causes were
    filed and dropped at the last seam.

    ``discarded`` is here for the reason ``AnalystBrief.discarded`` is — a
    rising count is the prompt asking for attention — and ``consulted`` for the
    reason ``consulted`` exists on the panel at all: a panel that found nothing
    and a panel nobody convened are different articles, and a run report that
    cannot tell them apart repeats the fault the panel itself was built to fix.

    Defensive like everything else in this module. A panel object of the wrong
    shape costs its own entry in these counts and never the report.
    """
    raw = getattr(report, "panels", None)
    panels = list(raw.values()) if isinstance(raw, Mapping) else []

    hypotheses = 0
    discarded = 0
    consulted = 0
    for panel in panels:
        try:
            hypotheses += len(getattr(panel, "hypotheses", ()) or ())
            discarded += len(getattr(panel, "discarded", ()) or ())
            consulted += 1 if (getattr(panel, "consulted", ()) or ()) else 0
        except TypeError:
            continue

    offered = 0
    stated = 0
    for article in published:
        try:
            document = article.to_json()
        except Exception:  # noqa: BLE001 — a shape we did not expect
            continue
        if not isinstance(document, Mapping):
            continue
        # Read off the artefact, exactly as the validator does. A published
        # article carries its own panel on `provenance.hypotheses`, so this
        # asks the article rather than joining it back to `report.panels` by
        # signal id — a join is a second enumeration, and a syndicated card has
        # no key it could be joined on at all.
        if not _panel_filed_causes(document):
            continue
        offered += 1
        if states_a_panel_cause(document):
            stated += 1

    return {
        "panels": len(panels),
        "consulted": consulted,
        "hypotheses": hypotheses,
        "discarded": discarded,
        "articles_offered_a_cause": offered,
        "articles_stating_a_cause": stated,
    }


def _panel_filed_causes(document: Mapping[str, Any]) -> bool:
    """Did this article's panel file at least one admissible hypothesis?"""
    provenance = document.get("provenance")
    if not isinstance(provenance, Mapping):
        return False
    block = provenance.get("hypotheses")
    if not isinstance(block, Mapping):
        return False
    entries = block.get("hypotheses")
    return bool(isinstance(entries, list) and entries)


def build_run_report(
    report: Any,
    *,
    trigger: str,
    finished_at: str | None = None,
    previous: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """The document, from a :class:`~newsroom.pipeline.run.RunReport`.

    Duck-typed and defensive throughout. This runs at the very end of a run
    that may already have gone wrong, and a report that raises while explaining
    a failure is worse than no report — it turns a bad run into a crashed one.

    ``previous`` is the last report, when one could be read. It carries the two
    rolling fields, which exist because **a run that publishes nothing is not
    necessarily broken**. Some days genuinely have no news, and a probe that
    alarms on one quiet run will be muted within a week. Thirty consecutive
    silent runs is a different thing entirely, and the difference is not
    visible in any single report — so it is carried forward rather than
    recomputed, and a probe can judge both liveness and yield from one fetch.
    """
    finished = finished_at or isoformat(utcnow())

    def count(name: str) -> int:
        try:
            return len(getattr(report, name, ()) or ())
        except TypeError:
            return 0

    published = list(getattr(report, "published", ()) or [])
    rejected = list(getattr(report, "rejected", ()) or [])
    desk = list(getattr(report, "desk", ()) or [])

    # One enumeration behind the count, the list and the aggregate. Walking
    # `rejected` here and `generated` for the reasons would be two populations
    # that agree today and drift silently later, which is the hazard this repo
    # keeps finding in guards that re-derive what they guard.
    reasons = [_reason_for(article) for article in rejected]

    desk_actions: dict[str, int] = {}
    for outcome in desk:
        action = getattr(getattr(outcome, "action", None), "value", None)
        if action:
            desk_actions[action] = desk_actions.get(action, 0) + 1

    # The number that matters. Nine published articles from thirty runs and
    # nine from three are the same "published" count and completely different
    # states of health, and only this distinguishes them.
    #
    # The filter tests `provenance` for truthiness and then calls `.get` on it,
    # which is a type assumption wearing an emptiness check: anything truthy and
    # not a mapping raises here, at the very end of a run, and takes the whole
    # report with it. This module's contract is that it is "duck-typed and
    # defensive throughout" because "a report that raises while explaining a
    # failure is worse than no report" — so this is the contract being kept
    # rather than belt-and-braces. Found by a test written for the rejection
    # reasons below, which is the only reason it is documented rather than
    # discovered on the run it would have cost.
    generated = list(getattr(report, "generated", ()) or ())
    attempts: list[int] = []
    for g in generated:
        provenance = getattr(getattr(g, "article", None), "provenance", None)
        # `not provenance` keeps the original falsy skip exactly, so an empty
        # provenance still contributes no attempt and `attempts_total` is
        # unchanged for every input that did not already crash.
        if not isinstance(provenance, Mapping) or not provenance:
            continue
        try:
            attempts.append(int(provenance.get("attempts", 1)))
        except (TypeError, ValueError):
            continue
    originals_published = sum(1 for g in generated if getattr(g, "publishable", False))

    prior = previous if isinstance(previous, Mapping) else {}
    prior_rolling = prior.get("liveness") if isinstance(prior.get("liveness"), Mapping) else {}
    if originals_published:
        last_original_at: Any = finished
        runs_without_originals = 0
    else:
        last_original_at = prior_rolling.get("last_original_at")
        try:
            runs_without_originals = int(prior_rolling.get("runs_without_originals", 0)) + 1
        except (TypeError, ValueError):
            runs_without_originals = 1

    return {
        "version": REPORT_VERSION,
        "finished_at": finished,
        "trigger": trigger,
        **_revision_stamp(),
        "schedule": config.SCHEDULE,
        "stale_after_hours": STALE_AFTER_HOURS,
        "summary": str(getattr(report, "summary", lambda: "")() or ""),
        "counts": {
            "signals_detected": count("signals"),
            "articles_generated": len(generated),
            "published": len(published),
            "rejected": len(rejected),
            "syndicated": count("syndicated"),
            "syndication_skipped": int(getattr(report, "syndication_skipped", 0) or 0),
            "errors": count("errors"),
            "style_notes": count("style_notes"),
        },
        "original_articles": {
            # Split out because tier A is the thing that keeps failing, and a
            # published count that includes syndicated cards hid exactly that:
            # the day the wire published nothing original still reported one
            # published article.
            "generated": len(generated),
            "publishable": originals_published,
            "attempts_total": sum(attempts),
            "attempts_max": max(attempts, default=0),
        },
        "liveness": {
            # What a probe needs to tell a quiet day from a dead pipeline.
            "last_original_at": last_original_at,
            "runs_without_originals": runs_without_originals,
        },
        # Which beats made the page. A front page is a shape, not just a count:
        # three trade stories and no maritime is not one an editor would lay
        # out, and until the balance-of-payments family map landed that is
        # exactly what the ranking produced. Reported so the effect is
        # observable rather than assumed.
        #
        # TWO POPULATIONS, BECAUSE ONE OF THEM ANSWERS THE QUESTION AND THE
        # OTHER SWAMPS IT. ``sections`` counts everything published, which is
        # dominated by syndicated cards: measured on 2026-08-30 it read
        # ``government 49 · energy 2 · property 1`` while the newsroom's own
        # eight originals spanned economy, energy, property and trade. An
        # operator asking "what do we cover?" got a confident wrong answer from
        # the field built to answer it -- a link-out to another outlet's
        # government story is not this newsroom filing a government beat.
        #
        # This is the same split, for the same reason, as ``original_articles``
        # twelve lines above: "a published count that includes syndicated cards
        # hid exactly that". The remedy was applied to the counts and never to
        # the shape, and the correct sibling sitting nearby is what made the
        # broken one look considered.
        "sections": _sections_of(published),
        "original_sections": _sections_of(
            [g.article for g in generated if getattr(g, "publishable", False)]
        ),
        # What the causal panel produced, and how much of it a reader actually
        # got. `articles_offered_a_cause` minus `articles_stating_a_cause` is
        # the whole point of the block: it is the only number that separates a
        # panel with nothing to say from a panel whose work was thrown away
        # between the brief and the prose.
        "causal_panel": _causal_panel(report, published),
        "desk": desk_actions,
        "published_slugs": [getattr(a, "slug", "") for a in published][:50],
        "rejected_slugs": [getattr(a, "slug", "") for a in rejected][:50],
        # Which check refused how many of them. Computed over every rejection
        # rather than over the truncated list below, so the cluster stays exact
        # on a run long enough to be cut.
        "rejected_checks": _checks_of(reasons),
        # And the individual verdicts, so a suspicious cluster can be read
        # rather than guessed at. Truncated like the slug lists above; the
        # aggregate is the complete statement.
        #
        # NO CODE READS EITHER OF THESE, AND THAT IS THE INTENT. Grepping the
        # fields a producer writes against the names its consumers read is how
        # the defect this section fixed was found, so both will show up on that
        # sweep as answers nobody uses. They are not: the consumer is a person
        # reading `runs/latest.json` after a bad afternoon, which is the only
        # reader that can tell a correct rejection from a broken check. Said
        # here so the next sweep gets its answer from the code rather than
        # having to reconstruct it.
        "rejections": reasons[:50],
        "errors": [str(e) for e in (getattr(report, "errors", ()) or ())][:20],
    }


async def write_run_report(
    report: Any,
    *,
    trigger: str,
    store: ArticleStore | None = None,
    finished_at: str | None = None,
) -> dict[str, Any]:
    """Write the report to ``runs/latest.json`` and to the dated history."""
    target = store or ArticleStore()
    try:
        previous = await target.read_json(LATEST_BLOB)
    except Exception:  # noqa: BLE001 — no history is not a failure
        log.warning("could not read the previous run report; starting the count fresh")
        previous = None
    document = build_run_report(
        report, trigger=trigger, finished_at=finished_at, previous=previous
    )
    await target.put_json(LATEST_BLOB, document)
    await target.put_json(_history_blob(document["finished_at"]), document)
    log.info("run report written: %s", document["summary"])
    return document


__all__ = [
    "LATEST_BLOB",
    "MAX_REJECTION_DETAIL",
    "REPORT_VERSION",
    "STALE_AFTER_HOURS",
    "UNRECORDED_REASON",
    "build_run_report",
    "write_run_report",
]
