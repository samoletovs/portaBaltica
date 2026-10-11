import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAllWeather, fetchPortData, fetchTradePartners } from '../src/api';

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe('API data fetchers', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  describe('fetchAllWeather', () => {
    it('returns the ports from the sea-state response', async () => {
      const ports = [{ port: 'Riga' }, { port: 'Ventspils' }];
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        ports,
        unavailable: [],
        source: 'Open-Meteo',
        fetchedAt: '2026-10-11T12:00:00Z',
      }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchAllWeather()).resolves.toEqual(ports);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/sea-state');
    });

    it('returns an empty array when the endpoint has no available ports', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        ports: [],
        unavailable: ['Riga'],
        source: 'Open-Meteo',
        fetchedAt: '2026-10-11T12:00:00Z',
      })));

      await expect(fetchAllWeather()).resolves.toEqual([]);
    });

    it('rejects when the endpoint returns an HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));

      await expect(fetchAllWeather()).rejects.toThrow('sea-state API failed: 503');
    });
  });

  describe('fetchPortData', () => {
    it('uses Latvia by default and returns the response', async () => {
      const data = { country: 'LV', ports: [] };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(data));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchPortData()).resolves.toEqual(data);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/port-data?country=LV');
    });

    it('normalizes country codes and keeps country responses in separate cache entries', async () => {
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const country = new URL(String(input), 'https://example.test').searchParams.get('country');
        return Promise.resolve(jsonResponse({ country, ports: [] }));
      });
      vi.stubGlobal('fetch', fetchMock);

      const estonia = await fetchPortData('ee');
      const lithuania = await fetchPortData('lt');

      expect(estonia.country).toBe('EE');
      expect(lithuania.country).toBe('LT');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(fetchPortData('EE')).resolves.toEqual(estonia);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('encodes the country parameter and propagates HTTP failures', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 502));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchPortData('a&b')).rejects.toThrow('port_data_A&B API failed: 502');
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/port-data?country=A%26B');
    });
  });

  describe('fetchTradePartners', () => {
    it('fetches the Latvia-only trade-partners endpoint and caches its response', async () => {
      const data = { country: 'LV', countryOnly: true, partners: [] };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(data));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchTradePartners()).resolves.toEqual(data);
      await expect(fetchTradePartners()).resolves.toEqual(data);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/trade-partners');
    });

    it('rejects when the endpoint returns an HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));

      await expect(fetchTradePartners()).rejects.toThrow('trade-partners API failed: 500');
    });
  });
});
