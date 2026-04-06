import { useParams, useNavigate } from 'react-router-dom';
import { IndicatorChart } from './IndicatorCard';
import { BalticCompareChart } from './BalticCompareChart';

// Map indicators to their Eurostat equivalent (if available)
const EUROSTAT_MAP: Record<string, string> = {
  gdp: 'gdp',
  unemployment: 'unemployment',
  cpi: 'inflation',
  house_prices: 'house_prices',
};

const INDICATOR_INFO: Record<string, { title: string; description: string; related: string[] }> = {
  gdp: {
    title: 'GDP Growth Rate',
    description: 'Gross Domestic Product quarterly growth rate, seasonally adjusted, compared to corresponding period of previous year. GDP measures the total economic output of Latvia.',
    related: ['salary', 'unemployment', 'industrial', 'retail_sales'],
  },
  salary: {
    title: 'Average Gross Salary',
    description: 'Average monthly gross wages and salaries across all sectors. Reflects the overall compensation level in the Latvian economy.',
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
    description: 'Total population of Latvia. Latvia has been experiencing population decline due to emigration and low birth rates.',
    related: ['unemployment', 'salary', 'gdp'],
  },
};

export function IndicatorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const info = id ? INDICATOR_INFO[id] : null;

  if (!id || !info) {
    return (
      <div className="min-h-screen">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <p className="text-slate-400">Unknown indicator.</p>
          <button onClick={() => navigate('/')} className="text-slate-300 underline mt-2 text-sm">← Back to dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate('/')}
          className="text-sm text-slate-400 hover:text-slate-200 mb-4 inline-flex items-center gap-1"
        >
          ← Back to dashboard
        </button>

        {/* Header */}
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          {info.title}
        </h1>
        <p className="text-slate-300 text-sm mb-6 max-w-2xl">{info.description}</p>

        {/* Main chart */}
        <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-6 mb-6">
          <IndicatorChart id={id} />
        </div>

        {/* Baltic comparison */}
        {EUROSTAT_MAP[id] && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-white mb-3">Baltic Comparison</h2>
            <BalticCompareChart indicator={EUROSTAT_MAP[id]} title={`${info.title} — Latvia vs Estonia vs Lithuania`} />
          </div>
        )}

        {/* Related indicators */}
        {info.related.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-white mb-3">Related Indicators</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {info.related.map((relId) => {
                const rel = INDICATOR_INFO[relId];
                if (!rel) return null;
                return (
                  <button
                    key={relId}
                    onClick={() => navigate(`/indicator/${relId}`)}
                    className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-3 text-left hover:border-slate-600/60 transition-colors"
                  >
                    <p className="text-sm font-medium text-white">{rel.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Click to explore →</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-xs text-slate-500 mt-8">
          Data from Latvia's Central Statistical Bureau (CSP) via PxWeb API. Updated according to CSP publication calendar.
          All data is publicly available under open license.
        </p>
      </div>
    </div>
  );
}
