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
from newsroom.pipeline.analyst import AnalystBrief
from newsroom.pipeline import config
from newsroom.pipeline.context import ContextPack
from newsroom.pipeline.house_style import StyleReport, apply_house_style
from newsroom.pipeline.hypothesis import HypothesisPanel
from newsroom.pipeline.models import Article, Block, Figure, Signal, isoformat, utcnow
from newsroom.pipeline.rank import finding_key
from newsroom.pipeline.research import ResearchContext
from newsroom.pipeline.units import unit_for_field
from newsroom.pipeline.write.reconcile import drop_unusable_figures, reconcile_figures
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
    build_editor_revision_prompt,
    build_revision_prompt,
    build_system_prompt,
    build_user_prompt,
    paragraphs_for,
)

log = logging.getLogger(__name__)

MAX_COMPLETION_TOKENS = 2000

# Three drafts. The first is usually rejected for bookkeeping — a figure written
# in the prose but not declared — which a writer fixes when shown the complaint.
#
# The previous comment here asserted that "a second failure means the model is
# not going to get there, and paying for a third attempt buys nothing". The
# production run of 2026-08-25 disproved it. Eight signals were selected and
# eight articles were rejected, and the log shows the drafts converging rather
# than stalling:
#
#   858b  attempt 1: 2 faults  ->  attempt 2: 1 fault  -> out of attempts
#   098d  attempt 1: 2 faults  ->  attempt 2: 1 fault  -> out of attempts
#   b416  attempt 1: 3 faults  ->  attempt 2: 2 faults -> out of attempts
#
# Every one of those ran out of attempts while still improving. The wire
# published nothing original that day, not because the model could not get
# there but because it was stopped one draft short.
#
# Cost is not the constraint. ~2,600 prompt + ~490 completion tokens per article
# on gpt-4o-mini is about $0.0007. A third attempt on every article of an
# eight-article day is roughly $0.20 a month.
#
# This does not weaken anything: the validator gates every attempt identically,
# and a draft that never passes is still never published.
MAX_ATTEMPTS = 3

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
                    # The pipeline's own answer, never the model's. `units.py`
                    # knows what every field is measured in; the model guesses,
                    # and its guesses reached the article JSON as
                    # "readings_in_series = 9 EUR per hour" — a count of years
                    # labelled as money — and as "6.5 % of the labour force"
                    # beside "6.5 %" for the same field on two different days.
                    #
                    # There is no case where the model knows better: for a
                    # count or a ratio this returns None, for a figure the
                    # context pack borrowed from another series it returns that
                    # series' unit, and otherwise the signal's own.
                    unit=unit_for_field(
                        signal_field, signal.unit, overrides=signal.field_units
                    ),
                    rendered_as=raw_figure.get("rendered_as"),
                )
            )
        blocks.append(Block(type="paragraph", text=text, figures=figures))
    if blocks and signal.metric:
        chart = next((b for b in blocks if b.chart_ref), None)
        if chart is None:
            blocks.append(Block(type="chart", chart_ref=signal.chart_ref or signal.metric))
    return blocks


