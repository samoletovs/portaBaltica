import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';

/**
 * The round-trip: article → the live chart the claim was made from.
 *
 * recharts and d3 are loaded lazily and only here. The news feed itself must
 * never pull them into its entry path — that is what took the dashboard to a
 * 743 KB initial chunk before `manualChunks` split it out.
 */

const IndicatorChart = lazy(() =>
  import('../IndicatorCard').then((module) => ({ default: module.IndicatorChart })),
);

interface Props {
  /** Indicator id resolving to a live tile on /data. */
  indicatorId: string;
  caption?: string;
}

export function ChartEmbed({ indicatorId, caption }: Props) {
  return (
    <figure className="my-8 rounded-xl border border-slate-800/60 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Live data</p>
        <Link
          to={`/indicator/${indicatorId}`}
          className="text-xs text-ocean-300 underline underline-offset-4 hover:text-ocean-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
        >
          Open the full series →
        </Link>
      </div>

      <Suspense
        fallback={
          <div className="h-64 animate-pulse rounded-lg bg-slate-800/40" aria-label="Loading chart" />
        }
      >
        <IndicatorChart id={indicatorId} />
      </Suspense>

      <figcaption className="mt-2 text-xs leading-relaxed text-slate-500">
        {caption ?? 'This chart updates independently of the article. It is the same series the story was written from.'}
      </figcaption>
    </figure>
  );
}
