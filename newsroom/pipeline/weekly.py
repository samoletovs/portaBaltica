"""The weekly wrap: one piece about what a week of findings added up to.

WHY THIS FORMAT EXISTS
----------------------
Everything else the newsroom publishes is one finding, one article. That is a
wire, and a wire is useful, but it never says what a week *meant* — that
Estonian productivity is still below its 2020 base while Latvia leads, or that
the debt ranking and the debt trend disagree. It is also the only format that
uses the fact that all eight beats now file.

WHY IT DOES NOT GET AN EXEMPTION FROM THE CONTRACT
--------------------------------------------------
The tempting shortcut is to let a wrap quote figures it did not verify, on the
grounds that another article already did. That is how a contract dies. Instead
the week's corpus is reduced to a synthetic :class:`Signal` whose ``fields``
hold every number the writer is permitted to use, and generation runs through
the ordinary path unchanged. ``figures_traceable`` then holds for exactly the
reason it holds everywhere else: a number with nothing to bind to fails closed.

It is worth being precise about what is *not* free here. Figures the wrap
QUOTES are traceable because they came from the ledger. Anything the wrap says
about the week itself — "eight sections filed", "three of five rose" — is a new
number derived from the corpus, and no field of any source article resolves it.
Those are computed deterministically here and supplied as fields of their own,
which is why they are safe to write and why a wrap that invented one would
still be rejected.

TWO CHECKS THAT NEEDED THINKING ABOUT, AND ONE THAT DID NOT
-----------------------------------------------------------
``no_repeated_findings`` is about repetition WITHIN one piece — two body
paragraphs declaring an identical, non-empty set of ``signal_field`` names. A
wrap quoting five findings once each declares five different sets, so the check
applies unchanged and needs no exemption. It is also actively wanted: a
synthesis that says the same thing twice is the failure this format is most
prone to.

``comparison_basis_stated`` is the one that constrains the design. It requires
the prose to name what a change is measured against, in the same text unit as
the claim. So a wrap cannot describe a movement unless it knows each figure's
basis — which is why :class:`~newsroom.pipeline.vintage.PublishedFigure` now
carries ``comparison_basis``, and why the bases are put in front of the writer
alongside the values.

WHAT MAKES IT SAFE TO PUBLISH: THE CITATIONS
---------------------------------------------
A wrap outlives the articles it cites, and every correction mechanism here
assumes the wrong thing is the article itself. On the day this was written the
newsroom retracted five articles for carrying figures from the wrong Eurostat
cube; a wrap published that week would have been a sixth, still asserting 130.9
as a bankruptcy figure, and ``retract_all`` would have had no idea it existed.

So a wrap records ``provenance.cites`` — the slugs it drew on — and
:func:`newsroom.pipeline.retract.retract_all` withdraws any wrap citing an
article it is withdrawing. See ``retract.wraps_citing`` for why that is a
retraction rather than a correction or a flag.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Mapping, Sequence

from newsroom import numeric_scan
from newsroom.pipeline.desk import Finding, run_desk
from newsroom.pipeline.models import Signal, SourceRef, isoformat, utcnow
from newsroom.pipeline.vintage import PublishedFigure

log = logging.getLogger(__name__)

#: Below this a week has not produced a synthesis, only a list. Two findings do
#: not disagree with each other in any interesting way, and a wrap that says
#: "these two things happened" is worth less than the two articles already on
#: the front page.
MIN_FINDINGS = 4

#: Above this the piece stops being a read and becomes a table. The cap is on
#: what reaches the writer, not on what the week produced: the highest-scoring
#: findings are kept and the rest are simply not cited.
MAX_FINDINGS = 8

SECTION = "economy"
DETECTOR = "weekly_wrap"

#: The value of ``Article.format`` for a wrap. Declared in the schema enum, so
#: a typo here fails validation rather than producing an unlabelled piece.
WEEKLY_FORMAT = "weekly_wrap"

#: The dashboard sections an article may be filed under. A wrap uses one of
#: these like anything else: the newsroom borrows the dashboard's taxonomy, and
#: a section with no tile behind it would break the article to /data round trip.
SECTION_LABELS_ALLOWED = (
    "economy", "trade", "government", "labour", "energy",
    "property", "environment", "maritime", "business",
)


@dataclass(frozen=True, slots=True)
class WeeklyCorpus:
    """A week of published findings, ready to be written about."""

    start: str
    end: str
    figures: tuple[PublishedFigure, ...]

    @property
    def slugs(self) -> tuple[str, ...]:
        """The articles this wrap would cite, in a stable order."""
        return tuple(sorted({figure.slug for figure in self.figures}))

    @property
    def sections(self) -> tuple[str, ...]:
        return tuple(sorted({_section_of(figure) for figure in self.figures}))

    def __len__(self) -> int:
        return len(self.figures)


def week_bounds(now: datetime | date) -> tuple[str, str]:
    """The seven days ending on ``now``, inclusive, as ISO dates.

    A rolling window rather than an ISO calendar week. A wrap that runs on a
    Sunday and covers Monday-to-Sunday would omit anything published that
    morning; a rolling seven days always covers the same span whenever the
    trigger happens to fire, which matters because the trigger has already
    silently failed to fire once.
    """
    end = now.date() if isinstance(now, datetime) else now
    return ((end - timedelta(days=6)).isoformat(), end.isoformat())


#: Metric prefix to beat.
#:
#: Checked against the metric names production actually uses, not invented
#: ones: a probe of the live ledger found `day_ahead_power_price`,
#: `ghg_emissions` and `economic_sentiment` all falling through to "economy",
#: which understated `sections_covered` — and that count is supplied to the
#: writer as a quotable figure, so a wrong one is a wrong published number
#: rather than a cosmetic slip.
_SECTION_BY_PREFIX = (
    ("port_", "maritime"),
    ("house_prices", "property"),
    ("construction", "property"),
    ("day_ahead_power", "energy"),
    ("power_", "energy"),
    ("electricity", "energy"),
    ("ghg_", "environment"),
    ("greenhouse", "environment"),
    ("air_", "environment"),
    ("business_", "business"),
    ("unemployment", "labour"),
    ("labour", "labour"),
    ("hourly", "labour"),
)


def _section_of(figure: PublishedFigure) -> str:
    """The beat a figure belongs to, inferred from its metric."""
    metric = figure.metric
    for prefix, section in _SECTION_BY_PREFIX:
        if metric.startswith(prefix):
            return section
    if "balance" in metric:
        return "trade"
    return "economy"


def collect_week(
    figures: Iterable[PublishedFigure],
    *,
    now: datetime | date,
    exclude: Iterable[str] = (),
) -> WeeklyCorpus:
    """The week's findings, one per article, newest first.

    ``exclude`` drops slugs that must not be cited — a retracted article whose
    figures have not yet left the ledger, for instance. Filtering here rather
    than trusting the ledger to be clean is deliberate: the ledger is purged on
    retraction, and this is the second lock on the same door.
    """
    start, end = week_bounds(now)
    blocked = set(exclude)

    seen: dict[str, PublishedFigure] = {}
    for figure in figures:
        published = (figure.published_at or "")[:10]
        if not published or not (start <= published <= end):
            continue
        if figure.slug in blocked or not figure.slug:
            continue
        # One figure per article. A piece that cited three readings does not get
        # three votes in a synthesis of the week.
        if figure.slug not in seen or published > (seen[figure.slug].published_at or "")[:10]:
            seen[figure.slug] = figure

    ordered = sorted(seen.values(), key=lambda f: (f.published_at or ""), reverse=True)
    return WeeklyCorpus(start=start, end=end, figures=tuple(ordered[:MAX_FINDINGS]))


def _field_name(figure: PublishedFigure) -> str:
    """A flat, readable key for one finding, carrying its period.

    Flat because the validator resolves a ``signal_field`` against the signal
    root and against ``payload``, and ``payload`` is ``signal.fields`` — so a
    nested name would simply not resolve and every quoted figure would fail
    traceability.

    THE PERIOD IS IN THE NAME, and that is the fix for the defect that stopped
    the first wrap being published. A dry run produced:

        "The total port goods throughput in the Baltic reached 6,149 thousand
         tonnes during the week of August 21 to August 27, 2026."

    That figure is 2025-Q4. The eight findings spanned nine months, and the
    piece attributed five of them to the week in which they were *published*.
    Every gate passed: the numbers were real, traced and correctly bound. Only
    the period the prose attached them to was wrong, and nothing checks that.

    The writer had the periods in the context and ignored them, because the
    signal's own period is the week. Putting the period in the token the writer
    must name to cite the figure makes it much harder to lose — and the check
    in ``period_problems`` refuses the article if it is lost anyway.
    """
    geography = figure.geography.lower().replace(" ", "_")
    period = figure.period.lower().replace("-", "_")
    return f"{figure.metric}_{geography}_{period}"


#: The week attached to a MEASUREMENT — the thing that must never happen.
#:
#: A wrap is "what we reported this week", not "what happened this week". The
#: window says why we are telling you now; it is not the period any figure was
#: measured in. The first dry run lost that distinction and produced:
#:
#:     "Baltic port goods throughput reached 6,149 thousand tonnes during the
#:      week of August 21 to August 27, 2026."
#:
#: which is a 2025-Q4 quarterly total. Every gate passed it: the number was
#: real, traced and correctly bound. Only the period the prose attached it to
#: was wrong, and nothing checked that.
#:
#: The model was not inventing. It was told the article is about
#: ``signal.period``, and ``signal.period`` is the window — the third time the
#: writer has been blamed for doing what the guidance said, after the persona
#: `closing_move` entries and the analyst's `what_to_watch`.
#: ``_GAP`` rather than ``[^.]`` because a decimal point is not a full stop.
#: "stood at 89.7 index points in the same period" went uncaught until this was
#: fixed: the character class stopped dead at the "." in 89.7, so the very
#: sentences this exists to catch -- the ones carrying figures -- were the ones
#: it could not see past.
_GAP = r"(?:[^.]|\.(?=\d))"

_MEASURED_IN_THE_WINDOW = re.compile(
    r"\b(?:reached|stood at|was|were|totalled|totaled|hit|came in at|rose to|"
    r"fell to|averaged|settled at|registered|recorded)\b" + _GAP + r"{0,80}?"
    # WEEK ONLY. "the same period" belongs to `_SHARED_PERIOD_CLAIM`, which can
    # tell whether the claim is true from the block's own figures; treating it
    # as a window claim here made a TRUE sentence fail.
    r"\b(?:during|in|over|across|for)\s+(?:the\s+)?(?:same\s+|past\s+)?"
    r"week\b"
    r"|\b(?:during|in|over|across|for)\s+(?:the\s+)?(?:same\s+|past\s+)?"
    r"week\b" + _GAP + r"{0,40}?\b(?:reached|stood at|totalled|totaled|"
    r"averaged|settled at)\b",
    re.IGNORECASE,
)

#: The week used honestly, as the publication window. Always legal.
_REPORTED_IN_THE_WINDOW = re.compile(
    r"\b(?:reported|published|covered|filed|carried|wrote about|ran)\b"
    + _GAP + r"{0,40}?\bthis week\b"
    r"|\bthis week\b" + _GAP + r"{0,40}?\b(?:we\s+)?(?:reported|published|covered|filed|"
    r"carried|ran)\b"
    r"|\bin the week to\b",
    re.IGNORECASE,
)


#: A claim that the figures in this sentence share a period.
#:
#: Legitimate and REQUIRED in an ordinary article, where every figure comes
#: from one signal and one release — `prompts.py` names "in the same period" as
#: the required phrase for a related measure. In a wrap its truth depends on
#: which figures the sentence actually cites, which is why this is checked
#: against the block's own figures rather than banned.
_SHARED_PERIOD_CLAIM = re.compile(
    r"\b(?:in|during|over|for|across)\s+(?:the\s+)?same\s+"
    r"(?:period|quarter|month|year|week|day)\b"
    r"|\bthe\s+same\s+(?:period|quarter|month|year|week|day)\b",
    re.IGNORECASE,
)


def period_problems(article: Any, corpus: WeeklyCorpus) -> list[str]:
    """Prose that attributes a finding to a period it was not measured in.

    Two faults, checked per paragraph against the figures that paragraph
    actually cites — structurally, not lexically. A lexical version of this
    check passed the sentence

        "Latvia's port goods containers in the fourth quarter of 2025 amounted
         to 1175 thousand tonnes, which is lower than Lithuania's 3233 thousand
         tonnes IN THE SAME QUARTER."

    because it knew "period" and "week" and not "quarter". Lithuania's figure
    is 2026-Q1. Resolving the block's own figures answers the question the
    phrase raises instead of guessing at the phrasing.

    1. Attaching a measurement to the publication WINDOW. A wrap is "what we
       reported this week", not "what happened this week" — the week says why
       the reader is told now and is never a figure's period.

    2. Claiming two figures share a period when they do not.

    Third appearance of one failure: every per-article invariant holds and the
    article is about the wrong thing. The others were "Latvian sea passengers",
    a claim about one port dressed as a country, and the cache collision, where
    one metric's data wore another metric's name.
    """
    by_field = {_field_name(figure): figure for figure in corpus.figures}
    problems: list[str] = []

    for index, block in enumerate(article.body or []):
        text = getattr(block, "text", None)
        if not text:
            continue

        cited = [
            by_field[field]
            for field in (
                getattr(fig, "signal_field", "") or ""
                for fig in (getattr(block, "figures", None) or [])
            )
            if field in by_field
        ]
        periods = {figure.period for figure in cited}

        window = _MEASURED_IN_THE_WINDOW.search(text)
        if window and not (
            _REPORTED_IN_THE_WINDOW.search(text) and _names_a_period(text, periods)
        ):
            problems.append(
                f"body[{index}]: {window.group(0).strip()!r} attaches a figure "
                "to the publication window. The week is when we reported it, "
                "not when it was measured"
            )

        shared = _SHARED_PERIOD_CLAIM.search(text)
        if shared and len(periods) > 1:
            problems.append(
                f"body[{index}]: says {shared.group(0).strip()!r}, but the "
                f"figures it cites are from {', '.join(sorted(periods))}"
            )

    return problems


def _names_a_period(text: str, periods: set[str]) -> bool:
    """Whether the sentence names one of the corpus's actual periods."""
    lowered = text.lower()
    return any(period.lower() in lowered for period in periods)


