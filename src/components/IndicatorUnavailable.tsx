interface IndicatorUnavailableProps {
  title: string;
  source: string;
  failed: boolean;
  onRetry: () => void;
}

export function IndicatorUnavailable({ title, source, failed, onRetry }: IndicatorUnavailableProps) {
  return (
    <div className="space-y-2">
      <p className="text-callout font-semibold dash-fg">{title}</p>
      <p role="status" className="text-ui dash-muted">
        {failed ? `Couldn't load ${title}.` : `No readings for ${title} in the selected range.`}
      </p>
      <p className="text-caption dash-subtle">Source: {source}{failed ? ' · Unavailable' : ' · No data returned'}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-ui dash-body underline min-h-11 px-3 dash-hover-fg"
        aria-label={`Retry ${title}`}
      >
        Retry
      </button>
    </div>
  );
}
