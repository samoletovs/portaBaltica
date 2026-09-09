import { lazy, Suspense, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { PORTS, DASHBOARD_SECTIONS } from './types';
import type { MarineWeatherForecast, PortWeather, PortDataResponse, DashboardSection, EconomyData, PropertyData, EnvironmentData, EUFundsData } from './types';
import { fetchAllWeather, fetchPortData, fetchEconomyData, fetchPropertyData, fetchEnvironmentData, fetchEUFunds } from './api';
import { OnboardingTutorial } from './components/OnboardingTutorial';
import { InsightsBanner } from './components/InsightsBanner';
import { SystemStatusFooter } from './components/SystemStatusFooter';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RESEARCH_SECTIONS } from './utils/researchCatalog';
import { DashboardNav } from './components/Header';
import { useCountryFromQuery } from './hooks/useCountryFromQuery';
import { useScrollCollection } from './motion/useScrollChoreography';

import { useParams, useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { useCountry } from './CountryContext';
import { usePageMeta } from './newsroom/usePageMeta';
import { usePriceRefresh } from './hooks/usePriceRefresh';
import { DataTicker } from './components/DataTicker';

const EconomyTile = lazy(() => import('./components/EconomyTile').then(module => ({ default: module.EconomyTile })));
const TradeTile = lazy(() => import('./components/TradeTile').then(module => ({ default: module.TradeTile })));
const GovernmentTile = lazy(() => import('./components/GovernmentTile').then(module => ({ default: module.GovernmentTile })));
const LabourTile = lazy(() => import('./components/LabourTile').then(module => ({ default: module.LabourTile })));
const EnergyTile = lazy(() => import('./components/EnergyTile').then(module => ({ default: module.EnergyTile })));
const PropertyTile = lazy(() => import('./components/PropertyTile').then(module => ({ default: module.PropertyTile })));
const EnvironmentTile = lazy(() => import('./components/EnvironmentTile').then(module => ({ default: module.EnvironmentTile })));
const MaritimeTile = lazy(() => import('./components/MaritimeTile').then(module => ({ default: module.MaritimeTile })));
const BusinessTile = lazy(() => import('./components/BusinessTile').then(module => ({ default: module.BusinessTile })));

interface PortWeatherData {
  port: typeof PORTS[0];
  marine: MarineWeatherForecast;
  weather: PortWeather | null;
}

const VALID_SECTIONS: ReadonlySet<string> = new Set(DASHBOARD_SECTIONS);

/**
 * The anchor a section is scrolled to.
 *
 * A wrapper rather than an id on the tile itself, because the tiles render
 * their own `<section>` and three of them belong to another workstream. The
 * `dash-section` class leaves breathing room above a fragment-link target.
 *
 * It is also a blast radius. The only error boundary on this site is at the
 * root, so one tile that threw replaced the whole dashboard with "Something
 * went wrong" — nine sections lost to one bad payload from one upstream, on a
 * site whose data comes from eleven of them and which is otherwise built
 * throughout to keep working when one is down. Twice while writing this change
 * a malformed response did exactly that. A section that fails now says so in
 * its own place, and the other eight keep their data.
 */
function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="dash-section">
      <div className="dashboard-sector-rule" data-scroll-rule="" aria-hidden="true" />
      <ErrorBoundary
        fallback={() => (
          <div
            className="rounded-xl p-4 text-ui"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}
          >
            This section could not be displayed. The rest of the dashboard is unaffected.
          </div>
        )}
      >
        <Suspense fallback={<div className="dashboard-section-loading text-ui" role="status">Loading this sector…</div>}>
          {children}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

