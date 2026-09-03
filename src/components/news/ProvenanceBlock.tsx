import type { ReactNode } from 'react';
import type { ContextFact, Provenance, ValidatorCheckName } from '../../news-types';
import { analystLabel } from '../../news-types';
import { AI_EDITOR, publisherName } from '../../newsroom/editorial';

/**
 * The passport.
 *
 * The published AI-use policy promises readers that "every article carries a
 * provenance panel: sources, datasets, when the data was retrieved, and which
 * model wrote it", and section 6 commits to displaying the deterministic signal
 * that caused the story, the prompt version, the validation results, and — for
 * reviewed material — who approved it and when. All of that is rendered here.
 *
 * It is written for a reader, not for a lawyer. The validator gates are spelled
 * out as sentences someone can judge ("No number appears in the text that is
 * absent from the data") rather than as snake_case names, the datasets link
 * back to their publishers so a claim can actually be checked, and the panel
 * opens by saying what it is for.
 *
 * It is collapsed on arrival. The record is longer than most of the articles it
 * accompanies, and a reader who has just finished the story should not have to
 * scroll past a wall of dataset cards to reach the next one. The header stays
 * visible with the check count on it, so the promise is still made in full on
 * the page; opening it is one click for the reader who wants to audit it.
 */

const SOURCE_NAMES: Record<string, string> = {
  eurostat: 'Eurostat',
  ecb: 'European Central Bank',
  elering: 'Elering / Nord Pool',
  datagovlv: 'data.gov.lv',
  statee: 'Statistics Estonia',
  datagovlt: 'data.gov.lt',
  openmeteo: 'Open-Meteo',
  ec_presscorner: 'European Commission Press Corner',
  ep_news: 'European Parliament news',
};

const CHECK_LABELS: Record<ValidatorCheckName, string> = {
  figures_traceable: 'Every figure traces back to a field in the source dataset',
  no_invented_numbers: 'No number appears in the text that is absent from the data',
  snippet_verbatim: 'Any quoted snippet matches the publisher’s own feed exactly',
  no_rewrite_of_restricted_source: 'No third-party reporting was rewritten',
  byline_discloses_ai: 'The byline discloses that an AI system wrote this',
  no_lived_experience_claims: 'No claim of an interview, a visit or a witnessed event',
  attribution_present: 'Required attribution is present',
  comparison_basis_stated: 'Every change states what it is measured against',
  no_repeated_findings: 'No paragraph restates a figure another has already made',
  no_unsupported_mechanism: 'No paragraph explains a movement the figures do not evidence',
  record_claim_holds: 'Any “highest” or “lowest” holds over the whole series, not just the part we fetched',
};

function formatTimestamp(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="news-subtle text-caption font-semibold uppercase tracking-widest">{label}</dt>
      <dd className="news-muted mt-1 text-ui">{children}</dd>
    </div>
  );
}

/** What each kind of borrowed figure is, in words a reader does not have to decode. */
const CONTEXT_KIND: Record<ContextFact['kind'], string> = {
  peer: 'the same measure in another Baltic state',
  companion: 'a related measure in the same economy',
  placement: 'where this reading sits in its own history',
  trajectory: 'the same point in an earlier year',
};

