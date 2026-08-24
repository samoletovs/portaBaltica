import type { Provenance, ValidatorCheckName } from '../../news-types';
import { ACCOUNTABLE_EDITOR } from '../../newsroom/editorial';

/**
 * The passport.
 *
 * Every tier A article shows what it was built from, by what, when, and who is
 * accountable. This is meant to be read, not merely stored — so the validator
 * checks are spelled out as sentences a reader can judge rather than as
 * snake_case gate names, and the datasets link back to their publishers.
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

export function ProvenanceBlock({ provenance }: { provenance: Provenance }) {
  const { sources, validator, model, prompt_version, generated_at, accountable_editor } = provenance;
  const passedCount = validator.checks.filter((check) => check.passed).length;

  return (
    <section
      aria-labelledby="provenance-heading"
      className="mt-10 rounded-xl border border-ocean-800/50 bg-ocean-950/40"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ocean-800/40 px-5 py-3">
        <h2 id="provenance-heading" className="text-sm font-semibold tracking-tight text-ocean-100">
          Where this came from
        </h2>
        <p className="flex items-center gap-2 text-xs text-emerald-300">
          <span aria-hidden="true">✓</span>
          {passedCount} of {validator.checks.length} publication checks passed
        </p>
      </div>

      <div className="space-y-5 px-5 py-4">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-500">Data</h3>
          <ul className="space-y-2">
            {sources.map((source) => (
              <li key={`${source.source_id}-${source.retrieved_at}`} className="text-sm text-slate-300">
                <span className="font-medium text-slate-100">
                  {SOURCE_NAMES[source.source_id] ?? source.source_id}
                </span>
                {source.dataset && <span className="text-slate-400"> — {source.dataset}</span>}
                {source.dataset_version && (
                  <span className="text-slate-500"> (v{source.dataset_version})</span>
                )}
                <span className="block text-xs text-slate-500">
                  Retrieved <time dateTime={source.retrieved_at}>{formatTimestamp(source.retrieved_at)}</time>
                  {source.url && (
                    <>
                      {' · '}
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-slate-300"
                      >
                        open the dataset ↗
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-500">How it was written</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-slate-500">Model</dt>
              <dd className="font-mono text-xs text-slate-300">{model ?? 'None — not generated'}</dd>
            </div>
            {prompt_version && (
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-slate-500">Prompt version</dt>
                <dd className="font-mono text-xs text-slate-300">{prompt_version}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-slate-500">Written</dt>
              <dd className="text-xs text-slate-300">
                <time dateTime={generated_at}>{formatTimestamp(generated_at)}</time>
              </dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-slate-500">Accountable editor</dt>
              <dd className="text-xs text-slate-300">{accountable_editor ?? ACCOUNTABLE_EDITOR}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            The model writes sentences around figures the pipeline has already verified. It is never
            asked to recall or supply a number.
          </p>
        </div>

        <details className="group">
          <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400">
            <span aria-hidden="true" className="mr-1 inline-block transition-transform group-open:rotate-90">
              ›
            </span>
            Checks run before publication
          </summary>
          <ul className="mt-2 space-y-1">
            {validator.checks.map((check) => (
              <li key={check.name} className="flex gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className={check.passed ? 'text-emerald-400' : 'text-red-400'}
                >
                  {check.passed ? '✓' : '✕'}
                </span>
                <span className="text-slate-300">
                  {CHECK_LABELS[check.name] ?? check.name}
                  <span className="sr-only">{check.passed ? ' — passed' : ' — failed'}</span>
                  {check.detail && <span className="block text-xs text-slate-500">{check.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Checked <time dateTime={validator.checked_at}>{formatTimestamp(validator.checked_at)}</time>. An
            article that fails any check is not published.
          </p>
        </details>
      </div>
    </section>
  );
}
