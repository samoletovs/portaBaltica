import { describe, it, expect } from 'vitest';

const BASE = 'https://portabaltica.naurolabs.com';

describe('API contracts (live)', () => {
  it('GET /api/baltic-compare?indicator=gdp returns expected shape', async () => {
    const r = await fetch(`${BASE}/api/baltic-compare?indicator=gdp&years=2`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d).toHaveProperty('indicator', 'gdp');
    expect(d).toHaveProperty('title');
    expect(d).toHaveProperty('unit');
    expect(d).toHaveProperty('countries');
    expect(d.countries).toHaveProperty('LV');
    expect(d.countries).toHaveProperty('EE');
    expect(d.countries).toHaveProperty('LT');
    expect(d.countries.LV.series.length).toBeGreaterThan(0);
  });

  it('GET /api/baltic-compare?indicator=salary returns EUR/hour data', async () => {
    const r = await fetch(`${BASE}/api/baltic-compare?indicator=salary&years=3`);
    const d = await r.json();
    expect(d.unit).toBe('EUR/hour');
    // Values should be reasonable (5-40 EUR/h for Baltics)
    const latest = d.countries.EE.series.filter((s: { value: number | null }) => s.value !== null).pop();
    if (latest) {
      expect(latest.value).toBeGreaterThan(5);
      expect(latest.value).toBeLessThan(50);
    }
  });

  it('GET /api/baltic-compare?indicator=unknown returns 400', async () => {
    const r = await fetch(`${BASE}/api/baltic-compare?indicator=unicorn`);
    expect(r.status).toBe(400);
  });

  it('GET /api/ai-insights?country=ee returns Tallinn data', async () => {
    const r = await fetch(`${BASE}/api/ai-insights?country=ee`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d.insights.length).toBeGreaterThan(0);
    const hasEstonia = d.insights.some((i: { headline: string }) =>
      i.headline.includes('Tallinn')
    );
    expect(hasEstonia).toBe(true);
  });

  it('GET /api/environment-data?country=lt returns capitalPopulation', async () => {
    const r = await fetch(`${BASE}/api/environment-data?country=lt`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d).toHaveProperty('capitalPopulation');
    expect(d).toHaveProperty('weather');
    expect(d).toHaveProperty('airQuality');
    expect(d.weather.length).toBe(4);
  });

  it('GET /api/economy-data?country=ee returns electricity for Estonia', async () => {
    const r = await fetch(`${BASE}/api/economy-data?country=ee`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d).toHaveProperty('electricityCurrent');
    expect(d).toHaveProperty('exchangeRates');
  });

  it.skip('GET /api/system-status returns health data (slow — 7 parallel health checks)', async () => {
    const r = await fetch(`${BASE}/api/system-status`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d).toHaveProperty('status');
    expect(d).toHaveProperty('sources');
    expect(d.sources.length).toBeGreaterThan(0);
  }, 30_000);
});
