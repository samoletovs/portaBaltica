import type { ReactNode } from 'react';
import type { Provenance, ValidatorCheckName } from '../../news-types';
import { ACCOUNTABLE_EDITOR } from '../../newsroom/editorial';

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
      <dt className="news-subtle text-xs">{label}</dt>
      <dd className="news-muted mt-0.5 text-[13px]">{children}</dd>
    </div>
  );
}

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
  } = provenance;

  const passedCount = validator.checks.filter((check) => check.passed).length;
  const allPassed = passedCount === validator.checks.length && validator.checks.length > 0;

  return (
    <section
      aria-labelledby="provenance-heading"
      className="news-border news-accent-panel mt-10 overflow-hidden rounded-xl border"
    >
      <div className="news-border flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <h2 id="provenance-heading" className="news-fg text-sm font-semibold tracking-tight">
          Where this came from
        </h2>
        <p
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
            allPassed
              ? 'news-status-positive'
              : 'news-status-warning'
          }`}
        >
          <span aria-hidden="true">{allPassed ? '✓' : '!'}</span>
          {passedCount} of {validator.checks.length} checks passed
        </p>
      </div>

      <div className="space-y-6 px-5 py-4">
        <p className="news-muted text-[13px] leading-relaxed">
          This record was written automatically as the article was produced. Open any dataset below
          and you can check the figures for yourself — that is what it is here for.
        </p>

        <div>
          <h3 className="news-subtle mb-2 text-xs font-medium uppercase tracking-widest">
            The data behind it
          </h3>
          <ul className="space-y-3">
            {sources.map((source) => (
              <li
                key={`${source.source_id}-${source.dataset ?? ''}-${source.retrieved_at}`}
                className="news-border news-panel rounded-lg border px-3 py-2.5"
              >
                <p className="news-fg text-sm font-medium">
                  {SOURCE_NAMES[source.source_id] ?? source.source_id}
                </p>
                {source.dataset && (
                  <p className="news-muted mt-0.5 text-[13px]">
                    {source.dataset}
                    {source.dataset_version && (
                      <span className="news-subtle"> · version {source.dataset_version}</span>
                    )}
                  </p>
                )}
                <p className="news-subtle mt-1 flex flex-wrap items-center gap-x-3 text-xs">
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
                      className="news-link news-focus underline underline-offset-2"
                    >
                      Open the dataset ↗<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {signal_id && (
          <div>
            <h3 className="news-subtle mb-2 text-xs font-medium uppercase tracking-widest">
              Why this story exists
            </h3>
            <p className="news-muted text-[13px] leading-relaxed">
              A deterministic detector — not a model — flagged this change as newsworthy and
              triggered the story.
            </p>
            <p className="news-subtle mt-1 font-mono text-xs">{signal_id}</p>
          </div>
        )}

        <div>
          <h3 className="news-subtle mb-2 text-xs font-medium uppercase tracking-widest">
            How it was written
          </h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label="Model">
              <span className="font-mono text-xs">{model ?? 'None — not generated'}</span>
            </Field>
            {prompt_version && (
              <Field label="Prompt version">
                <span className="font-mono text-xs">{prompt_version}</span>
              </Field>
            )}
            <Field label="Written">
              <time dateTime={generated_at}>{formatTimestamp(generated_at)}</time>
            </Field>
            <Field label="Accountable editor">{accountable_editor ?? ACCOUNTABLE_EDITOR}</Field>
            {approved_by && (
              <Field label="Approved by">
                {approved_by}
                {approved_at && (
                  <span className="news-subtle block text-xs">
                    <time dateTime={approved_at}>{formatTimestamp(approved_at)}</time>
                  </span>
                )}
              </Field>
            )}
          </dl>
          <p className="news-subtle mt-3 text-xs leading-relaxed">
            The model writes sentences around figures the pipeline has already verified. It is never
            asked to recall or supply a number.
          </p>
        </div>

        <details className="news-border group border-t pt-3">
          <summary className="news-subtle news-hover news-focus cursor-pointer list-none text-xs font-medium uppercase tracking-widest">
            <span
              aria-hidden="true"
              className="mr-1 inline-block transition-transform group-open:rotate-90"
            >
              ›
            </span>
            The {validator.checks.length} checks run before publication
          </summary>
          <ul className="mt-3 space-y-1.5">
            {validator.checks.map((check) => (
              <li key={check.name} className="flex gap-2 text-[13px]">
                <span
                  aria-hidden="true"
                  className={check.passed ? 'news-positive' : 'news-negative'}
                >
                  {check.passed ? '✓' : '✕'}
                </span>
                <span className="news-muted">
                  {CHECK_LABELS[check.name] ?? check.name}
                  <span className="sr-only">{check.passed ? ' — passed' : ' — failed'}</span>
                  {check.detail && (
                    <span className="news-subtle block text-xs">{check.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="news-subtle mt-3 text-xs leading-relaxed">
            Checked{' '}
            <time dateTime={validator.checked_at}>{formatTimestamp(validator.checked_at)}</time>. An
            article that fails any check is not published — the system fails closed.
          </p>
        </details>
      </div>
    </section>
  );
}