/**
 * What each dashboard URL is, for the document head.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * `App.tsx` set no page metadata, so every `/data*` URL inherited the static
 * shell's head — including its `<link rel="canonical" href="https://portabaltica.naurolabs.com">`.
 * Measured in a rendering Chromium against production at 2026-08-28T13:12:28Z:
 * all ten of `/data` and `/data/{9 sections}` came back
 * `canonical=/  DISOWNS ITSELF`, with the generic site title, while the article
 * page beside them resolved to itself.
 *
 * Ten of the twenty non-article URLs in our own sitemap were therefore
 * submitted for indexing by a document that told the crawler the canonical
 * version of it was the home page. The sitemap said "index this"; the page
 * said "no, index that instead". Nothing was red, because a canonical is only
 * read by machines that never report back.
 *
 * The descriptions are per section rather than one template with the label
 * substituted, because a search result is the only part of this dashboard most
 * people will ever read.
 */
const SECTION_META: Record<DashboardSection, { title: string; description: string }> = {
  economy: {
    title: 'Economy',
    description:
      'GDP, inflation, wages and retail trade for Latvia, Estonia and Lithuania, from Eurostat and the national statistics offices, with the source named beside every series.',
  },
  trade: {
    title: 'Trade',
    description:
      'Exports, imports and the goods and services balance across the three Baltic states, quarterly, traceable to the Eurostat cube each figure came from.',
  },
  government: {
    title: 'Government',
    description:
      'Government debt, revenue and expenditure for the Baltic states, alongside EU Recovery Fund projects and their status.',
  },
  labour: {
    title: 'Labour',
    description:
      'Unemployment, hourly labour cost and minimum wage across Latvia, Estonia and Lithuania, with each series shown against its own basis.',
  },
  energy: {
    title: 'Energy',
    description:
      'Nord Pool day-ahead electricity prices for all four Baltic-region bidding zones, the spread between them, and household and industrial energy prices.',
  },
  property: {
    title: 'Property',
    description:
      'House prices, construction output and building permits for the Baltic states, with Latvian energy certificates and cadastral data underneath.',
  },
  environment: {
    title: 'Environment',
    description:
      'Weather, air quality on the European AQI bands, greenhouse gas emissions and population for the Baltic region.',
  },
  business: {
    title: 'Business',
    description:
      'Company registrations and bankruptcies across the Baltic states, with searchable Latvian beneficial-ownership and address registers.',
  },
  maritime: {
    title: 'Maritime',
    description:
      'Cargo tonnage, sea passengers and vessel arrivals at Baltic ports from Eurostat, quarterly, with live sea state at the Latvian ports.',
  },
};

const OVERVIEW_META = {
  title: 'The dashboard',
  description:
    'Baltic open data across economy, trade, energy, property, environment, government and maritime, for Latvia, Estonia and Lithuania. Every figure is traceable to the dataset it came from.',
};

export default function App() {
  const root = useRef<HTMLElement>(null);
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useCountryFromQuery();
  const activeSection: DashboardSection | 'all' =
    section && VALID_SECTIONS.has(section) ? section as DashboardSection : 'all';
  const { country } = useCountry();
  useScrollCollection(root, '.dash-card, [data-scroll-rule]', `${activeSection}:${country}`);

  // The canonical is the load-bearing half. `activeSection` falls back to
  // 'all' for an unknown section, so `/data/not-a-section` — which the SPA
  // fallback answers 200 for, like every route here — declares `/data` as its
  // canonical rather than inventing one for itself.
  const meta = activeSection === 'all' ? OVERVIEW_META : SECTION_META[activeSection];
  usePageMeta({
    title: `${meta.title} | portaBaltica`,
    description: meta.description,
    canonicalPath: activeSection === 'all' ? '/data' : `/data/${activeSection}`,
  });

  // Bookmarks from the earlier combined view still open the selected measure.
  // An explicit tools view, however, now belongs to the dashboard.
  if (params.has('indicator') && params.get('view') !== 'tools' && params.get('view') !== 'dashboard') {
    const next = new URLSearchParams(params);
    if (activeSection !== 'all') next.set('section', activeSection);
    next.delete('view');
    return <Navigate to={`/explore?${next.toString()}`} replace />;
  }
  const explorerQuery = new URLSearchParams({ country });
  if (activeSection !== 'all') explorerQuery.set('section', activeSection);

  return (
    <main id="main" className="dashboard-surface" ref={root}>
      <header className="dashboard-heading">
        <div>
          <h1 className="text-display md:text-masthead news-fg">
            {activeSection === 'all' ? 'The Baltic dashboard' : `${RESEARCH_SECTIONS[activeSection].title} dashboard`}
          </h1>
          <p className="text-prose news-muted">
            {activeSection === 'all' ? 'All areas. One regional view.' : RESEARCH_SECTIONS[activeSection].tools}
          </p>
          <p className="text-ui news-subtle">Scan the latest available observations, or choose a sector. Dates and sources travel with each measure.</p>
        </div>
        <div className="dashboard-heading-actions">
          <Link className="lab-link text-ui" to={`/explore?${explorerQuery.toString()}`}>Explore one measure ↗</Link>
          <OnboardingTutorial autoOpen={false} activeSection={activeSection} onSectionChange={next =>
            navigate(`/data${next === 'all' ? '' : `/${next}`}?country=${country}`)
          } />
        </div>
      </header>
      <DashboardNav active={activeSection} country={country} />
      <SectorTools activeSection={activeSection} />
    </main>
  );
}

