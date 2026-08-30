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
from typing import Mapping, Sequence

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


def record_correction_note(
    *,
    claim: str,
    window: str,
    window_start: str,
    series_start: str,
    true_extreme: str,
    true_period: str,
    beaten_in_window: int,
    beaten_in_series: int,
    window_extreme: str | None = None,
    window_extreme_period: str | None = None,
    claims_low: bool = True,
    corrected_at: str | None = None,
) -> dict[str, str]:
    """The public notice for a record claim the data does not support.

    A DIFFERENT KIND OF WRONG FROM A REVISION
    -----------------------------------------
    :class:`Revision` covers the case where the statistical office restated a
    figure we had printed: our number was right when we printed it and the
    source moved. This covers the opposite — the source never moved, our
    *figure* is still correct, and what was wrong is the **characterisation**.

    WHY BOTH COUNTS ARE REQUIRED, AND WHY THAT IS THE POINT
    ------------------------------------------------------
    This function used to be ``scope_correction_note`` and took one count: how
    many readings beat the claim **over full history**. It then asserted, in
    the note it published, that the figure "was the lowest only in the N
    observations that the newsroom had retrieved". That sentence is an
    unmeasured claim about the window — and for the rail article it was false.
    4,653 thousand passengers was called the highest of the 39 observations we
    held, and **15 of those 39 are higher**. Building the notice with the old
    signature would have printed a fresh falsehood inside a correction.

    So ``beaten_in_window`` is required and has no default. The count that was
    silently assumed to be zero is now an argument a caller has to go and
    measure, which is the only version of this that cannot repeat the mistake.
    Two counts, two scopes, and the wording follows from them:

    ===================  =============================================
    ``beaten_in_window``  what the note says
    ===================  =============================================
    ``0``                 it held over our window and not over the
                          series — a scope error
    ``> 0``               it did not hold even over our window, so
                          both scopes are named
    ===================  =============================================

    WRITTEN FOR A READER, IN THE ORDER THEY NEED IT
    -----------------------------------------------
    What we said, then what is actually so, then what still stands. A reader
    who met the headline needs the correction to name the thing they were told
    before it names the thing that is true.

    ``claims_low`` picks the comparison word. "Three earlier readings are
    beyond it" is vague in a way a correction cannot afford; a low is beaten by
    something *lower* and a high by something *higher*, and the note has to say
    which.

    ``status`` is left alone by the caller for the reason ``annotate`` gives at
    length: both ``is_servable`` and the frontend require ``published``, so
    changing it would delete the page a correction notice exists to be read on.
    """
    if beaten_in_window < 0 or beaten_in_series < 0:
        raise ValueError("counts cannot be negative")
    if beaten_in_window > beaten_in_series:
        raise ValueError(
            f"more readings beat the claim over the window ({beaten_in_window}) "
            f"than over the whole series ({beaten_in_series}); the window is a "
            "subset of the series, so one of these was measured wrong"
        )

    superlative = "lowest" if claims_low else "highest"
    lower_or_higher = "lower" if claims_low else "higher"
    opening = f"CORRECTED. This article said {claim.strip().rstrip('.')}. "
    closing_note = (
        "The figure itself is unchanged and correct; describing "
        "it as a record was not, and a record claim on this wire now has to name "
        "the window it is measured over."
    )

    if beaten_in_window == 0:
        # The scope error: true over what we held, false over what exists.
        # This branch is byte-identical to the note already published on
        # `latvia-s-food-inflation-drops-to-a-record-low-of-2b7683`, and a test
        # pins it against that live string. Reword it and a re-run appends a
        # second, near-duplicate correction to a live article, because
        # `append_correction` de-duplicates on the description.
        return {
            "corrected_at": corrected_at or isoformat(utcnow()),
            "description": (
                f"{opening}"
                f"It was the {superlative} only in the "
                f"{window.strip().rstrip('.')} that the newsroom had retrieved — not in "
                f"the series, which runs back to {series_start}. "
                f"{_spelled(beaten_in_series)} earlier "
                f"reading{_plural(beaten_in_series)} {_verb(beaten_in_series)} "
                f"{lower_or_higher}, the "
                f"{superlative} being {true_extreme} in "
                f"{true_period}. {closing_note}"
            ),
        }

    # Not a scope error. The claim fails over our own window as well, so a
    # notice that only widened the scope would still be telling the reader it
    # was true of something. Name what actually was the extreme, in the very
    # observations the article cited.
    if not window_extreme or not window_extreme_period:
        raise ValueError(
            "a claim beaten inside our own window must name what actually was "
            "the extreme there; pass window_extreme and window_extreme_period"
        )
    return {
        "corrected_at": corrected_at or isoformat(utcnow()),
        "description": (
            f"{opening}"
            f"It was not the {superlative}. "
            f"{_spelled(beaten_in_window)} of the "
            f"{window.strip().rstrip('.')} that the newsroom had retrieved "
            f"{_verb(beaten_in_window)} {lower_or_higher}, the {superlative} of "
            f"them being {window_extreme} in {window_extreme_period}. The series "
            f"also does not begin in {window_start} — that is where the "
            f"newsroom's data window starts — but in {series_start}, across "
            f"which {beaten_in_series} readings are {lower_or_higher} and the "
            f"{superlative} is {true_extreme} in {true_period}. {closing_note}"
        ),
    }


