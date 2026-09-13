import { createRequire } from 'node:module';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { PublicBriefingSample } from '../src/components/news/PublicBriefingSample';
import type { BalticCompareData } from '../src/api';

const registry = createRequire(import.meta.url)('../api/shared/indicators.js') as Record<
  string, { title: string; unit: string; dataset: string }
>;
const fetchCompare = vi.fn();
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...args: unknown[]) => fetchCompare(...args),
}));

type Points = [string, number | null][];
function payload(id: string, countries: Record<string, Points>): BalticCompareData {
  const { title, unit, dataset } = registry[id];
  return {
    indicator: id, title, unit, dataset, source: `Eurostat (${dataset})`,
    fetchedAt: '2026-09-11T12:00:00Z',
    countries: Object.fromEntries(Object.entries(countries).map(([code, points]) => [
      code, { label: code, series: points.map(([period, value]) => ({ period, value })) },
    ])),
  };
}

function respond(overrides: Partial<Record<string, BalticCompareData>> = {}) {
  const data = {
    inflation: payload('inflation', {
      LV: [['2026-07', 2.5], ['2026-08', 2.9]],
      EE: [['2026-07', 2], ['2026-08', 1.3]],
      LT: [['2026-07', 5.4], ['2026-08', 5.8]],
    }),
    salary: payload('salary', {
      LV: [['2024', 15.1], ['2025', 16.3]],
      EE: [['2024', 19.6], ['2025', 21.1]],
      LT: [['2024', 16.3], ['2025', 17.8]],
    }),
    retail: payload('retail', {
      LV: [['2026-06', 5.1], ['2026-07', 7.1]],
      EE: [['2026-06', 0.2], ['2026-07', 4.1]],
      LT: [['2026-06', 6.5], ['2026-07', 5.9]],
    }),
    ...overrides,
  };
  fetchCompare.mockImplementation((id: keyof typeof data) => Promise.resolve(data[id]));
}

function Location() {
  const location = useLocation();
  return <output aria-label="Current address">{location.pathname}{location.search}{location.hash}</output>;
}

function renderSample(url = '/briefings') {
  return render(<MemoryRouter initialEntries={[url]}><PublicBriefingSample /><Location /></MemoryRouter>);
}

async function settle() {
  await act(async () => {});
  await act(async () => {});
}

function section(id: string) {
  return within(screen.getByRole('heading', { name: registry[id].title }).closest('section')!);
}