def corpus_fields(corpus: WeeklyCorpus) -> dict[str, float]:
    """Every number the writer is allowed to use, and nothing else.

    Three kinds, and the distinctions are the whole reason this function
    exists.

    The per-finding values are QUOTED — each was verified when its own article
    was written and traced to a field of that article's signal.

    The BASIS values are quoted too, and supplying them is what makes the
    format readable. A comparison basis reads "the previous record high of 2691
    thousand tonnes in 2025-Q2"; without 2691 as a field the writer can either
    state a bare level, which produced eight paragraphs of list, or cite the
    number and fail ``figures_traceable``, which is what the first attempt with
    bases did — it invented a field called ``previous_record_high``. Both
    failures come from the same cause: a basis whose numbers cannot be cited is
    a basis that cannot be used. These values are as verified as the headline
    ones, having been checked when the source article was written.

    The counts are DERIVED: facts about the corpus, true of no single source
    article, which the writer could not state without inventing them.
    """
    fields: dict[str, float] = {}
    for figure in corpus.figures:
        name = _field_name(figure)
        fields[name] = float(figure.value)
        for index, token in enumerate(_basis_values(figure)):
            suffix = "_basis" if index == 0 else f"_basis_{index + 1}"
            fields[f"{name}{suffix}"] = token
    fields["findings_covered"] = float(len(corpus.figures))
    fields["sections_covered"] = float(len(corpus.sections))
    return fields


