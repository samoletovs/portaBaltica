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


#: We published something that was wrong when we published it.
OUR_ERROR = "our_error"
#: The source restated a figure we reported faithfully. Our text was never wrong.
SOURCE_REVISION = "source_revision"
#: Every value a correction may declare. The schema pins the same set, so a typo
#: cannot become a third silent category.
CORRECTION_KINDS: tuple[str, ...] = (OUR_ERROR, SOURCE_REVISION)

#: What a correction that does not say means. NOT one of the two above.
UNSPECIFIED_KIND = "unspecified"


def correction_kind(correction: Mapping[str, object]) -> str:
    """Which kind of correction this is, resolving absence to the weaker claim.

    WHY ABSENCE IS A THIRD ANSWER AND NOT A DEFAULT TO EITHER
    --------------------------------------------------------
    The log holds two facts that a reader must not have confused: *we got this
    wrong*, and *the source restated its figure and our text was faithful*. Until
    this field existed every surface said one word for both, which is two states
    wearing one artefact in the machinery whose whole subject is telling a reader
    the truth about what changed.

    The 31 entries written before it carry nothing, and nothing here invents a
    value for them. Defaulting them to ``SOURCE_REVISION`` would be the
    flattering guess — "the source moved, not us" — asserted about corrections we
    know include our own errors. Defaulting them to ``OUR_ERROR`` would be the
    opposite falsehood, and unfair to the four revision notes that say in their
    own text "a restatement by the source, not a reporting error".

    So absence resolves to ``UNSPECIFIED_KIND``, which grants no claim in either
    direction and leaves every surface saying exactly what it says today. A
    surface may say *more* only where one of the two declared values is present.

    An UNRECOGNISED value resolves the same way, deliberately. The schema refuses
    one on the way in, and if a value ever reaches a reader that this build does
    not understand, the safe reading is the one that claims nothing — the same
    allow-list reasoning as ``SHOWABLE_STATUSES`` in ``src/news-api.ts``, where an
    unknown state is withheld rather than shown.
    """
    declared = correction.get("kind")
    if isinstance(declared, str) and declared in CORRECTION_KINDS:
        return declared
    return UNSPECIFIED_KIND


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
            # Set here rather than inferred anywhere, because THIS CLASS IS THE
            # CLAIM: a `Revision` exists only when the source restated a figure
            # we reported faithfully, which is what `description()` two methods
            # up says in its own last sentence. Reading that sentence back to
            # decide the kind would be a word list standing in for a property.
            "kind": SOURCE_REVISION,
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
            # Carried from the correction rather than restated, for the reason
            # the docstring gives about the wording: a second source of truth
            # for the kind is a second thing that can disagree about it.
            "kind": correction["kind"],
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
    rank: int = 1,
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

    ``rank`` IS NOT DECORATION
    --------------------------
    Not every claim corrected here is a claim of first place. The context
    builder emits "this is the fourth-highest on record" as readily as "this is
    the highest reading anywhere in the series", and a **rank claim is only
    false if the rank is wrong**. Lithuania's construction output really is the
    fourth-highest of the 40 observations we retrieved — exactly three are
    higher — and is the fourteenth of the 113 the cube holds. Correcting that
    to "it was not the highest" would be correcting something the article never
    said.

    A sweep that treated every superlative as first place called two correctly
    hedged articles false. Reading the sentences is what caught it, so the rank
    travels as an argument rather than being assumed to be 1.

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
    if rank < 1:
        raise ValueError("rank starts at 1")
    if rank > 1 and beaten_in_window != rank - 1:
        raise ValueError(
            f"a claim of rank {rank} means exactly {rank - 1} reading(s) beat it "
            f"over the window, but {beaten_in_window} do; either the rank or the "
            "count is wrong, and a correction cannot rest on whichever it is"
        )

    superlative = "lowest" if claims_low else "highest"
    lower_or_higher = "lower" if claims_low else "higher"
    described = superlative if rank == 1 else f"{_ordinal(rank)}-{superlative}"
    opening = f"CORRECTED. This article said {claim.strip().rstrip('.')}. "
    closing_note = (
        "The figure itself is unchanged and correct; describing "
        "it as a record was not, and a record claim on this wire now has to name "
        "the window it is measured over."
    )
    if rank > 1:
        closing_note = (
            "The figure itself is unchanged and correct; the placing was not, "
            "and a claim about where a reading sits on this wire now has to "
            "name the window it is measured over."
        )

    if beaten_in_window == 0 or rank > 1:
        # The scope error: true over what we held, false over what exists.
        # With rank == 1 this branch is byte-identical to the note already
        # published on `latvia-s-food-inflation-drops-to-a-record-low-of-2b7683`,
        # and a test pins it against that live string. Reword it and a re-run
        # appends a second, near-duplicate correction to a live article, because
        # `append_correction` de-duplicates on the description.
        if rank == 1:
            placing = (
                f"{_spelled(beaten_in_series)} earlier "
                f"reading{_plural(beaten_in_series)} {_verb(beaten_in_series)} "
                f"{lower_or_higher}, the "
                f"{superlative} being {true_extreme} in {true_period}."
            )
        else:
            placing = (
                f"{_spelled(beaten_in_series)} reading{_plural(beaten_in_series)} "
                f"{_verb(beaten_in_series)} {lower_or_higher}, making it the "
                f"{_ordinal(beaten_in_series + 1)} rather than the "
                f"{_ordinal(rank)}; the {superlative} is {true_extreme} in "
                f"{true_period}."
            )
        return {
            "corrected_at": corrected_at or isoformat(utcnow()),
            # Every builder here composes a notice about SOMETHING WE PUBLISHED
            # WRONG. The kind is a property of which builder ran, not of the
            # sentence it produced, so it is stamped rather than read back out
            # of the prose.
            "kind": OUR_ERROR,
            "description": (
                f"{opening}"
                f"It was the {described} only in the "
                f"{window.strip().rstrip('.')} that the newsroom had retrieved — not in "
                f"the series, which runs back to {series_start}. "
                f"{placing} {closing_note}"
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
        # Every builder here composes a notice about SOMETHING WE PUBLISHED
        # WRONG. The kind is a property of which builder ran, not of the
        # sentence it produced, so it is stamped rather than read back out
        # of the prose.
        "kind": OUR_ERROR,
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


def origin_correction_note(
    *,
    claim: str,
    window_start: str,
    series_start: str,
    series_start_value: str,
    still_stands: str,
    also: str | None = None,
    corrected_at: str | None = None,
) -> dict[str, str]:
    """The notice for an article whose record is real and whose origin is not.

    A THIRD SHAPE, AND NOT A PARAMETER ON THE SECOND
    ------------------------------------------------
    `lithuania-s-passenger-car-ownership-reaches-record-high-in-2025` says two
    things. "This reading is the highest in the series" is **true** — 629 cars
    per thousand inhabitants is the maximum of all 36 readings the cube holds,
    back to 1990. "The series start value of 490 ... in 2006" is **false**: that
    is where `lastTimePeriod=20` put our window, and the series begins in 1990
    at 133.

    Running that through :func:`record_correction_note` would tell the reader
    the figure "was the highest only in the observations we retrieved", which is
    itself untrue — a correction asserting a falsehood in order to correct one,
    which is precisely the fault caught in the rail note arriving from the other
    direction. The claim being corrected is different in kind: not *this was not
    a record* but *the series does not begin where we said*.

    ``still_stands`` is required rather than optional because the whole reason
    this shape exists is that something DOES stand. A reader who meets a
    correction on an article whose headline is true needs that said plainly, or
    the notice reads as a retraction of the story.

    ``also`` EXISTS BECAUSE A PARTIAL CORRECTION CAN MAKE THINGS WORSE
    ------------------------------------------------------------------
    `lithuania-s-renewable-energy-share-hits-record-38-5` misplaces the origin
    **twice**: once as our window boundary, and once by attaching a seven-year
    run of increases to "since the series began" when the run begins in 2018
    and the share fell in five separate years before it.

    Correcting only the first would authoritatively establish 2004 as the
    origin and leave a sentence saying the rise has been unbroken since the
    origin — so the notice would make the surviving falsehood **more**
    believable than it was. A correction that strengthens an error it did not
    address is worse than none, which is why this takes a second clause rather
    than being applied twice or applied partially.

    It is a whole sentence supplied by the caller, for the same reason ``claim``
    and ``still_stands`` are: what is wrong differs per article and cannot be
    composed from fields. It is reviewed as prose before it publishes.
    """
    if not still_stands.strip():
        raise ValueError(
            "this shape exists because the record survives; say what stands, or "
            "the notice reads as a retraction of a true story"
        )
    # Omitted, the wording is byte-identical to the note already published on
    # `lithuania-s-passenger-car-ownership-reaches-record-high-in-2025-b7016e`.
    # `append_correction` de-duplicates on the description, so the text is the
    # idempotency key: change this branch and a re-run stops recognising the
    # live note and appends a near-duplicate.
    extra = f"{also.strip().rstrip('.')}. " if also and also.strip() else ""
    return {
        "corrected_at": corrected_at or isoformat(utcnow()),
        # Every builder here composes a notice about SOMETHING WE PUBLISHED
        # WRONG. The kind is a property of which builder ran, not of the
        # sentence it produced, so it is stamped rather than read back out
        # of the prose.
        "kind": OUR_ERROR,
        "description": (
            f"CORRECTED. This article said {claim.strip().rstrip('.')}. "
            f"{window_start} is where the newsroom's data window starts, not "
            f"where the series starts: it runs back to {series_start}, when the "
            f"figure was {series_start_value}. {extra}"
            f"{still_stands.strip().rstrip('.')}, "
            "and the figures are unchanged — only the description of where the "
            "series begins was wrong. A statement about where a series starts on "
            "this wire now has to rest on the series rather than on the window "
            "the newsroom retrieved."
        ),
    }


def span_correction_note(
    *,
    claim: str,
    named_span: str,
    named_span_change: str,
    actual_span: str,
    stated_change: str,
    series_start: str,
    series_start_change: str,
    still_stands: str,
    corrected_at: str | None = None,
) -> dict[str, str]:
    """The notice for a real magnitude attached to the wrong span.

    A FOURTH SHAPE, AND THE FIRST ONE WHERE A FIGURE IS ACTUALLY WRONG
    ------------------------------------------------------------------
    The other three correct a **characterisation**: the number was right and
    what we said *about* it was not. All three therefore end by telling the
    reader "the figures are unchanged and correct", which is true of them and
    is the reassurance a correction on a sound article owes.

    `latvia-s-industrial-electricity-price-drops-to-0-13-eur` is different:

        "a cumulative change of -0.1 EUR per kWh, or 41.75%, since the series
         began in 2016-S1, where the starting value was 0.09 EUR per kWh"

    Measured on its own cube, 37 observations from 2007-S2:

        since 2016-S1, the span it NAMES     +0.0438 EUR   +48.83%
        since 2007-S2, the true series       +0.0740 EUR  +124.37%
        since 2022-S2, paragraph 1's basis   -0.0957 EUR   -41.75%   exact

    So the magnitude is genuine and belongs to a shorter, later span — and over
    the period the sentence names, **the price rose by half again**. The
    article tells a reader it fell by 41.75% over a period in which it rose by
    48.83%.

    That is not a description that overreached. It is a false statement about
    direction, and running it through :func:`origin_correction_note` would
    publish "the figures are unchanged — only the description of where the
    series begins was wrong", which is itself untrue. **A reader must not be
    told the figures are unchanged when the sign is wrong**, so this shape does
    not reuse that closing sentence.

    IT NAMES WHERE THE NUMBER REALLY CAME FROM
    ------------------------------------------
    ``actual_span`` is required. A reader who meets 41.75% elsewhere in the
    piece — it is paragraph 1's comparison, correctly stated there — and is
    told only that it does not belong where it appears is left unable to place
    a figure they can see with their own eyes. Saying the number is real and
    naming its span is the difference between a correction and a retraction of
    something sound.
    """
    for name, value in (
        ("named_span", named_span),
        ("actual_span", actual_span),
        ("still_stands", still_stands),
    ):
        if not str(value).strip():
            raise ValueError(
                f"{name} is required: a correction that says a figure is "
                "misplaced without saying where it belongs leaves the reader "
                "unable to place a number they can see"
            )
    return {
        "corrected_at": corrected_at or isoformat(utcnow()),
        # Every builder here composes a notice about SOMETHING WE PUBLISHED
        # WRONG. The kind is a property of which builder ran, not of the
        # sentence it produced, so it is stamped rather than read back out
        # of the prose.
        "kind": OUR_ERROR,
        "description": (
            f"CORRECTED. This article said {claim.strip().rstrip('.')}. "
            f"That change is real but belongs to a different, shorter period: "
            f"it is the change since {actual_span.strip()}. Over the span the "
            f"article names — since {named_span.strip()} — the figure moved "
            f"{named_span_change.strip()}, the opposite direction to the "
            f"{stated_change.strip()} reported. {named_span.strip()} is also "
            f"where the newsroom's data window starts, not where the series "
            f"starts: it runs back to {series_start.strip()}, since when the "
            f"figure has moved {series_start_change.strip()}. "
            f"{still_stands.strip().rstrip('.')}. A figure on this wire now "
            "has to name the period it was measured over, and a period named "
            "in a claim has to be one the newsroom actually holds."
        ),
    }


def comparison_correction_note(
    *,
    claim: str,
    observations: int,
    series_start: str,
    beaten: int,
    true_extreme: str,
    true_period: str,
    true_standing: str,
    still_stands: str,
    claims_low: bool = True,
    corrected_at: str | None = None,
) -> dict[str, str]:
    """The notice for an unbounded superlative inflated from a true local one.

    A FIFTH SHAPE, AND THE FIRST ONE ``#280`` MADE POSSIBLE
    -------------------------------------------------------
    Two articles in the 14:00Z edition of 2026-08-31 — the first generated with
    the true series origin — say this. Both were measured against their own
    provenance cube with every dimension pinned:

        estonia-s-core-inflation   "the lowest in the 296 observations since
                                    the series began"
                                   296 is right, the origin is right,
                                   71 readings are lower

        foreign-visitors ... lithuania
                                   "the highest recorded in the 270
                                    observations since the series began in
                                    January 2004"
                                   270 is right, the origin is right,
                                   12 readings are higher

    In both, the count and the origin are **true** — that is ``#280`` working —
    and the superlative attached to them is false.

    THE LOCAL CLAIM UNDERNEATH IS NOT ALWAYS A SUPERLATIVE
    ------------------------------------------------------
    A first draft of this shape described the fault as a *peer* superlative
    promoted to a series one, because the Estonian article says "the lowest
    rate among the three Baltic states" two paragraphs later and that is
    genuinely true. That framing is too narrow and would have misdescribed the
    Lithuanian article, which has no peer superlative at all: its true local
    claim is a rise on the same month a year earlier, and measured across the
    twenty-three Junes in the cube the reading is the **second** highest, not
    the highest. There is no comparison over which its superlative holds.

    So the field is ``true_standing`` — *what the reading actually is* — rather
    than "where the superlative is true". It is required for the reason
    ``actual_span`` is in :func:`span_correction_note`: a reader told only that
    a superlative is wrong, who can see a related and correct comparison in the
    same sentence or the next paragraph, cannot tell which of our claims to
    believe.

    WHY NONE OF THE OTHER FOUR CAN SAY THIS
    ---------------------------------------
    :func:`record_correction_note` closes its beaten branch with "the series
    also does not begin in X — that is where the newsroom's data window starts
    — but in Y". After ``#280`` the collector fetches the whole series, so
    ``window_start == series_start`` and that renders as "does not begin in
    2001-12 ... but in 2001-12": a correction contradicting itself.

    :func:`origin_correction_note` would say the series begins elsewhere. It
    does not — the origin claim in both articles is **true**.
    :func:`span_correction_note` needs a magnitude on the wrong span. None is
    misplaced.

    AND ``#280`` MADE THIS MORE CONVINCING, NOT LESS
    ------------------------------------------------
    Before, ``readings_in_series`` carried the window count. It now carries the
    whole series, so the false sentence is attached to a *more* authoritative
    number than it would have been. Supplying a true fact in our own voice
    makes the falsehood around it more believable — the same effect as a
    partial correction, arriving through an improvement.
    """
    if beaten < 0:
        raise ValueError("counts cannot be negative")
    if beaten == 0:
        raise ValueError(
            "nothing beats the reading, so the superlative holds over the "
            "series and there is nothing to correct"
        )
    if beaten >= observations:
        raise ValueError(
            f"{beaten} readings cannot beat the claim out of {observations} "
            "observations that include the reading itself"
        )
    for name, value in (
        ("true_standing", true_standing),
        ("still_stands", still_stands),
    ):
        if not str(value).strip():
            raise ValueError(
                f"{name} is required: a superlative inflated from a true local "
                "claim must be placed, not merely denied"
            )
    superlative = "lowest" if claims_low else "highest"
    lower_or_higher = "lower" if claims_low else "higher"
    return {
        "corrected_at": corrected_at or isoformat(utcnow()),
        # Every builder here composes a notice about SOMETHING WE PUBLISHED
        # WRONG. The kind is a property of which builder ran, not of the
        # sentence it produced, so it is stamped rather than read back out
        # of the prose.
        "kind": OUR_ERROR,
        "description": (
            f"CORRECTED. This article said {claim.strip().rstrip('.')}. "
            f"It was not the {superlative} of those {observations} readings: "
            f"{beaten} are {lower_or_higher}, the {superlative} being "
            f"{true_extreme} in {true_period}. What is true is that "
            f"{true_standing.strip().rstrip('.')}. "
            f"{still_stands.strip().rstrip('.')}, and the {observations} "
            f"observations since {series_start} really are the whole series — "
            "the count is right and so is the origin; what was wrong was "
            "attaching an unbounded superlative to them. A superlative on this "
            "wire now has to hold over the population it names."
        ),
    }


def unit_correction_note(
    *,
    claim: str,
    start_value: float,
    start_period: str,
    latest_value: float,
    latest_period: str,
    change: float,
    still_stands: str,
    corrected_at: str | None = None,
) -> dict[str, str]:
    """The notice for a right number under the wrong unit.

    A SIXTH SHAPE, AND THE FIRST WHERE NEITHER THE NUMBER NOR THE
    CHARACTERISATION IS WRONG
    -------------------------------------------------------------------
    Three articles published a distance across a rate series labelled as a
    percentage. `latvia-s-house-prices-rise-10-9-year-on-year` says

        "The cumulative change of 5.5% year on year indicates a strong upward
         trend in the housing market"

    5.4% and 10.9% are two readings of "% year on year", and the distance
    between them is 5.5 **percentage points**. Written as "5.5%" it asserts a
    change of 5.5 where the change from 5.4 to 10.9 is 101.9% — understated
    18.5-fold. ``#344`` fixed :func:`newsroom.pipeline.units.unit_for_field` so
    the writer is no longer told the wrong label; this is the pass over what
    had already printed.

    WHAT THIS SHAPE REFUSES TO SAY, WHICH IS WHAT MAKES IT A SHAPE
    --------------------------------------------------------------
    Two sentences are available to every other builder here and false in this
    one, and forcing this through either would publish another shape's truth
    as this one's.

    **"The figures are unchanged and correct."** :func:`record_correction_note`
    and :func:`origin_correction_note` both end on it, and it is the
    reassurance a correction on a sound article owes. Here it is a trade on an
    ambiguity: 5.5 is the correct distance and "5.5%" is not a correct figure.
    A notice read by someone already doubting us must not rest on which of
    those two the reader has in mind.

    **"the opposite direction to the ... reported".**
    :func:`span_correction_note` hardcodes it, because there the sign inverts.
    Here it does not: all three readings rose, and telling a reader the
    direction was wrong would be a fresh falsehood inside the correction —
    exactly the fault that builder exists to avoid, arriving from the other
    side. :func:`comparison_correction_note` and the record shapes need a
    superlative or a placing, and no superlative is involved at all.

    So what survives here is its own sentence: **both readings stand, the
    distance between them stands, the direction stands, and the size does
    not.** No other shape can say that, because in every other shape the size
    was never in question.

    THE RELATIVE CHANGE AND THE FACTOR ARE DERIVED, NOT DECLARED
    ------------------------------------------------------------
    ``AGENTS.md`` records a correction notice whose own stated interval was
    typed from memory and was two years out — inside a notice about a figure
    on the wrong span. Both figures this note turns on are therefore computed
    here, from ``start_value`` and ``latest_value``, in the run that writes the
    sentence. The factor is exactly ``100 / start_value``; a caller cannot
    supply it and so cannot get it wrong.

    ``change`` is a required argument even though it is ``latest_value -
    start_value``, for the reason ``beaten_in_window`` is required on
    :func:`record_correction_note`: it is the number that was *published*, and
    making the caller state it lets this refuse the case where the published
    distance and the two readings disagree. A notice cannot rest on figures
    that contradict each other.

    A NON-POSITIVE BASE IS REFUSED RATHER THAN RENDERED
    ---------------------------------------------------
    "N times as large" has no meaning against a base of zero, and against a
    negative one it silently inverts: a series running -1.38 to 4.8 gives a
    relative change of -448%, which is arithmetic rather than a fact about the
    world. None of the three subjects has such a base. A future one would need
    a differently-worded notice, so this refuses instead of publishing a number
    it cannot mean.

    THE SERIES UNIT IS NOT A PARAMETER, AND THAT WAS MEASURED
    ----------------------------------------------------------
    An earlier draft took ``unit: str`` and refused a non-rate series through
    :func:`newsroom.pipeline.units.is_rate_unit` — the same function ``#344``
    fixed, asked rather than respelled. It is not here, because the guard it
    bought is smaller than the one it broke.

    ``AGENTS.md``'s parameter table records that every string parameter these
    builders show a reader has at some point carried a figure, and that the two
    rules by which one might count those parameters give the same number over
    different sets. Measured across the registry, **0 of the 14 rate-like units
    in** ``collect/opendata.py`` **contains a digit** — 0 of all 38 do — so a
    ``unit`` argument can never honestly carry one. Printed, it falsifies the
    first claim; unprinted, it is a second never-shown string and dissolves the
    second. Interpolating it only into the exception would break the first
    anyway, since that classifier counts any f-string; concatenating it to
    slip past the classifier would be worse than either.

    So the check lives where the risk actually is. Every notice filed here goes
    through ``corrections.PENDING``, and
    ``newsroom/tests/pipeline/test_unit_correction.py`` asserts each one's
    series unit is rate-like by calling ``is_rate_unit`` on the unit the
    published article declares. That tests the three real subjects rather than
    a hypothetical caller, and it still cannot drift from ``#344``.
    """
    if change == 0:
        raise ValueError("a distance of zero has no unit worth correcting")
    if abs((latest_value - start_value) - change) > 1e-9:
        raise ValueError(
            f"{latest_value} - {start_value} is {latest_value - start_value}, not "
            f"the published {change}; the notice would rest on three figures two "
            "of which disagree, and a correction cannot"
        )
    if start_value <= 0:
        raise ValueError(
            f"a relative change against a base of {start_value} is meaningless — "
            "zero cannot be divided into and a negative base inverts the sign; "
            "this article needs a notice that does not state a factor"
        )
    if not still_stands.strip():
        raise ValueError(
            "this shape exists because the reading, the distance and the "
            "direction all stand; say what stands, or a notice that corrects a "
            "unit reads as a retraction of the story"
        )

    relative = 100.0 * (latest_value - start_value) / start_value
    factor = relative / change
    rose = change > 0

    return {
        "corrected_at": corrected_at or isoformat(utcnow()),
        # Every builder here composes a notice about SOMETHING WE PUBLISHED
        # WRONG. The kind is a property of which builder ran, not of the
        # sentence it produced, so it is stamped rather than read back out
        # of the prose.
        "kind": OUR_ERROR,
        "description": (
            f"CORRECTED. This article said {claim.strip().rstrip('.')}. "
            f"That figure is the distance between two readings of the same "
            f"rate: {_number(start_value)}% in {start_period.strip()} and "
            f"{_number(latest_value)}% in {latest_period.strip()}. The distance "
            f"between two percentages is measured in percentage points, not in "
            f"percent, and it is {_number(abs(change))} percentage points. "
            f"Written with a percent sign it reads as a change of "
            f"{_number(abs(change))}%, when the change from "
            f"{_number(start_value)}% to {_number(latest_value)}% is "
            f"{_number(relative)}% — {_number(abs(factor))} times as large. "
            f"Both readings are correct, the distance between them is correct, "
            f"and the figure {'rose' if rose else 'fell'} as reported: "
            f"{still_stands.strip().rstrip('.')}. What was wrong is the unit, "
            "and on a rate series the unit is what carries the size. The figure "
            "table this article was written from labelled the distance with the "
            "series' own unit; it now reads percentage points, so no later "
            "article is told the same thing."
        ),
    }


def _number(value: float) -> str:
    """A figure for a reader: at most one decimal, and no trailing zero.

    Percentages read at one decimal — the same limit ``formatFigures`` applies
    in the browser, so the notice and the prose beside it do not disagree about
    how precisely this newsroom claims to measure. ``101.85185185185185``
    becomes ``101.9`` and ``4.048582995951417`` becomes ``4``.
    """
    text = f"{value:.1f}".rstrip("0").rstrip(".")
    return text if text not in {"", "-", "-0"} else "0"


_WORDS = {
    1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six",
    7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten", 11: "Eleven", 12: "Twelve",
    13: "Thirteen", 14: "Fourteen", 15: "Fifteen", 16: "Sixteen",
    17: "Seventeen", 18: "Eighteen", 19: "Nineteen", 20: "Twenty",
}

_ORDINALS = {
    1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth",
    7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth", 11: "eleventh",
    12: "twelfth", 13: "thirteenth", 14: "fourteenth", 15: "fifteenth",
    16: "sixteenth", 17: "seventeenth", 18: "eighteenth", 19: "nineteenth",
    20: "twentieth", 26: "twenty-sixth",
}


def _ordinal(n: int) -> str:
    """Words for the small ones; digits with a suffix beyond the table.

    A correction is read by someone already doubting us, so "the twenty-sixth"
    reads better than "the 26th" -- but inventing an English ordinal for an
    arbitrary integer is how "the 113rd" gets published, so anything not named
    falls back to a form that is always right.
    """
    if n in _ORDINALS:
        return _ORDINALS[n]
    suffix = "th"
    if n % 100 not in (11, 12, 13):
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


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
                # Carried through rather than recomputed. A note reaching here
                # from one of the builders above declares `our_error`; one that
                # does not declare anything stays silent, and `correction_kind`
                # resolves that to the weaker claim at the point of reading.
                **({"kind": note["kind"]} if note.get("kind") else {}),
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
    "comparison_correction_note",
    "find_revisions",
    "origin_correction_note",
    "record_correction_note",
    "span_correction_note",
    "unit_correction_note",
]
