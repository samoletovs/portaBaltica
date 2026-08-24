"""Turn a verified signal into an article, then refuse to publish it unless the
validator agrees.

The order here is deliberate and one-way:

    signal -> licence check -> prompt -> model -> article -> validator -> status

The licence check happens *before* the model is called, so we never spend a
token generating prose we would not be allowed to publish. The validator runs
after, and its verdict is written into the article's own provenance block, so an
article can never be served without carrying the evidence that it was checked.

There is no regeneration loop. A rejected article is dropped and logged. Paying
the model twice to talk it out of a fabrication is both expensive and a way of
selecting for outputs that happen to slip past the checks.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from newsroom.pipeline.ids import new_ulid, slugify
from newsroom.pipeline.models import Article, Block, Figure, Signal, isoformat, utcnow
from newsroom.pipeline.research import ResearchContext
from newsroom.pipeline.safety import (
    RewriteNotPermittedError,
    Verdict,
    assert_rewrite_allowed,
    persona_for_section,
    personas,
    registry,
    render_byline,
    validate,
)
from newsroom.pipeline.write.llm import LlmWriter
from newsroom.pipeline.write.prompts import (
    PROMPT_VERSION,
    build_revision_prompt,
    build_system_prompt,
    build_user_prompt,
)

log = logging.getLogger(__name__)

MAX_COMPLETION_TOKENS = 900

# Two drafts, never more. The first is usually rejected for bookkeeping — a
# figure written in the prose but not declared — which a writer fixes when
# shown the complaint. A second failure means the model is not going to get
# there, and paying for a third attempt buys nothing.
#
# Cost is not the constraint it was once assumed to be. Measured in production:
# ~2,600 prompt + ~490 completion tokens per article, which on gpt-4o-mini is
# about $0.0007. At 8 articles a day a revision on every single one adds
# roughly $0.20 a month against a €150 subscription. The comment this replaces
# justified having no revision loop at all on cost grounds; it was wrong by
# three orders of magnitude, and the price was that a run published nothing.
MAX_ATTEMPTS = 2

_COUNTRY_ALIASES = {"LV": "LV", "EE": "EE", "LT": "LT", "Baltic": "Baltic", "EU27_2020": "EU"}


@dataclass
class GenerationResult:
    signal: Signal
    article: Article
    verdict: Verdict

    @property
    def publishable(self) -> bool:
        return self.verdict.passed and self.article.status == "published"


class GenerationRefused(RuntimeError):
    """The pipeline declined to generate. Never a reason to retry."""


def _countries_for(signal: Signal) -> list[str]:
    if signal.geography == "Baltic":
        return ["Baltic", "LV", "EE", "LT"]
    mapped = _COUNTRY_ALIASES.get(signal.geography)
    return [mapped] if mapped else []


def _coerce_blocks(payload: dict[str, Any], signal: Signal) -> list[Block]:
    blocks: list[Block] = []
    for raw in payload.get("blocks", []) or []:
        text = (raw.get("text") or "").strip()
        if not text:
            continue
        figures: list[Figure] = []
        for raw_figure in raw.get("figures", []) or []:
            try:
                value = float(raw_figure["value"])
                signal_field = str(raw_figure["signal_field"])
            except (KeyError, TypeError, ValueError):
                # A malformed figure is left out rather than repaired. The
                # validator will then see a number in the prose with nothing
                # backing it and reject the article, which is the right outcome.
                log.warning("dropping malformed figure %r", raw_figure)
                continue
            figures.append(
                Figure(
                    value=value,
                    signal_field=signal_field,
                    unit=raw_figure.get("unit") or signal.unit,
                    rendered_as=raw_figure.get("rendered_as"),
                )
            )
        blocks.append(Block(type="paragraph", text=text, figures=figures))
    if blocks and signal.metric:
        chart = next((b for b in blocks if b.chart_ref), None)
        if chart is None:
            blocks.append(Block(type="chart", chart_ref=signal.metric))
    return blocks


def generate_article(
    signal: Signal,
    writer: LlmWriter,
    *,
    paragraphs: int = 4,
    now: str | None = None,
    research: ResearchContext | None = None,
    max_attempts: int = MAX_ATTEMPTS,
) -> GenerationResult:
    """Generate, gate, and allow one bounded revision. Check ``publishable``.

    A rejected first draft is usually a bookkeeping failure rather than a
    fabrication — the model wrote a correct figure in the prose and forgot to
    declare it, or described a movement without naming the comparison basis.
    Those are faults a writer can fix when told what they are, so the
    validator's own complaint goes back once and the article is re-gated.

    The gate itself is untouched: the same checks run again at the same zero
    tolerance, and a second failure discards the article. Nothing here can
    publish something the validator rejected.
    """
    created_at = now or isoformat(utcnow())

    # Licence gate, before a single token is spent.
    for source_ref in signal.sources:
        try:
            assert_rewrite_allowed(source_ref.source_id)
        except RewriteNotPermittedError as exc:
            raise GenerationRefused(str(exc)) from exc

    persona = persona_for_section(signal.section)
    system = build_system_prompt(signal, persona, paragraphs=paragraphs)
    user = build_user_prompt(signal, research=research)

    result: GenerationResult | None = None
    prompt = user
    # One bound, deliberately. An earlier draft of this loop had both a bounded
    # range and an explicit break on the same ceiling; each silently masked the
    # other, so neither could be shown to work and removing either would have
    # looked safe in review.
    attempts = max(1, max_attempts)
    for attempt in range(1, attempts + 1):
        payload = writer.complete_json(
            system=system, user=prompt, max_tokens=MAX_COMPLETION_TOKENS
        )
        result = _article_from_payload(
            payload,
            signal=signal,
            persona=persona,
            writer=writer,
            created_at=created_at,
            research=research,
            attempts=attempt,
        )
        if result.publishable:
            break

        summary = result.verdict.failure_summary() or "failed shape checks"
        if attempt == attempts:
            log.warning("article rejected for signal %s: %s", signal.id, summary)
        else:
            log.info(
                "attempt %d rejected for signal %s, revising: %s", attempt, signal.id, summary
            )
            prompt = build_revision_prompt(user, summary)

    assert result is not None  # the loop runs at least once
    return result


def _article_from_payload(
    payload: dict[str, Any],
    *,
    signal: Signal,
    persona,
    writer: LlmWriter,
    created_at: str,
    research: ResearchContext | None,
    attempts: int,
) -> GenerationResult:
    """Build an article from one model response and run it through the gate."""
    headline = str(payload.get("headline") or "").strip()
    dek = str(payload.get("dek") or "").strip() or None
    blocks = _coerce_blocks(payload, signal)

    article = Article(
        id=new_ulid(),
        slug=slugify(headline or signal.metric, suffix=signal.id[:6]),
        tier="A",
        status="draft",
        headline=headline,
        section=signal.section,
        created_at=created_at,
        dek=dek,
        body=blocks,
        persona={
            "id": persona.id,
            "name": persona.name,
            "beat": persona.beat,
            "byline": render_byline(persona),
        },
        countries=_countries_for(signal),
        tags=[str(t).lower() for t in (payload.get("tags") or [])][:5],
        provenance={
            "sources": [ref.to_json() for ref in signal.sources],
            "signal_id": signal.id,
            "signal_detector": signal.detector,
            "comparison_basis": signal.comparison_basis,
            "model": writer.model_name,
            "prompt_version": PROMPT_VERSION,
            "generated_at": created_at,
            # How many drafts this took. Recorded because a reader auditing the
            # provenance is entitled to know the piece was rewritten once
            # before it passed, and because a rising average is the signal that
            # the prompt, not the model, needs work.
            "attempts": attempts,
            "accountable_editor": personas().accountable_editor or "Sam Samoletovs",
            **({"research": research.to_provenance()} if research is not None else {}),
        },
    )

    verdict = _verdict_for(article, signal)
    article.provenance["validator"] = verdict.to_dict()

    if verdict.passed and _shape_is_publishable(article):
        article.status = "published"
        article.published_at = created_at
    else:
        article.status = "rejected"
    return GenerationResult(signal=signal, article=article, verdict=verdict)


def _verdict_for(article: Article, signal: Signal) -> Verdict:
    """Validate against the signal the article was written from.

    The whole traceability claim rests on this call: the validator resolves
    every ``signal_field`` in the article back into this payload, so a figure
    the model invented has nothing to bind to and the article fails closed.
    ``rewrite_allowed`` and attribution come from the source registry inside
    the validator rather than being passed in, so there is one source of truth
    for what a licence permits.

    ``payload`` is set to the flat verified figures because the validator
    resolves a ``signal_field`` against the signal root and against
    ``payload``. The pipeline nests the same values under ``fields`` for its
    own use; exposing them as ``payload`` lets the model emit a plain
    ``latest_value`` rather than ``fields.latest_value``, which is one less
    thing for it to get subtly wrong.
    """
    signal_payload = signal.to_json()
    signal_payload["payload"] = dict(signal.fields)
    return validate(article.to_json(), signal=signal_payload)


def _shape_is_publishable(article: Article) -> bool:
    """Schema constraints the validator does not own.

    Kept separate so a shape problem is never mistaken for a safety pass.
    """
    if not 12 <= len(article.headline) <= 140:
        log.warning("headline length %d outside schema bounds", len(article.headline))
        return False
    if article.dek and len(article.dek) > 300:
        log.warning("dek exceeds 300 characters")
        return False
    if not any(b.type == "paragraph" and b.text for b in article.body):
        log.warning("article has no prose")
        return False
    return True


__all__ = ["GenerationRefused", "GenerationResult", "generate_article"]
