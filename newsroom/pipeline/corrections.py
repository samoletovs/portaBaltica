"""Correcting an article the newsroom got wrong, without withdrawing it.

WHY THIS IS NEITHER ``revisions.py`` NOR ``retract.py``
-------------------------------------------------------
The published corrections policy names two remedies, and the pipeline
implemented one and a half of them:

    Correction — a factual error: a wrong figure, a misstated comparison.
    Retraction — the story should not have been published: the underlying data
                 was invalid, or the premise was wrong.

``retract.py`` is the second. ``revisions.py`` looks like the first and is not:
it handles the case where **the source** restated a figure after we published
it, and its public sentence ends

    "Statistical agencies revise routinely — this is a restatement by the
     source, not a reporting error."

which is true there and a lie about anything we got wrong ourselves. So a
factual error of our own — the category the policy leads with — had nowhere to
go. The only tool that fitted was retraction, which withdraws the article, and
using it on a piece whose figures and premise are sound would destroy correct
journalism to fix a label.

That gap was found by needing it. On 2026-08-28 an article published:

    "Dr. Ineta Zvirbule suggests this is a likely explanation, but the data
     cannot confirm it."

No such economist exists — she is a role on the causal panel, not a person, and
was given an invented name by a defect since fixed. Everything else in the piece
is right: the figures, the comparison basis, the finding, and the substance of
the hypothesis itself. There is nothing to retract and one sentence to correct.

WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
--------------------------------------------------
* Appends a note to the article's ``corrections``, which ``ArticleView`` renders
  in a warning panel **above the body** — so a reader meets the correction
  before the sentence it is about.
* Appends the same note to the public corrections log at ``/corrections``.
* Leaves ``status`` as ``published``. See :func:`newsroom.pipeline.revisions.annotate`
  for why touching it would delete the article from the site at the moment it
  was corrected.
* **Does not touch the prose.** ``retract.py`` states the rule for the whole
  apparatus — *"Nothing here rewrites the article's prose. The record is
  append-only"* — and it is the rule that makes a correction worth anything.

That last point was argued rather than assumed, because the obvious alternative
is to repair the sentence at render time, the way ``analystLabel`` repairs the
provenance block. Three reasons it is wrong here:

1. The provenance block is the site's own chrome *describing* its data; the
   body is the article. Relabelling the first explains a record, relabelling
   the second edits one.
2. **A correction and a silent rewrite are incompatible, not complementary.** A
   note saying "we credited Dr Zvirbule" beside a paragraph that no longer says
   it describes a state the reader cannot check. A correction that cannot be
   verified against the page is worse than no correction, because it asks for
   trust while removing the evidence.
3. It is what this newsroom already promises. The retraction notice says "The
   page remains here, unchanged, so the record of what we published is public",
   and a site whose argument is disclosure does not quietly edit an
   embarrassment out of its own archive.

WHY THE LIST LIVES IN CODE
--------------------------
An editorial correction cannot be detected — that is what distinguishes it from
the revision watch, which computes its own subject every run. Somebody has to
decide that a published sentence was wrong. Declaring that decision here, applied
idempotently on each run, means it is reviewed like any other change and leaves a
diff; the alternative is an operator editing a blob by hand, which is
unreviewable and unrepeatable.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from newsroom.pipeline.models import isoformat, utcnow
from newsroom.pipeline.publish import ArticleStore
from newsroom.pipeline.revisions import OUR_ERROR, unit_correction_note

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class EditorialCorrection:
    """A factual error of ours, on an article that otherwise stands."""

    slug: str
    #: What was wrong and what is true, in plain terms. "An error occurred"
    #: asks for trust rather than earning it, which is ``retract.py``'s rule for
    #: the same reason.
    description: str
    #: The wording as published, when quoting it helps a reader find the
    #: sentence. Optional in the schema, and worth setting: a correction about
    #: a phrase is much easier to check against the page than one about a topic.
    previous_value: str | None = None

    def to_correction(self) -> dict[str, str]:
        """Shaped by ``corrections`` in ``schemas/article.schema.json``."""
        note: dict[str, str] = {
            "corrected_at": isoformat(utcnow()),
            "description": self.description,
            # THIS CLASS IS THE CLAIM. Its docstring says so in six words — "a
            # factual error of ours, on an article that otherwise stands" — so
            # every notice issued through this path is one, by construction and
            # not by inspection of the sentence it carries.
            "kind": OUR_ERROR,
        }
        if self.previous_value:
            note["previous_value"] = self.previous_value
        return note

    def to_log_entry(self, note: Mapping[str, str], headline: str) -> dict[str, str]:
        """Shaped by ``CorrectionLogEntry`` in ``src/news-api.ts``.

        Takes the note already written onto the article rather than building a
        second one, so the log and the article can never disagree about the
        wording or the timestamp — the same rule
        :meth:`newsroom.pipeline.revisions.Revision.to_log_entry` follows.
        """
        entry = {
            "slug": self.slug,
            "headline": headline,
            "corrected_at": note["corrected_at"],
            "description": note["description"],
        }
        if note.get("previous_value"):
            entry["previous_value"] = note["previous_value"]
        # Carried from the note for the reason the docstring gives about the
        # wording: a second source of truth for the kind is a second thing that
        # can disagree about it. A note with none stays silent here, and
        # `correction_kind` resolves that to the weaker claim when it is read.
        if note.get("kind"):
            entry["kind"] = note["kind"]
        return entry


def already_recorded(
    article_corrections: Sequence[Mapping[str, Any]], correction: EditorialCorrection
) -> bool:
    """Has this correction already been noted on the article?

    Matched on the description text rather than on a stored identifier, for the
    same reason ``revisions.already_recorded`` is: there is no id on a note
    written before this module existed, and a correction that re-appends itself
    every run turns the warning panel into a wall of the same sentence.
    """
    return any(
        str(existing.get("description") or "").strip() == correction.description.strip()
        for existing in article_corrections
    )


def annotate(
    document: Mapping[str, Any], correction: EditorialCorrection
) -> dict[str, Any] | None:
    """Append the note, or ``None`` if it is already there.

    Returns a new document rather than mutating, so a caller that decides not to
    write cannot have already changed the record.
    """
    corrections = list(document.get("corrections") or [])
    if already_recorded(corrections, correction):
        return None
    corrections.append(correction.to_correction())
    updated = dict(document)
    updated["corrections"] = corrections
    return updated


async def issue(
    store: ArticleStore, corrections: Sequence[EditorialCorrection]
) -> list[str]:
    """Apply each correction to its article. Returns the slugs actually changed.

    Idempotent and independent: a correction whose article is missing, already
    corrected, or unreadable is skipped without touching the others. Never
    raises — a correction that cannot be filed must not take an edition down,
    and the next run will try again.
    """
    changed: list[str] = []
    log_entries: list[dict[str, str]] = []

    for correction in corrections:
        try:
            document = await store.read_published(correction.slug)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not read %s to correct it: %s", correction.slug, exc)
            continue
        if document is None:
            log.info("nothing to correct: %s is not published", correction.slug)
            continue
        # A retracted article already carries a louder notice, and appending a
        # correction to a withdrawn story tells a reader we amended something
        # we had disowned.
        if document.get("status") != "published":
            log.info(
                "skipping %s: status is %r, not published",
                correction.slug,
                document.get("status"),
            )
            continue

        annotated = annotate(document, correction)
        if annotated is None:
            continue

        try:
            await store.write_published(correction.slug, annotated)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not write the correction to %s: %s", correction.slug, exc)
            continue

        changed.append(correction.slug)
        log_entries.append(
            correction.to_log_entry(
                annotated["corrections"][-1], str(annotated.get("headline") or "")
            )
        )
        log.warning("corrected %s: %s", correction.slug, correction.description)

    if log_entries:
        try:
            await store.append_corrections(log_entries)
        except Exception as exc:  # noqa: BLE001
            # The article carries the note either way, which is the copy a
            # reader of that page sees. The log is the index of them.
            log.warning("corrections log append failed: %s", exc)

    return changed


#: The invented analyst. One article, named rather than searched for, because
#: the population is closed: ``hypothesis.Lens`` now carries a role title, the
#: validator refuses any honorific-led name, and no later run can produce
#: another. A detector for a fault that cannot recur is a detector that will
#: only ever be wrong.
#:
#: Only this article is listed. The same invented name is in the *provenance* of
#: a second one, and that needs no correction: ``analystLabel`` repairs the
#: passport at render time, so nothing false reaches the reader there. The line
#: between the two mechanisms is the same one this module's docstring draws —
#: **render-time repair for the chrome, a correction for the prose.**
INVENTED_ANALYST = EditorialCorrection(
    slug=(
        "consumer-confidence-in-the-baltic-states-shows-significant-"
        "divergence-in-1ee73e"
    ),
    description=(
        "This article credited an explanation to “Dr. Ineta Zvirbule”. There "
        "is no such person. The suggestion came from one of the newsroom's "
        "own AI analysts — a software role, now named “the newsroom's AI "
        "household economist” — which a defect in our pipeline had given an "
        "invented personal name. The analysis itself is unchanged and was "
        "always marked as unconfirmed; what was wrong was presenting it as "
        "the view of a human economist we had consulted. We have consulted "
        "nobody. The paragraph is left exactly as published, so the record "
        "of what we printed stands, and no analyst is given a personal name "
        "again."
    ),
    previous_value=(
        "Dr. Ineta Zvirbule suggests this is a likely explanation, but the "
        "data cannot confirm it."
    ),
)


#: The weekly wrap that inverted a direction in its own headline.
#:
#: `electricity-prices-and-renewable-energy-share-rise-in-the-baltics-fa8c99`,
#: published 2026-08-30T15:00:19Z by the first scheduled weekly timer, at
#: `revision e8da9c3` — before `#280` was on master. Measured 2026-08-31T11:2xZ
#: against the two live series, and against the corpus the wrap was built from:
#:
#:     elec_price_industry LV   37 obs 2007-S2..2025-S2
#:       2025-S2  0.1335   <- the article's "0.13"
#:       2025-S1  0.1354   <- the actual previous semi-annual period
#:       2022-S2  0.2292   <- the article's "0.23", the STREAK basis
#:       move vs the previous period: -0.0019, a FALL and the sixth in a row
#:
#:     renewables LT            22 obs 2004..2025
#:       2025     38.5     <- rose, so this half of the headline is TRUE
#:       2024     35.408   <- the actual previous measurement period
#:       2018     24.695   <- the article's "24.7", again the STREAK basis
#:
#: WHY A CORRECTION AND NOT A RETRACTION, WHICH WAS ARGUED RATHER THAN ASSUMED
#: ---------------------------------------------------------------------------
#: The false headline is in the slug and travels alone — into the feed, the RSS
#: and the JSON-LD — where no notice follows it, and retraction would remove it
#: from feeds. That is the strongest argument for the heavier remedy and it
#: loses to two things. The published policy names this case in its own words:
#: a correction covers "a wrong figure, **a misstated comparison**", and a
#: retraction is for when "the underlying data was invalid, or the premise was
#: wrong". Neither is true here — every figure is a correct reading and two of
#: the three findings are sound. And the newsroom has already met a false
#: headline once, in `latvia-s-food-inflation-drops-to-a-record-low-`, and
#: corrected it rather than withdrawing it.
#:
#: THE FAULT IS NARROWER THAN "THE WRAP MISDESCRIBES ITS BASES"
#: -------------------------------------------------------------
#: Three paragraphs carry a comparison. The third — building permits at 106.8
#: index points "compared with a nine-year average of 71.52 index points for
#: this period" — is exactly right; the nine Q2 readings from 2017 to 2025 mean
#: 71.52. It is the one whose basis comes from `seasonal_deviation`. Both
#: paragraphs that got it wrong are quoting a **streak** basis, and both call
#: it "the previous period". 2 of 2 streak bases wrong, 1 of 1 seasonal basis
#: right — which is a much sharper statement than a count of paragraphs, and it
#: is the correct sibling that made the file look handled.
WEEKLY_WRAP_BASIS = EditorialCorrection(
    slug="electricity-prices-and-renewable-energy-share-rise-in-the-baltics-fa8c99",
    description=(
        "CORRECTED. The headline of this weekly wrap said that electricity "
        "prices and the renewable energy share both rose in the Baltics. "
        "Latvian industrial electricity prices did not rise. At 0.13 EUR per "
        "kWh in 2025-S2 they were down from 0.135 EUR per kWh in 2025-S1, and "
        "that was the sixth consecutive semi-annual fall; the first paragraph's "
        "“increased” is wrong in the same way. Two comparisons were also "
        "labelled as the previous period and are not: the 0.23 EUR per kWh the "
        "article measures the price against is 2022-S2, three years earlier, "
        "and the 24.7% it measures Lithuania's renewable share against is 2018, "
        "seven years earlier — the previous year, 2024, was 35.4%. Each figure "
        "quoted is a "
        "correct reading of its own period; what was wrong is which period each "
        "was set against, and, for electricity, the direction that follows from "
        "it. The renewable share did rise, so that half of the headline stands, "
        "and the paragraph on Lithuanian residential building permits — 106.8 "
        "index points against a nine-year average of 71.52 for the same quarter "
        "— is correct and correctly described. The paragraphs are left exactly "
        "as published. Our daily report on the same reading was headlined "
        "“Latvia's industrial electricity price drops to 0.13 EUR”: the wrap "
        "contradicted it, and a comparison on this wire now has to name the "
        "period it is measured against rather than calling it the previous one."
    ),
    previous_value=(
        "Industrial electricity prices in Latvia increased to 0.13 EUR per kWh, "
        "compared with 0.23 EUR per kWh in the previous semi-annual period."
    ),
)


#: Our own correction notice, corrected. The first instance of this apparatus
#: being turned on itself, and the policy rather than judgement is what decides
#: it: `newsroom/policy/corrections.md` defines a correction as "a factual
#: error: **a wrong figure**, a misstated comparison, a misattributed source",
#: with no materiality threshold, and *Clarification* — "the facts were right
#: but the framing could mislead" — does not fit, because the fact is wrong.
#:
#: `span_correction_note(**ELECTRICITY)`, filed 2026-08-31T06:12:34Z, says the
#: 41.75% fall "is the change since 2022-S2, four and a half years later".
#: "Later" is measured from the span the article named, 2016-S1, and:
#:
#:     2016-S1 .. 2022-S2   13 semi-annual periods = 6.5 years
#:
#: Nothing gives 4.5 from any pair of periods that notice names.
#:
#: WHY THIS IS NOT AN EMBARRASSMENT TO BE MINIMISED
#: -------------------------------------------------
#: A figure inside a correction is read by someone already doubting us, on the
#: one surface that exists to earn that trust back — so it is the most
#: expensive place to be wrong, not the least. The policy anticipates the
#: discomfort and rules against it in its own voice: "We do not delete the
#: evidence." The first notice stays exactly as filed.
#:
#: AND IT IS THE SAME FAULT IT CORRECTS, ONE LAYER OUT
#: ----------------------------------------------------
#: The phrase then propagated: `WEEKLY_WRAP_BASIS` was drafted with "four and a
#: half years earlier", copied from the `ELECTRICITY` fixture that pins this
#: published text, where the correct interval is a *different* 3.0 years. One
#: phrase, two notes, two wrong numbers, neither of them 4.5 — a wrong figure
#: travelling out of a correction and into the next one. Caught in review
#: before the second shipped; `newsroom/tests/pipeline/test_correction_intervals.py`
#: now computes every stated interval from the periods the note itself names.
CORRECTION_INTERVAL = EditorialCorrection(
    slug="latvia-s-industrial-electricity-price-drops-to-0-13-eur-93118d",
    description=(
        "CORRECTED — and this time we are correcting ourselves. The notice "
        "above, filed on 31 August 2026, said the 41.75% fall "
        "“is the change since 2022-S2, four and a half years later”. That "
        "interval is wrong. Measured from 2016-S1, the period the article "
        "named, 2022-S2 is six and a half years later — thirteen semi-annual "
        "periods, not nine. Everything else in that notice stands: 41.75% is "
        "the change since 2022-S2, the price did rise 48.8% over the span the "
        "article named, the series does run back to 2007-S2, and none of the "
        "article's own figures is affected. The first notice is left exactly "
        "as filed, because a corrections record that quietly repairs itself is "
        "not a record."
    ),
    previous_value="it is the change since 2022-S2, four and a half years later",
)


#: THE PERCENTAGE-POINT PASS. Three articles stated a distance across a rate
#: series as a percentage. `#344` fixed `units.unit_for_field` so the writer is
#: no longer told the wrong label; these are the three that had already printed.
#:
#: THE POPULATION IS THE PROSE, NOT THE METADATA, AND THE TWO DISAGREE
#: -------------------------------------------------------------------
#: Swept against the served blobs on 2026-09-01 (`index.json` generated
#: 2026-08-31T14:08:21Z): 93 index entries, 39 with declared figures, 257
#: figures. Nine of those figures, across eight articles, carry a
#: `signal_field` in `units.ABSOLUTE_DIFFERENCE_FIELDS` under a rate unit — the
#: stale label. But `unit` and `rendered_as` are internal: nothing in `src/`
#: reads `block.figures`, so `ArticleView` renders `block.text` and no reader
#: ever sees them. Read the sentences instead and the nine split cleanly:
#:
#:     deviation  (seasonal)  5 rendered "N percentage points"   CORRECT
#:     deviation  (seasonal)  1 not rendered in its paragraph    n/a
#:     cumulative_change (streak)  3 rendered "N%"               WRONG
#:
#: which independently reproduces the count `units.py` already records — "the
#: seasonal section carries a percentage-points example and got 5 of 5 right,
#: the streak section does not and got 0 of 3". Six of the nine need no notice,
#: because a reader was never told anything false; correcting them would file a
#: correction against correct journalism.
#:
#: Every figure below is read out of the article's own declared figures and the
#: identity `latest - start == cumulative_change` is asserted before the notice
#: is built, by `unit_correction_note` itself. The relative change and the
#: understatement factor are computed there, in the run that writes the
#: sentence, and cannot be supplied by a caller.
UNIT_HOUSE_PRICES = EditorialCorrection(
    slug="latvia-s-house-prices-rise-10-9-year-on-year-b069b5",
    description=unit_correction_note(
        claim=(
            'that Latvia\'s house prices showed a "cumulative change of 5.5% '
            'year on year"'
        ),
        start_value=5.4,
        start_period="2025-Q1",
        latest_value=10.9,
        latest_period="2026-Q1",
        change=5.5,
        still_stands=(
            "Latvian house price growth did accelerate across those four "
            "quarters, and by more than the article's own wording conveyed"
        ),
    )["description"],
    previous_value="The cumulative change of 5.5% year on year",
)


UNIT_GOODS_INFLATION = EditorialCorrection(
    slug="lithuania-s-goods-inflation-reaches-4-8-after-six-consecutive-6e1271",
    description=unit_correction_note(
        claim=(
            'that Lithuania\'s goods inflation showed "a cumulative change of '
            '3.2% across the six-month streak"'
        ),
        start_value=1.6,
        start_period="January 2026",
        latest_value=4.8,
        latest_period="July 2026",
        change=3.2,
        still_stands=(
            "Lithuanian goods inflation did rise in each of those six months, "
            "and the streak the article reports is real"
        ),
    )["description"],
    previous_value="a cumulative change of 3.2% across the six-month streak",
)


#: This article already carries a notice — `#342`'s, on the origin of the
#: series and on where the run of seven begins. The two must not disagree, and
#: were read against each other rather than assumed to be independent: that
#: notice establishes 2018 as the start of the run and says "the record itself
#: stands: 38.5% in 2025 is the highest of all 22 readings". Both halves of
#: `still_stands` below are that notice's own findings, restated rather than
#: re-derived, so a reader meeting the two together is not told two things.
UNIT_RENEWABLES = EditorialCorrection(
    slug="lithuania-s-renewable-energy-share-hits-record-38-5-in-bb595c",
    description=unit_correction_note(
        claim=(
            'that Lithuania\'s renewable share showed "a cumulative change of '
            '13.8%"'
        ),
        start_value=24.7,
        start_period="2018",
        latest_value=38.5,
        latest_period="2025",
        change=13.8,
        still_stands=(
            "the share did rise in each of the seven years from 2018, and "
            "38.5% remains the highest of the 22 readings in the series"
        ),
    )["description"],
    previous_value="with a cumulative change of 13.8%",
)


PENDING: tuple[EditorialCorrection, ...] = (
    INVENTED_ANALYST,
    WEEKLY_WRAP_BASIS,
    CORRECTION_INTERVAL,
    UNIT_HOUSE_PRICES,
    UNIT_GOODS_INFLATION,
    UNIT_RENEWABLES,
)


__all__ = [
    "CORRECTION_INTERVAL",
    "INVENTED_ANALYST",
    "PENDING",
    "UNIT_GOODS_INFLATION",
    "UNIT_HOUSE_PRICES",
    "UNIT_RENEWABLES",
    "WEEKLY_WRAP_BASIS",
    "EditorialCorrection",
    "already_recorded",
    "annotate",
    "issue",
]