#: How many numbers to lift out of one basis. Two covers "the previous record
#: high of X in <period>" and "an average of X across Y observations"; beyond
#: that a basis is describing its own method rather than a comparison.
_MAX_BASIS_VALUES = 2


def _basis_values(figure: PublishedFigure) -> list[float]:
    """The numbers inside a comparison basis, so the writer may cite them.

    Read with ``numeric_scan`` rather than a local regex, so that what counts
    as a number here is the same thing the validator counts. The two disagreeing
    is how a figure becomes quotable in one component and invented in another.
    """
    if not figure.comparison_basis:
        return []
    return [
        float(token.value)
        for token in numeric_scan.scan(figure.comparison_basis)[:_MAX_BASIS_VALUES]
    ]


def corpus_context(corpus: WeeklyCorpus) -> dict[str, str]:
    """What each supplied number MEANS, in the words its own article used.

    Without the basis a wrap cannot describe a movement at all:
    ``check_comparison_basis_stated`` refuses prose that quantifies a change
    without naming what it is measured against, and it will not accept a basis
    stated three paragraphs away.
    """
    context: dict[str, str] = {
        "week_start": corpus.start,
        "week_end": corpus.end,
        "sections": ", ".join(corpus.sections),
        # THE FRAMING, stated first because everything else depends on it.
        #
        # A wrap is what we REPORTED this week, not what HAPPENED this week.
        # The first dry run lost that and called a 2025-Q4 quarterly total "the
        # week's throughput" — the model was not inventing, it was told the
        # article is about the signal's period and the signal's period is the
        # window.
        "what_this_article_is": (
            f"A digest of the findings portaBaltica PUBLISHED between "
            f"{corpus.start} and {corpus.end}. The week is the publication "
            "window, NOT the period any figure was measured in — those differ "
            "and are given per figure below. Say 'this week we reported X, "
            "measured in <that figure's period>'. Never say a figure was "
            "reached, stood at or totalled anything 'during the week' or 'in "
            "the same period': these findings do not share a period"
        ),
    }
    for figure in corpus.figures:
        name = _field_name(figure)
        label = f"{figure.metric_label} ({figure.geography}, {figure.period})"
        if figure.unit:
            label += f", in {figure.unit}"
        if figure.comparison_basis:
            label += f" — measured against {figure.comparison_basis}"
            basis_fields = [
                f"{name}_basis" if i == 0 else f"{name}_basis_{i + 1}"
                for i in range(len(_basis_values(figure)))
            ]
            if basis_fields:
                label += (
                    f". The numbers in that basis are available as "
                    f"{', '.join(basis_fields)} — cite them by those names to "
                    "compare, and never invent a field for them"
                )
        else:
            # Said plainly rather than left blank. Every figure in the ledger
            # before `comparison_basis` was added carries none, and a writer
            # given a bare number tends to describe a movement it cannot
            # support — which `check_comparison_basis_stated` then refuses,
            # spending the article's attempts on a fault the prompt caused.
            #
            # This is not hypothetical: a probe of the live ledger found all
            # eight of the week's findings in exactly this state.
            label += (
                " — NO COMPARISON BASIS RECORDED for this figure, so state the "
                "level only and do not describe it as a rise, a fall or a record"
            )
        context[name] = label
    return context


