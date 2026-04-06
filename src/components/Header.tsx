import { useState, useEffect } from 'react';
import type { DashboardSection } from '../types';

interface HeaderProps {
  lastUpdated: Date | null;
  activeSection: DashboardSection | 'all';
  onSectionChange: (section: DashboardSection | 'all') => void;
}

const SECTIONS: { id: DashboardSection | 'all'; label: string }[] = [
  { id: 'all', label: 'Overview' },
  { id: 'economy', label: 'Economy' },
  { id: 'property', label: 'Property' },
  { id: 'environment', label: 'Environment' },
  { id: 'business', label: 'Business' },
  { id: 'maritime', label: 'Maritime' },
];

export function Header({ lastUpdated, activeSection, onSectionChange }: HeaderProps) {
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="border-b border-slate-800/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Top bar */}
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-white tracking-tight">
              Porta Baltica
            </h1>
            <span className="hidden sm:inline text-xs text-slate-500 font-normal">Baltic data intelligence</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono text-slate-400">
              {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Riga' })}
              <span className="text-slate-600 ml-1">EET</span>
            </span>
            {lastUpdated && (
              <span className="text-xs text-slate-500 hidden sm:inline">
                Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* Section tabs */}
        <nav className="flex gap-0 -mb-px overflow-x-auto" aria-label="Dashboard sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => onSectionChange(s.id)}
              className={`px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 ${
                activeSection === s.id
                  ? 'border-slate-400 text-white font-medium'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
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
