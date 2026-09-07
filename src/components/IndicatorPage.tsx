import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { IndicatorChart } from './IndicatorCard';
import { BalticCompareChart } from './BalticCompareChart';
import { useCountry } from '../CountryContext';
import { usePageMeta } from '../newsroom/usePageMeta';

/**
 * One entry of the indicator registry, as `/api/baltic-compare?list=1` serves it.
 *
 * Fetched rather than mirrored. A hand-written copy of the registry in `src/`
 * is the two-enumerations problem this repo keeps finding — and this file
 * already had two of them (`EUROSTAT_MAP` and `INDICATOR_INFO`), which is
 * precisely how 57 of the dashboard's 71 indicators ended up with a page that
 * rendered "Unknown indicator".
 */
interface RegistryEntry {
  id: string;
  title: string;
  unit: string;
  dataset: string;
  freq: string;
}

/** `Q` → "Quarterly", for a description a person would read. */
const FREQ_WORD: Record<string, string> = {
  A: 'Annual',
  S: 'Half-yearly',
  Q: 'Quarterly',
  M: 'Monthly',
  W: 'Weekly',
  D: 'Daily',
};

// Map indicators to their Eurostat equivalent for Baltic comparison
const EUROSTAT_MAP: Record<string, string> = {
  gdp: 'gdp',
  unemployment: 'unemployment',
  cpi: 'inflation',
  salary: 'salary',
  house_prices: 'house_prices',
  retail_sales: 'retail',
  industrial: 'industrial',
  population: 'population',
  tourist_arrivals: 'tourism',
  hotel_occupancy: 'tourism',
  construction_output: 'construction',
  biz_confidence: 'consumer_confidence',
  gov_debt: 'gov_debt_gdp',
  gov_revenue: 'gov_revenue',
  exports: 'exports',
  imports: 'imports',
  trade_balance: 'trade_balance',
  new_vehicles: 'vehicles',
  renewable_share: 'renewables',
  wages_industry: 'wages_mfg',
  wages_it: 'wages_it',
  ppi: 'ppi',
};

const INDICATOR_INFO: Record<string, { title: string; description: string; related: string[] }> = {
  gdp: {
    title: 'GDP Growth Rate',
    description: 'Gross Domestic Product quarterly growth rate, seasonally adjusted. GDP measures the total economic output and is the broadest measure of economic activity.',
    related: ['salary', 'unemployment', 'industrial', 'retail_sales'],
  },
  salary: {
    title: 'Hourly Labour Cost',
    description: 'Average hourly labour cost across all sectors (Eurostat lc_lci_lev). Covers compensation of employees plus taxes minus subsidies, business economy excluding public administration.',
    related: ['gdp', 'cpi', 'unemployment'],
  },
  cpi: {
    title: 'CPI Inflation',
    description: 'Consumer Price Index — 12-month average rate of change. Measures how fast prices are rising for goods and services purchased by households.',
    related: ['salary', 'gdp', 'house_prices'],
  },
  unemployment: {
    title: 'Unemployment Rate',
    description: 'Share of economically active population aged 15-74 that is unemployed, seasonally adjusted. A key indicator of labor market health.',
    related: ['gdp', 'salary', 'industrial'],
  },
  house_prices: {
    title: 'House Price Change',
    description: 'Year-over-year change in residential property prices. A leading indicator for the real estate market and construction activity.',
    related: ['cpi', 'salary', 'gdp'],
  },
  retail_sales: {
    title: 'Retail Sales Growth',
    description: 'Year-over-year change in retail trade turnover. Reflects consumer spending patterns and economic confidence.',
    related: ['cpi', 'salary', 'gdp'],
  },
  industrial: {
    title: 'Industrial Production Growth',
    description: 'Year-over-year change in industrial output (mining, manufacturing, energy). A key indicator of the productive economy.',
    related: ['gdp', 'retail_sales', 'unemployment'],
  },
  population: {
    title: 'Population',
    description: 'Total population. All three Baltic states have experienced population decline due to emigration and low birth rates since EU accession.',
    related: ['unemployment', 'salary', 'gdp'],
  },
  exports: {
    title: 'Exports',
    description: 'Total value of goods and services exported, seasonally adjusted. Key indicator of trade competitiveness and external demand.',
    related: ['imports', 'gdp', 'industrial'],
  },
  imports: {
    title: 'Imports',
    description: 'Total value of goods and services imported, seasonally adjusted. Reflects domestic demand and trade dependency.',
    related: ['exports', 'gdp', 'retail_sales'],
  },
  hotel_occupancy: {
    title: 'Hotel occupancy rate',
    description: 'Percentage of available hotel rooms occupied. A key indicator of tourism activity and service sector health.',
    related: ['tourist_arrivals', 'gdp'],
  },
  tourist_arrivals: {
    title: 'Tourist arrivals',
    description: 'Number of tourists arriving at accommodation establishments. Tourism is a significant contributor to the Latvian economy.',
    related: ['hotel_occupancy', 'gdp'],
  },
  gov_revenue: {
    title: 'Government revenue',
    description: 'Total general government revenue in million euros. Reflects tax collection effectiveness and economic activity.',
    related: ['gov_debt', 'gdp', 'cpi'],
  },
  gov_debt: {
    title: 'Government debt',
    description: 'Total general government consolidated debt. A key metric for fiscal sustainability and credit risk assessment.',
    related: ['gov_revenue', 'gdp'],
  },
  biz_confidence: {
    title: 'Economic sentiment',
    description: 'Composite economic sentiment indicator (long-term average = 100). A leading indicator combining business and consumer surveys.',
    related: ['gdp', 'retail_sales', 'unemployment'],
  },
  construction_output: {
    title: 'Construction output',
    description: 'Volume index of construction production (2021=100, seasonally adjusted). Tracks the health of the building sector.',
    related: ['building_permits', 'gdp', 'house_prices'],
  },
  building_permits: {
    title: 'Building permits issued',
    description: 'Number of building permits issued per quarter. A leading indicator for future construction activity.',
    related: ['construction_output', 'house_prices'],
  },
  new_vehicles: {
    title: 'New car registrations',
    description: 'New passenger car registrations per quarter. A proxy for consumer confidence and economic health.',
    related: ['retail_sales', 'salary', 'biz_confidence'],
  },
  wages_industry: {
    title: 'Manufacturing Wages',
    description: 'Labour cost index for the manufacturing sector (NACE C), base year 2020=100. Tracks how industrial labour costs evolve over time.',
    related: ['salary', 'wages_it', 'industrial'],
  },
  wages_it: {
    title: 'IT Sector Wages',
    description: 'Labour cost index for the information and communication sector (NACE J), base year 2020=100. The Baltics\' fastest-growing wage sector.',
    related: ['salary', 'wages_industry'],
  },
  energy_price_gas: {
    title: 'Gas price (households)',
    description: 'Average natural gas price for household consumers in EUR per gigajoule. A key cost-of-living indicator.',
    related: ['cpi', 'renewable_share'],
  },
  renewable_share: {
    title: 'Renewable Energy Share',
    description: 'Share of renewable energy in total energy consumption. The Baltics have above-EU-average shares thanks to hydropower (Latvia), biomass, and wind expansion.',
    related: ['energy_price_gas'],
  },
  ppi: {
    title: 'Producer prices (PPI)',
    description: 'Year-over-year change in producer prices for industrial products. A leading indicator for consumer inflation.',
    related: ['cpi', 'industrial', 'exports'],
  },
  trade_balance: {
    title: 'Trade balance',
    description: 'Difference between exports and imports (seasonally adjusted). A negative balance means the country imports more than it exports.',
    related: ['exports', 'imports', 'gdp'],
  },
};