def corpus_signal(corpus: WeeklyCorpus) -> Signal:
    """A synthetic signal standing for the week.

    Synthetic, but not a fiction: every field is either a value a published
    article already verified or a count computed here from the corpus. It is
    shaped as a ``Signal`` so that generation, validation and the whole
    editorial contract apply to a wrap exactly as they apply to a report on a
    single series. No branch anywhere says "unless it is a wrap".
    """
    sources: list[SourceRef] = []
    seen_sources: set[tuple[str, str]] = set()
    for figure in corpus.figures:
        key = ("newsroom", figure.observed_at or "")
        if key not in seen_sources:
            seen_sources.add(key)
            sources.append(SourceRef(source_id="eurostat", retrieved_at=figure.observed_at or ""))

    return Signal(
        detector=DETECTOR,
        metric="weekly_wrap",
        metric_label="the week in Baltic data",
        geography="Baltic",
        period=f"{corpus.start}/{corpus.end}",
        value=float(len(corpus.figures)),
        # No unit: the "value" is a count of findings, and a unit containing a
        # digit is interpolated into the comparison basis and then read back as
        # an untraceable numeral. See the `unit` guard in test_collect.
        unit="",
        comparison_basis=(
            # No numeral here, deliberately. The basis is interpolated into
            # prose and then read back by the numeric scanner, so a count in it
            # would have to bind to a field to survive `no_invented_numbers` --
            # it happens to (``findings_covered``), but that is a coupling
            # between two strings that nothing enforces. ISO dates are already
            # recognised as dates and ignored by the scanner, so they are safe.
            f"the findings portaBaltica published between {corpus.start} "
            f"and {corpus.end}"
        ),
        score=1.0,
        # The week's busiest beat, so `generate_article` selects that beat's
        # correspondent and the article's section agrees with its byline.
        # Overriding the persona afterwards instead was wrong twice: it
        # duplicated the persona-to-JSON shape (and got it wrong, storing the
        # dataclass), and it left a maritime byline on a piece filed under
        # economy.
        section=dominant_section(corpus),
        fields=corpus_fields(corpus),
        sources=tuple(sources) or (SourceRef(source_id="eurostat", retrieved_at=""),),
        context=corpus_context(corpus),
    )


