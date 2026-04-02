import { useState, useEffect } from 'react';
import { PORTS } from './types';
import type { MarineWeatherForecast, PortWeather, ShipVisit, FerryData, CargoData } from './types';
import { fetchAllWeather, fetchPortData } from './api';
import { PortCard } from './components/PortCard';
import { Header } from './components/Header';
import { ShipVisitsPanel } from './components/ShipVisitsPanel';
import { FerryPanel } from './components/FerryPanel';
import { CargoPanel } from './components/CargoPanel';

interface PortWeatherData {
  port: typeof PORTS[0];
  marine: MarineWeatherForecast;
  weather: PortWeather;
}

export default function App() {
  const [portData, setPortData] = useState<PortWeatherData[]>([]);
  const [shipVisits, setShipVisits] = useState<ShipVisit[]>([]);
  const [ferryData, setFerryData] = useState<FerryData[]>([]);
  const [cargoData, setCargoData] = useState<CargoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [weather, govData] = await Promise.all([
          fetchAllWeather(),
          fetchPortData().catch(() => ({ shipVisits: [], ferryData: [], cargoData: [], fetchedAt: '' })),
        ]);
        setPortData(weather);
        setShipVisits(govData.shipVisits);
        setFerryData(govData.ferryData);
        setCargoData(govData.cargoData);
        setLastUpdated(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div className="min-h-screen">
      <Header lastUpdated={lastUpdated} />

      <main className="max-w-7xl mx-auto px-4 pb-16">
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="inline-block w-8 h-8 border-2 border-ocean-400 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-ocean-300">Loading port data...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-4 mb-8">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Port overview cards */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {portData.map(({ port, marine, weather }) => (
                <PortCard key={port.code} port={port} marine={marine} weather={weather} />
              ))}
            </section>

            {/* Ship visits, ferry & cargo data */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
              <ShipVisitsPanel visits={shipVisits} />
              <FerryPanel data={ferryData} />
              <CargoPanel data={cargoData} />
            </div>

            {/* Data sources footer */}
            <footer className="mt-16 pt-8 border-t border-ocean-800/50 text-sm text-ocean-400">
              <p className="mb-2">Data sources:</p>
              <ul className="space-y-1">
                <li>Marine weather — <a href="https://open-meteo.com/en/docs/marine-weather-api" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">Open-Meteo Marine API</a> (DWD EWAM, 5km resolution)</li>
                <li>Ship visits — <a href="https://data.gov.lv/dati/lv/dataset/ar-juras-parvadajumiem-un-ostas-formalitatem-saistito-formalitasu-statistika" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">SKLOIS via data.gov.lv</a> (CC0)</li>
                <li>Ferry passengers — <a href="https://data.gov.lv/dati/lv/dataset/pasazieru-parvadajumu-statistika-parvadajumiem-ar-juras-transportu" className="underline hover:text-ocean-200" target="_blank" rel="noopener noreferrer">Ministry of Transport via data.gov.lv</a> (CC0)</li>
              </ul>
              <p className="mt-4 text-ocean-500">Built by <a href="https://naurolabs.com" className="underline">NauroLabs</a></p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
