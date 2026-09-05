import { Link, useNavigate } from 'react-router-dom';
import { usePageMeta } from '../newsroom/usePageMeta';

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/economy-data', params: '?country=lv|ee|lt', description: 'Electricity delivery-interval prices, ECB exchange rates, national and Eurostat macro indicators, business pulse', cache: 'Until the next electricity delivery interval (at most 15 min)' },
  { method: 'GET', path: '/api/environment-data', params: '?country=lv|ee|lt', description: 'Weather for 4 cities, air quality, capital-region population', cache: '15 min' },
  { method: 'GET', path: '/api/historical-data', params: '?indicator=gdp&years=5', description: '24 Latvian indicators with time series from CSP PxWeb, falling back to Eurostat where a national table is unavailable. The `source` field always names the provider that answered.', cache: '1 hour' },
  { method: 'GET', path: '/api/baltic-compare', params: '?indicator=gdp&years=5', description: 'Latvia vs Estonia vs Lithuania from Eurostat across 72 indicators. Add ?list=1 for the full catalogue. Responses carry an `assumptions` array, which is empty unless the API had to guess which slice of a Eurostat cube to read.', cache: '1 hour' },
  { method: 'GET', path: '/api/power-prices', params: '', description: 'Nord Pool day-ahead prices for all four Baltic-region bidding zones (EE, LV, LT, FI) with the spread between them and whether the market is currently coupled', cache: '15 min' },
  { method: 'GET', path: '/api/live-grid', params: '', description: 'Estonian grid state from Elering in MW: metered production, consumption and renewables, plus the forecast beyond `meteredTo`. Readings after that timestamp are a plan, not a measurement, and the two are labelled separately.', cache: '5 min' },
  { method: 'GET', path: '/api/sea-state', params: '', description: 'Marine and surface weather for Riga, Ventspils and Liepāja from Open-Meteo in one response. A port that could not be fetched is named in `unavailable` rather than omitted.', cache: '15 min' },
  { method: 'GET', path: '/api/property-data', params: '', description: 'Construction permits by municipality, building energy profile', cache: '1 hour' },
  { method: 'GET', path: '/api/port-data', params: 'country=LV|EE|LT', description: 'Baltic port statistics from Eurostat: cargo tonnage, sea passengers, vessel arrivals, quarterly', cache: '6 hours' },
  { method: 'GET', path: '/api/trade-partners', params: '', description: "Latvia's goods trade for the newest month CSP has published, by partner country and Harmonised System chapter, in both directions. Latvia only — the source is a national customs dataset, and `countryOnly` says so. `dataAsOf` is read from the rows, never from the file's metadata.", cache: '6 hours' },
  { method: 'GET', path: '/api/business-search', params: '?q=TERM', description: 'Search 195K+ beneficial owners (UBO) by company registration number or surname', cache: '5 min' },
  { method: 'GET', path: '/api/address-search', params: '?q=TERM', description: 'Search 608K+ Latvian addresses with GPS coordinates', cache: '5 min' },
  { method: 'GET', path: '/api/eu-funds', params: '', description: 'EU Recovery & Resilience Fund: the 20 most recent projects with status, plus the full project total', cache: '1 hour' },
  { method: 'GET', path: '/api/ai-insights', params: '', description: 'Real-time AI-generated insights from live data analysis', cache: '15 min' },
  { method: 'GET', path: '/api/data-export', params: '?indicator=ID&years=N&format=csv|json', description: 'Any dashboard series as a file, with a provenance preamble naming the source, the dataset and when it was retrieved. An empty cell means the source published nothing there, never a zero.', cache: '1 hour' },
  { method: 'GET', path: '/api/system-status', params: '', description: 'System health: 13 data source checks (9 required) with latency and what each one powers, plus API inventory', cache: '1 min' },
];

const INDICATORS = [
  'gdp', 'salary', 'cpi', 'unemployment', 'house_prices', 'retail_sales', 'industrial', 'population',
  'hotel_occupancy', 'tourist_arrivals', 'gov_revenue', 'gov_debt', 'exports', 'imports', 'biz_confidence',
  'construction_output', 'new_vehicles', 'wages_industry', 'wages_it', 'energy_price_gas', 'building_permits',
  'renewable_share', 'ppi', 'trade_balance',
];

