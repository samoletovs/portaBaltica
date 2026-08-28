import { useNavigate } from 'react-router-dom';
import { usePageMeta } from '../newsroom/usePageMeta';

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/economy-data', params: '?country=lv|ee|lt', description: 'Live electricity prices, ECB exchange rates, PxWeb macro indicators, business pulse', cache: '30 min' },
  { method: 'GET', path: '/api/environment-data', params: '?country=lv|ee|lt', description: 'Weather for 4 cities, air quality, capital-region population', cache: '15 min' },
  { method: 'GET', path: '/api/historical-data', params: '?indicator=gdp&years=5', description: '24 Latvian indicators with time series from CSP PxWeb, falling back to Eurostat where a national table is unavailable. The `source` field always names the provider that answered.', cache: '1 hour' },
  { method: 'GET', path: '/api/baltic-compare', params: '?indicator=gdp&years=5', description: 'Latvia vs Estonia vs Lithuania from Eurostat across 71 indicators. Add ?list=1 for the full catalogue. Responses carry an `assumptions` array, which is empty unless the API had to guess which slice of a Eurostat cube to read.', cache: '1 hour' },
  { method: 'GET', path: '/api/power-prices', params: '', description: 'Nord Pool day-ahead prices for all four Baltic-region bidding zones (EE, LV, LT, FI) with the spread between them and whether the market is currently coupled', cache: '15 min' },
  { method: 'GET', path: '/api/property-data', params: '', description: 'Construction permits by municipality, building energy profile', cache: '1 hour' },
  { method: 'GET', path: '/api/port-data', params: 'country=LV|EE|LT', description: 'Baltic port statistics from Eurostat: cargo tonnage, sea passengers, vessel arrivals, quarterly', cache: '6 hours' },
  { method: 'GET', path: '/api/business-search', params: '?q=TERM', description: 'Search 195K+ beneficial owners (UBO) by company registration number or surname', cache: '5 min' },
  { method: 'GET', path: '/api/address-search', params: '?q=TERM', description: 'Search 608K+ Latvian addresses with GPS coordinates', cache: '5 min' },
  { method: 'GET', path: '/api/eu-funds', params: '', description: 'EU Recovery & Resilience Fund: the 20 most recent projects with status, plus the full project total', cache: '1 hour' },
  { method: 'GET', path: '/api/ai-insights', params: '', description: 'Real-time AI-generated insights from live data analysis', cache: '15 min' },
  { method: 'GET', path: '/api/system-status', params: '', description: 'System health: 8 data source checks with latency and what each one powers, plus API inventory', cache: '1 min' },
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
      'Twelve public JSON endpoints over Baltic open data: Eurostat indicators for Latvia, Estonia and Lithuania, Nord Pool electricity prices, port statistics, and searchable Latvian business and address registers.',
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
          All endpoints are free and public. No authentication required. Data sourced from government open data (CC0/CC-BY).
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
            <code key={ind} className="text-caption font-mono px-2 py-1 rounded cursor-pointer" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-body)' }}
              onClick={() => navigate(`/indicator/${ind}`)}>
              {ind}
            </code>
          ))}
        </div>

        {/* Pricing */}
        <h2 className="balance-text text-title font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <p className="text-ui mb-1" style={{ color: 'var(--text-primary)' }}>Free</p>
            <p className="text-title font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>€0</p>
            <ul className="text-caption space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>All dashboard data</li>
              <li>24 Latvian indicators from CSP PxWeb</li>
              <li>71 Baltic comparison indicators from Eurostat</li>
              <li>CSV and JSON export on every series</li>
              <li>Full history, not a rolling window</li>
              <li>AI insights</li>
              <li>3 country support</li>
            </ul>
          </div>
          <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '2px solid var(--news-accent)' }}>
            <p className="text-ui mb-1" style={{ color: 'var(--news-accent)' }}>Pro</p>
            <p className="text-title font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>€15<span className="text-ui font-normal" style={{ color: 'var(--text-tertiary)' }}>/month</span></p>
            <ul className="text-caption space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>Everything in Free</li>
              <li>Email alerts on changes</li>
              <li>Custom indicator watchlist</li>
            </ul>
            <p className="text-caption mt-3" style={{ color: 'var(--text-tertiary)' }}>Coming soon</p>
          </div>
          <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <p className="text-ui mb-1" style={{ color: 'var(--text-primary)' }}>Enterprise</p>
            <p className="text-title font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>€49<span className="text-ui font-normal" style={{ color: 'var(--text-tertiary)' }}>/month</span></p>
            <ul className="text-caption space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>Everything in Pro</li>
              <li>REST API access (1000 calls/hr)</li>
              <li>Webhook notifications</li>
              <li>White-label embed</li>
              <li>Priority support</li>
            </ul>
            <p className="text-caption mt-3" style={{ color: 'var(--text-tertiary)' }}>Coming soon</p>
          </div>
        </div>

        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
          Data from CSP Latvia, Eurostat, ECB, Elering, data.gov.lv, Open-Meteo. All government data is published under CC0 or CC-BY licenses.
          Built by <a href="https://naurolabs.com" style={{ color: 'var(--text-secondary)' }}>NauroLabs</a>.
        </p>
      </main>
    </div>
  );
}