beforeEach(() => {
  fetchCompare.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('a briefing used as a planning document', () => {
  it('answers three bounded questions with dated changes, exact bases and monitoring conditions', async () => {
    respond();
    renderSample();
    await settle();
    expect(section('inflation').getByText('Is annual consumer-price pressure changing?')).toBeTruthy();
    expect(section('salary').getByText('Has the hourly labour-cost benchmark changed?')).toBeTruthy();
    expect(section('retail').getByText('Is retail volume growing relative to a year earlier?')).toBeTruthy();
    expect(section('inflation').getByText(
      'Latvia: 2.9% in August 2026, up 0.4 percentage points from 2.5% in July 2026.',
    )).toBeTruthy();
    expect(section('salary').getByText(
      'Latvia: €16.3/h in 2025, up €1.2/h from €15.1/h in 2024.',
    )).toBeTruthy();
    expect(section('retail').getByText(
      'Latvia: 7.1% in July 2026, up 2.0 percentage points from 5.1% in June 2026.',
    )).toBeTruthy();
    expect(section('inflation').getByText(/next published monthly reading with 2.9% for August 2026/)).toBeTruthy();
    expect(section('salary').getByText(/next published annual reading with €16.3\/h for 2025/)).toBeTruthy();
    expect(section('retail').getByText(/Crossing zero separates growth from contraction/)).toBeTruthy();
    expect(screen.getByText(/Release dates are not supplied/)).toBeTruthy();
  });

  it('retains URL country and section without refetching, and keeps own-latest separate from the shared comparison', async () => {
    respond({
      inflation: payload('inflation', {
        LV: [['2026-07', 2.5]],
        EE: [['2026-07', 2], ['2026-08', 1.3]],
        LT: [['2026-07', 5.4]],
      }),
    });
    renderSample('/briefings?country=EE&context=planning#briefing-inflation');
    await settle();
    expect((screen.getByLabelText('Planning focus') as HTMLSelectElement).value).toBe('EE');
    expect(section('inflation').getByText(
      'Estonia: 1.3% in August 2026, down 0.7 percentage points from 2.0% in July 2026.',
    )).toBeTruthy();
    expect(section('inflation').getByText(/In July 2026, the reading ranged/)).toBeTruthy();
    expect(section('inflation').getByText(/Newer own-country readings are available for Estonia/)).toBeTruthy();
    const table = section('inflation').getByRole('table');
    expect(within(table).getByRole('row', { name: /Estonia/ }).textContent).toContain('2.0%');
    fireEvent.change(screen.getByLabelText('Planning focus'), { target: { value: 'LT' } });
    await settle();
    expect(screen.getByLabelText('Current address').textContent)
      .toBe('/briefings?country=LT&context=planning#briefing-inflation');
    expect(section('inflation').getByText(/Lithuania: 5.4% in July 2026/)).toBeTruthy();
    expect(fetchCompare).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('link', { name: 'Prices' }).getAttribute('href'))
      .toBe('/briefings?country=LT&context=planning#briefing-inflation');
  });

  it.each([null, 'absent'])('does not bridge a missing previous month (%s), while preserving a genuine zero', async missing => {
    const points: Points = [['2026-06', 2.5], ['2026-08', 0]];
    if (missing === null) points.push(['2026-07', null]);
    respond({ inflation: payload('inflation', { LV: points, EE: points, LT: points }) });
    renderSample();
    await settle();
    const inflation = section('inflation');
    expect(inflation.getByText('Latvia: 0.0% in August 2026.')).toBeTruthy();
    expect(inflation.getByText('Change not calculated: July 2026 has no published reading for Latvia.')).toBeTruthy();
    expect(inflation.queryByText(/down 2.5/)).toBeNull();
    expect(inflation.getByText(/next published monthly reading with 0.0% for August 2026/)).toBeTruthy();
  });

  it('does not call older shared evidence the source latest when a country has moved on', async () => {
    respond({ inflation: payload('inflation', {
      LV: [['2024-01', 2], ['2026-07', 2.5], ['2026-08', 2.9]],
      EE: [['2024-01', 3]],
      LT: [['2024-01', 1]],
    }) });
    renderSample();
    await settle();
    const inflation = section('inflation');
    expect(inflation.getByText(/Latvia: 2.9% in August 2026/)).toBeTruthy();
    expect(inflation.queryByText(/published nothing newer than January 2024/)).toBeNull();
    expect(inflation.getByText(/shared comparison is January 2024/)).toBeTruthy();
  });

  it.each([
    ['ee', 'EE', 'Estonia'],
    ['unknown', 'LV', 'Latvia'],
  ])('validates a shared country selection (%s)', async (query, code, name) => {
    respond();
    renderSample(`/briefings?country=${query}`);
    await settle();
    expect((screen.getByLabelText('Planning focus') as HTMLSelectElement).value).toBe(code);
    expect(section('inflation').getByText(new RegExp(`^${name}:`))).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Briefing link' }).getAttribute('href'))
      .toBe(`/briefings?country=${code}`);
  });

  it('does not give a focus reading or a next check to a missing country', async () => {
    respond({ salary: payload('salary', { EE: [['2025', 21.1]], LT: [['2025', 17.8]] }) });
    renderSample();
    await settle();
    expect(section('salary').getByText('No planning reading is available for Latvia in this window.')).toBeTruthy();
    expect(section('salary').queryByText('Next check')).toBeNull();
    expect(section('salary').getByLabelText('No published reading for Latvia')).toBeTruthy();
    expect(section('inflation').getByText('Next check')).toBeTruthy();
  });

  it('uses the preceding calendar year and does not jump a missing annual estimate', async () => {
    respond({ salary: payload('salary', {
      LV: [['2023', 13.5], ['2024', null], ['2025', 16.3]],
      EE: [['2025', 21.1]], LT: [['2025', 17.8]],
    }) });
    renderSample();
    await settle();
    expect(section('salary').getByText('Change not calculated: 2024 has no published reading for Latvia.')).toBeTruthy();
    expect(section('salary').queryByText(/up €2.8/)).toBeNull();
  });

  it('compares January against December and a zero against zero without claiming a direction', async () => {
    const points: Points = [['2026-01', 0], ['2025-12', 0]];
    respond({ inflation: payload('inflation', { LV: points, EE: points, LT: points }) });
    renderSample();
    await settle();
    expect(section('inflation').getByText(
      'Latvia: 0.0% in January 2026, unchanged from 0.0% in December 2025.',
    )).toBeTruthy();
  });

  it('copies the selected view and clears obsolete feedback when the focus changes', async () => {
    respond();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = renderSample('/briefings?country=EE#briefing-retail');
    await settle();
    const status = container.querySelector('.public-briefing-focus [role="status"]')!;
    expect(status.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Copy briefing link' }));
    await settle();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/briefings?country=EE#briefing-retail`);
    expect(status.textContent).toBe('Briefing link copied. Readings may change when it is reopened.');
    fireEvent.change(screen.getByLabelText('Planning focus'), { target: { value: 'LT' } });
    await settle();
    expect(status.textContent).toBe('');
  });

  it('offers an actual fallback address if clipboard access fails', async () => {
    respond();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true,
    });
    renderSample('/briefings?country=LT#briefing-salary');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Copy briefing link' }));
    await settle();
    expect(screen.getByText('Copy is unavailable. Use the briefing link to copy its address.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Briefing link' }).getAttribute('href'))
      .toBe('/briefings?country=LT#briefing-salary');
  });

  it('does not turn the requested history parameter into a claim about the observed span', async () => {
    // `years=3` starts at a calendar-year boundary; a September reading can
    // retrieve more than 36 months. The delivered periods own the scope.
    const points: Points = [['2023-01', 1], ['2026-07', 2.5], ['2026-08', 2.9]];
    respond({ inflation: payload('inflation', { LV: points, EE: points, LT: points }) });
    renderSample();
    await settle();
    expect(section('inflation').getByText(
      'CSV and JSON include all three countries and the full retrieved window, not just the displayed readings.',
    )).toBeTruthy();
    expect(section('inflation').queryByText(/3-year window/)).toBeNull();
    expect(fetchCompare).toHaveBeenCalledWith('inflation', 3);
  });
});