export function ApiDocsPage() {
  const navigate = useNavigate();

  // Without this the page inherited the shell's head, which names the home
  // page as its canonical — measured against production at 2026-08-28T13:12Z:
  // `/api-docs  canonical=/  DISOWNS ITSELF`. Adding it to the sitemap while
  // it said that would have submitted a URL that disclaims itself, so the head
  // had to be fixed before the sitemap entry was worth anything.
  usePageMeta({
    title: 'API documentation | portaBaltica',
    description:
      'Public JSON endpoints over Baltic data: Eurostat indicators for Latvia, Estonia and Lithuania, electricity prices, port statistics, and searchable Latvian business and address registers.',
    canonicalPath: '/api-docs',
  });

  return (
    <div className="min-h-screen">
      <main id="main" className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <button onClick={() => navigate('/data')} className="text-ui mb-4 inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
          ← Back to dashboard
        </button>

        <h1 className="balance-text text-headline sm:text-display font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>API documentation</h1>
        <p className="text-ui mb-8" style={{ color: 'var(--text-secondary)' }}>
          All endpoints are free and public. No authentication required. Source-specific terms apply;
          public API access is not a grant of commercial redistribution rights. There is no paid API or service-level agreement.
          Base URL: <code className="font-mono text-caption break-all px-1 py-0.5 rounded" style={{ background: 'var(--bg-card-hover)' }}>https://portabaltica.naurolabs.com</code>
        </p>

        {/* Endpoints */}
        <div className="space-y-3 mb-12">
          {API_ENDPOINTS.map((ep) => (
            <div key={ep.path} className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
              {/* A query string has no space to break at, so `?indicator=gdp&years=5`
                  is one unbreakable token whose min-content is its full width.
                  Three of those in a rigid `flex` row overflowed the card at
                  320px and scrolled the page by 45px -- the same shape as the
                  chart legend in #151, with a URL in place of a legend entry.

                  The row wraps, and the parameters may break mid-token, which
                  is what a reader expects of a URL and is the only way a
                  340-character-per-line device can show one at all. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                <span className="text-caption font-mono px-2 py-0.5 rounded" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-secondary)' }}>
                  {ep.method}
                </span>
                <code className="text-ui font-mono break-all min-w-0" style={{ color: 'var(--text-primary)' }}>{ep.path}</code>
                {ep.params && <code className="text-caption font-mono break-all min-w-0" style={{ color: 'var(--text-tertiary)' }}>{ep.params}</code>}
              </div>
              <p className="text-caption mb-1" style={{ color: 'var(--text-body)' }}>{ep.description}</p>
              <span className="text-caption" style={{ color: 'var(--text-tertiary)' }}>Cache: {ep.cache}</span>
            </div>
          ))}
        </div>

        {/* Available indicators */}
        <h2 className="balance-text text-title font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Available indicators</h2>
        <p className="text-ui mb-4" style={{ color: 'var(--text-secondary)' }}>
          Use with <code className="font-mono text-caption break-all">/api/historical-data?indicator=NAME&years=5</code>
        </p>
        <div className="flex flex-wrap gap-2 mb-12">
          {INDICATORS.map((ind) => (
            <Link key={ind} to={`/indicator/${ind}`} className="inline-flex min-h-11 items-center text-caption font-mono px-2 py-1 rounded" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-body)' }}>
              {ind}
            </Link>
          ))}
        </div>

        <h2 className="balance-text text-title font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Free public access</h2>
        <div className="mb-8">
          <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <p className="text-ui mb-1" style={{ color: 'var(--text-primary)' }}>Free</p>
            <p className="text-title font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>€0</p>
            <ul className="text-caption space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>All dashboard data</li>
              <li>24 Latvian indicators from CSP PxWeb</li>
              <li>72 Baltic comparison indicators from Eurostat</li>
              <li>CSV and JSON export on every series</li>
              <li>Full history, not a rolling window</li>
              <li>AI insights</li>
              <li>3 country support</li>
            </ul>
          </div>
        </div>
        <p className="news-muted mb-8 text-ui">
          Current electricity fields are recomputed at delivery-interval boundaries. Published
          schedules cache for 15 minutes. During an upstream outage, a still-covered interval may
          use a recent schedule; check <code className="font-mono break-all">priceSchedule.stale</code> and{' '}
          <code className="font-mono break-all">priceSchedule.retrievedAt</code> before relying on it.
        </p>
        <p className="news-muted mb-8 text-ui">
          We are exploring a human-reviewed business briefing pilot, not selling access to
          these public endpoints. No paid plan or guaranteed delivery schedule is available.{' '}
          <Link to="/briefings" className="news-link underline underline-offset-4">Explore the briefing pilot</Link>.
        </p>

        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
          Data from CSP Latvia, Eurostat, ECB, Elering, data.gov.lv and Open-Meteo.
          Check the original provider's attribution, licensing and hosted-service terms before reuse.
          Built by <a href="https://naurolabs.com" style={{ color: 'var(--text-secondary)' }}>NauroLabs</a>.
        </p>
      </main>
    </div>
  );
}
