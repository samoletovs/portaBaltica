import { useState, useEffect } from 'react';
import { PORTS } from './types';
import type { MarineWeatherForecast, PortWeather, ShipVisit, FerryData, CargoData, CargoTurnover, DashboardSection, EconomyData, PropertyData, EnvironmentData, EUFundsData } from './types';
import { fetchAllWeather, fetchPortData, fetchEconomyData, fetchPropertyData, fetchEnvironmentData, fetchEUFunds } from './api';
import { Header } from './components/Header';
import { DataTicker } from './components/DataTicker';
import { InsightsBanner } from './components/InsightsBanner';
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

import { useParams, useNavigate } from 'react-router-dom';
import { useCountry } from './CountryContext';

interface PortWeatherData {
  port: typeof PORTS[0];
  marine: MarineWeatherForecast;
  weather: PortWeather;
}

const VALID_SECTIONS = new Set(['economy', 'trade', 'government', 'labour', 'energy', 'property', 'environment', 'business', 'maritime']);

export default function App() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const activeSection: DashboardSection | 'all' =
    section && VALID_SECTIONS.has(section) ? section as DashboardSection : 'all';
  const { country } = useCountry();

  function setActiveSection(s: DashboardSection | 'all') {
    navigate(s === 'all' ? '/' : `/${s}`, { replace: true });
  }

  // Maritime data (existing)
  const [portData, setPortData] = useState<PortWeatherData[]>([]);
  const [shipVisits, setShipVisits] = useState<ShipVisit[]>([]);
  const [ferryData, setFerryData] = useState<FerryData[]>([]);
  const [cargoData, setCargoData] = useState<CargoData[]>([]);
  const [cargoTurnover, setCargoTurnover] = useState<CargoTurnover[]>([]);
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

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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
        const [weather, govData] = await Promise.all([
          fetchAllWeather().catch(() => []),
          fetchPortData().catch(() => ({ shipVisits: [], ferryData: [], cargoData: [], cargoTurnover: [], fetchedAt: '' })),
        ]);
        if (cancelled) return;
        setPortData(weather);
        setShipVisits(govData.shipVisits);
        setFerryData(govData.ferryData);
        setCargoData(govData.cargoData);
        setCargoTurnover(govData.cargoTurnover ?? []);
      } catch { /* non-critical */ } finally {
        if (!cancelled) { setMaritimeLoading(false); setLastUpdated(new Date()); }
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

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <Header lastUpdated={lastUpdated} activeSection={activeSection} onSectionChange={setActiveSection} />
        <DataTicker />

        <main className="pt-6 pb-16">

        {/* AI Insights */}
        <InsightsBanner />

        {/* Dashboard sections */}
        <div className="space-y-8">
          {show('economy') && (
            <EconomyTile data={economyData} loading={economyLoading} />
          )}

          {show('trade') && (
            <TradeTile />
          )}

          {show('government') && (
            <GovernmentTile />
          )}

          {show('labour') && (
            <LabourTile />
          )}

          {show('energy') && (
            <EnergyTile />
          )}

          {show('property') && (
            <PropertyTile data={propertyData} loading={propertyLoading} />
          )}

          {show('environment') && (
            <EnvironmentTile data={environmentData} loading={environmentLoading} />
          )}

          {show('business') && (
            <BusinessTile euFunds={euFunds} euLoading={euLoading} />
          )}

          {show('maritime') && (
            <MaritimeTile
              portData={portData}
              shipVisits={shipVisits}
              ferryData={ferryData}
              cargoData={cargoData}
              cargoTurnover={cargoTurnover}
              loading={maritimeLoading}
            />
          )}
        </div>

        {/* System Status */}
        <SystemStatusFooter />

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-slate-800/40 text-xs text-slate-500">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            <p>Economy — <a href="https://data.stat.gov.lv/" className="hover:text-slate-300" target="_blank" rel="noopener noreferrer">CSP Latvia</a>, <a href="https://dashboard.elering.ee/" className="hover:text-slate-300" target="_blank" rel="noopener noreferrer">Elering</a>, <a href="https://www.ecb.europa.eu/" className="hover:text-slate-300" target="_blank" rel="noopener noreferrer">ECB</a>, <a href="https://ec.europa.eu/eurostat" className="hover:text-slate-300" target="_blank" rel="noopener noreferrer">Eurostat</a></p>
            <p>Business — <a href="https://data.gov.lv/" className="hover:text-slate-300" target="_blank" rel="noopener noreferrer">data.gov.lv</a> (VID, UBO, BVKB · CC0)</p>
            <p>Environment — <a href="https://open-meteo.com/" className="hover:text-slate-300" target="_blank" rel="noopener noreferrer">Open-Meteo</a>, <a href="https://opendata.riga.lv/" className="hover:text-slate-300" target="_blank" rel="noopener noreferrer">Riga Open Data</a></p>
            <p>Maritime — <a href="https://open-meteo.com/en/docs/marine-weather-api" className="hover:text-slate-300" target="_blank" rel="noopener noreferrer">Open-Meteo Marine</a>, <a href="https://data.gov.lv/" className="hover:text-slate-300" target="_blank" rel="noopener noreferrer">SKLOIS</a></p>
          </div>
          <p className="mt-4 text-slate-600">
            Built by <a href="https://naurolabs.com" className="hover:text-slate-400">NauroLabs</a>
            {' · '}
            <a href="/api-docs" className="hover:text-slate-400">API docs & pricing</a>
          </p>
        </footer>
      </main>
      </div>
    </div>
  );
}
