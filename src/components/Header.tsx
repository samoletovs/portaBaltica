import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { DashboardSection } from '../types';
import { useTheme } from '../ThemeContext';
import { useCountry, COUNTRY_INFO, type Country } from '../CountryContext';
import { useFilter, YEAR_OPTIONS, type YearRange } from '../FilterContext';

const SECTIONS: { id: DashboardSection | 'all' | 'news'; label: string; path: string }[] = [
  { id: 'news', label: 'News', path: '/' },
  { id: 'all', label: 'Overview', path: '/data' },
  { id: 'economy', label: 'Economy', path: '/data/economy' },
  { id: 'labour', label: 'Labour', path: '/data/labour' },
  { id: 'trade', label: 'Trade', path: '/data/trade' },
  { id: 'government', label: 'Government', path: '/data/government' },
  { id: 'energy', label: 'Energy', path: '/data/energy' },
  { id: 'property', label: 'Property', path: '/data/property' },
  { id: 'environment', label: 'Environment', path: '/data/environment' },
  { id: 'business', label: 'Business', path: '/data/business' },
  { id: 'maritime', label: 'Maritime', path: '/data/maritime' },
];

export function Header() {
  const [clock, setClock] = useState(new Date());
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const { country, setCountry, timezone, tzAbbr } = useCountry();
  const { years, setYears } = useFilter();
  const section = location.pathname.startsWith('/data/')
    ? location.pathname.slice('/data/'.length).split('/')[0]
    : null;
  const activeSection = location.pathname === '/data'
    ? 'all'
    : section && SECTIONS.some((item) => item.id === section)
      ? section
      : location.pathname.startsWith('/data') ||
          location.pathname.startsWith('/indicator') ||
          location.pathname.startsWith('/api-docs')
        ? 'all'
        : 'news';

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header>
      <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {/* Top bar */}
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-callout font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              porta<span style={{ color: '#0ea5e9' }}>Baltica</span>
            </Link>
            <span className="hidden sm:inline text-caption font-normal" style={{ color: 'var(--text-tertiary)' }}>Baltic news & data intelligence</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-caption font-mono" style={{ color: 'var(--text-secondary)' }}>
              {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone })}
              <span style={{ color: 'var(--text-muted)' }} className="ml-1">{tzAbbr}</span>
            </span>
            {/* Country selector */}
            <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-card)' }}>
              {(Object.keys(COUNTRY_INFO) as Country[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCountry(c)}
                  className="px-2 py-1 text-caption transition-colors"
                  style={{
                    background: country === c ? 'var(--text-secondary)' : 'var(--bg-card)',
                    color: country === c ? '#fff' : 'var(--text-secondary)',
                    fontWeight: country === c ? 500 : 400,
                  }}
                  aria-label={`Switch to ${COUNTRY_INFO[c].label}`}
                >
                  {COUNTRY_INFO[c].flag} {c}
                </button>
              ))}
            </div>
            {/* Date range selector */}
            <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-card)' }} aria-label="Date range filter">
              {YEAR_OPTIONS.map((y: YearRange) => (
                <button
                  key={y}
                  onClick={() => setYears(y)}
                  className="px-2 py-1 text-caption transition-colors"
                  style={{
                    background: years === y ? 'var(--text-secondary)' : 'var(--bg-card)',
                    color: years === y ? '#fff' : 'var(--text-secondary)',
                    fontWeight: years === y ? 500 : 400,
                  }}
                  aria-label={`Show ${y} year${y > 1 ? 's' : ''} of data`}
                  aria-pressed={years === y}
                >
                  {y}Y
                </button>
              ))}
            </div>
            <button
              onClick={toggle}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              <span className="text-ui">{theme === 'dark' ? '☀️' : '🌙'}</span>
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <nav className="flex gap-0 -mb-px overflow-x-auto" aria-label="Site sections">
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to={s.path}
              className="px-4 py-2.5 text-ui whitespace-nowrap transition-colors border-b-2"
              style={{
                borderColor: activeSection === s.id ? 'var(--text-secondary)' : 'transparent',
                color: activeSection === s.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: activeSection === s.id ? 500 : 400,
              }}
              aria-current={activeSection === s.id ? 'page' : undefined}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
