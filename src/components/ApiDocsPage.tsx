import { useNavigate } from 'react-router-dom';

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/economy-data', params: '?country=lv|ee|lt', description: 'Live electricity prices, ECB exchange rates, PxWeb macro indicators, business pulse', cache: '30 min' },
  { method: 'GET', path: '/api/environment-data', params: '?country=lv|ee|lt', description: 'Weather for 4 cities, air quality, capital city population', cache: '15 min' },
  { method: 'GET', path: '/api/historical-data', params: '?indicator=gdp&years=5', description: '24 indicators with time series: GDP, salary, CPI, unemployment, house prices, exports, imports, PPI, trade balance, etc.', cache: '1 hour' },
  { method: 'GET', path: '/api/baltic-compare', params: '?indicator=gdp&years=5', description: 'Latvia vs Estonia vs Lithuania from Eurostat: GDP, unemployment, inflation, house prices, interest rates, debt/GDP, construction, consumer confidence', cache: '1 hour' },
  { method: 'GET', path: '/api/property-data', params: '', description: 'Construction permits by municipality, building energy profile', cache: '1 hour' },
  { method: 'GET', path: '/api/port-data', params: '', description: 'Maritime: ship visits, ferry passengers, cargo volumes for 3 Latvian ports', cache: '1 hour' },
  { method: 'GET', path: '/api/business-search', params: '?q=TERM', description: 'Search 195K+ beneficial owners (UBO) by company registration number or surname', cache: '5 min' },
  { method: 'GET', path: '/api/address-search', params: '?q=TERM', description: 'Search 608K+ Latvian addresses with GPS coordinates', cache: '5 min' },
  { method: 'GET', path: '/api/eu-funds', params: '', description: 'EU Recovery & Resilience Fund: 955 projects with status', cache: '1 hour' },
  { method: 'GET', path: '/api/ai-insights', params: '', description: 'Real-time AI-generated insights from live data analysis', cache: '15 min' },
  { method: 'GET', path: '/api/system-status', params: '', description: 'System health: 7 data source checks with latency, API inventory', cache: '1 min' },
];

const INDICATORS = [
  'gdp', 'salary', 'cpi', 'unemployment', 'house_prices', 'retail_sales', 'industrial', 'population',
  'hotel_occupancy', 'tourist_arrivals', 'gov_revenue', 'gov_debt', 'exports', 'imports', 'biz_confidence',
  'construction_output', 'new_vehicles', 'wages_industry', 'wages_it', 'energy_price_gas', 'building_permits',
  'renewable_share', 'ppi', 'trade_balance',
];

export function ApiDocsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <button onClick={() => navigate('/')} className="text-sm mb-4 inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
          ← Back to dashboard
        </button>

        <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>API documentation</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
          All endpoints are free and public. No authentication required. Data sourced from government open data (CC0/CC-BY).
          Base URL: <code className="font-mono text-xs px-1 py-0.5 rounded" style={{ background: 'var(--bg-card-hover)' }}>https://portabaltica.naurolabs.com</code>
        </p>

        {/* Endpoints */}
        <div className="space-y-3 mb-12">
          {API_ENDPOINTS.map((ep) => (
            <div key={ep.path} className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-secondary)' }}>
                  {ep.method}
                </span>
                <code className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{ep.path}</code>
                {ep.params && <code className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>{ep.params}</code>}
              </div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-body)' }}>{ep.description}</p>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Cache: {ep.cache}</span>
            </div>
          ))}
        </div>

        {/* Available indicators */}
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Available indicators</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Use with <code className="font-mono text-xs">/api/historical-data?indicator=NAME&years=5</code>
        </p>
        <div className="flex flex-wrap gap-2 mb-12">
          {INDICATORS.map((ind) => (
            <code key={ind} className="text-xs font-mono px-2 py-1 rounded cursor-pointer" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-body)' }}
              onClick={() => navigate(`/indicator/${ind}`)}>
              {ind}
            </code>
          ))}
        </div>

        {/* Pricing */}
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Free</p>
            <p className="text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>€0</p>
            <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>All dashboard data</li>
              <li>24 historical indicators</li>
              <li>Baltic comparison charts</li>
              <li>AI insights</li>
              <li>3 country support</li>
            </ul>
          </div>
          <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '2px solid #2563eb' }}>
            <p className="text-sm font-medium mb-1" style={{ color: '#2563eb' }}>Pro</p>
            <p className="text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>€15<span className="text-sm font-normal" style={{ color: 'var(--text-tertiary)' }}>/month</span></p>
            <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>Everything in Free</li>
              <li>Email alerts on changes</li>
              <li>CSV data export</li>
              <li>Custom indicator watchlist</li>
              <li>30+ day history</li>
            </ul>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>Coming soon</p>
          </div>
          <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Enterprise</p>
            <p className="text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>€49<span className="text-sm font-normal" style={{ color: 'var(--text-tertiary)' }}>/month</span></p>
            <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>Everything in Pro</li>
              <li>REST API access (1000 calls/hr)</li>
              <li>Webhook notifications</li>
              <li>White-label embed</li>
              <li>Priority support</li>
            </ul>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>Coming soon</p>
          </div>
        </div>

        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Data from CSP Latvia, Eurostat, ECB, Elering, data.gov.lv, Open-Meteo. All government data is published under CC0 or CC-BY licenses.
          Built by <a href="https://naurolabs.com" style={{ color: 'var(--text-secondary)' }}>NauroLabs</a>.
        </p>
      </div>
    </div>
  );
}
