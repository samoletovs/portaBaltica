import { Link, useLocation } from 'react-router-dom';
import type { DashboardSection } from '../types';
import { useTheme } from '../ThemeContext';
import { useOverflowFade } from '../utils/useOverflowFade';
import type { Country } from '../CountryContext';
import { useLayoutEffect } from 'react';
import { Wordmark } from './Wordmark';

const SECTIONS: { id: DashboardSection | 'all' | 'news'; label: string; path: string }[] = [
  { id: 'news', label: 'News', path: '/' },
  { id: 'all', label: 'All sectors', path: '/data' },
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
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();

  return (
    <header className="desk-masthead">
      <Link to="/" className="desk-wordmark text-callout sm:text-lead font-semibold" aria-label="portaBaltica home">
        <span className="desk-brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <Wordmark />
      </Link>
      <nav className="desk-primary-nav text-ui" aria-label="Primary">
        <Link to="/" aria-current={pathname === '/' ? 'page' : undefined}>The journal</Link>
        <Link to="/data" aria-current={pathname === '/data' || pathname.startsWith('/data/') ? 'page' : undefined}>Dashboard</Link>
        <Link to="/explore" aria-current={pathname === '/explore' || pathname.startsWith('/indicator/') ? 'page' : undefined}>Data explorer</Link>
        <Link to="/briefings" aria-current={pathname === '/briefings' ? 'page' : undefined}>Business briefings</Link>
      </nav>
      <button
        type="button"
        onClick={toggle}
        className="desk-theme-button text-ui"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          {theme === 'dark' ? (
            <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
          ) : (
            <path d="M20 15.2A9 9 0 0 1 8.8 4 9 9 0 1 0 20 15.2Z" />
          )}
        </svg>
      </button>
    </header>
  );
}

export function DashboardNav({ active, country }: { active: DashboardSection | 'all'; country: Country }) {
  const [ref, fade] = useOverflowFade<HTMLElement>();
  useLayoutEffect(() => {
    const nav = ref.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !selected || nav.scrollWidth <= nav.clientWidth) return;
    const bounds = nav.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    nav.scrollLeft += item.left - bounds.left - (bounds.width - item.width) / 2;
  }, [active, ref]);
  return (
    <nav ref={ref} className={`dashboard-sector-nav text-ui ${fade}`} aria-label="Dashboard sectors">
      {SECTIONS.filter(section => section.id !== 'news').map(section => (
        <Link key={section.id} to={`${section.path}?country=${country}`} aria-current={active === section.id ? 'page' : undefined}>
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
