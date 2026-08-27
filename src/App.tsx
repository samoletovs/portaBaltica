import { useState, useEffect, type ReactNode } from 'react';
import { PORTS } from './types';
import type { MarineWeatherForecast, PortWeather, PortDataResponse, DashboardSection, EconomyData, PropertyData, EnvironmentData, EUFundsData } from './types';
import { fetchAllWeather, fetchPortData, fetchEconomyData, fetchPropertyData, fetchEnvironmentData, fetchEUFunds } from './api';
import { OnboardingTutorial } from './components/OnboardingTutorial';
import { InsightsBanner } from './components/InsightsBanner';
import { SectionRail, type SectionLink } from './components/SectionRail';
import { EconomyTile } from './components/EconomyTile';
import { TradeTile } from './components/TradeTile';
import { GovernmentTile } from './components/GovernmentTile';
import { LabourTile } from './components/LabourTile';
import { EnergyTile } from './components/EnergyTile';
import { PropertyTile } from './components/PropertyTile';
import { EnvironmentTile } from './components/EnvironmentTile';
import { MaritimeTile } from './components/MaritimeTile';
import { BusinessTile } from './components/BusinessTile';
import { SystemStatusFooter } from './components/SystemStatusFooter';
import { ErrorBoundary } from './components/ErrorBoundary';

import { useParams, useNavigate } from 'react-router-dom';
import { useCountry } from './CountryContext';

interface PortWeatherData {
  port: typeof PORTS[0];
  marine: MarineWeatherForecast;
  weather: PortWeather;
}

const VALID_SECTIONS = new Set(['economy', 'trade', 'government', 'labour', 'energy', 'property', 'environment', 'business', 'maritime']);

/** The overview's sections, in the order they are rendered, for the rail. */
const SECTION_LINKS: SectionLink[] = [
  { id: 'economy', label: 'Economy' },
  { id: 'trade', label: 'Trade' },
  { id: 'government', label: 'Government' },
  { id: 'labour', label: 'Labour' },
  { id: 'energy', label: 'Energy' },
  { id: 'property', label: 'Property' },
  { id: 'environment', label: 'Environment' },
  { id: 'business', label: 'Business' },
  { id: 'maritime', label: 'Maritime' },
];

/**
 * The anchor a section is scrolled to.
 *
 * A wrapper rather than an id on the tile itself, because the tiles render
 * their own `<section>` and three of them belong to another workstream. The
 * `dash-section` class carries the `scroll-margin-top` that stops a jump
 * landing underneath the sticky rail (WCAG 2.2 SC 2.4.11).
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
        {children}
      </ErrorBoundary>
    </div>
  );
}

export default function App() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const activeSection: DashboardSection | 'all' =
    section && VALID_SECTIONS.has(section) ? section as DashboardSection : 'all';
  const { country } = useCountry();

  function setActiveSection(s: DashboardSection | 'all') {
    navigate(s === 'all' ? '/data' : `/data/${s}`, { replace: true });
  }

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

  // Track login
  useEffect(() => {
    fetch('/api/track-login', { method: 'POST' }).catch(() => {});
  }, []);

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

    // Economy
    async function loadEconomy() {
      setEconomyLoading(true);
      try {
        const data = await fetchEconomyData(country.toLowerCase());
        if (!cancelled) setEconomyData(data);
      } catch { /* non-critical */ } finally {
        if (!cancelled) setEconomyLoading(false);
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

    loadMaritime();
    loadEconomy();
    loadProperty();
    loadEnvironment();
    loadEUFunds();

    return () => { cancelled = true; };
  }, [country]);

  const show = (section: DashboardSection) => activeSection === 'all' || activeSection === section;

  // The dashboard had no page heading at all: it opened straight into a tile,
  // so it began a level below where every news page begins, and the highlighted
  // tab was the only thing telling you where you were. The h1 names the page and
  // the tiles stay h2 beneath it, so both halves of the site now start the same
  // way and at the same size.
  //
  // The dek deliberately does not name the active section. It did, and on a
  // single-section route that put the word "Maritime" immediately above a
  // heading reading "Maritime" — the section is already stated by the h2 below
  // and by the tab above, so saying it a third time was noise.
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <main id="main" className="pt-6 pb-16">

        <header className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <h1 className="balance-text text-headline sm:text-display font-semibold" style={{ color: 'var(--text-primary)' }}>
              Baltic data
            </h1>
            {/* The tour trigger rides in the heading row rather than in a strip
                of its own above the page, so it costs no vertical space at all
                — the version it replaces spent a full row on a button most
                readers never press. */}
            <OnboardingTutorial activeSection={activeSection} onSectionChange={setActiveSection} />
          </div>
          <p className="pretty-text mt-3 text-callout" style={{ color: 'var(--text-secondary)' }}>
            Live open data for Latvia, Estonia and Lithuania — the same series our reporting is
            written from, updated independently of it.
          </p>
        </header>

        {/* AI Insights */}
        <InsightsBanner />

        {/* The rail only earns its place on the overview. On a single-section
            route there is one thing to scroll through and nothing to jump to,
            and a navigation control that offers a choice of one is noise. */}
        {activeSection === 'all' && <SectionRail sections={SECTION_LINKS} />}

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
        <footer className="mt-12 pt-6 border-t dash-edge text-caption dash-subtle">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            <p>Economy — <a href="https://data.stat.gov.lv/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">CSP Latvia</a>, <a href="https://dashboard.elering.ee/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Elering</a>, <a href="https://www.ecb.europa.eu/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">ECB</a>, <a href="https://ec.europa.eu/eurostat" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Eurostat</a></p>
            <p>Business — <a href="https://data.gov.lv/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">data.gov.lv</a> (VID, UBO, BVKB · CC0)</p>
            <p>Environment — <a href="https://open-meteo.com/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Open-Meteo</a>, <a href="https://opendata.riga.lv/" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Riga Open Data</a></p>
            <p>Maritime — <a href="https://open-meteo.com/en/docs/marine-weather-api" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Open-Meteo Marine</a>, <a href="https://ec.europa.eu/eurostat/web/transport/database" className="dash-hover-fg" target="_blank" rel="noopener noreferrer">Eurostat maritime</a></p>
          </div>
          <p className="mt-4 dash-subtle">
            Built by <a href="https://naurolabs.com" className="dash-hover-body">NauroLabs</a>
            {' · '}
            <a href="/api-docs" className="dash-hover-body">API docs & pricing</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