export function IndicatorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { countryLabel, flag, setCountry } = useCountry();

  // A link from an article carries the country the story was about. Without
  // this the page answered for whatever the dashboard's switcher was last left
  // on, so "check it yourself" under an Estonian story could open Lithuania —
  // which looks less like a different country than like the article being
  // wrong. The switcher stays visible and the reader can still change it.
  const requested = searchParams.get('country')?.toUpperCase();
  useEffect(() => {
    if (requested === 'LV' || requested === 'EE' || requested === 'LT') {
      setCountry(requested);
    }
  }, [requested, setCountry]);

  /**
   * The registry, or `null` when we asked and could not find out.
   *
   * Three states kept apart on purpose: `undefined` is "not asked yet", `null`
   * is "asked and failed", an array is an answer. A page must not say "Unknown
   * indicator" about a series the registry would have recognised, merely
   * because the catalogue request had not landed yet.
   */
  const [registry, setRegistry] = useState<RegistryEntry[] | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/baltic-compare?list=1', { signal: controller.signal, credentials: 'omit' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { indicators?: RegistryEntry[] } | null) => {
        setRegistry(Array.isArray(payload?.indicators) ? payload.indicators : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRegistry(null);
      });
    return () => controller.abort();
  }, []);

  const info = id ? INDICATOR_INFO[id] : null;
  const registered = id && registry ? registry.find((entry) => entry.id === id) : undefined;

  /**
   * Does this URL name something we can show?
   *
   * Either we hold an editorial entry for it, or the dashboard's own registry
   * serves it. Anything else is a stale link or a typed URL, and it gets the
   * dead end below.
   */
  const known = Boolean(info) || Boolean(registered);
  const stillLooking = registry === undefined && !info;

  const title = info?.title ?? registered?.title ?? 'Indicator';

  /**
   * The description, distinct per page, and composed only where it must be.
   *
   * The 24 editorial entries are used as written — measured, 24 of 24 distinct,
   * 97 to 179 characters, longest shared prefix between any two 34 characters.
   *
   * The rest are composed from the registry, and the composition deliberately
   * leads with the registry's own title. Measured across all 71: `freq`, `unit`
   * and `dataset` together are distinct for only 47 — eight inflation variants
   * share `M | % YoY | prc_hicp_minr` between them — so a description built
   * from those three alone would put an identical sentence on eight pages,
   * which is the duplicate-content problem one level down from the canonical
   * one this page is being fixed for. `title` is distinct 71 of 71, so leading
   * with it is what makes the composed form safe.
   */
  const description = info?.description
    ?? (registered
      ? `${registered.title} for Latvia, Estonia and Lithuania. ` +
        `${FREQ_WORD[registered.freq] ?? 'Periodic'} series in ${registered.unit}, ` +
        `from Eurostat dataset ${registered.dataset}, downloadable as CSV or JSON.`
      : undefined);

  usePageMeta({
    title: known ? `${title} | portaBaltica` : 'Indicator | portaBaltica',
    description,
    canonicalPath: id ? `/indicator/${id}` : undefined,
    // A dead end must not be indexed, and it cannot be a 404: the SPA fallback
    // answers HTTP 200 for every route here — `/utterly-invented-page` included,
    // verified against production — so `noindex` is the only signal available.
    index: known || stillLooking,
  });

  if (!id || (!known && !stillLooking)) {
    return (
      <div className="min-h-screen">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <p className="dash-muted">Unknown indicator.</p>
          <button onClick={() => navigate('/data')} className="dash-body underline mt-2 text-ui">← Back to dashboard</button>
        </div>
      </div>
    );
  }

  if (stillLooking) {
    return (
      <div className="min-h-screen">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <div
            className="dash-skeleton h-64 animate-pulse rounded-xl"
            aria-busy="true"
            aria-label="Loading the indicator"
          />
        </div>
      </div>
    );
  }

  /**
   * Which series the Baltic comparison should ask for.
   *
   * `EUROSTAT_MAP` translates the legacy ids that predate the registry. A
   * registry id needs no translation — it *is* the id the API serves — and
   * routing every id through the map is what left 57 indicators unreachable.
   */
  const compareId = (id && EUROSTAT_MAP[id]) ?? registered?.id;

  /**
   * The Latvian series exists only for the editorial ids.
   *
   * `/api/historical-data?indicator=road_freight` answers 400 while
   * `/api/baltic-compare?indicator=road_freight` answers 200 — measured. Asking
   * anyway would put an empty chart frame on 57 pages, which this codebase
   * treats as worse than showing no chart at all.
   */
  const hasNationalSeries = Boolean(info);

  return (
    <div className="min-h-screen">
      <main id="main" className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate('/data')}
          className="text-ui dash-muted dash-hover-fg mb-4 inline-flex items-center gap-1"
        >
          ← Back to dashboard
        </button>

        {/* Header */}
        <h1 className="balance-text text-headline sm:text-display font-semibold dash-fg mb-3">
          {title}
        </h1>
        <p className="text-ui mb-1" style={{ color: 'var(--text-secondary)' }}>{flag} {countryLabel}</p>
        {description && (
          <p className="text-ui mb-6 max-w-2xl" style={{ color: 'var(--text-body)' }}>{description}</p>
        )}

        {/* The Latvian series, where one exists. */}
        {hasNationalSeries && (
          <div className="dash-card border dash-edge rounded-xl p-6 mb-6">
            <IndicatorChart id={id} />
          </div>
        )}

        {/* Baltic comparison */}
        {compareId && (
          <div className="mb-8">
            <h2 className="balance-text text-title font-semibold dash-fg mb-4">Baltic Comparison</h2>
            <BalticCompareChart indicator={compareId} title={`${title} — Latvia vs Estonia vs Lithuania`} />
          </div>
        )}

        {/* Related indicators */}
        {info && info.related.length > 0 && (
          <div>
            <h2 className="balance-text text-title font-semibold dash-fg mb-4">Related Indicators</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {info.related.map((relId) => {
                const rel = INDICATOR_INFO[relId];
                if (!rel) return null;
                return (
                  <button
                    key={relId}
                    onClick={() => navigate(`/indicator/${relId}`)}
                    className="dash-card border dash-edge rounded-xl p-3 text-left dash-hover-edge transition-colors"
                  >
                    <p className="text-ui dash-fg">{rel.title}</p>
                    <p className="text-caption dash-muted mt-0.5">Click to explore →</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-caption mt-8" style={{ color: 'var(--text-tertiary)' }}>
          {hasNationalSeries && !registered
            ? `Data from Latvia's Central Statistical Bureau (CSP) via PxWeb API. Updated according to CSP publication calendar.`
            : 'Data from Eurostat. Updated according to Eurostat publication calendar.'
          }{' '}
          All data is publicly available under open license.{' '}
          {/* The open-licence claim used to end the page with nothing behind it.
              Every chart above now writes the series out as CSV or JSON, unit,
              source and retrieval instant included, so the sentence says where. */}
          Use the download buttons on each chart to take the series as CSV or JSON.
        </p>
      </main>
    </div>
  );
}
