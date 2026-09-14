import { createRequire } from 'node:module';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { BalticCompareData } from '../src/api';
import { PublicBriefingSample } from '../src/components/news/PublicBriefingSample';

const registry = createRequire(import.meta.url)('../api/shared/indicators.js') as Record<
  string, { title: string; unit: string; dataset: string }
>;
const fetchCompare = vi.fn();
const download = vi.fn<(filename: string, type: string, text: string) => boolean>(() => true);
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...args: unknown[]) => fetchCompare(...args),
}));
vi.mock('../src/utils/downloadText', () => ({
  downloadText: (filename: string, type: string, text: string) => download(filename, type, text),
}));

type Points = [string, number | null][];
function payload(id: string, countries: Record<string, Points>): BalticCompareData {
  const { title, unit, dataset } = registry[id];
  return {
    indicator: id, title, unit, dataset, source: `Eurostat (${dataset})`,
    fetchedAt: '2026-09-14T09:17:34Z',
    countries: Object.fromEntries(Object.entries(countries).map(([code, points]) => [
      code, { label: code, series: points.map(([period, value]) => ({ period, value })) },
    ])),
  };
}

function respond(inflation?: BalticCompareData) {
  const data = {
    inflation: inflation ?? payload('inflation', {
      LV: [['2026-07', 2.54]],
      EE: [['2026-08', 1.2345], ['2026-07', 2.0197], ['2026-06', 2.2]],
      LT: [['2026-07', 5.4]],
    }),
    salary: payload('salary', {
      LV: [['2025', 16.3]], EE: [['2024', 19.6], ['2025', 21.1]], LT: [['2025', 17.8]],
    }),
    retail: payload('retail', {
      LV: [['2026-07', 7.1]], EE: [['2026-06', -0.2], ['2026-07', 0]], LT: [['2026-07', 5.9]],
    }),
  };
  fetchCompare.mockImplementation((id: keyof typeof data) => Promise.resolve(data[id]));
}

async function show(country = 'EE') {
  render(<MemoryRouter initialEntries={[`/briefings?country=${country}`]}><PublicBriefingSample /></MemoryRouter>);
  await act(async () => {});
  await act(async () => {});
}

function section(id: string) {
  return within(screen.getByRole('heading', { name: registry[id].title }).closest('section')!);
}

function address(link: HTMLElement) {
  return new URL(link.getAttribute('href')!, window.location.origin);
}

function downloadedJson() {
  const [filename, type, text] = download.mock.calls.at(-1)!;
  expect(filename).toBe('portabaltica-inflation-ee-planning-basis-2026-09-14.json');
  expect(type).toBe('application/json;charset=utf-8');
  return JSON.parse(String(text));
}

beforeEach(() => {
  fetchCompare.mockReset();
  download.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T12:00:00Z'));
});

afterEach(() => vi.useRealTimers());

