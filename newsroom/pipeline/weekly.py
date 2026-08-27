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
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Mapping, Sequence

from newsroom.pipeline.models import Signal, SourceRef, utcnow
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


def _section_of(figure: PublishedFigure) -> str:
    """The beat a figure belongs to, inferred from its metric."""
    metric = figure.metric
    for prefix, section in (
        ("port_", "maritime"),
        ("house_", "property"),
        ("construction", "property"),
        ("power_", "energy"),
        ("electricity", "energy"),
        ("greenhouse", "environment"),
        ("business_", "business"),
        ("unemployment", "labour"),
        ("labour", "labour"),
        ("hourly", "labour"),
    ):
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
    """A flat, readable key for one finding.

    Flat because the validator resolves a ``signal_field`` against the signal
    root and against ``payload``, and ``payload`` is ``signal.fields`` — so a
    nested name would simply not resolve and every quoted figure would fail
    traceability.
    """
    geography = figure.geography.lower().replace(" ", "_")
    return f"{figure.metric}_{geography}"


def corpus_fields(corpus: WeeklyCorpus) -> dict[str, float]:
    """Every number the writer is allowed to use, and nothing else.

    Two kinds, and the distinction is the whole reason this function exists.
    The per-finding values are QUOTED — each was verified when its own article
    was written and traced to a field of that article's signal. The counts are
    DERIVED: they are facts about the corpus, true of no single source article,
    and if they were not supplied here the writer could not state them without
    inventing them.
    """
    fields: dict[str, float] = {}
    for figure in corpus.figures:
        fields[_field_name(figure)] = float(figure.value)
    fields["findings_covered"] = float(len(corpus.figures))
    fields["sections_covered"] = float(len(corpus.sections))
    return fields


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
    }
    for figure in corpus.figures:
        name = _field_name(figure)
        label = f"{figure.metric_label} ({figure.geography}, {figure.period})"
        if figure.unit:
            label += f", in {figure.unit}"
        if figure.comparison_basis:
            label += f" — measured against {figure.comparison_basis}"
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
        section=SECTION,
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


def cites_provenance(corpus: WeeklyCorpus) -> dict[str, Any]:
    """The record that makes a wrap correctable.

    Declared in ``article.schema.json`` under ``provenance.cites``, which sets
    ``additionalProperties: false`` — an undeclared provenance key is written
    happily by the pipeline and then fails the schema on the way out, which is
    how every published article once violated its own contract.
    """
    return {"cites": list(corpus.slugs)}


def cited_slugs(document: Mapping[str, Any]) -> tuple[str, ...]:
    """The articles a stored wrap drew on. Empty for anything else."""
    provenance = document.get("provenance") or {}
    cites = provenance.get("cites")
    if not isinstance(cites, Sequence) or isinstance(cites, str):
        return ()
    return tuple(str(slug) for slug in cites if isinstance(slug, str) and slug)


async def write_weekly(
    store: Any,
    writer: Any,
    *,
    vintages: Any = None,
    now: datetime | None = None,
) -> Any | None:
    """Write and publish one wrap, or return ``None`` if the week did not earn one.

    Generation goes through :func:`generate_article` unchanged. That is the
    whole design: a wrap is a Signal like any other, so every gate, every
    retry, the house style and the validator apply to it without a branch
    saying "unless it is a wrap". The only wrap-specific step is recording
    ``provenance.cites`` afterwards, which is what makes it correctable.

    Returning ``None`` rather than raising is deliberate and matches the rest
    of the enrichment: a week without a wrap is a missing feature, and a wrap
    that cannot be written must not take the edition down with it.
    """
    from newsroom.pipeline.safety import persona_for_section
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
        return None

    result = generate_article(corpus_signal(corpus), writer, paragraphs=5)
    if not result.publishable:
        log.warning(
            "weekly wrap: draft refused (%s)",
            result.verdict.failure_summary() or "article shape",
        )
        return None

    persona = persona_for_section(dominant_section(corpus))
    if persona is not None:
        result.article.persona = _persona_json(persona)
    result.article.provenance.update(cites_provenance(corpus))

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
    return result


def _persona_json(persona: Any) -> Any:
    to_json = getattr(persona, "to_json", None)
    return to_json() if callable(to_json) else persona


__all__ = [
    "MAX_FINDINGS",
    "MIN_FINDINGS",
    "WeeklyCorpus",
    "cited_slugs",
    "cites_provenance",
    "collect_week",
    "corpus_context",
    "corpus_fields",
    "corpus_signal",
    "dominant_section",
    "is_worth_writing",
    "week_bounds",
    "write_weekly",
]
