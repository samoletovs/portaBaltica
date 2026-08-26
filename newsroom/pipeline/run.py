"""The orchestrator: collect -> detect -> rank -> context -> research -> analyse
-> write -> edit -> publish.

One run of this function is one edition of the wire. It is deliberately boring:
every interesting decision has already been made in a stage module, and the
failure policy is uniform — a stage that breaks costs coverage, never accuracy.

THE THREE STAGES BETWEEN RANKING AND WRITING
--------------------------------------------
``context``   Assembles the peers, companions, placement and trajectory the
              newsroom already retrieved, and merges their figures into the
              signal so the validator gates them like any other.
``research``  Selects registered feed items, then *fetches the official
              documents behind them* — the part the previous pipeline claimed
              to do and did not.
``analyse``   A domain specialist reads all of it and files an editorial brief,
              with every ungrounded mechanism stripped in code.

All three are enrichment. Each one is wrapped so that its failure costs the
article its depth and never its correctness: a signal with no context, no
research and no brief still writes exactly the article it wrote before.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Callable, Sequence

from newsroom.pipeline.collect.archive import RawArchive
from newsroom.pipeline.collect.httpclient import CollectorHttp
from newsroom.pipeline.collect.opendata import collect_open_data
from newsroom.pipeline.collect.rss import extract_raw_description, parse_feed
from newsroom.pipeline.analyst import AnalystBrief, analyse
from newsroom.pipeline.context import ContextPack, build_context, enrich_signal
from newsroom.pipeline.detect import Threshold, detect_all
from newsroom.pipeline.desk import DeskOutcome, Finding, run_desk
from newsroom.pipeline.house_style import check_prose, review_headline
from newsroom.pipeline.detect.series import TimeSeries
from newsroom.pipeline.models import Article, FeedItem, Signal
from newsroom.pipeline.editor import EditorOutcome, edit_syndicated_articles
from newsroom.pipeline.publish import ArticleStore, is_servable
from newsroom.pipeline.rank import RankingReport, rank
from newsroom.pipeline.research import ResearchContext, research_selected
from newsroom.pipeline.revisions import Revision, annotate, find_revisions
from newsroom.pipeline.safety import registry
from newsroom.pipeline.significance import Materiality, gate
from newsroom.pipeline.syndicate import pending_approval_queue, syndicate
from newsroom.pipeline.vintage import PublishedFigure, VintageStore, figures_from
from newsroom.pipeline.webresearch import deepen_all
from newsroom.pipeline.write import AzureOpenAIWriter, LlmWriter, generate_article
from newsroom.pipeline.write.generator import GenerationRefused, GenerationResult

log = logging.getLogger(__name__)

#: Levels whose crossing is editorially meaningful. Negative wholesale power
#: prices — the market paying consumers to take electricity — are the strongest
#: single-number story this pipeline can find, hence the weight.
THRESHOLDS: dict[str, tuple[Threshold, ...]] = {
    "day_ahead_power_price": (
        Threshold(name="zero-price", value=0.0, weight=0.95, unit_label="EUR/MWh"),
        Threshold(name="€200/MWh", value=200.0, weight=0.75, unit_label="EUR/MWh"),
        Threshold(name="€100/MWh", value=100.0, weight=0.45, unit_label="EUR/MWh"),
    ),
    "unemployment_rate": (
        Threshold(name="7%", value=7.0, weight=0.6, unit_label="%"),
        Threshold(name="6%", value=6.0, weight=0.5, unit_label="%"),
    ),
    "hicp_annual_rate": (
        Threshold(name="the ECB's 2% target", value=2.0, weight=0.8, unit_label="%"),
        Threshold(name="4%", value=4.0, weight=0.6, unit_label="%"),
    ),
}


@dataclass
class RunReport:
    series: list[TimeSeries] = field(default_factory=list)
    signals: list[Signal] = field(default_factory=list)
    #: Findings the source could not resolve, with the floor they fell under.
    #: Kept on the report so a short wire can always be explained: "nothing
    #: happened" and "three things happened too small to measure" are different
    #: days and the log should be able to tell them apart.
    suppressed: list[tuple[Signal, Materiality]] = field(default_factory=list)
    ranking: RankingReport | None = None
    generated: list[GenerationResult] = field(default_factory=list)
    syndicated: list[Article] = field(default_factory=list)
    edited: list[EditorOutcome] = field(default_factory=list)
    research: dict[str, ResearchContext] = field(default_factory=dict)
    #: What else the newsroom knew about each selected signal, by signal id.
    context: dict[str, ContextPack] = field(default_factory=dict)
    #: The specialist desk's brief for each selected signal, by signal id.
    analysis: dict[str, AnalystBrief] = field(default_factory=dict)
    #: Signals after the context pack was merged in, by signal id. The writer
    #: and the validator both see these, not the bare detector output.
    enriched: dict[str, Signal] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    #: Copy-edits the desk applied, and style problems it could only flag.
    style_notes: list[str] = field(default_factory=list)
    #: One editorial decision per original article. The audit trail for what
    #: the desk approved, sent back, or held.
    desk: list[DeskOutcome] = field(default_factory=list)
    #: Corrections appended to already-published articles because the source
    #: restated a figure we printed. Reported separately from ``errors``: a
    #: revision is the system working, not the system failing.
    corrections: list[Revision] = field(default_factory=list)

    @property
    def published(self) -> list[Article]:
        """Everything a reader should now be able to find.

        The index built from this is what the front page reads, so anything
        missing here is invisible however faithfully it was written to Blob.

        Syndicated cards were absent until #39. The editor approved 99 of them
        in one run, `_store_all` wrote all 99 to storage, and the front page
        went on saying "Nothing filed here right now" — because approval sets
        `status = "published"` on the card while this property only ever looked
        at tier A generations. Storing is not publishing.
        """
        articles = [g.article for g in self.generated if g.publishable]
        articles.extend(
            card
            for card in self.syndicated
            if card.status == "published" and is_servable(card)
        )
        return articles

    @property
    def rejected(self) -> list[Article]:
        return [g.article for g in self.generated if not g.publishable]

    def summary(self) -> str:
        # The README warns that "0 error(s)" was reported every run through two
        # days of publishing nothing, because refusing to write is a correct
        # outcome. So the counts that explain a short wire belong here too: a
        # day with nothing to say and a day whose findings were all too small to
        # measure look identical otherwise.
        parts = [
            f"{len(self.series)} series",
            f"{len(self.signals)} signals",
        ]
        if self.suppressed:
            parts.append(f"{len(self.suppressed)} below the measurement floor")
        parts.append(f"{len(self.ranking.selected) if self.ranking else 0} selected")
        # And the counts that explain a *thin* wire rather than a short one. An
        # article written with no peers, no document read and no mechanism is
        # the recitation this pipeline was changed to stop producing, and it is
        # indistinguishable from a good one in every other number here.
        parts.extend(
            [
                f"{sum(len(pack.facts) for pack in self.context.values())} context fact(s)",
                f"{sum(ctx.documents_fetched for ctx in self.research.values())} document(s) read",
                f"{sum(len(brief.mechanisms) for brief in self.analysis.values())} mechanism(s)",
            ]
        )
        parts.extend(
            [
                f"{len(self.published)} published",
                f"{len(self.rejected)} rejected",
                f"{len(self.syndicated)} syndicated cards",
                f"{len(self.edited)} editor decisions",
            ]
        )
        if self.corrections:
            parts.append(f"{len(self.corrections)} correction(s) issued")
        parts.append(f"{len(self.errors)} error(s)")
        return ", ".join(parts)


async def collect_feeds(
    http: CollectorHttp,
    archive: RawArchive,
) -> tuple[list[FeedItem], dict[str, str]]:
    """Fetch every enabled tier B/C feed and read back the archived descriptions.

    The descriptions used for the verbatim check are re-read from the archived
    bytes rather than kept from the parse, so the check compares a published
    snippet against what the publisher actually served.
    """
    items: list[FeedItem] = []
    raw_descriptions: dict[str, str] = {}
    # by_tier() returns every registered source of that tier; enabled_sources()
    # filters out the ones marked `enabled: false` (delfi_global is disabled
    # until its channel is confirmed to serve English). Intersecting the two
    # keeps a disabled source out of the wire without removing it from the
    # registry, which is where its licence and attribution are recorded.
    enabled_ids = {source.id for source in registry().enabled_sources()}
    syndicated = [
        source
        for tier in ("B", "C")
        for source in registry().by_tier(tier)
        if source.id in enabled_ids
    ]
    for source in syndicated:
        result = await http.fetch(
            source_id=source.id,
            url=source.endpoint,
            cache_ttl_minutes=source.cache_ttl_minutes,
        )
        if not result.ok or result.item is None:
            log.info("%s: %s", source.id, result.skipped_reason)
            continue
        raw_blob = result.item.archive_name
        parsed = parse_feed(
            result.item.body,
            source_id=source.id,
            raw_blob=raw_blob,
            retrieved_at=result.item.retrieved_at,
        )
        items.extend(parsed)
        stored = archive.read(raw_blob)
        for item in parsed:
            description = extract_raw_description(stored, item.guid)
            if description is not None:
                raw_descriptions[item.guid] = description
    return items, raw_descriptions


def apply_house_style(article: Article) -> list[str]:
    """Copy-edits an article in place. Returns what the desk changed or flagged.

    Corrections are applied; violations are recorded. Nothing here rewrites a
    figure — `house_style.sentence_case` refuses to touch any token containing
    a digit, so the validator's traceability guarantee is unaffected.
    """
    notes: list[str] = []

    fixed, violations, corrections = review_headline(article.headline)
    if fixed != article.headline:
        article.headline = fixed
    notes.extend(corrections)
    notes.extend(violations)

    if article.dek:
        notes.extend(check_prose(article.dek, where="dek"))

    for index, block in enumerate(article.body or []):
        if block.text:
            notes.extend(check_prose(block.text, where=f"body[{index}]"))

    return notes


def _revision_for(
    generated: GenerationResult, writer: LlmWriter, report: RunReport
) -> Callable[[Article, Sequence[str]], Article | None]:
    """Turn the desk's notes back into a draft.

    Without this the desk's "revise" verdict was a decision with no
    consequence. ``run_desk`` accepts a revision callback and holds the article
    whenever one is not supplied, and the production run never supplied one, so
    six of eight articles in a live run were sent back to a writer that was
    never asked to rewrite them.

    The rewrite goes through ``generate_article``, so it faces the identical
    validator at the identical zero tolerance. The desk can still only narrow
    what publishes: a revision that fails the gate returns ``None`` and the
    article is held.
    """

    def revise(article: Article, notes: Sequence[str]) -> Article | None:
        try:
            signal = report.enriched.get(generated.signal.id, generated.signal)
            revised = generate_article(
                signal,
                writer,
                research=report.research.get(generated.signal.id),
                pack=report.context.get(generated.signal.id),
                brief=report.analysis.get(generated.signal.id),
                editor_notes=tuple(notes),
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("revision failed for %s", article.id)
            report.errors.append(f"revise {article.id}: {exc}")
            return None

        if not revised.publishable:
            log.info(
                "revision of %s did not pass the gate: %s",
                article.id,
                revised.verdict.failure_summary() or "failed shape checks",
            )
            return None

        for note in apply_house_style(revised.article):
            report.style_notes.append(note)
        # Keep the identity stable so the audit trail, the slug and any
        # correction filed against this piece still refer to one article.
        revised.article.id = article.id
        revised.article.slug = article.slug
        return revised.article

    return revise


async def run_once(
    *,
    writer: LlmWriter | None = None,
    store: ArticleStore | None = None,
    archive: RawArchive | None = None,
    http: CollectorHttp | None = None,
    include_syndication: bool = True,
    max_articles: int | None = None,
) -> RunReport:
    report = RunReport()
    archive = archive or RawArchive()
    store = store or ArticleStore()
    writer = writer or AzureOpenAIWriter()

    owns_http = http is None
    client = http or CollectorHttp(archive)
    if owns_http:
        await client.__aenter__()
    try:
        # --- 1. collect --------------------------------------------------
        try:
            report.series = await collect_open_data(client)
        except Exception as exc:  # noqa: BLE001
            log.exception("open-data collection failed")
            report.errors.append(f"collect_open_data: {exc}")

        feed_items: list[FeedItem] = []
        raw_descriptions: dict[str, str] = {}
        if include_syndication:
            try:
                feed_items, raw_descriptions = await collect_feeds(client, archive)
            except Exception as exc:  # noqa: BLE001
                log.exception("feed collection failed")
                report.errors.append(f"collect_feeds: {exc}")

        # --- 2. detect ---------------------------------------------------
        report.signals = detect_all(report.series, thresholds=THRESHOLDS)

        # --- 2b. measurement floor ---------------------------------------
        # Before asking whether a finding is interesting, ask whether it is
        # measurable. A movement smaller than the source's own resolution is
        # not a small story, it is the same reading taken twice, and it must be
        # dropped here rather than scored down — a score can be rescued by a
        # quiet day, which is exactly when the wire would otherwise run it.
        significance = gate(report.signals, report.series)
        report.suppressed = significance.suppressed
        report.signals = significance.kept
        log.info("significance: %s", significance.summary())

        # --- 3. rank -----------------------------------------------------
        policy = None
        if max_articles is not None:
            from newsroom.pipeline.config import DEFAULT_RANKING, RankingPolicy

            policy = RankingPolicy(
                max_articles=max_articles,
                min_score=DEFAULT_RANKING.min_score,
                max_per_metric=DEFAULT_RANKING.max_per_metric,
            )
        report.ranking = rank(report.signals, policy)

        # --- 4. context -------------------------------------------------
        # Everything else the newsroom retrieved this run that bears on each
        # selected finding. Deterministic, free, and merged into the signal so
        # the validator gates it exactly like the detector's own figures.
        for signal in report.ranking.selected:
            try:
                pack = build_context(signal, report.series)
                report.context[signal.id] = pack
                report.enriched[signal.id] = enrich_signal(signal, pack)
            except Exception as exc:  # noqa: BLE001
                log.exception("context assembly failed for %s", signal.id)
                report.errors.append(f"context {signal.id}: {exc}")
                report.enriched[signal.id] = signal

        # --- 5. research -------------------------------------------------
        report.research = research_selected(report.ranking.selected, feed_items)
        try:
            # Reads the official documents behind the selected links, and — when
            # a search provider is configured — looks for others. Bounded by the
            # source registry at both ends: nothing unregistered is fetched.
            report.research = await deepen_all(
                report.ranking.selected, report.research, client
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("web research failed")
            report.errors.append(f"webresearch: {exc}")

        # --- 6. analysis --------------------------------------------------
        # A domain specialist reads the figures and the context before the
        # correspondent writes a word. Ungrounded mechanisms are stripped inside
        # `analyse`, so nothing speculative can reach the writer's prompt.
        for signal in report.ranking.selected:
            try:
                report.analysis[signal.id] = analyse(
                    report.enriched.get(signal.id, signal),
                    writer,
                    pack=report.context.get(signal.id),
                    research=report.research.get(signal.id),
                )
            except Exception as exc:  # noqa: BLE001
                log.exception("analysis failed for %s", signal.id)
                report.errors.append(f"analyse {signal.id}: {exc}")

        # --- 7/8. write and validate -------------------------------------
        for signal in report.ranking.selected:
            try:
                report.generated.append(
                    generate_article(
                        report.enriched.get(signal.id, signal),
                        writer,
                        research=report.research.get(signal.id),
                        pack=report.context.get(signal.id),
                        brief=report.analysis.get(signal.id),
                    )
                )
            except GenerationRefused as exc:
                log.warning("generation refused for %s: %s", signal.id, exc)
                report.errors.append(f"refused {signal.id}: {exc}")
            except Exception as exc:  # noqa: BLE001
                log.exception("generation failed for signal %s", signal.id)
                report.errors.append(f"generate {signal.id}: {exc}")

        # --- 9. copy desk ----------------------------------------------------
        # House style is applied after generation and before publication, so a
        # Title Case headline or an em dash cannot reach a reader regardless of
        # what the model produced. Deterministic, and therefore not something
        # the writer can talk its way past.
        #
        # Notes are kept PER ARTICLE as well as in the run report. They used to
        # be read out of `report.style_notes`, which accumulates across the
        # whole run, so every article's editor was shown every *other* article's
        # style problems — and duly demanded a rewrite for them. One live piece
        # was sent back to fix a Title Case headline that belonged to a
        # different story and had already been corrected here.
        style_by_article: dict[str, list[str]] = {}
        for generated in report.generated:
            notes = apply_house_style(generated.article)
            style_by_article[generated.article.id] = notes
            for note in notes:
                log.info("house style: %s", note)
                report.style_notes.append(note)

        # --- 10. editorial review --------------------------------------------
        # Every original article is read by the AI editor before a reader sees
        # it. The validator has already established that the piece is correct;
        # this asks whether it is worth running. The desk can only narrow what
        # publishes — an article it does not approve is marked rejected, and
        # isServable() refuses it on the reader side.
        #
        # The desk is handed the detector's finding as well as the prose. Asking
        # whether something is worth a reader's attention while withholding the
        # evidence of its significance produced exactly the answer you would
        # expect: it called the day's strongest findings trivial.
        strongest = {signal.id for signal in report.ranking.selected[:3]}
        for generated in report.generated:
            if not generated.publishable:
                continue
            try:
                outcome = run_desk(
                    generated.article,
                    writer,
                    style_notes=style_by_article.get(generated.article.id, ()),
                    revise=_revision_for(generated, writer, report),
                    finding=Finding(
                        detector=generated.signal.detector,
                        comparison_basis=generated.signal.comparison_basis,
                        among_strongest=generated.signal.id in strongest,
                    ),
                    pack=report.context.get(generated.signal.id),
                    brief=report.analysis.get(generated.signal.id),
                )
                report.desk.append(outcome)
                # The desk rewrites in place through the callback, so the piece
                # that publishes must be the rewritten one. Publishing
                # generated.article here would ship the draft the editor had
                # just sent back.
                if outcome.revised_article is not None:
                    generated.article = outcome.revised_article
                log.info(
                    "desk %s %s: %s",
                    outcome.action.value,
                    generated.article.id,
                    outcome.reason,
                )
            except Exception as exc:  # noqa: BLE001
                # Fail closed: an article whose review did not complete is not
                # an approved article.
                log.exception("desk review failed for %s", generated.article.id)
                generated.article.status = "rejected"
                report.errors.append(f"desk {generated.article.id}: {exc}")

        # --- tier B/C ----------------------------------------------------
        if include_syndication and feed_items:
            report.syndicated = syndicate(feed_items, raw_descriptions=raw_descriptions)
            try:
                report.edited = edit_syndicated_articles(report.syndicated, writer)
            except Exception as exc:  # noqa: BLE001
                log.exception("editor stage failed")
                report.errors.append(f"editor: {exc}")

        # --- 11. publish ---------------------------------------------------
        await _store_all(store, report)

        # --- 12. the revision watch -----------------------------------------
        # Last, and about articles that are already out. Everything above makes
        # a story right at the moment of writing; this is the only stage that
        # can find out a story stopped being right afterwards.
        try:
            await _watch_revisions(store, report)
        except Exception as exc:  # noqa: BLE001
            log.exception("revision watch failed")
            report.errors.append(f"revision watch: {exc}")
    finally:
        if owns_http:
            await client.__aexit__(None, None, None)

    log.info("run complete: %s", report.summary())
    return report


async def _store_all(store: ArticleStore, report: RunReport) -> None:
    for result in report.generated:
        try:
            await store.put(result.article)
        except Exception as exc:  # noqa: BLE001
            log.exception("failed to store article %s", result.article.id)
            report.errors.append(f"store {result.article.id}: {exc}")
    for card in report.syndicated:
        try:
            await store.put(card)
        except Exception as exc:  # noqa: BLE001
            log.exception("failed to store card %s", card.id)
            report.errors.append(f"store {card.id}: {exc}")
    await store.write_index(report.published)


async def _watch_revisions(
    store: ArticleStore, report: RunReport, *, vintages: VintageStore | None = None
) -> None:
    """Correct what the source has restated, then record today's claims.

    Order matters and is the reverse of what looks natural. Revisions are looked
    for *before* this run's figures are added to the ledger, because a figure
    published minutes ago is being compared against the very reading that
    produced it — it can only ever match, and folding it in first would spend a
    blob round-trip to prove that a number equals itself.
    """
    vintages = vintages or VintageStore()
    ledger = await vintages.load()

    log_entries: list[dict[str, str]] = []
    for revision in find_revisions(ledger, report.series):
        document = await store.read_published(revision.figure.slug)
        if document is None:
            log.info(
                "revised figure belongs to %s, which is no longer stored; skipping",
                revision.figure.slug,
            )
            continue
        annotated = annotate(document, revision)
        if annotated is None:
            continue  # already noted on a previous run
        await store.write_published(revision.figure.slug, annotated)
        report.corrections.append(revision)
        log_entries.append(revision.to_log_entry(annotated["corrections"][-1]))
        log.info("correction appended to %s: %s", revision.figure.slug, revision.description())

    # The public log is a separate artefact from the article, and it is what
    # /corrections reads. `src/news-api.ts` has documented this file since the
    # frontend was written; nothing had ever produced it, so the page said "No
    # corrections have been issued yet" as a permanent condition rather than a
    # true one.
    if log_entries:
        total = await store.append_corrections(log_entries)
        log.info("public corrections log now holds %d entr(ies)", total)

    fresh: list[PublishedFigure] = []
    for result in report.generated:
        if result.publishable and result.article.status == "published":
            fresh.extend(figures_from(result.article, result.signal))
    if fresh:
        ledger.record(fresh)
        await vintages.save(ledger)
        log.info("vintage ledger now tracks %d published figure(s)", len(ledger))


def approval_queue(report: RunReport) -> list[dict[str, object]]:
    """Tier B/C handoff for the Telegram approval workstream."""
    return pending_approval_queue(report.syndicated)


def _sync_run(**kwargs: object) -> RunReport:  # pragma: no cover - convenience
    return asyncio.run(run_once(**kwargs))  # type: ignore[arg-type]


__all__ = ["RunReport", "THRESHOLDS", "approval_queue", "collect_feeds", "run_once"]