describe('briefing evidence carried into a planning discussion', () => {
  it('keeps all nine Baltic table links on their displayed period and requested history', async () => {
    respond();
    await show();
    let opportunities = 0;
    for (const [id, period] of [['inflation', '2026-07'], ['salary', '2025'], ['retail', '2026-07']]) {
      for (const [code, name] of [['LV', 'Latvia'], ['EE', 'Estonia'], ['LT', 'Lithuania']]) {
        const link = section(id).getByRole('link', { name: `View ${registry[id].title} for ${name} in Data explorer` });
        const url = address(link);
        expect(url.pathname).toBe(`/indicator/${id}`);
        expect(Object.fromEntries(url.searchParams)).toEqual({ country: code, years: '3', view: 'table', period });
        opportunities++;
      }
    }
    expect(opportunities).toBe(9);
  });

  it('exposes the focus basis without rounding or substituting the older common period', async () => {
    respond();
    await show();
    const basis = section('inflation').getByRole('table', { name: 'Estonia planning basis for HICP Inflation (% YoY)' });
    const rows = within(basis).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain('Previous period');
    expect(rows[1].textContent).toContain('2.0197');
    expect(rows[2].textContent).toContain('Latest reading');
    expect(rows[2].textContent).toContain('1.2345');
    const links = within(basis).getAllByRole('link');
    expect(links.map(link => address(link).searchParams.get('period'))).toEqual(['2026-07', '2026-08']);
    expect(links.every(link => address(link).searchParams.get('country') === 'EE')).toBe(true);
    expect(section('inflation').getByText(/In July 2026, the reading ranged/)).toBeTruthy();
    expect(section('inflation').getByText(/Live views may be revised/)).toBeTruthy();
  });

  it('downloads only the two focus periods with exact values, units and original retrieval time', async () => {
    respond();
    await show();
    fireEvent.click(section('inflation').getByRole('button', { name: 'Download HICP Inflation - Estonia planning basis as JSON' }));
    const data = downloadedJson();
    expect(data.indicator).toBe('inflation');
    expect(data.unit).toBe(registry.inflation.unit);
    expect(data.dataset).toBe(registry.inflation.dataset);
    expect(data.retrievedAt).toBe('2026-09-14T09:17:34Z');
    expect(data.exportedAt).toBe('2026-09-14T12:00:00.000Z');
    expect(data.series).toEqual([{
      label: 'Estonia', observations: [
        { period: '2026-07', value: 2.0197 },
        { period: '2026-08', value: 1.2345 },
      ],
    }]);
    expect(data).not.toHaveProperty('evidence_snapshot_id');
    expect(fetchCompare).toHaveBeenCalledTimes(3);
    fireEvent.click(section('inflation').getByRole('button', { name: 'Download HICP Inflation as JSON' }));
    const [fullFilename, , fullText] = download.mock.calls.at(-1)!;
    expect(fullFilename).toBe('portabaltica-inflation-2026-09-14.json');
    const fullData = JSON.parse(fullText);
    expect(fullData.indicator).toBe('inflation');
    expect(fullData.series).toHaveLength(3);
    expect(fullData.series[1].observations).toContainEqual({ period: '2026-06', value: 2.2 });
  });

  it.each([null, 'absent'] as const)('retains a missing previous period (%s) beside a true zero in screen, CSV and JSON', async missing => {
    const points: Points = [['2026-06', 2.5], ['2026-08', 0]];
    if (missing === null) points.push(['2026-07', null]);
    respond(payload('inflation', { LV: points, EE: points, LT: points }));
    await show();
    const basis = section('inflation').getByRole('table', { name: /Estonia planning basis/ });
    expect(within(basis).getByText('No published reading')).toBeTruthy();
    expect(within(basis).getByText('0')).toBeTruthy();
    expect(within(basis).getAllByRole('link')).toHaveLength(1);
    expect(section('inflation').getByText(/Change not calculated: July 2026/)).toBeTruthy();
    fireEvent.click(section('inflation').getByRole('button', { name: 'Download HICP Inflation - Estonia planning basis as JSON' }));
    expect(downloadedJson().series[0].observations).toEqual([
      { period: '2026-07', value: null }, { period: '2026-08', value: 0 },
    ]);
    fireEvent.click(section('inflation').getByRole('button', { name: 'Download HICP Inflation - Estonia planning basis as CSV' }));
    const csv = String(download.mock.calls.at(-1)![2]);
    expect(csv).toContain('period,Estonia\r\n2026-07,\r\n2026-08,0\r\n');
    expect(csv).not.toContain('2026-06');
  });

  it('uses calendar labels for the annual basis and a January rollover', async () => {
    const points: Points = [['2026-01', 0], ['2025-12', 1], ['2025-10', 2]];
    respond(payload('inflation', { LV: points, EE: points, LT: points }));
    await show();
    const monthly = section('inflation').getByRole('table', { name: /Estonia planning basis/ });
    expect(within(monthly).getAllByRole('link').map(link => address(link).searchParams.get('period')))
      .toEqual(['2025-12', '2026-01']);
    const annual = section('salary').getByRole('table', { name: /Estonia planning basis/ });
    expect(within(annual).getAllByRole('link').map(link => address(link).searchParams.get('period')))
      .toEqual(['2024', '2025']);
  });

  it('changes the exported country without refetching and keeps missing-country controls absent', async () => {
    respond(payload('inflation', { EE: [['2026-07', 2], ['2026-08', 1]], LT: [['2026-07', 5]] }));
    await show();
    expect(section('inflation').getByRole('table', { name: /Estonia planning basis/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Planning focus'), { target: { value: 'LV' } });
    expect(section('inflation').queryByRole('table', { name: /planning basis/ })).toBeNull();
    expect(section('inflation').queryByRole('button', { name: /planning basis/ })).toBeNull();
    expect(section('inflation').getByText(/No planning reading is available for Latvia/)).toBeTruthy();
    expect(section('salary').getByRole('table', { name: /Latvia planning basis/ })).toBeTruthy();
    expect(fetchCompare).toHaveBeenCalledTimes(3);
  });

  it('does not invent a retrieval instant when the source did not supply one', async () => {
    const data = payload('inflation', { EE: [['2026-07', 2], ['2026-08', 1]] });
    delete data.fetchedAt;
    respond(data);
    await show();
    fireEvent.click(section('inflation').getByRole('button', { name: 'Download HICP Inflation - Estonia planning basis as JSON' }));
    expect(downloadedJson()).not.toHaveProperty('retrievedAt');
    fireEvent.click(section('inflation').getByRole('button', { name: 'Download HICP Inflation - Estonia planning basis as CSV' }));
    expect(download.mock.calls.at(-1)![2]).toContain('Retrieved from source: not reported by the API');
  });

  it('never offers an evidence export for a failed measure', async () => {
    fetchCompare.mockRejectedValue(new Error('Source unavailable'));
    await show();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(3);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });
});
