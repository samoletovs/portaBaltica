import type { EvidenceError } from '../../evidence-validation';

export function EvidenceLoading({ label = 'Reading the evidence archive' }: { label?: string }) {
  return (
    <div className="evidence-loading" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="evidence-skeleton" aria-hidden="true" />
      <div className="evidence-skeleton" aria-hidden="true" />
      <div className="evidence-skeleton" aria-hidden="true" />
    </div>
  );
}

export function EvidenceFailure({ error, retry }: { error: EvidenceError; retry: () => void }) {
  const heading = error.kind === 'integrity' ? 'Evidence could not be verified'
    : error.kind === 'not-found' ? 'Evidence not found' : 'The archive is unavailable';
  return (
    <section className="evidence-notice" role="alert">
      <h2 className="text-title font-semibold news-fg">{heading}</h2>
      <p className="text-callout news-muted">
        {error.kind === 'integrity' ? 'This record failed its format, identity or checksum checks. Its observations have not been displayed.'
          : error.kind === 'not-found' ? 'There is no published record at this address. Browse the archive for completed captures; a missing record is not an empty dataset.'
            : 'The evidence service did not respond successfully. Existing articles and the live data explorer are still available.'}
      </p>
      <p className="text-ui news-muted">{error.message}</p>
      <button type="button" onClick={retry} className="site-action text-ui">Try again</button>
    </section>
  );
}

export function EvidenceTime({ value }: { value: string | null }) {
  if (!value) return <>Not supplied by the source</>;
  const date = new Date(value);
  const label = Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
  return <time dateTime={value}>{label}</time>;
}
