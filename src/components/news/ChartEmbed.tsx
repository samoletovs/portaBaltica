import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { resolveChartRef } from '../../newsroom/chart-ref';

/**
 * The round-trip: article → the live series the claim was made from.
 *
 * The chart plots the article's own country, never the dashboard's switcher.
 * That rule is not negotiable and is guarded by tests/chartEmbed.test.tsx: a
 * chart under a story is an invitation to check a claim, so showing a
 * different country renders something that looks like confirmation and is not.
 *
 * WHEN THAT SERIES DOES NOT EXIST
 * -------------------------------
 * Several indicators are only published per-country for Latvia, so a story
 * about Estonia used to produce a box labelled "Live data" containing the
 * sentence "This indicator is only available for Latvia via PxWeb. See the
 * Baltic Comparison chart below" — advice that is true on /data, where such a
 * chart sits further down, and false under an article, where it does not
 * exist. The reader got an empty frame and a pointer to nothing.
 *
 * So the fallback is the three-country Eurostat comparison, which carries LV,
 * EE and LT on one definition and therefore has a series where the per-country
 * path does not. It is labelled as what it is. Showing all three including the
 * article's own country is a superset of the claim rather than a substitute
 * for it, which is the distinction that keeps this honest.
 *
 * recharts and d3 stay behind these lazy boundaries. The news feed must never
 * pull them into its entry path.
 */

const IndicatorChart = lazy(() =>
  import('../IndicatorCard').then((module) => ({ default: module.IndicatorChart })),
);

const BalticCompareChart = lazy(() =>
  import('../BalticCompareChart').then((module) => ({ default: module.BalticCompareChart })),
);

interface Props {
  /** Indicator id resolving to a live tile on /data. */
  indicatorId: string;
  /**
   * The country the article is about, when it has exactly one. Overrides the
   * dashboard's switcher so a story about Estonia never charts Latvia.
   */
  country?: 'LV' | 'EE' | 'LT';
  caption?: string;
}

const COUNTRY_NAMES: Record<string, string> = { LV: 'Latvia', EE: 'Estonia', LT: 'Lithuania' };

export function ChartEmbed({ indicatorId, country, caption }: Props) {
  // An unresolvable id means no chart at all. A frame captioned "Live data"
  // with nothing inside it is worse than silence: it tells the reader the
  // evidence exists and then fails to produce it.
  const resolved = resolveChartRef(indicatorId);
  if (!resolved) return null;

  const seriesHref = country
    ? `/indicator/${resolved}?country=${country}`
    : `/indicator/${resolved}`;

  const fallback = (
    <div>
      <BalticCompareChart indicator={resolved} compact />
      <p className="news-subtle mt-2 text-caption">
        {country
          ? `${COUNTRY_NAMES[country] ?? country} is not published as a separate series for this indicator, so all three Baltic countries are shown on the Eurostat measure.`
          : 'All three Baltic countries on the Eurostat measure.'}
      </p>
    </div>
  );

  return (
    <figure className="news-border news-panel my-8 rounded-xl border p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="news-subtle text-caption font-semibold uppercase tracking-widest">Live data</p>
        {/* `flex min-h-11 items-center` for the same reason the masthead
            wordmark carries it: the 44px rule in `index.css` reaches `nav a`,
            and this is a standalone link outside any nav, so no rule touched
            it. Measured 116×18 at 320/375/768/1280 on every article. It is not
            a link in running prose — its row is a flex container — so SC 2.5.8's
            prose exemption does not reach it either. */}
        <Link
          to={seriesHref}
          className="news-link flex min-h-11 items-center text-caption underline underline-offset-4"
        >
          Open the full series →
        </Link>
      </div>

      <Suspense
        fallback={
          <div className="news-skeleton h-64 animate-pulse rounded-lg" aria-label="Loading chart" />
        }
      >
        <IndicatorChart id={resolved} country={country} fallback={fallback} />
      </Suspense>

      <figcaption className="news-subtle mt-2 text-caption">
        {caption ??
          'This chart updates independently of the article. It is the same series the story was written from.'}
      </figcaption>
    </figure>
  );
}
