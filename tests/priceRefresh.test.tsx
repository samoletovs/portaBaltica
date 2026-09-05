import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { DataTicker } from '../src/components/DataTicker';
import { PowerMarketCard } from '../src/components/PowerMarketCard';
import { CountryProvider, useCountry } from '../src/CountryContext';
import { ThemeProvider } from '../src/ThemeContext';
import { fetchEconomyData, fetchPowerPrices } from '../src/api';

vi.mock('recharts', () => {
  const Wrapper = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const Chart = ({ children, 'aria-label': label }: PropsWithChildren<{ 'aria-label'?: string }>) => (
    <div role="img" aria-label={label}>{children}</div>
  );
  const Marker = ({ label }: { label?: { value: string } }) => label ? <span>{label.value}</span> : null;
  const Empty = () => null;
  return {
    ResponsiveContainer: Wrapper, LineChart: Chart, BarChart: Wrapper,
    Line: Empty, Bar: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty,
    Tooltip: Empty, ReferenceLine: Marker,
  };
});
vi.mock('../src/components/IndicatorCard', () => ({ IndicatorCard: () => null }));
vi.mock('../src/components/IndicatorTable', () => ({ IndicatorTable: () => null }));
vi.mock('../src/components/BalticCompareChart', () => ({ BalticCompareChart: () => null }));
vi.mock('../src/components/TradeTile', () => ({ TradeTile: () => null }));
vi.mock('../src/components/GovernmentTile', () => ({ GovernmentTile: () => null }));
vi.mock('../src/components/LabourTile', () => ({ LabourTile: () => null }));
vi.mock('../src/components/EnergyTile', () => ({ EnergyTile: () => null }));
vi.mock('../src/components/PropertyTile', () => ({ PropertyTile: () => null }));
vi.mock('../src/components/EnvironmentTile', () => ({ EnvironmentTile: () => null }));
vi.mock('../src/components/MaritimeTile', () => ({ MaritimeTile: () => null }));
vi.mock('../src/components/BusinessTile', () => ({ BusinessTile: () => null }));
vi.mock('../src/components/InsightsBanner', () => ({ InsightsBanner: () => null }));
vi.mock('../src/components/OnboardingTutorial', () => ({ OnboardingTutorial: () => null }));
vi.mock('../src/components/SystemStatusFooter', () => ({ SystemStatusFooter: () => null }));
vi.mock('../src/components/SectionRail', () => ({ SectionRail: () => null }));