export function ProvenanceBlock({ provenance }: { provenance: Provenance }) {
  const {
    sources,
    validator,
    model,
    prompt_version,
    generated_at,
    accountable_editor,
    signal_id,
    approved_by,
    approved_at,
    research,
    context,
    analysis,
    hypotheses,
    editor,
  } = provenance;

  const passedCount = validator.checks.filter((check) => check.passed).length;
  const allPassed = passedCount === validator.checks.length && validator.checks.length > 0;

  return (
    <section aria-labelledby="provenance-heading" className="mt-12">
      <details className="news-border news-accent-panel group/passport overflow-hidden rounded-xl border">
        <summary className="news-border flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-6 py-3 group-open/passport:border-b [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="news-subtle inline-block transition-transform group-open/passport:rotate-90"
            >
              ›
            </span>
            <h2 id="provenance-heading" className="news-fg text-callout font-semibold">
              Where this came from
            </h2>
          </span>
          <span
            className={`flex items-center gap-2 rounded-full border px-2 py-1 text-caption ${
              allPassed
                ? 'news-status-positive'
                : 'news-status-warning'
            }`}
          >
            <span aria-hidden="true">{allPassed ? '✓' : '!'}</span>
            {passedCount} of {validator.checks.length} checks passed
          </span>
        </summary>

        <div className="space-y-6 px-6 py-4">
          <p className="news-muted text-ui">
            This record was written automatically as the article was produced. Open any dataset below
            and you can check the figures for yourself. That is what it is here for.
          </p>

          <div>
            <h3 className="news-subtle mb-2 text-caption font-semibold uppercase tracking-widest">
              The data behind it
            </h3>
            <ul className="space-y-3">
              {sources.map((source) => (
                <li
                  key={`${source.source_id}-${source.dataset ?? ''}-${source.retrieved_at}`}
                  className="news-border news-panel rounded-lg border px-3 py-2"
                >
                  <p className="news-fg text-callout font-semibold">
                    {SOURCE_NAMES[source.source_id] ?? source.source_id}
                  </p>
                  {source.dataset && (
                    <p className="news-muted mt-1 text-ui">
                      {source.dataset}
                      {source.dataset_version && (
                        <span className="news-subtle"> · version {source.dataset_version}</span>
                      )}
                    </p>
                  )}
                  {/* The dataset link measured 104×18 on every article at every
                      width. This `<p>` is a flex row rather than a sentence, so
                      the link is a standalone control and SC 2.5.8's
                      running-prose exemption does not reach it — unlike the
                      `display: inline` research links below, which are genuinely
                      prose and are deliberately left alone. */}
                  <p className="news-subtle mt-2 flex flex-wrap items-center gap-x-3 text-caption">
                    <span>
                      Retrieved{' '}
                      <time dateTime={source.retrieved_at} className="news-muted">
                        {formatTimestamp(source.retrieved_at)}
                      </time>
                    </span>
                    {source.url && (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="news-link flex min-h-11 items-center underline underline-offset-2"
                      >
                        Open the dataset ↗<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {research && (
            <div>
              <h3 className="news-subtle mb-2 text-caption font-semibold uppercase tracking-widest">
                Reporting context consulted
              </h3>
              {research.consulted.length > 0 ? (
                <ul className="space-y-2">
                  {research.consulted.map((item) => (
                    <li
                      key={`${item.source_id}-${item.url}`}
                      className="news-border news-panel rounded-lg border px-3 py-2"
                    >
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="news-link text-callout font-semibold underline underline-offset-2"
                      >
                        {item.title} ↗<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                      <p className="news-subtle mt-2 text-caption">
                        {item.source_name} ·{' '}
                        {item.role === 'official_statement'
                          ? 'official statement'
                          : 'prior coverage lead'}{' '}
                        · retrieved {formatTimestamp(item.retrieved_at)}
                        {item.document_chars && ' · full text read'}
                        {item.discovered_by && ` · found via ${item.discovered_by}`}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="news-muted text-ui">
                  No relevant item was found in the registered feeds for this signal.
                </p>
              )}
            </div>
          )}

          {context && context.facts.length > 0 && (
            <div>
              <h3 className="news-subtle mb-2 text-caption font-semibold uppercase tracking-widest">
                Other data this was written against
              </h3>
              <p className="news-muted mb-2 text-ui">
                Figures from {context.series_considered} series the newsroom retrieved in the same
                run. Each one passed the same traceability check as the figure that triggered the
                story.
              </p>
              <ul className="news-subtle space-y-1 text-caption">
                {context.facts.map((fact) => (
                  <li key={fact.field}>
                    <span className="font-mono">{fact.field}</span> · {CONTEXT_KIND[fact.kind]} ·{' '}
                    {fact.period}
                    {fact.geography && ` · ${fact.geography}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis && (
            <div>
              <h3 className="news-subtle mb-2 text-caption font-semibold uppercase tracking-widest">
                What the analysis desk said
              </h3>
              <p className="news-muted text-ui">
                Read first by {analysis.expert}, {analysis.discipline}, working from the same
                verified figures as the correspondent.
              </p>
              {analysis.angle && <p className="news-muted mt-2 text-ui">{analysis.angle}</p>}
              {analysis.mechanisms && analysis.mechanisms.length > 0 && (
                <ul className="news-subtle mt-2 space-y-1 text-caption">
                  {analysis.mechanisms.map((mechanism) => (
                    <li key={mechanism.claim}>
                      {mechanism.claim}:{' '}
                      {mechanism.confidence === 'established'
                        ? 'shown by the figures'
                        : 'consistent with the figures, not proven by them'}
                    </li>
                  ))}
                </ul>
              )}
              {analysis.mechanisms_discarded ? (
                <p className="news-subtle mt-2 text-caption">
                  {analysis.mechanisms_discarded} further explanation
                  {analysis.mechanisms_discarded === 1 ? ' was' : 's were'} proposed and discarded
                  for resting on no verified figure. The correspondent never saw them.
                </p>
              ) : null}
            </div>
          )}

          {hypotheses && (
            <div>
              <h3 className="news-subtle mb-2 text-caption font-semibold uppercase tracking-widest">
                What the causal panel proposed
              </h3>
              <p className="news-muted text-ui">
                {hypotheses.consulted.length === 1
                  ? '1 AI analyst was'
                  : `${hypotheses.consulted.length} AI analysts were`}{' '}
                consulted separately and asked what drove this:{' '}
                {hypotheses.consulted.map(analystLabel).join(', ')}. These are software,
                not people, and their answers are proposals, not findings — nothing in
                this article establishes any of them.
              </p>
              {hypotheses.hypotheses.length > 0 ? (
                <ul className="news-subtle mt-2 space-y-2 text-caption">
                  {hypotheses.hypotheses.map((hypothesis) => (
                    <li key={hypothesis.claim}>
                      {hypothesis.claim} — {hypothesis.likelihood ?? hypothesis.strength}
                      {hypothesis.likelihood_range ? ` (${hypothesis.likelihood_range})` : ''},
                      proposed by {analystLabel(hypothesis.attribution)}
                      {hypothesis.informed_by
                        ? `, which had read ${hypothesis.informed_by}. The claim is ours, not that publisher's`
                        : ', from its own domain knowledge rather than from this data'}
                      {hypothesis.corroborated_by && hypothesis.corroborated_by.length > 0
                        ? `. Reached independently by ${hypothesis.corroborated_by
                            .map(analystLabel)
                            .join(', ')}`
                        : ''}
                      {hypothesis.rival
                        ? `. The same analyst's rival explanation: ${hypothesis.rival}`
                        : ''}
                      {hypothesis.disconfirmed_by
                        ? `. What would disprove it: ${hypothesis.disconfirmed_by}`
                        : ''}
                      {hypothesis.testable_with
                        ? `. What would settle it: ${hypothesis.testable_with}`
                        : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="news-subtle mt-2 text-caption">
                  No explanation survived the panel's own checks, so the article offers
                    none. Analysts looked and found nothing they could stand behind,
                  which is not the same as nobody asking.
                </p>
              )}
              {hypotheses.discarded ? (
                <p className="news-subtle mt-2 text-caption">
                  {hypotheses.discarded} further explanation
                  {hypotheses.discarded === 1 ? ' was' : 's were'} proposed and discarded
                  {' '}for carrying an unverified figure, citing a document the newsroom
                  never retrieved, or naming no particular beyond the finding itself. The
                  correspondent never saw them.
                </p>
              ) : null}
            </div>
          )}

          {editor?.notes && editor.notes.length > 0 && (
            <div>
              <h3 className="news-subtle mb-2 text-caption font-semibold uppercase tracking-widest">
                What the editor asked for
              </h3>
              <p className="news-muted text-ui">
                The desk read this piece and sent it back before it ran. These are the notes it
                gave the correspondent.
              </p>
              <ul className="news-subtle mt-2 space-y-1 text-caption">
                {editor.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              {editor.reason && <p className="news-muted mt-2 text-ui">{editor.reason}</p>}
            </div>
          )}

          {signal_id && (
            <div>
              <h3 className="news-subtle mb-2 text-caption font-semibold uppercase tracking-widest">
                Why this story exists
              </h3>
              <p className="news-muted text-ui">
                A deterministic detector, not a model, flagged this change as newsworthy and
                triggered the story.
              </p>
              <p className="news-subtle mt-2 font-mono text-caption">{signal_id}</p>
            </div>
          )}

          <div>
            <h3 className="news-subtle mb-2 text-caption font-semibold uppercase tracking-widest">
              How it was written
            </h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Model">
                <span className="font-mono text-ui">{model ?? 'None. Not generated'}</span>
              </Field>
              {prompt_version && (
                <Field label="Prompt version">
                  <span className="font-mono text-ui">{prompt_version}</span>
                </Field>
              )}
              <Field label="Written">
                <time dateTime={generated_at}>{formatTimestamp(generated_at)}</time>
              </Field>
              <Field label="Reviewed by">{AI_EDITOR.name} · AI editor</Field>
              <Field label="Accountable publisher">{publisherName(accountable_editor)}</Field>
              {approved_by && (
                <Field label="Approved by">
                  {approved_by}
                  {approved_at && (
                    <span className="news-subtle block text-caption">
                      <time dateTime={approved_at}>{formatTimestamp(approved_at)}</time>
                    </span>
                  )}
                </Field>
              )}
            </dl>
            <p className="news-subtle mt-4 text-caption">
              The model writes sentences around figures the pipeline has already verified. It is never
              asked to recall or supply a number.
            </p>
          </div>

          <details className="news-border group/checks border-t pt-3">
            <summary className="news-subtle news-hover cursor-pointer list-none text-caption font-semibold uppercase tracking-widest">
              <span
                aria-hidden="true"
                className="mr-1 inline-block transition-transform group-open/checks:rotate-90"
              >
                ›
              </span>
              The {validator.checks.length} checks run before publication
            </summary>
            <ul className="mt-3 space-y-2">
              {validator.checks.map((check) => (
                <li key={check.name} className="flex gap-2 text-ui">
                  <span
                    aria-hidden="true"
                    className={check.passed ? 'news-positive' : 'news-negative'}
                  >
                    {check.passed ? '✓' : '✕'}
                  </span>
                  <span className="news-muted">
                    {CHECK_LABELS[check.name] ?? check.name}
                    <span className="sr-only">{check.passed ? ': passed' : ': failed'}</span>
                    {check.detail && (
                      <span className="news-subtle block text-caption">{check.detail}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="news-subtle mt-4 text-caption">
              Checked{' '}
              <time dateTime={validator.checked_at}>{formatTimestamp(validator.checked_at)}</time>. An
              article that fails any check is not published. The system fails closed.
            </p>
          </details>
        </div>
      </details>
    </section>
  );
}