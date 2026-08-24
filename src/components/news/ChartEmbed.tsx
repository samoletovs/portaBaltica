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
  /**
   * The country the article is about. Overrides the dashboard's country
   * switcher, so a story about Estonia never renders Latvia's series
   * underneath it.
   */
  country?: 'LV' | 'EE' | 'LT';
  caption?: string;
}

export function ChartEmbed({ indicatorId, country, caption }: Props) {
  return (
    <figure className="news-border news-panel my-8 rounded-xl border p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="news-subtle text-xs font-medium uppercase tracking-widest">Live data</p>
        <Link
          to={`/indicator/${indicatorId}`}
          className="news-link news-focus text-xs underline underline-offset-4"
        >
          Open the full series →
        </Link>
      </div>

      <Suspense
        fallback={
          <div className="news-skeleton h-64 animate-pulse rounded-lg" aria-label="Loading chart" />
        }
      >
        <IndicatorChart id={indicatorId} country={country} />
      </Suspense>

      <figcaption className="news-subtle mt-2 text-xs leading-relaxed">
        {caption ?? 'This chart updates independently of the article. It is the same series the story was written from.'}
      </figcaption>
    </figure>
  );
}
