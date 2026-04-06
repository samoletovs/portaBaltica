import { useState, useEffect } from 'react';
import { PORTS } from './types';
import type { MarineWeatherForecast, PortWeather, ShipVisit, FerryData, CargoData, CargoTurnover, DashboardSection, EconomyData, PropertyData, EnvironmentData, EUFundsData } from './types';
import { fetchAllWeather, fetchPortData, fetchEconomyData, fetchPropertyData, fetchEnvironmentData, fetchEUFunds } from './api';
import { Header } from './components/Header';
import { InsightsBanner, generateSampleInsights } from './components/InsightsBanner';
import { EconomyTile } from './components/EconomyTile';
import { PropertyTile } from './components/PropertyTile';
import { EnvironmentTile } from './components/EnvironmentTile';
import { MaritimeTile } from './components/MaritimeTile';
import { BusinessTile } from './components/BusinessTile';
import { SystemStatusFooter } from './components/SystemStatusFooter';

import { useParams, useNavigate } from 'react-router-dom';

interface PortWeatherData {
  port: typeof PORTS[0];
  marine: MarineWeatherForecast;
  weather: PortWeather;
}

const VALID_SECTIONS = new Set(['economy', 'property', 'environment', 'business', 'maritime']);

export default function App() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const activeSection: DashboardSection | 'all' =
    section && VALID_SECTIONS.has(section) ? section as DashboardSection : 'all';

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
  const [error, setError] = useState<string | null>(null);

  // Track login
  useEffect(() => {
    fetch('/api/track-login', { method: 'POST' }).catch(() => {});
  }, []);

  // Load all data in parallel
  useEffect(() => {
    // Maritime (existing flow)
    async function loadMaritime() {
      setMaritimeLoading(true);
      try {
        const [weather, govData] = await Promise.all([
          fetchAllWeather(),
          fetchPortData().catch(() => ({ shipVisits: [], ferryData: [], cargoData: [], cargoTurnover: [], fetchedAt: '' })),
        ]);
        setPortData(weather);
        setShipVisits(govData.shipVisits);
        setFerryData(govData.ferryData);
        setCargoData(govData.cargoData);
        setCargoTurnover(govData.cargoTurnover ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load maritime data');
      } finally {
        setMaritimeLoading(false);
        setLastUpdated(new Date());
      }
    }

    // Economy
    async function loadEconomy() {
      setEconomyLoading(true);
      try {
        const data = await fetchEconomyData();
        setEconomyData(data);
      } catch { /* non-critical */ } finally {
        setEconomyLoading(false);
      }
    }

    // Property
    async function loadProperty() {
      setPropertyLoading(true);
      try {
        const data = await fetchPropertyData();
        setPropertyData(data);
      } catch { /* non-critical */ } finally {
        setPropertyLoading(false);
      }
    }

    // Environment
    async function loadEnvironment() {
      setEnvironmentLoading(true);
      try {
        const data = await fetchEnvironmentData();
        setEnvironmentData(data);
      } catch { /* non-critical */ } finally {
        setEnvironmentLoading(false);
      }
    }

    // Phase 2: EU Funds
    async function loadEUFunds() {
      setEuLoading(true);
      try {
        const data = await fetchEUFunds();
        setEuFunds(data);
      } catch { /* non-critical */ } finally {
        setEuLoading(false);
      }
    }

    loadMaritime();
    loadEconomy();
    loadProperty();
    loadEnvironment();
    loadEUFunds();
  }, []);

  const insights = generateSampleInsights();
  const show = (section: DashboardSection) => activeSection === 'all' || activeSection === section;

  return (
    <div className="min-h-screen">
      <Header lastUpdated={lastUpdated} activeSection={activeSection} onSectionChange={setActiveSection} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-16">
        {error && (
          <div className="bg-red-950/50 border border-red-900/40 rounded-lg p-3 mb-6" role="alert">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* AI Insights */}
        <InsightsBanner insights={insights} />

        {/* Dashboard sections */}
        <div className="space-y-8">
          {show('economy') && (
            <EconomyTile data={economyData} loading={economyLoading} />
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
          <p className="mt-4 text-slate-600">Built by <a href="https://naurolabs.com" className="hover:text-slate-400">NauroLabs</a></p>
        </footer>
      </main>
    </div>
  );
}
