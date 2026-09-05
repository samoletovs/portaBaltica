import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { PORTS, DASHBOARD_SECTIONS } from './types';
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

import { useParams, useNavigate, Link } from 'react-router-dom';
import { useCountry } from './CountryContext';
import { usePageMeta } from './newsroom/usePageMeta';
import { usePriceRefresh } from './hooks/usePriceRefresh';

interface PortWeatherData {
  port: typeof PORTS[0];
  marine: MarineWeatherForecast;
  weather: PortWeather | null;
}

const VALID_SECTIONS: ReadonlySet<string> = new Set(DASHBOARD_SECTIONS);

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
    'Live Baltic open data: 71 indicators across economy, trade, energy, property, environment, government and maritime, for Latvia, Estonia and Lithuania. Every figure is traceable to the dataset it came from.',
};

export default function App() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const activeSection: DashboardSection | 'all' =
    section && VALID_SECTIONS.has(section) ? section as DashboardSection : 'all';
  const { country } = useCountry();

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

  const refreshEconomy = useCallback(async (signal: AbortSignal, initial: boolean) => {
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
  }, [country]);
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

    loadMaritime();
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
            {/*
              `Link`, not `<a>`. A bare anchor from here reloads the whole
              application to reach a page the bundle already contains — measured
              at 1 document request and ~1.4MB of assets re-fetched versus 0 and
              one lazy chunk. It is the same fault this footer's `Follow` link
              would have had if it had copied its neighbour.
            */}
            <Link to="/api-docs" className="dash-hover-body">API docs &amp; pricing</Link>
            {' · '}
            {/*
              The dashboard's only route to a feed.

              Measured before this existed, against production at
              2026-08-28T12:25:08Z: `/follow` was three clicks from `/data`, and
              `/weekly` and `/feed.json` were unreachable within three, because
              every route out of the dashboard ran through the wordmark to the
              front page and then through an article. This footer had a link to
              every upstream data provider and none back to our own journalism.
            */}
            <Link to="/follow" className="dash-hover-body">Follow</Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