function SectorTools({ activeSection }: { activeSection: DashboardSection | 'all' }) {
  const { country } = useCountry();
  const [marketOpen, setMarketOpen] = useState(true);
  // Maritime data (existing)
  const [portData, setPortData] = useState<PortWeatherData[]>([]);
  const [portStats, setPortStats] = useState<PortDataResponse | null>(null);
  const [maritimeLoading, setMaritimeLoading] = useState(true);

  // New data sections
  const [economyData, setEconomyData] = useState<EconomyData | null>(null);
  const [propertyData, setPropertyData] = useState<PropertyData | null>(null);
  const [environmentData, setEnvironmentData] = useState<EnvironmentData | null>(null);
  const [economyLoading, setEconomyLoading] = useState(true);
  const [propertyLoading, setPropertyLoading] = useState(true);
  const [environmentLoading, setEnvironmentLoading] = useState(true);

  // Phase 2: Business Intelligence
  const [euFunds, setEuFunds] = useState<EUFundsData | null>(null);
  const [euLoading, setEuLoading] = useState(true);

  const refreshEconomy = useCallback(async (signal: AbortSignal, initial: boolean) => {
    if (activeSection !== 'all' && activeSection !== 'economy') return;
    if (initial) { setEconomyData(null); setEconomyLoading(true); }
    else setEconomyData(previous => previous ? { ...previous, electricityCurrent: null } : null);
    try {
      const data = await fetchEconomyData(country.toLowerCase(), signal);
      if (!signal.aborted) {
        // This tile has no last-good badge; do not label a fallback price as fresh.
        setEconomyData(data?.priceSchedule?.stale ? { ...data, electricityCurrent: null } : data);
      }
    } catch { /* Keep the current price absent; retain dated series and other indicators. */ }
    finally { if (!signal.aborted) setEconomyLoading(false); }
  }, [country, activeSection]);
  usePriceRefresh(refreshEconomy);

  // Load all data in parallel
  useEffect(() => {
    let cancelled = false;

    // Maritime (existing flow)
    async function loadMaritime() {
      setMaritimeLoading(true);
      try {
        const [weather, stats] = await Promise.all([
          fetchAllWeather().catch(() => []),
          fetchPortData(country).catch(() => null),
        ]);
        if (cancelled) return;
        setPortData(weather);
        setPortStats(stats);
      } catch { /* non-critical */ } finally {
        if (!cancelled) setMaritimeLoading(false);
      }
    }

    // Property
    async function loadProperty() {
      setPropertyLoading(true);
      try {
        const data = await fetchPropertyData();
        if (!cancelled) setPropertyData(data);
      } catch { /* non-critical */ } finally {
        if (!cancelled) setPropertyLoading(false);
      }
    }

    // Environment
    async function loadEnvironment() {
      setEnvironmentLoading(true);
      try {
        const data = await fetchEnvironmentData(country.toLowerCase());
        if (!cancelled) setEnvironmentData(data);
      } catch { /* non-critical */ } finally {
        if (!cancelled) setEnvironmentLoading(false);
      }
    }

    // Phase 2: EU Funds
    async function loadEUFunds() {
      setEuLoading(true);
      try {
        const data = await fetchEUFunds();
        if (!cancelled) setEuFunds(data);
      } catch { /* non-critical */ } finally {
        if (!cancelled) setEuLoading(false);
      }
    }

    if (activeSection === 'all' || activeSection === 'maritime') void loadMaritime();
    if (activeSection === 'all' || activeSection === 'property') void loadProperty();
    if (activeSection === 'all' || activeSection === 'environment') void loadEnvironment();
    if (activeSection === 'all' || activeSection === 'business') void loadEUFunds();

    return () => { cancelled = true; };
  }, [country, activeSection]);

  const show = (section: DashboardSection) => activeSection === 'all' || activeSection === section;

  return (
    <div className="desk-dashboard pt-6 pb-16">

        {activeSection === 'all' && (
          <>
            <details className="desk-market-snapshot text-ui" open={marketOpen} onToggle={event => setMarketOpen(event.currentTarget.open)}>
              <summary><span>Market snapshot</span> Prices, rates and headline indicators</summary>
              {marketOpen && <DataTicker />}
            </details>
            <InsightsBanner />
          </>
        )}

        {/* Dashboard sections.
            48px apart, `--space-2xl`, which DESIGN.md §1.2 names as the gap
            between dashboard sections. They were 32px apart while the blocks
            *inside* each section were 24px apart, so the boundary between
            "Economy & markets" and "Trade & tourism" was 8px more emphatic
            than the boundary between two cards — which is why the page read as
            one continuous block rather than as distinct subjects. */}
        <div className="space-y-12">
          {show('economy') && (
            <Section id="economy">
              <EconomyTile data={economyData} loading={economyLoading} />
            </Section>
          )}

          {show('trade') && (
            <Section id="trade">
              <TradeTile />
            </Section>
          )}

          {show('government') && (
            <Section id="government">
              <GovernmentTile />
            </Section>
          )}

          {show('labour') && (
            <Section id="labour">
              <LabourTile />
            </Section>
          )}

          {show('energy') && (
            <Section id="energy">
              <EnergyTile />
            </Section>
          )}

          {show('property') && (
            <Section id="property">
              <PropertyTile data={propertyData} loading={propertyLoading} />
            </Section>
          )}

          {show('environment') && (
            <Section id="environment">
              <EnvironmentTile data={environmentData} loading={environmentLoading} />
            </Section>
          )}

          {show('business') && (
            <Section id="business">
              <BusinessTile euFunds={euFunds} euLoading={euLoading} />
            </Section>
          )}

          {show('maritime') && (
            <Section id="maritime">
              <MaritimeTile
                portData={portData}
                stats={portStats}
                loading={maritimeLoading}
              />
            </Section>
          )}
        </div>

        {/* System Status */}
        <SystemStatusFooter />

        {/* Footer */}
        <section aria-label="Dashboard data sources" className="mt-12 pt-6 border-t dash-edge text-caption dash-subtle">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            <p>Economy — <a href="https://data.stat.gov.lv/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">CSP Latvia</a>, <a href="https://dashboard.elering.ee/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Elering</a>, <a href="https://www.ecb.europa.eu/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">ECB</a>, <a href="https://ec.europa.eu/eurostat" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Eurostat</a></p>
            <p>Business — <a href="https://data.gov.lv/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">data.gov.lv</a> (VID, UBO, BVKB · CC0)</p>
            <p>Environment — <a href="https://open-meteo.com/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Open-Meteo</a>, <a href="https://opendata.riga.lv/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Riga Open Data</a></p>
            <p>Maritime — <a href="https://open-meteo.com/en/docs/marine-weather-api" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Open-Meteo Marine</a>, <a href="https://ec.europa.eu/eurostat/web/transport/database" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Eurostat maritime</a></p>
          </div>
        </section>
    </div>
  );
}
