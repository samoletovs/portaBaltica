import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const es: { httpJson: (url: string, options: unknown) => Promise<unknown> } = require('../api/shared/eurostat.js');
const https: {
  get: (url: string, options: unknown, callback: (res: EventEmitter & { statusCode: number; resume: () => void }) => void) => EventEmitter;
} = require('node:https');
const cache: { clear: () => void } = require('../api/shared/cache.js');
const rateLimit: { reset: () => void } = require('../api/shared/rateLimit.js');
const handler: (context: { res?: { status: number; body: string } }, req: object) => Promise<void> =
  require('../api/ai-insights/index.js');
type Insight = { headline: string; description: string; level: string };
let pm25: number | null;
let temperature: number;

beforeEach(() => {
  cache.clear();
  rateLimit.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-11T12:49:00Z'));
  pm25 = 2.4;
  temperature = 18.7;
  vi.spyOn(es, 'httpJson').mockImplementation(async url => {
    const query = new URL(url);
    expect(query.searchParams.has('hourly')).toBe(false);
    expect(query.searchParams.has('daily')).toBe(false);
    return query.hostname.includes('air-quality')
      ? { current: { time: '2026-09-11T15:00', interval: 3600, european_aqi: 23, pm2_5: pm25 } }
      : { current: { time: '2026-09-11T15:45', interval: 900, temperature_2m: temperature, wind_speed_10m: 15.5, weather_code: 2 } };
  });
  vi.spyOn(https, 'get').mockImplementation((url, _options, callback) => {
    const request = Object.assign(new EventEmitter(), { destroy() {} });
    const body = url.includes('ecb.europa.eu')
      ? "<Cube time='2026-09-11'><Cube currency='USD' rate='1.17'/></Cube>"
      : JSON.stringify({ success: true, data: { lv: [{ timestamp: Date.now() / 1000, price: 50 }] } });
    queueMicrotask(() => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200, resume() {} });
      callback(response);
      queueMicrotask(() => { response.emit('data', body); response.emit('end'); });
    });
    return request;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cache.clear();
  rateLimit.reset();
});

async function insights() {
  const context: { res?: { status: number; body: string } } = {};
  await handler(context, { query: { country: 'lv' }, headers: {} });
  expect(context.res?.status).toBe(200);
  return (JSON.parse(context.res!.body) as { insights: Insight[] }).insights;
}

describe('current model estimates do not establish a longer comparison window', () => {
  it.each([0, 2.4, 15, 16.9])('keeps PM2.5=%s without judging WHO daily-guideline compliance', async value => {
    pm25 = value;
    const card = (await insights()).find(item => item.headline === 'Riga air quality: Fair');
    expect(card).toBeDefined();
    expect(card!.description).toContain(`${value.toFixed(1)} µg/m³`);
    expect(card!.description).toContain('current estimate');
    expect(card!.description).toContain('WHO 24-hour guideline cannot be assessed');
    expect(card!.description).not.toMatch(/(?:within|above|below) the WHO/);
    expect(card!.level).toBe('routine');
  });

  it('does not discuss a PM2.5 estimate when the value was not returned', async () => {
    pm25 = null;
    const card = (await insights()).find(item => item.headline === 'Riga air quality: Fair');
    expect(card).toBeDefined();
    expect(card!.description).toContain('PM2.5 unavailable');
    expect(card!.description).not.toMatch(/WHO|0\.0/);
  });

  it.each([-11, -1, 0, 18.7, 31, 36])('describes %s°C without inventing climatology or a multi-day heat wave', async value => {
    temperature = value;
    const card = (await insights()).find(item => item.headline.startsWith('Riga:'));
    expect(card).toBeDefined();
    expect(card!.headline).toContain(`${value.toFixed(0)}°C`);
    expect(card!.description).toContain('Wind 16 km/h');
    expect(card!.description).not.toMatch(/within seasonal range|heat wave|normal for/i);
    if (value >= 0 && value <= 30) expect(card!.description).toContain('no seasonal comparison');
    if (value > 30) expect(card!.description).toContain('High temperature');
    expect(card!.level).toBe(value < -10 || value > 35 ? 'significant' : 'routine');
  });
});
