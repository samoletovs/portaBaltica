import { useState, useEffect } from 'react';
import type { DashboardSection } from '../types';

interface HeaderProps {
  lastUpdated: Date | null;
  activeSection: DashboardSection | 'all';
  onSectionChange: (section: DashboardSection | 'all') => void;
}

const SECTIONS: { id: DashboardSection | 'all'; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: '🌍' },
  { id: 'economy', label: 'Economy', icon: '📊' },
  { id: 'property', label: 'Property', icon: '🏗️' },
  { id: 'environment', label: 'Environment', icon: '🌤️' },
  { id: 'business', label: 'Business Intel', icon: '🔍' },
  { id: 'maritime', label: 'Maritime', icon: '⚓' },
];

export function Header({ lastUpdated, activeSection, onSectionChange }: HeaderProps) {
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="py-6 px-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-ocean-400">⚓</span> Porta Baltica
          </h1>
          <p className="text-ocean-300 text-sm mt-0.5">Baltic Open Data Intelligence</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-mono text-white">
            {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Riga' })}
          </p>
          <p className="text-xs text-ocean-400">
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
              : 'Loading...'}
          </p>
        </div>
      </div>

      {/* Section tabs */}
      <nav className="flex gap-1 bg-ocean-900/40 rounded-xl p-1 overflow-x-auto" aria-label="Dashboard sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => onSectionChange(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors ${
              activeSection === s.id
                ? 'bg-ocean-600 text-white font-medium'
                : 'text-ocean-400 hover:text-ocean-200 hover:bg-ocean-800/40'
            }`}
            aria-current={activeSection === s.id ? 'page' : undefined}
            aria-label={`Show ${s.label} section`}
          >
            <span>{s.icon}</span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}
