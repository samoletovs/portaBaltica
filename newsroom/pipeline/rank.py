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
from typing import Sequence

from newsroom.pipeline.config import DEFAULT_RANKING, RankingPolicy
from newsroom.pipeline.models import Signal

log = logging.getLogger(__name__)

#: When several detectors fire on the same series, this is the order we prefer.
#: A record is a stronger claim than the streak that produced it, and both beat
#: a bare period-over-period move.
DETECTOR_PRIORITY = {
    "record_extreme": 5,
    "divergence": 4,
    "seasonal_deviation": 3,
    "threshold_cross": 2,
    "streak": 1,
    "sharp_move": 0,
}


@dataclass
class RankingReport:
    """Why the wire is the length it is. Logged every run."""

    considered: int = 0
    below_floor: int = 0
    deduplicated: int = 0
    over_capacity: int = 0
    selected: list[Signal] = field(default_factory=list)

    @property
    def quiet_day(self) -> bool:
        return len(self.selected) < 3

    def summary(self) -> str:
        return (
            f"{self.considered} signal(s) considered, {self.below_floor} below the quality floor, "
            f"{self.deduplicated} deduplicated, {self.over_capacity} beyond capacity, "
            f"{len(self.selected)} selected"
        )


def _sort_key(signal: Signal) -> tuple[float, int, str]:
    return (signal.score, DETECTOR_PRIORITY.get(signal.detector, 0), signal.id)


def rank(
    signals: Sequence[Signal],
    policy: RankingPolicy | None = None,
) -> RankingReport:
    """Select the signals worth writing up.

    Order of operations matters: the floor is applied *before* deduplication and
    capacity, so a weak signal can never be promoted into the wire just because
    a stronger one on the same metric was dropped.
    """
    policy = policy or DEFAULT_RANKING
    report = RankingReport(considered=len(signals))

    above_floor = [s for s in signals if s.score >= policy.min_score]
    report.below_floor = len(signals) - len(above_floor)

    ordered = sorted(above_floor, key=_sort_key, reverse=True)

    kept: list[Signal] = []
    per_metric: dict[tuple[str, str], int] = {}
    for signal in ordered:
        key = (signal.metric, signal.geography)
        if per_metric.get(key, 0) >= policy.max_per_metric:
            report.deduplicated += 1
            continue
        per_metric[key] = per_metric.get(key, 0) + 1
        kept.append(signal)

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
