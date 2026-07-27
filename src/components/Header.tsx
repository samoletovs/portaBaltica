import { useState, useEffect } from 'react';
import type { DashboardSection } from '../types';
import { useTheme } from '../ThemeContext';
import { useCountry, COUNTRY_INFO, type Country } from '../CountryContext';
import { useFilter, YEAR_OPTIONS, type YearRange } from '../FilterContext';

interface HeaderProps {
  lastUpdated: Date | null;
  activeSection: DashboardSection | 'all';
  onSectionChange: (section: DashboardSection | 'all') => void;
}

const SECTIONS: { id: DashboardSection | 'all'; label: string }[] = [
  { id: 'all', label: 'Overview' },
  { id: 'economy', label: 'Economy' },
  { id: 'labour', label: 'Labour' },
  { id: 'trade', label: 'Trade' },
  { id: 'government', label: 'Government' },
  { id: 'energy', label: 'Energy' },
  { id: 'property', label: 'Property' },
  { id: 'environment', label: 'Environment' },
  { id: 'business', label: 'Business' },
  { id: 'maritime', label: 'Maritime' },
];

export function Header({ lastUpdated, activeSection, onSectionChange }: HeaderProps) {
  const [clock, setClock] = useState(new Date());
  const { theme, toggle } = useTheme();
  const { country, setCountry, timezone, tzAbbr } = useCountry();
  const { years, setYears } = useFilter();

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
            <h1 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              porta<span style={{ color: '#0ea5e9' }}>Baltica</span>
            </h1>
            <span className="hidden sm:inline text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>Baltic data intelligence</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone })}
              <span style={{ color: 'var(--text-muted)' }} className="ml-1">{tzAbbr}</span>
            </span>
            {lastUpdated && (
              <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-tertiary)' }}>
                Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {/* Country selector */}
            <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-card)' }}>
              {(Object.keys(COUNTRY_INFO) as Country[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCountry(c)}
                  className="px-2 py-1 text-xs transition-colors"
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
                  className="px-2 py-1 text-xs transition-colors"
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
              <span className="text-sm">{theme === 'dark' ? '☀️' : '🌙'}</span>
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <nav className="flex gap-0 -mb-px overflow-x-auto" aria-label="Dashboard sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => onSectionChange(s.id)}
              className="px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2"
              style={{
                borderColor: activeSection === s.id ? 'var(--text-secondary)' : 'transparent',
                color: activeSection === s.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: activeSection === s.id ? 500 : 400,
              }}
              aria-current={activeSection === s.id ? 'page' : undefined}
              aria-label={`Show ${s.label} section`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