def is_worth_writing(corpus: WeeklyCorpus) -> bool:
    """Whether the week produced a synthesis or merely a list."""
    if len(corpus) < MIN_FINDINGS:
        log.info(
            "weekly wrap: only %d finding(s) between %s and %s; not writing one",
            len(corpus),
            corpus.start,
            corpus.end,
        )
        return False
    return True


def dominant_section(corpus: WeeklyCorpus) -> str:
    """Which beat filed most this week, and so whose correspondent writes it.

    A wrap crosses beats, so no correspondent owns it by subject. Giving it to
    the week's busiest beat is arbitrary but honest, and it beats inventing a
    seventh persona whose only job is to have no beat — the roster is named
    after lighthouses precisely so that a byline is never mistaken for a
    person, and adding one to paper over an editorial question would be the
    wrong kind of solution.
    """
    counts = Counter(_section_of(figure) for figure in corpus.figures)
    if not counts:
        return SECTION
    top = max(counts.values())
    return sorted(name for name, count in counts.items() if count == top)[0]


def cites_provenance(corpus: WeeklyCorpus, article: Any = None) -> dict[str, Any]:
    """The record that makes a wrap correctable.

    Declared in ``article.schema.json`` under ``provenance.cites``, which sets
    ``additionalProperties: false`` — an undeclared provenance key is written
    happily by the pipeline and then fails the schema on the way out, which is
    how every published article once violated its own contract.

    RECORDS WHAT THE PROSE USED, not what the corpus offered. The first dry run
    cited eight articles and quoted five: the economy, energy and environment
    findings never appeared in the piece, yet provenance claimed it drew on
    them. That is a claim we cannot support, and it has a second cost — a
    retraction elsewhere would send an operator to review a wrap that never
    used the withdrawn figure, and an alert that cries wolf gets ignored.

    Falls back to the whole corpus when no article is supplied, and errs toward
    inclusion when a figure cannot be matched: overstating wastes a reviewer's
    time, understating means a wrong wrap is never reviewed at all.
    """
    if article is None:
        return {"cites": list(corpus.slugs)}

    used_fields = {
        figure.signal_field
        for block in (article.body or [])
        for figure in (getattr(block, "figures", None) or [])
        if getattr(figure, "signal_field", None)
    }
    slugs = {
        item.slug
        for item in corpus.figures
        if _field_name(item) in used_fields
    }
    return {"cites": sorted(slugs) if slugs else list(corpus.slugs)}


