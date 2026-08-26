"""Stage 0 — the revision watch: has the ground moved under something we printed?

WHAT THIS IS FOR
----------------
Every other stage of this pipeline improves an article at the moment it is
written. This is the only one that acts on articles already published, and it
exists because a statistical claim has a shelf life that a news story does not.

Eurostat, CSP and the national institutes all restate series as late returns
arrive; the flash estimate is explicitly provisional and the revision policy is
published. So the sentence "Estonia's unemployment rate fell to 6.6% in June"
can be perfectly true on Tuesday, and by the following month describe a number
that no longer exists — not because we hallucinated it, but because we froze a
vintage and walked away.

The wire's own record made the case: 161 articles, no corrections, and no way to
produce one. A corrections page nothing can ever write to is decoration.

WHAT A CORRECTION HERE IS, AND IS NOT
-------------------------------------
It is an **annotation, not a rewrite**. The prose keeps the figure it was
written around, because every number in the body is bound by the validator to a
verified signal field; silently swapping the number would break that binding and
would also be dishonest — the article did say 6.6, and pretending otherwise
edits the past. So the correction states both readings and their vintages and
lets the reader see the revision happen.

It is also **not an error admission by default**. Distinguishing "the source
revised this" from "we got this wrong" matters, and conflating them would train
readers to discount both. The wording says which one this is.

THE TOLERANCE IS THE MEASUREMENT FLOOR
--------------------------------------
A revision smaller than the series can express is not a revision. Rather than
invent a second threshold, this reuses
:mod:`newsroom.pipeline.significance` — the same floor that decides whether a
movement was worth reporting decides whether a restatement is worth correcting.
One definition of "a difference that counts", used in both directions.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Sequence

from newsroom.pipeline.detect.series import TimeSeries
from newsroom.pipeline.models import isoformat, utcnow
from newsroom.pipeline.significance import MeasurementFloor, floor_for
from newsroom.pipeline.vintage import PublishedFigure, VintageLedger

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Revision:
    """A published figure the source no longer agrees with."""

    figure: PublishedFigure
    current_value: float
    current_observed_at: str
    floor: MeasurementFloor

    @property
    def difference(self) -> float:
        return self.current_value - self.figure.value

    @property
    def direction(self) -> str:
        return "up" if self.difference > 0 else "down"

    def description(self) -> str:
        """The public sentence. Written for a reader, not a maintainer."""
        vintage = self.figure.observed_at[:10] or "publication"
        return (
            f"{self.figure.metric_label.capitalize()} for {self.figure.geography} in "
            f"{self.figure.period} was {self.figure.value:g}{_unit(self.figure.unit)} when this "
            f"article was written, the value the source published as of {vintage}. "
            f"It has since been revised {self.direction} to "
            f"{self.current_value:g}{_unit(self.figure.unit)} "
            f"(read {self.current_observed_at[:10]}). The article's text is unchanged and "
            f"reports the earlier vintage; this note records the revision. "
            f"Statistical agencies revise routinely — this is a restatement by the "
            f"source, not a reporting error."
        )

    def to_correction(self) -> dict[str, str]:
        """Shaped by ``corrections`` in ``schemas/article.schema.json``."""
        return {
            "corrected_at": isoformat(utcnow()),
            "description": self.description(),
            "previous_value": f"{self.figure.value:g}{_unit(self.figure.unit)}",
        }

    def to_log_entry(self, correction: dict[str, str]) -> dict[str, str]:
        """Shaped by ``CorrectionLogEntry`` in ``src/news-api.ts``.

        Takes the correction already written onto the article rather than
        building a second one, so the log and the article can never disagree
        about the wording or the timestamp.
        """
        return {
            "slug": self.figure.slug,
            "headline": self.figure.headline,
            "corrected_at": correction["corrected_at"],
            "description": correction["description"],
            "previous_value": correction["previous_value"],
        }

    @property
    def fingerprint(self) -> str:
        """Identifies this revision, so it is never appended twice.

        A correction log that repeats itself every run is worse than none: it
        buries the real ones and makes the article look chaotically wrong.
        """
        return f"{self.figure.key}->{self.current_value:.6g}"


def _unit(unit: str) -> str:
    if not unit:
        return ""
    return unit if unit in {"%", "°C"} else f" {unit}"


def find_revisions(
    ledger: VintageLedger, series_list: Sequence[TimeSeries]
) -> list[Revision]:
    """Published figures whose series now reads differently.

    Absence is not revision. A period that has dropped out of the fetched window
    — because the collector asks for a rolling range, not all history — must not
    be read as a restatement to nothing, so a figure whose period is not present
    in the current series is skipped rather than reported.
    """
    by_key = {(s.metric, s.geography): s for s in series_list}
    revisions: list[Revision] = []
    for figure in ledger:
        series = by_key.get(figure.series_key)
        if series is None:
            continue
        observation = series.at(figure.period)
        if observation is None:
            continue
        floor = floor_for(series)
        if abs(observation.value - figure.value) < floor.value:
            continue
        revisions.append(
            Revision(
                figure=figure,
                current_value=observation.value,
                current_observed_at=series.source.retrieved_at,
                floor=floor,
            )
        )
    if revisions:
        log.info(
            "revision watch: %d published figure(s) have been restated by the source",
            len(revisions),
        )
    return revisions


def already_recorded(article_corrections: Sequence[dict], revision: Revision) -> bool:
    """Has this exact restatement already been noted on the article?

    Matched on the stated previous value and the new value appearing in the
    text, rather than on a stored fingerprint, so it also holds for corrections
    written before this module existed.
    """
    previous = f"{revision.figure.value:g}"
    current = f"{revision.current_value:g}"
    for correction in article_corrections:
        description = str(correction.get("description") or "")
        recorded_previous = str(correction.get("previous_value") or "")
        if previous in recorded_previous and current in description:
            return True
    return False


def annotate(document: dict, revision: Revision) -> dict | None:
    """Append a correction to a stored article, or ``None`` if already present.

    Returns a new document rather than mutating, so a caller that decides not to
    write cannot have already changed the record.

    The article's ``status`` deliberately stays ``published``. The schema offers
    a ``corrected`` status, and using it here would be the obvious move and a
    serious bug: both :func:`newsroom.pipeline.publish.is_servable` and the
    frontend's ``isServable`` require ``published``, so correcting a story would
    delete it from the site. Making an article vanish the moment we annotate it
    is the opposite of a corrections policy — the vc.ru account of RuntimeWire
    quietly deleting accurate stories on request is the failure this guards
    against, and an unpublish disguised as a correction is the same act with
    better manners.
    """
    corrections = list(document.get("corrections") or [])
    if already_recorded(corrections, revision):
        return None
    corrections.append(revision.to_correction())
    updated = dict(document)
    updated["corrections"] = corrections
    return updated


__all__ = ["Revision", "already_recorded", "annotate", "find_revisions"]
