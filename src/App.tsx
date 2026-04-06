import { useState, useEffect } from 'react';
import { PORTS } from './types';
import type { MarineWeatherForecast, PortWeather, ShipVisit, FerryData, CargoData, CargoTurnover, DashboardSection, EconomyData, PropertyData, EnvironmentData } from './types';
import { fetchAllWeather, fetchPortData, fetchEconomyData, fetchPropertyData, fetchEnvironmentData } from './api';
import { Header } from './components/Header';
import { InsightsBanner, generateSampleInsights } from './components/InsightsBanner';
import { EconomyTile } from './components/EconomyTile';
import { PropertyTile } from './components/PropertyTile';
import { EnvironmentTile } from './components/EnvironmentTile';
import { MaritimeTile } from './components/MaritimeTile';

interface PortWeatherData {
  port: typeof PORTS[0];
  marine: MarineWeatherForecast;
  weather: PortWeather;
}

export default function App() {
  const [activeSection, setActiveSection] = useState<DashboardSection | 'all'>('all');

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

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    loadMaritime();
    loadEconomy();
    loadProperty();
    loadEnvironment();
  }, []);

  const insights = generateSampleInsights();
  const show = (section: DashboardSection) => activeSection === 'all' || activeSection === section;

  return (
    <div className="min-h-screen">
      <Header lastUpdated={lastUpdated} activeSection={activeSection} onSectionChange={setActiveSection} />

      <main className="max-w-7xl mx-auto px-4 pb-16">
        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-4 mb-6" role="alert">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* AI Insights */}
        <InsightsBanner insights={insights} />

        {/* Dashboard sections */}
        <div className="space-y-10">
          {show('economy') && (
            <EconomyTile data={economyData} loading={economyLoading} />
          )}

          {show('property') && (
            <PropertyTile data={propertyData} loading={propertyLoading} />
          )}

          {show('environment') && (
            <EnvironmentTile data={environmentData} loading={environmentLoading} />
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

        {/* Data sources footer */}
        <footer className="mt-16 pt-8 border-t border-ocean-800/50 text-sm text-ocean-400">
          <p className="mb-2 font-medium text-ocean-300">Data sources</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            <p>Economy — <a href="https://www.bank.lv/vk/ecb.xml" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">ECB/Latvijas Banka</a>, <a href="https://dashboard.elering.ee/" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">Elering/NordPool</a>, <a href="https://data.stat.gov.lv/" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">CSP Latvia</a></p>
            <p>Business — <a href="https://data.gov.lv/" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">data.gov.lv</a> (VID VAT & Business Registries, CC0)</p>
            <p>Property — <a href="https://data.gov.lv/" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">BVKB Construction</a>, <a href="https://data.gov.lv/" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">Energy Certificates</a></p>
            <p>Environment — <a href="https://open-meteo.com/" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">Open-Meteo</a>, <a href="https://opendata.riga.lv/" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">Riga Open Data</a></p>
            <p>Maritime — <a href="https://open-meteo.com/en/docs/marine-weather-api" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">Open-Meteo Marine</a>, <a href="https://data.gov.lv/" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">SKLOIS/data.gov.lv</a></p>
          </div>
          <p className="mt-4 text-ocean-500">Built by <a href="https://naurolabs.com" className="underline hover:text-ocean-300">NauroLabs</a> · <a href="https://github.com/samoletovs/portaBaltica" className="underline hover:text-ocean-300">GitHub</a></p>
        </footer>
      </main>
    </div>
  );
}
