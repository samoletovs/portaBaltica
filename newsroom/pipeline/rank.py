"""Stage 3 — rank.

Takes whatever detection produced and decides how much of it is worth writing.

The important property is what this module *cannot* do: there is no code path
that increases the number of selected signals when few are available. The floor
is absolute, so a quiet day produces a short wire and, if nothing clears the
bar, no articles at all. Padding to a daily quota is the definition of Google's
"scaled content abuse" policy, and the only reliable defence is to make padding
unimplementable rather than discouraged.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Collection, Sequence

from newsroom.pipeline.config import DEFAULT_RANKING, RankingPolicy
from newsroom.pipeline.models import Signal

log = logging.getLogger(__name__)

#: When several detectors fire on the same series, this is the order we prefer.
#: A record is a stronger claim than the streak that produced it, and both beat
#: a bare period-over-period move.
#:
#: ``structural_divergence`` sits above ``divergence`` because the two collide:
#: they share a metric and the "Baltic" geography, so deduplication keeps
#: exactly one of them, and on live trade data both fire on the same three
#: series. The sustained finding is the better story of the pair — it reports
#: how long the gap has held and how far it has grown, where the spread-based
#: one can only describe the latest quarter — so it must win that tie. An
#: unregistered detector falls back to 0 here and would silently lose every
#: tie-break instead; see test_rank.py.
DETECTOR_PRIORITY = {
    "record_extreme": 6,
    "structural_divergence": 5,
    "divergence": 4,
    "seasonal_deviation": 3,
    "threshold_cross": 2,
    "streak": 1,
    "sharp_move": 0,
}

#: Metrics that are two readings of one event rather than two stories.
#:
#: A live run published these minutes apart:
#:
#:     "Divergence in Baltic electricity prices reaches 70.2 EUR/MWh"
#:     "Baltic power market sees significant spread divergence"
#:
#: ``day_ahead_power_price`` and ``day_ahead_power_spread`` are different
#: metrics, so every dedupe key in this module let both through. They are the
#: same Baltic power market on the same day, and the second adds nothing a
#: reader of the first did not already have.
#:
#: Curated rather than inferred. A rule that guessed relatedness from names or
#: sections would eventually collapse two genuinely different stories, and the
#: cost of missing a pair here is one duplicate — the cost of a wrong guess is
#: a finding that never runs at all.
METRIC_FAMILIES = {
    "day_ahead_power_price": "baltic_power_market",
    "day_ahead_power_spread": "baltic_power_market",
    # One balance-of-payments release, read seven ways. These are not seven
    # findings: they are NESTED. The goods-and-services balance IS goods plus
    # services, and services is transport plus financial plus telecoms plus
    # other business services plus the rest — so the same euro is reported in
    # three of them and a front page carrying all seven has told one story
    # seven times while double-counting it.
    #
    # Measured on the live collection: trade produced 26 of 47 signals from
    # these alone and took three of the eight slots, which is why maritime's
    # best signal — a container record at 0.95 — landed seventh of eight and
    # was the first thing lost to any jitter.
    #
    # The split stays in COLLECTION, deliberately: the whole reason it exists
    # is that "the total hides the finding", since all three states run a
    # similar goods deficit and the entire divergence sits in services. Folding
    # here keeps that. The strongest COMPONENT wins the slot, so the wire says
    # "the transport services balance diverged" rather than the vaguer thing
    # the headline total would have supported.
    "trade_balance": "external_balance",
    "goods_balance": "external_balance",
    "services_balance": "external_balance",
    "transport_services_balance": "external_balance",
    "financial_services_balance": "external_balance",
    "ict_services_balance": "external_balance",
    "other_business_services_balance": "external_balance",
}


def family_of(metric: str) -> str:
    """The event a metric reports on. Its own name when it stands alone."""
    return METRIC_FAMILIES.get(metric, metric)


def finding_key(metric: str, geography: str, period: str) -> str:
    """What makes two articles the same story, across runs.

    Deliberately NOT ``Signal.id``, which hashes the detector and the value in
    as well. Those make it too narrow in both directions:

    * a revised value mints a new id for the same reading, and the wire
      republishes it — revisions are handled by annotating the published piece,
      in ``revisions.py``, not by writing a second one;
    * two detectors firing on one reading produce two ids, and the reader gets
      "Estonian unemployment hits a record" and "Estonian unemployment extends
      its run" about the same number on the same day.

    **The period is the window.** No age threshold is applied and none is
    wanted: republishing a metric for a period already covered is a repeat
    whether it happens an hour later or a month later, and when the series
    moves to a new period the key changes on its own. A time window would have
    to be tuned per frequency — a fortnight is nothing to an annual series and
    forever to a daily one — and would still be wrong at the boundary.
    """
    return f"{metric}|{geography}|{period}"


def release_key(metric: str, period: str) -> str:
    """One release of one series, whichever reading of it was written up.

    The country fold has to survive the run that performed it. Without this it
    did not, and the live sequence was:

        run 1  keeps hourly_labour_cost/EE, folds away LV and LT
        run 2  suppresses EE as already published — and then selects LV,
               because LV is now the strongest of that group

    which is the three-thin-articles problem again, spread over two days
    instead of one page. Publishing one country's reading closes the release.

    Keyed on the FAMILY for the same reason, one level up. Seven nested
    balance-of-payments series are one release; keyed on the metric, run 1
    published the transport services balance, run 2 the financial services
    balance, run 3 services, run 4 the headline total — four articles about one
    quarter of one release, arriving on four consecutive runs. Within a run
    they were correctly folded; across runs they were not, which is the same
    bug in the same shape as the country fold and needed the same fix.
    """
    return f"{family_of(metric)}|*|{period}"


def _release_of(key: str) -> str | None:
    """The release a stored finding key belongs to, when it names a country."""
    parts = key.split("|")
    if len(parts) != 3:
        return None
    metric, geography, period = parts
    return release_key(metric, period) if geography in _COVERAGE else None




@dataclass
class RankingReport:
    """Why the wire is the length it is. Logged every run."""

    considered: int = 0
    below_floor: int = 0
    deduplicated: int = 0
    #: Findings this wire has already published, in an earlier run.
    already_published: int = 0
    #: Per-country signals folded into one comparative piece.
    same_release: int = 0
    #: Second readings of an event another signal already reports.
    same_event: int = 0
    over_capacity: int = 0
    selected: list[Signal] = field(default_factory=list)

    @property
    def quiet_day(self) -> bool:
        return len(self.selected) < 3

    def summary(self) -> str:
        return (
            f"{self.considered} signal(s) considered, {self.below_floor} below the quality floor, "
            f"{self.deduplicated} deduplicated, {self.already_published} already published, "
            f"{self.same_release} folded into a country comparison, "
            f"{self.same_event} second readings of one event, "
            f"{self.over_capacity} beyond capacity, {len(self.selected)} selected"
        )


def _sort_key(signal: Signal) -> tuple[float, int, str]:
    return (signal.score, DETECTOR_PRIORITY.get(signal.detector, 0), signal.id)


#: The three Baltic states, as a signal's geography.
_COUNTRIES = frozenset({"LV", "EE", "LT"})

#: Every geography that reports on the same release. A "Baltic" signal is the
#: comparison across all three, so it and the country singles are competing
#: tellings of one release rather than four separate stories.
_COVERAGE = _COUNTRIES | {"Baltic"}


def rank(
    signals: Sequence[Signal],
    policy: RankingPolicy | None = None,
    *,
    published: Collection[str] = (),
) -> RankingReport:
    """Select the signals worth writing up.

    Order of operations matters: the floor is applied *before* deduplication and
    capacity, so a weak signal can never be promoted into the wire just because
    a stronger one on the same metric was dropped.

    ``published`` is the set of :func:`finding_key` values this wire has already
    run, read from the index. Suppression happens HERE, before research, the
    analyst brief, the writer and the desk — six model calls per article — so a
    repeat costs nothing rather than being generated and then quietly dropped
    from the front page. The index has deduped itself by ``signal_id`` for a
    while, which fixed what a reader saw and not what the run spent, and at
    three scheduled runs a day against monthly and quarterly data almost every
    signal is a repeat.
    """
    policy = policy or DEFAULT_RANKING
    report = RankingReport(considered=len(signals))

    above_floor = [s for s in signals if s.score >= policy.min_score]
    report.below_floor = len(signals) - len(above_floor)

    ordered = sorted(above_floor, key=_sort_key, reverse=True)

    already = set(published)
    # A published country reading also closes its release, so the fold that
    # dropped its neighbours this run cannot be undone by the next one.
    already |= {r for key in published if (r := _release_of(key))}
    fresh: list[Signal] = []
    for signal in ordered:
        if finding_key(signal.metric, signal.geography, signal.period) in already:
            report.already_published += 1
            continue
        if (
            signal.geography in _COVERAGE
            and release_key(signal.metric, signal.period) in already
        ):
            report.already_published += 1
            continue
        fresh.append(signal)

    kept: list[Signal] = []
    per_metric: dict[tuple[str, str], int] = {}
    for signal in fresh:
        key = (signal.metric, signal.geography)
        if per_metric.get(key, 0) >= policy.max_per_metric:
            report.deduplicated += 1
            continue
        per_metric[key] = per_metric.get(key, 0) + 1
        kept.append(signal)

    kept = _one_per_release(kept, report)
    kept = _one_per_event(kept, report)

    report.selected = kept[: policy.max_articles]
    report.over_capacity = max(0, len(kept) - policy.max_articles)

    log.info("ranking: %s", report.summary())
    if report.quiet_day:
        log.info(
            "quiet day: %d article(s) will be written. This is the intended behaviour — "
            "the pipeline has no mechanism to top the wire up.",
            len(report.selected),
        )
    return report


def _one_per_release(signals: list[Signal], report: RankingReport) -> list[Signal]:
    """One comparative piece per release, not one article per country.

    A single Eurostat labour-cost release produced three tier A articles:

        "Latvia's hourly labour cost reaches 16.3 EUR per hour in 2025"
        "Estonia's hourly labour cost reaches record high of 21.1 EUR..."
        "Hourly labour costs in Lithuania reach 17.8 EUR per hour in 2025"

    Three thin recitals where an editor writes one — "Estonian employers now
    pay a third more per hour than Latvian ones" — which is stronger, cheaper
    and more informative. The ``(metric, geography)`` dedupe let all three
    through because the geographies differ, which is exactly what that key is
    for and exactly why it cannot see this.

    THE DIVERGENCE DETECTOR IS NOT THE FIX, and this was checked rather than
    assumed. Against the live series the spread is 4.80 EUR per hour on a
    typical 3.75, a ratio of 1.28 against a threshold of 2.0 — and the spread
    has sat between 26% and 40% of the mean every year since 2008. The gap is
    not unusual; only the levels are. ``detect_divergence`` is right to stay
    silent and loosening it would make it fire on every stable difference in
    the wire.

    So the survivor is the strongest signal of the group, and it is not a
    poorer story for being alone: ``context.enrich_signal`` has already
    attached the other two countries' readings as ``peer_*`` fields, and the
    article plan's third paragraph is THE NEIGHBOURS. The comparison was always
    available — what was missing was the decision to write it once.
    """
    best: dict[tuple[str, str], Signal] = {}
    order: list[tuple[str, str]] = []
    passthrough: list[Signal] = []

    for signal in signals:
        if signal.geography not in _COVERAGE:
            passthrough.append(signal)
            continue
        # Keyed on the FAMILY, not the metric, so that "one release" means the
        # release rather than one reading of it. Seven nested balance-of-
        # payments series published together are one release; keyed on metric
        # they were seven, and trade took three of the eight slots with the
        # same euro counted in several of them. For a metric with no declared
        # family this is identical to keying on the metric itself.
        key = (family_of(signal.metric), signal.period)
        incumbent = best.get(key)
        if incumbent is None:
            best[key] = signal
            order.append(key)
            continue
        report.same_release += 1
        # Signals arrive strongest-first, so the incumbent normally wins --
        # except that a Baltic-wide reading IS the comparison the fold is
        # trying to produce, so it takes the slot from a single country even
        # when it scored lower. That is the case the brief calls "the
        # per-country singles a comparative signal subsumes".
        if signal.geography == "Baltic" and incumbent.geography != "Baltic":
            best[key] = signal

    folded = [best[key] for key in order]
    return sorted([*folded, *passthrough], key=_sort_key, reverse=True)


def _one_per_event(signals: list[Signal], report: RankingReport) -> list[Signal]:
    """One article per event, when two metrics report the same one.

    See :data:`METRIC_FAMILIES`. Only fires for metrics explicitly declared to
    be readings of one event, so a metric standing on its own is its own family
    and nothing is ever collapsed by accident.
    """
    seen: set[tuple[str, str, str]] = set()
    kept: list[Signal] = []
    for signal in signals:
        key = (family_of(signal.metric), signal.geography, signal.period)
        if key in seen:
            report.same_event += 1
            continue
        seen.add(key)
        kept.append(signal)
    return kept