def cited_slugs(document: Mapping[str, Any]) -> tuple[str, ...]:
    """The articles a stored wrap drew on. Empty for anything else."""
    provenance = document.get("provenance") or {}
    cites = provenance.get("cites")
    if not isinstance(cites, Sequence) or isinstance(cites, str):
        return ()
    return tuple(str(slug) for slug in cites if isinstance(slug, str) and slug)


@dataclass(frozen=True, slots=True)
class WeeklyOutcome:
    """What one weekly run did, including when it did nothing.

    THE POINT OF THIS TYPE. A weekly cron that never fires and a week with
    nothing worth wrapping produce the same silence on the front page, and they
    are very different problems: one is a broken deployment, the other is the
    feature working as designed. Two GitHub Actions runs have already sat
    queued for sixteen hours here looking exactly like healthy ones.

    So every run records an outcome, whatever happened, and the absence of a
    record for a week is itself the signal that the trigger did not fire.
    """

    outcome: str
    week_start: str
    week_end: str
    findings_available: int
    slug: str = ""
    cites: tuple[str, ...] = ()
    detail: str = ""

    #: Ran, and the week did not earn a wrap. Not a fault.
    NOT_ENOUGH = "not_enough_findings"
    #: Ran, wrote a draft, and the contract refused it.
    REFUSED = "draft_refused"
    #: Ran and published.
    PUBLISHED = "published"

    def to_json(self) -> dict[str, Any]:
        document: dict[str, Any] = {
            "version": 1,
            "outcome": self.outcome,
            "week": {"start": self.week_start, "end": self.week_end},
            "findings_available": self.findings_available,
            "min_findings": MIN_FINDINGS,
            "detail": self.detail,
        }
        if self.slug:
            document["slug"] = self.slug
            document["cites"] = list(self.cites)
        return document


def _wrap_revision(signal: Signal, writer: Any, corpus: WeeklyCorpus) -> Any:
    """Turn the desk's notes back into a draft, and re-gate the result.

    Mirrors ``run._revision_for``. The rewrite goes through
    ``generate_article``, so it faces the identical validator at the identical
    tolerance, and it faces ``period_problems`` again — a revision that fixes
    the desk's objection and reintroduces a period claim is not an improvement.

    Returning ``None`` holds the article, which is the fail-closed direction:
    the desk can only ever narrow what publishes.
    """
    from newsroom.pipeline.write.generator import generate_article

    def revise(article: Any, notes: Any) -> Any:
        try:
            revised = generate_article(
                signal, writer, paragraphs=5, editor_notes=tuple(notes)
            )
        except Exception:  # noqa: BLE001
            log.exception("weekly wrap: revision failed")
            return None
        if not revised.publishable:
            return None
        if period_problems(revised.article, corpus):
            log.warning("weekly wrap: the revision reintroduced a period claim")
            return None
        return revised.article

    return revise