const INTERVAL = 15 * 60_000;
const RETRIEVED = '2026-09-05T06:14:00.000Z';
let visible = true;
let failing = false;
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function schedule() {
  const currentTime = new Date(Math.floor(Date.now() / INTERVAL) * INTERVAL).toISOString();
  const current = 10 + (Date.parse(currentTime) - Date.parse('2026-09-05T06:00:00Z')) / INTERVAL * 10;
  const priceSchedule = { retrievedAt: RETRIEVED, stale: false };
  const electricityPrices = [0, 15, 30, 45].map((minute, index) => ({
    timestamp: `2026-09-05T06:${String(minute).padStart(2, '0')}:00.000Z`, price: (index + 1) * 10,
  }));
  return {
    economy: {
      electricityCurrent: current, electricityCurrentTime: currentTime, electricityPrices,
      priceSchedule, fetchedAt: RETRIEVED,
      exchangeRates: [{ currency: 'USD', rate: 1.17, name: 'US Dollar' }],
      indicators: [], businessPulse: { activeVatPayers: null, suspendedBusinesses: null },
    },
    power: {
      unit: 'EUR/MWh', currentTime, currentSpread: 0, coupled: true,
      priceSchedule, fetchedAt: RETRIEVED, source: 'Elering', today: '2026-09-05',
      zones: [{ id: 'lv', label: 'Latvia', flag: 'LV', current, min: 10, max: 40, avg: 25 }],
      series: electricityPrices.map(point => ({ time: point.timestamp, day: '2026-09-05', lv: point.price, ee: point.price, lt: point.price, fi: point.price, spread: 0 })),
      decoupledIntervals: 0, totalIntervals: 4, widestSpread: null,
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  visible = true;
  failing = false;
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(RETRIEVED));
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
  fetchMock.mockReset();
  fetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url.includes('economy-data') || url.includes('power-prices')) {
      return Response.json(url.includes('economy-data') ? schedule().economy : schedule().power,
        { status: failing ? 503 : 200 });
    }
    return Response.json({ ports: [], unavailable: [], indicators: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

async function mountSurfaces() {
  const view = render(
    <MemoryRouter><ThemeProvider><CountryProvider>
      <div data-testid="economy"><App /></div>
      <div data-testid="power"><PowerMarketCard /></div>
      <div data-testid="ticker"><DataTicker /></div>
    </CountryProvider></ThemeProvider></MemoryRouter>,
  );
  await act(async () => {});
  return view;
}

function currentText(view: ReturnType<typeof render>, id: string) {
  const surface = view.getByTestId(id);
  return id === 'economy' ? surface.querySelector('p.text-lead')?.textContent : surface.textContent;
}

function CountrySwitch() {
  const { setCountry } = useCountry();
  return <button onClick={() => setCountry('EE')}>Estonia</button>;
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

describe('browser caches containing current electricity prices', () => {
  it('still recovers from quota exhaustion without evicting another app data', async () => {
    localStorage.setItem('other-app', 'keep');
    localStorage.setItem('portabaltica_old', JSON.stringify({ timestamp: 1, data: {} }));
    const setItem = Storage.prototype.setItem;
    let exhausted = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (exhausted) {
        exhausted = false;
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    });
    expect((await fetchEconomyData()).electricityCurrent).toBe(10);
    expect(localStorage.getItem('other-app')).toBe('keep');
    expect(localStorage.getItem('portabaltica_old')).toBeNull();
    expect(localStorage.getItem('portabaltica_economy-lv')).not.toBeNull();
    await fetchEconomyData();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not swallow a response parsing error when browser storage is denied', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    fetchMock.mockImplementation(async () => new Response('{invalid', { status: 200 }));
    await expect(fetchEconomyData()).rejects.toMatchObject({ name: 'SyntaxError' });
  });

  it.each(['economy', 'power'])('expires %s at the delivery boundary, not a relative TTL', async kind => {
    if (kind === 'economy') await fetchEconomyData();
    else await fetchPowerPrices();
    vi.setSystemTime(new Date('2026-09-05T06:15:00Z'));
    const value = kind === 'economy'
      ? (await fetchEconomyData()).electricityCurrent
      : (await fetchPowerPrices()).zones[0].current;
    expect(value).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps retrieval metadata when selecting a new current delivery interval', async () => {
    await fetchEconomyData();
    vi.setSystemTime(new Date('2026-09-05T06:16:00Z'));
    const result = await fetchEconomyData();
    expect(result.electricityCurrent).toBe(20);
    expect(result.fetchedAt).toBe(RETRIEVED);
    expect(result.priceSchedule).toEqual({ retrievedAt: RETRIEVED, stale: false });
  });

  it('does not call an expired server response current even when newly fetched', async () => {
    const old = schedule();
    vi.setSystemTime(new Date('2026-09-05T06:16:00Z'));
    fetchMock.mockImplementation(async input => Response.json(String(input).includes('economy') ? old.economy : old.power));
    expect((await fetchEconomyData()).electricityCurrent).toBeNull();
    const power = await fetchPowerPrices();
    expect(power.currentTime).toBeNull();
    expect(power.zones[0].current).toBeNull();
    expect(power.coupled).toBeNull();
  });

  it('cancels one reader without aborting another reader of the shared request', async () => {
    const response = deferredResponse();
    fetchMock.mockImplementation(() => response.promise);
    const first = new AbortController();
    const second = new AbortController();
    const cancelled = expect(fetchEconomyData('lv', first.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const surviving = fetchEconomyData('lv', second.signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first.abort();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    response.resolve(Response.json(schedule().economy));
    expect((await surviving).electricityCurrent).toBe(10);
    await cancelled;
  });

  it('does not cache a slow response under the interval when it finished', async () => {
    const response = deferredResponse();
    const old = schedule().economy;
    fetchMock.mockImplementationOnce(() => response.promise);
    const pending = fetchEconomyData();
    vi.setSystemTime(new Date('2026-09-05T06:16:00Z'));
    response.resolve(Response.json(old));
    expect((await pending).electricityCurrent).toBeNull();
    expect((await fetchEconomyData()).electricityCurrent).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let an older in-flight interval overwrite a newer cached response', async () => {
    const response = deferredResponse();
    const old = schedule().economy;
    fetchMock.mockImplementationOnce(() => response.promise);
    const older = fetchEconomyData();
    vi.setSystemTime(new Date('2026-09-05T06:16:00Z'));
    expect((await fetchEconomyData()).electricityCurrent).toBe(20);
    const stored = localStorage.getItem('portabaltica_economy-lv');
    vi.setSystemTime(new Date('2026-09-05T06:17:00Z'));
    response.resolve(Response.json(old));
    expect((await older).electricityCurrent).toBeNull();
    expect(localStorage.getItem('portabaltica_economy-lv')).toBe(stored);
    expect((await fetchEconomyData()).electricityCurrent).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('overwrites stable persistent keys rather than adding an entry per delivery interval', async () => {
    for (let index = 0; index < 4; index++) {
      vi.setSystemTime(new Date(Date.parse('2026-09-05T06:00:00Z') + index * INTERVAL));
      await fetchEconomyData();
      await fetchPowerPrices();
    }
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(localStorage.length).toBe(2);
    expect(localStorage.getItem('portabaltica_economy-lv')).not.toBeNull();
    expect(localStorage.getItem('portabaltica_power-prices')).not.toBeNull();
  });
});

describe('the three mounted current-price surfaces', () => {
  it.each(['access', 'enumeration', 'removal'])('keeps valid ticker data when storage %s is denied', async failure => {
    const baseline = render(<DataTicker />);
    await act(async () => {});
    const expected = baseline.container.textContent;
    expect(expected).toContain('EUR/USD');
    expect(expected).toContain('€10.00');
    baseline.unmount();
    localStorage.clear();

    const denied = () => { throw new DOMException('Storage denied', 'SecurityError'); };
    if (failure === 'access') vi.spyOn(window, 'localStorage', 'get').mockImplementation(denied);
    else {
      localStorage.setItem('portabaltica_old', JSON.stringify({ timestamp: 1, data: {} }));
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Storage full', 'QuotaExceededError');
      });
      if (failure === 'enumeration') vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(denied);
      else vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
    }
    const actual = render(<DataTicker />);
    await act(async () => {});
    expect(actual.container.textContent).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes exactly at the next delivery boundary without polling other App feeds', async () => {
    const view = await mountSurfaces();
    for (const id of ['economy', 'power', 'ticker']) expect(currentText(view, id)).toContain('€10.00');
    const unrelated = () => fetchMock.mock.calls.filter(([url]) => !/economy-data|power-prices/.test(String(url))).length;
    const initialOthers = unrelated();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    for (const id of ['economy', 'power', 'ticker']) expect(currentText(view, id)).toContain('€20.00');
    expect(unrelated()).toBe(initialOthers);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('economy-data'))).toHaveLength(2);
  });

  it('withholds the previous current price during a failed refresh', async () => {
    const view = await mountSurfaces();
    failing = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    for (const id of ['economy', 'power', 'ticker']) expect(currentText(view, id)).not.toContain('€10.00');
    expect(view.getByTestId('power').textContent).not.toContain('Coupled');
    expect(view.getByTestId('ticker').textContent).toContain('EUR/USD');
  });

  it('pauses hidden tabs and refreshes on resume', async () => {
    const view = await mountSurfaces();
    visible = false;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const beforeHidden = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(beforeHidden);
    visible = true;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    for (const id of ['economy', 'power', 'ticker']) expect(currentText(view, id)).toContain('€40.00');
  });

  it('does not start pricing requests when mounted in a background tab', async () => {
    visible = false;
    const view = await mountSurfaces();
    expect(fetchMock.mock.calls.filter(([url]) => /economy-data|power-prices/.test(String(url)))).toHaveLength(0);
    view.unmount();
    visible = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock.mock.calls.filter(([url]) => /economy-data|power-prices/.test(String(url)))).toHaveLength(0);
  });

  it('removes a previous price immediately while the next request is still pending', async () => {
    const view = await mountSurfaces();
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    for (const id of ['economy', 'power', 'ticker']) expect(currentText(view, id)).not.toContain('€10.00');
    view.unmount();
    const pending = fetchMock.mock.calls.slice(-2);
    expect(pending.every(([, options]) => options?.signal?.aborted)).toBe(true);
    const count = fetchMock.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });

  it('dates source fallback explicitly instead of presenting it as newly retrieved', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, options) => {
      const url = String(input);
      if (/economy-data|power-prices/.test(url)) {
        const data = url.includes('economy') ? schedule().economy : schedule().power;
        return Response.json({ ...data, priceSchedule: { retrievedAt: RETRIEVED, stale: true } });
      }
      return original(input, options);
    });
    const view = await mountSurfaces();
    expect(currentText(view, 'economy')).not.toContain('€10.00');
    expect(view.getByTestId('ticker').textContent).toContain('Electricity (last-good schedule)');
    expect(view.getByTestId('power').textContent).toContain('Last-good schedule');
    expect(view.getByTestId('power').querySelector('time')?.dateTime).toBe(RETRIEVED);
  });

  it.each(['2026-09-07T06:14:00Z', '2026-09-05T21:01:00Z'])('dates retained history after a calendar rollover and failed resume: %s', async resumedAt => {
    const old = {
      ...schedule().power,
      tomorrow: '2026-09-06',
      tomorrowOutlook: { date: '2026-09-06', decoupledIntervals: 0, totalIntervals: 1, widestSpread: null },
      series: [...schedule().power.series, {
        time: '2026-09-06T00:00:00.000Z', day: '2026-09-06', lv: 30, ee: 30, lt: 30, fi: 30, spread: 0,
      }],
    };
    fetchMock.mockImplementation(async () => Response.json(old, { status: failing ? 503 : 200 }));
    const view = render(<ThemeProvider><CountryProvider><PowerMarketCard /></CountryProvider></ThemeProvider>);
    await act(async () => {});
    expect(view.container.textContent).toContain("today's low to high");
    expect(view.container.textContent).toContain('tomorrow published');
    visible = false;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    vi.setSystemTime(new Date(resumedAt));
    failing = true;
    visible = true;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(view.container.textContent).not.toMatch(/today|tomorrow/i);
    expect(view.getByRole('img').getAttribute('aria-label')).not.toMatch(/today|tomorrow/i);
    expect(view.container.textContent).toContain('2026-09-05');
    expect(view.container.textContent).toContain('2026-09-06');
    expect(view.container.textContent).toContain('Refresh failed');
    expect(view.container.textContent).toContain('Last-good schedule');
    expect(view.container.querySelector('time')?.dateTime).toBe(RETRIEVED);
    expect(old.priceSchedule.stale).toBe(false);
  });

  it('ignores a late response after the country changed, including its cache write', async () => {
    const old = deferredResponse();
    fetchMock.mockImplementation(async input => {
      if (String(input).includes('country=lv')) return old.promise;
      return Response.json({ ...schedule().economy, electricityCurrent: 30 });
    });
    const view = render(<CountryProvider><CountrySwitch /><DataTicker /></CountryProvider>);
    await act(async () => { fireEvent.click(view.getByText('Estonia')); });
    expect(view.container.textContent).toContain('€30.00');
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { old.resolve(Response.json(schedule().economy)); });
    expect(view.container.textContent).toContain('€30.00');
    expect(localStorage.getItem('portabaltica_economy-lv')).toBeNull();
  });

  it('ignores late older-interval responses after all three surfaces displayed a newer interval', async () => {
    const view = await mountSurfaces();
    const oldEconomy = deferredResponse();
    const oldPower = deferredResponse();
    fetchMock.mockImplementation(input => String(input).includes('economy') ? oldEconomy.promise : oldPower.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    const old = schedule();
    fetchMock.mockImplementation(async input => Response.json(String(input).includes('economy') ? schedule().economy : schedule().power));
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL); });
    for (const id of ['economy', 'power', 'ticker']) expect(currentText(view, id)).toContain('€30.00');
    const storedEconomy = localStorage.getItem('portabaltica_economy-lv');
    const storedPower = localStorage.getItem('portabaltica_power-prices');

    await act(async () => {
      oldEconomy.resolve(Response.json(old.economy));
      oldPower.resolve(Response.json(old.power));
    });
    for (const id of ['economy', 'power', 'ticker']) expect(currentText(view, id)).toContain('€30.00');
    expect(localStorage.getItem('portabaltica_economy-lv')).toBe(storedEconomy);
    expect(localStorage.getItem('portabaltica_power-prices')).toBe(storedPower);
  });

  it.each(['focus', 'pageshow'])('refreshes a resumed page on %s without relying on a delayed timer', async event => {
    const view = await mountSurfaces();
    vi.setSystemTime(new Date('2026-09-05T06:31:00Z'));
    await act(async () => { window.dispatchEvent(new Event(event)); });
    for (const id of ['economy', 'power', 'ticker']) expect(currentText(view, id)).toContain('€30.00');
  });
});