def generate_article(
    signal: Signal,
    writer: LlmWriter,
    *,
    paragraphs: int | None = None,
    now: str | None = None,
    research: ResearchContext | None = None,
    pack: ContextPack | None = None,
    brief: AnalystBrief | None = None,
    panel: HypothesisPanel | None = None,
    max_attempts: int = MAX_ATTEMPTS,
    editor_notes: Sequence[str] = (),
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

    ``signal`` is expected to arrive already enriched by
    ``context.enrich_signal``, so the pack's figures are in ``signal.fields``
    and face the validator exactly as the detector's own do. ``pack`` and
    ``brief`` add the *explanation* of those figures to the prompt; neither
    introduces a number.

    ``panel`` is the causal panel's candidate causes. It is the one input here
    that carries a claim about the world rather than about the figures, and it
    introduces no number either: ``hypothesis._admissible`` discards any claim
    carrying a quantity before this function ever sees it, so the numeric gates
    downstream have nothing new to catch.
    """
    created_at = now or isoformat(utcnow())

    # Licence gate, before a single token is spent.
    for source_ref in signal.sources:
        try:
            assert_rewrite_allowed(source_ref.source_id)
        except RewriteNotPermittedError as exc:
            raise GenerationRefused(str(exc)) from exc

    persona = persona_for_section(signal.section)
    length = paragraphs if paragraphs is not None else paragraphs_for(pack, brief)
    system = build_system_prompt(signal, persona, paragraphs=length)
    user = build_user_prompt(
        signal, research=research, pack=pack, brief=brief, panel=panel
    )

    # A rewrite the editor asked for starts from the editor's notes, not from a
    # blank draft. Without this the desk's "revise" was a decision with no
    # consequence: the same prompt produced the same faults and the piece was
    # held on the second read.
    if editor_notes:
        user = build_editor_revision_prompt(user, editor_notes)

    result: GenerationResult | None = None
    best: GenerationResult | None = None
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
            pack=pack,
            brief=brief,
            panel=panel,
            attempts=attempt,
        )

        # Copy-edit here rather than after the loop. See ``_style_faults``.
        #
        # The closing is cut only on the final attempt: while the writer still
        # has an attempt left, an empty closing is handed back so it can write
        # a real one, which is a better article than one that simply stops.
        # When the attempts are gone the paragraph goes, because house style
        # has no rejection path and would otherwise publish it.
        #
        # The speculative impact paragraph is cut on the same terms and for the
        # identical reason, which had simply never been applied to it. It is the
        # larger fault of the two: 13 of the 25 published tier A originals carry
        # one, and the desk named it in 17 of 17 of its "ran as filed"
        # approvals, every time asking for a cut that nothing performed.
        last_attempt = attempt == attempts
        style = apply_house_style(
            result.article,
            cut_empty_closings=last_attempt,
            cut_speculative_impact=last_attempt,
        )
        # A cut deletes prose the verdict was computed against, so the stored
        # verdict now describes an article that no longer exists. Re-run it.
        # Removing a paragraph can only withdraw claims, so this cannot turn a
        # passing article into a failing one on the traceability checks — but
        # "cannot" is a belief about eight interacting rules, and re-validating
        # costs nothing and needs no such belief.
        if style.cuts:
            _revalidate(result.article, signal)
        if result.publishable and best is None:
            best = result

        if result.publishable and style.clean:
            break

        faults = _style_faults(result, style)
        if attempt == attempts:
            if result.publishable:
                # Out of attempts, with publishable copy and prose the desk
                # will grumble about. Publish it: house style is an editor, not
                # a gate, and spiking a validated article over a hedge phrase
                # would be this loop lowering the yield it exists to raise.
                log.info(
                    "signal %s: %d style note(s) survive to the desk: %s",
                    signal.id,
                    len(style.violations),
                    "; ".join(style.violations),
                )
                break
            log.warning("article rejected for signal %s: %s", signal.id, faults)
            _log_rejection_forensics(result, signal)
        else:
            log.info(
                "attempt %d rejected for signal %s, revising: %s", attempt, signal.id, faults
            )
            prompt = build_revision_prompt(user, faults, result.article)

    assert result is not None  # the loop runs at least once
    # A later attempt can be worse than an earlier one — the loop is asking a
    # sampling model to try again. Never hand back a rejected draft when a
    # publishable one was already in hand.
    if best is not None and not result.publishable:
        log.info("signal %s: keeping the earlier publishable draft", signal.id)
        return best
    return result


def _style_faults(result: GenerationResult, style: StyleReport) -> str:
    """The revision brief: what the gate refused, plus what the desk will refuse.

    House style is deterministic, costs no model call, and was being evaluated
    at step 9 of the run — after this loop had spent its whole budget. So a
    phrase on a fixed list of banned phrases could not be fixed by the writer
    that produced it. It went to the desk instead, which read it, sent the
    piece back, and paid for a fresh generation plus two more editor reads to
    remove a substring the loop could have named for free.

    Folding it in here does not make style a publication gate: an attempt that
    passes the validator is still published once the attempts run out, exactly
    as before. It only spends attempts the loop was going to spend anyway on
    faults it can actually describe.
    """
    parts: list[str] = []
    if not result.publishable:
        parts.append(result.verdict.failure_summary() or "failed the article shape checks")
    parts.extend(style.violations)
    return "; ".join(p for p in parts if p) or "failed the article shape checks"


def _log_rejection_forensics(result: GenerationResult, signal: Signal) -> None:
    """Log enough to diagnose a rejection without a rerun.

    Rejected drafts are not persisted, so for three production runs the only
    evidence of why nothing published was a one-line summary naming a bare
    token such as ``'119' not in figures``. That was not enough to tell an
    invented number from a mis-filed one, and two plausible fixes were shipped
    against a guess before the real cause was found. This prints the block
    text, what it declared and what the detector actually verified, so the
    failure is reconstructible from the log alone.
    """
    try:
        fields = ", ".join(f"{k}={v}" for k, v in sorted(signal.fields.items()))
        log.warning("  signal fields: %s", fields)
        for index, block in enumerate(result.article.body):
            declared = ", ".join(f"{f.rendered_as or f.value}<-{f.signal_field}" for f in block.figures)
            # A chart block carries no text. Slicing None threw a TypeError here,
            # so the one log line written to explain a rejection was itself the
            # thing that failed — and the eight rejections of 2026-08-25 had to
            # be diagnosed from the one-line summary because of it.
            log.warning(
                "  body[%d] declared [%s] text: %s", index, declared, (block.text or "")[:400]
            )
    except Exception:  # diagnostics must never break a run
        log.exception("failed to log rejection forensics")


def _article_from_payload(
    payload: dict[str, Any],
    *,
    signal: Signal,
    persona,
    writer: LlmWriter,
    created_at: str,
    research: ResearchContext | None,
    attempts: int,
    pack: ContextPack | None = None,
    brief: AnalystBrief | None = None,
    panel: HypothesisPanel | None = None,
) -> GenerationResult:
    """Build an article from one model response and run it through the gate."""
    headline = str(payload.get("headline") or "").strip()
    dek = str(payload.get("dek") or "").strip() or None
    blocks = _coerce_blocks(payload, signal)

    # The model reliably writes numbers it was given and then forgets to file
    # them in the block's figures array. Do that bookkeeping in code. It can
    # only ever attach values from the detector's verified payload, so an
    # invented number stays undeclared and the validator still rejects it.
    notes = reconcile_figures(
        blocks, signal.fields, unit=signal.unit, field_units=signal.field_units
    )
    if notes:
        log.info("reconciled %d figure(s) for signal %s: %s", len(notes), signal.id, "; ".join(notes))

    # And remove entries that are wrong *and* justify nothing in their own
    # paragraph. The model declares a figure for "the fourth-highest on record"
    # — a sentence with no numeral in it — guesses a field, gets the value
    # wrong, and a correct article is discarded over an entry no claim rests on.
    dropped = drop_unusable_figures(blocks, signal.fields)
    if dropped:
        log.info("dropped %d stray figure(s) for signal %s: %s", len(dropped), signal.id, "; ".join(dropped))

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
            # What makes two articles the same story across runs: the reading, not
            # the telling. `signal_id` hashes the detector and the value in as well,
            # so a revision or a second detector on the same reading mints a new one
            # and the wire republishes. See `rank.finding_key`.
            "signal_finding": finding_key(signal.metric, signal.geography, signal.period),
            "comparison_basis": signal.comparison_basis,
            "model": writer.model_name,
            "prompt_version": PROMPT_VERSION,
            "generated_at": created_at,
            # WHICH CODE WROTE THIS.
            #
            # Provenance recorded the model, the prompt version and the time,
            # but not the revision — so "was this generated by the code I think
            # it was?" had to be inferred by comparing the article's timestamp
            # against a deploy job's finish time. That inference is wrong
            # whenever Azure has accepted a package and not yet started serving
            # it, which is a silent window of unknown length, and it has now
            # produced two invalid measurements of this pipeline.
            #
            # Written as one of two distinguishable keys rather than a value
            # with a fallback: see `_revision_record`.
            **_revision_record(),
            # How many drafts this took. Recorded because a reader auditing the
            # provenance is entitled to know the piece was rewritten once
            # before it passed, and because a rising average is the signal that
            # the prompt, not the model, needs work.
            "attempts": attempts,
            "accountable_editor": personas().accountable_editor or "Andre Kõpu",
            **({"research": research.to_provenance()} if research is not None else {}),
            # The context pack and the analyst brief are recorded in full. A
            # reader auditing a piece is entitled to see which other series it
            # was written against and what the specialist desk actually said —
            # including how many of its proposed mechanisms were thrown out for
            # resting on nothing.
            **({"context": pack.to_provenance()} if pack is not None and pack else {}),
            **({"analysis": brief.to_provenance()} if brief is not None and brief else {}),
            # The panel is recorded whenever it was consulted, including when
            # it proposed nothing admissible. That is the case worth keeping:
            # an article saying the data does not establish a cause is a
            # different artefact depending on whether two specialists looked
            # and found nothing, or nobody was asked. Without this the two are
            # the same silence, which is the state that made these articles
            # shallow in the first place.
            **(
                {"hypotheses": panel.to_provenance()}
                if panel is not None and panel.consulted
                else {}
            ),
        },
    )

    verdict = _verdict_for(article, signal)
    article.provenance["validator"] = verdict.to_dict()

    if verdict.passed and _shape_is_publishable(article):
        article.status = "published"
        article.published_at = created_at
    else:
        article.status = "rejected"
        # Why, on the artifact itself. Establishing what was killing the wire
        # took downloading and parsing 200 blobs, because a rejected draft
        # recorded that it had failed and nothing about what failed: the
        # verdict is in `provenance.validator`, but the reason has to be
        # reconstructed by diffing eight checks against each other, and a
        # shape failure leaves no trace there at all. Three days of the wire
        # publishing almost nothing went unnoticed for exactly that reason.
        #
        # Written as flat, queryable fields rather than prose, so the next
        # investigation is a filter over the rejected/ prefix instead of an
        # archaeology project.
        article.provenance["rejection"] = _rejection_record(article, verdict)
    return GenerationResult(signal=signal, article=article, verdict=verdict)


def _rejection_record(article: Article, verdict: Verdict) -> dict[str, Any]:
    """The gate, the checks it failed, and what it said — on the stored draft."""
    failures = [check.name for check in verdict.failures()]
    if failures:
        return {
            "gate": "validator",
            "checks": failures,
            "detail": verdict.failure_summary(),
        }
    # The verdict passed, so the shape checks are what refused it. They log,
    # and until now that was the only record anywhere.
    return {
        "gate": "article_shape",
        "checks": ["shape"],
        "detail": _shape_failure(article),
    }


def _shape_failure(article: Article) -> str:
    if not 12 <= len(article.headline) <= 140:
        return f"headline is {len(article.headline)} characters, outside 12-140"
    if article.dek and len(article.dek) > 300:
        return f"dek is {len(article.dek)} characters, over 300"
    if not any(b.type == "paragraph" and b.text for b in article.body):
        return "article has no prose"
    return "failed the article shape checks"


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


def _revalidate(article: Article, signal: Signal) -> None:
    """Recompute the verdict after prose was deleted, and re-decide status.

    ``apply_house_style`` may cut an empty closing, which leaves the stored
    verdict describing a paragraph that is gone. This keeps the artefact
    honest: what ``provenance.validator`` says was checked is what a reader can
    actually read.

    It can promote as well as demote. A closing that repeated an earlier
    paragraph's findings fails ``no_repeated_findings``; cutting it removes the
    repetition, and the article becomes publishable for the same reason the
    desk would have approved it.
    """
    verdict = _verdict_for(article, signal)
    article.provenance["validator"] = verdict.to_dict()
    if verdict.passed and _shape_is_publishable(article):
        article.status = "published"
        article.published_at = article.published_at or isoformat(utcnow())
    else:
        article.status = "rejected"


def _revision_record() -> dict[str, str]:
    """Which revision produced this article, or an explicit statement that we
    do not know.

    TWO KEYS, NOT ONE KEY WITH A FALLBACK. A ``revision`` that degrades to
    ``"unknown"``, or to a constant committed in the tree, is a field that
    always looks plausible — and a provenance stamp that cannot be false is
    worse than no stamp, because it earns trust it has not verified. So either
    the article carries ``revision`` and it is the real thing, or it carries
    ``revision_unavailable`` and says why, and the two cannot be confused by
    anything reading the artefact.

    The value comes from the deployment rather than from the repository. A
    constant in the tree records what someone last typed; this records what
    Azure is serving, which is the question that was being answered by
    guesswork from timestamps.
    """
    revision = config.REVISION.strip()
    if revision:
        return {"revision": revision}
    return {
        "revision_unavailable": (
            "NEWSROOM_REVISION is not set in this environment, so the code that "
            "produced this article cannot be identified from the artefact"
        )
    }


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