async def write_weekly(
    store: Any,
    writer: Any,
    *,
    vintages: Any = None,
    now: datetime | None = None,
) -> WeeklyOutcome:
    """Write and publish one wrap, and report what happened either way.

    Generation goes through :func:`generate_article` unchanged. That is the
    whole design: a wrap is a Signal like any other, so every gate, every
    retry, the house style and the validator apply to it without a branch
    saying "unless it is a wrap". The only wrap-specific step is recording
    ``provenance.cites`` afterwards, which is what makes it correctable.

    Always returns an outcome rather than ``None``. A week with no wrap is a
    fact worth recording, because the alternative reading of the same silence
    is that the trigger never ran.
    """
    from newsroom.pipeline.vintage import VintageStore
    from newsroom.pipeline.write.generator import generate_article

    moment = now or utcnow()
    ledger = list(await (vintages or VintageStore()).load())

    # Only cite what a reader can still reach. Retraction purges the ledger, so
    # in the ordinary case this excludes nothing; it is the lock that still
    # holds if a purge is interrupted between writing the article and saving
    # the ledger, and it also drops anything that has aged off the index.
    reachable = await store.published_slugs()
    corpus = collect_week(
        ledger,
        now=moment,
        exclude=[figure.slug for figure in ledger if figure.slug not in reachable],
    )
    if not is_worth_writing(corpus):
        return WeeklyOutcome(
            outcome=WeeklyOutcome.NOT_ENOUGH,
            week_start=corpus.start,
            week_end=corpus.end,
            findings_available=len(corpus),
            detail=(
                f"{len(corpus)} finding(s) in the week, below the floor of "
                f"{MIN_FINDINGS}; no wrap was written"
            ),
        )

    signal = corpus_signal(corpus)
    result = generate_article(signal, writer, paragraphs=5)
    # The period gate, applied after generation and before anything is stored.
    # A wrap that attributes a figure to the wrong period is wrong in exactly
    # the way the five retracted trade articles were: real numbers, correctly
    # traced, attached to something they do not describe. Refusing costs a week
    # of the format; publishing costs a correction.
    faults = period_problems(result.article, corpus) if result.publishable else []
    if faults:
        log.warning("weekly wrap: %s", faults[0])
    if not result.publishable or faults:
        detail = faults[0] if faults else (
            result.verdict.failure_summary() or "article shape"
        )
        log.warning("weekly wrap: draft refused (%s)", detail)
        return WeeklyOutcome(
            outcome=WeeklyOutcome.REFUSED,
            week_start=corpus.start,
            week_end=corpus.end,
            findings_available=len(corpus),
            detail=detail,
        )

    # THE DESK. Not optional on this format, and the reason is measured rather
    # than assumed: run five times against the wrap that had to be retracted,
    # it returned "revise" five times out of five, naming the fault in its own
    # words -- "the impact paragraph asserts a consequence that the data does
    # not establish" -- and asking for the right remedy, a cut.
    #
    # The format whose failure mode is being about the wrong thing was the one
    # shipping without the component whose job is judgement. `write_weekly`
    # called `generate_article` and stored; it never called the desk, so every
    # wrap carried an empty `provenance.editor` while every other tier A
    # article carried a decision, a reason and a named editor.
    #
    # A revision callback is supplied, because a desk that can say "revise"
    # with nothing able to act on it turns every fixable fault into a spike --
    # which is exactly what happened to six of eight articles in a live run
    # before `_revision_for` existed.
    outcome = run_desk(
        result.article,
        writer,
        revise=_wrap_revision(signal, writer, corpus),
        finding=Finding(
            detector=signal.detector,
            comparison_basis=signal.comparison_basis,
            among_strongest=True,
        ),
    )
    if outcome.revised_article is not None:
        result.article = outcome.revised_article
    log.info("desk %s %s: %s", outcome.action.value, result.article.id, outcome.reason)

    if result.article.status != "published":
        return WeeklyOutcome(
            outcome=WeeklyOutcome.REFUSED,
            week_start=corpus.start,
            week_end=corpus.end,
            findings_available=len(corpus),
            detail=f"the desk did not approve it: {outcome.reason}",
        )

    # What kind of thing this is, carried explicitly. The first wrap was filed
    # and bylined as a maritime report because `section` was the only field
    # answering any identity question, and `section` answers the subject.
    result.article.format = WEEKLY_FORMAT
    cites = cites_provenance(corpus, result.article)
    result.article.provenance.update(cites)

    await store.put(result.article)
    # `put` stores; it does not publish. The index is a separate artefact and
    # an article missing from it "is invisible however faithfully it was
    # stored". `write_index` merges by slug against what is already there, so
    # passing only the wrap adds it without disturbing the day's edition.
    await store.write_index([result.article])
    log.info(
        "weekly wrap published: %s, citing %d article(s)",
        result.article.slug,
        len(corpus.slugs),
    )
    return WeeklyOutcome(
        outcome=WeeklyOutcome.PUBLISHED,
        week_start=corpus.start,
        week_end=corpus.end,
        findings_available=len(corpus),
        slug=result.article.slug,
        # What the article recorded, not what the corpus offered. The two
        # differ whenever the writer uses fewer findings than it was given, and
        # the first published wrap reported eight while storing three -- so the
        # run report and the artefact disagreed about the same piece.
        cites=tuple(cites["cites"]),
        detail=f"published, citing {len(cites['cites'])} article(s)",
    )