# Spelled at the head of a sentence, where a numeral reads as a typo. Only the
# small ones -- "Fifty-five earlier readings" is worse than "55".
_WORDS = {
    1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six",
    7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten", 11: "Eleven", 12: "Twelve",
    13: "Thirteen", 14: "Fourteen", 15: "Fifteen", 16: "Sixteen",
    17: "Seventeen", 18: "Eighteen", 19: "Nineteen", 20: "Twenty",
}


def _spelled(n: int) -> str:
    return _WORDS.get(n, str(n))


def _plural(n: int) -> str:
    return "" if n == 1 else "s"


def _verb(n: int) -> str:
    return "is" if n == 1 else "are"


def append_correction(document: dict, note: Mapping[str, str]) -> dict | None:
    """Append a note to a stored article, or ``None`` if it is already there.

    Idempotent on the description rather than on a timestamp, so re-running the
    same correction is a no-op while a genuinely different note still lands. A
    corrections log that repeats itself every run buries the real entries and
    makes the article look chaotically wrong.

    Returns a new document rather than mutating, so a caller that decides not
    to write cannot have already changed the record — the same contract as
    :func:`annotate`, and for the same reason.
    """
    corrections = list(document.get("corrections") or [])
    incoming = str(note.get("description") or "").strip()
    if not incoming:
        return None
    for existing in corrections:
        if str(existing.get("description") or "").strip() == incoming:
            return None
    corrections.append(dict(note))
    updated = dict(document)
    updated["corrections"] = corrections
    return updated


async def apply_correction_note(
    store: "ArticleStore", slug: str, note: Mapping[str, str]
) -> dict | None:
    """Read the stored article, append the note, write it back, and log it.

    Returns the updated document, or ``None`` when the note is already there —
    so running it twice is safe and says so, rather than being safe by accident.

    THE PUBLIC LOG IS PART OF THE CORRECTION, NOT A SIDE EFFECT.
    ``corrections.json`` is the one page a reader can audit us on, and a
    correction that exists only on the article is one they can find only if
    they already know which article to open. Writing the article and forgetting
    the log was the first thing that went wrong when this was applied by hand:
    the note rendered, the log did not list it, and nothing anywhere said the
    two disagreed. So both happen here, from one call, and the log entry is
    built from the note already written to the article rather than composed
    again — the same reason ``Revision.to_log_entry`` takes the correction it
    is logging instead of rebuilding it.

    Separate from the note builder because the two fail differently: composing
    a sentence cannot lose data, and a read-modify-write can. Keeping the write
    here means the note can be reviewed, printed and argued over without any
    credential being involved, which is how both of these were.
    """
    document = await store.read_json(f"{slug}.json")
    if not isinstance(document, dict):
        raise ValueError(f"{slug}: stored article is not a JSON object")
    updated = append_correction(document, note)
    if updated is None:
        log.info("correction already present on %s; nothing written", slug)
        return None
    await store.put_json(f"{slug}.json", updated)
    await store.append_corrections(
        [
            {
                "slug": slug,
                "headline": str(document.get("headline") or ""),
                "corrected_at": note["corrected_at"],
                "description": note["description"],
            }
        ]
    )
    log.info("correction appended to %s and to the public log", slug)
    return updated


__all__ = [
    "Revision",
    "already_recorded",
    "annotate",
    "append_correction",
    "apply_correction_note",
    "find_revisions",
    "record_correction_note",
]