#: Where the weekly run leaves its record. Separate from the daily
#: ``runs/latest.json`` so one cadence failing is visible without reading the
#: other's history and doing arithmetic on timestamps.
WEEKLY_REPORT_BLOB = "runs/weekly-latest.json"

#: What started a run, and the only field that answers "did the cron fire?".
#:
#: ``WeeklyOutcome`` explains that an *absent* report means the trigger did not
#: fire. These two values carry the other half, which absence cannot: a report
#: that exists still has to say whether the schedule produced it or a person did.
#:
#:     timer    the Sunday 15:00Z schedule ran it. The cron works.
#:     manual   an operator POSTed /api/newsroom/weekly. Says nothing either way
#:              about the schedule, and will sit there looking like a healthy
#:              week while the timer stays dead.
#:
#: Both blobs are world-readable on the articles container, so this is answerable
#: with an unauthenticated GET and no Azure access at all:
#:
#:     https://<account>.blob.core.windows.net/articles/runs/weekly-<YYYY-MM-DD>.json
#:
#: Written here rather than only in a pull request, because the question it
#: settles is asked days later by someone who was not in that conversation.
#:
#: ``function_app.py`` passes these literals from its two entry points and
#: nothing imports this tuple -- a Functions app binds its triggers by
#: decorator, so the call sites cannot be collapsed into one. They are asserted
#: instead, by ``test_weekly_trigger_vocabulary.py``: the value the timer passes
#: is the value this documentation claims, or the diagnosis above is wrong in
#: the one direction that cannot be noticed, because a mislabelled report is
#: still a perfectly well-formed report.
WEEKLY_TRIGGERS = ("timer", "manual")


async def write_weekly_report(
    store: Any, outcome: WeeklyOutcome, *, trigger: str, finished_at: str | None = None
) -> dict[str, Any]:
    """Leave the record, whatever the outcome.

    Written to a stable name and to a dated history, matching the daily report.
    The dated copy is what makes a missed week visible: ``weekly-latest`` alone
    cannot distinguish "ran today and found nothing" from "last ran in March".

    ``trigger`` is one of :data:`WEEKLY_TRIGGERS`, and is not validated here on
    purpose: this function's job is to leave a record, and refusing to write one
    because a label was unfamiliar would destroy the very artefact the record
    exists to preserve. The vocabulary is enforced at the call sites instead,
    where an unknown value is a bug rather than a reason to lose a week.
    """
    document = outcome.to_json()
    document["trigger"] = trigger
    document["finished_at"] = finished_at or isoformat(utcnow())

    await store.put_json(WEEKLY_REPORT_BLOB, document)
    await store.put_json(
        f"runs/weekly-{document['finished_at'][:10]}.json", document
    )
    log.info("weekly report: %s (%s)", document["outcome"], document["detail"])
    return document


__all__ = [
    "MAX_FINDINGS",
    "MIN_FINDINGS",
    "WeeklyCorpus",
    "cited_slugs",
    "period_problems",
    "cites_provenance",
    "collect_week",
    "corpus_context",
    "corpus_fields",
    "corpus_signal",
    "dominant_section",
    "is_worth_writing",
    "week_bounds",
    "SECTION_LABELS_ALLOWED",
    "WEEKLY_FORMAT",
    "WEEKLY_TRIGGERS",
    "WeeklyOutcome",
    "WEEKLY_REPORT_BLOB",
    "write_weekly",
    "write_weekly_report",
]
