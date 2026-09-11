import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PublicBriefingSample } from '../src/components/news/PublicBriefingSample';
import type { BalticCompareData } from '../src/api';

/**
 * `PublicBriefingSample` draws three independent measures — inflation,
 * hourly labour cost, retail sales growth — each from its own
 * `fetchBalticCompare` call. These tests cover the one rule the component
 * exists to enforce (never compare three countries across three different
 * periods without saying so), the failure isolation between sections, and
 * the retry/cancellation plumbing.
 *
 * Two `act` flushes rather than `waitFor`/`findBy*`: `tests/suiteDeterminism.test.ts`
 * forbids adding a new wall-clock wait to this parallel suite. Each section
 * resolves one promise then sets state once, so flushing the microtask queue
 * twice is deterministic and needs no timer.
 */

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...args: unknown[]) => fetchBalticCompare(...args),
}));

async function settle() {
  await act(async () => {});
  await act(async () => {});
}

function renderSample() {
  return render(
    <MemoryRouter>
      <PublicBriefingSample />
    </MemoryRouter>,
  );
}

function series(points: [string, number | null][]) {
  return points.map(([period, value]) => ({ period, value }));
}

function fixture(
  indicator: string,
  countries: Partial<Record<'LV' | 'EE' | 'LT', [string, number | null][]>>,
  overrides: Partial<Pick<BalticCompareData, 'title' | 'unit' | 'source' | 'dataset' | 'fetchedAt'>> = {},
): BalticCompareData {
  return {
    indicator,
    title: overrides.title ?? `Title for ${indicator}`,
    unit: overrides.unit ?? '%',
    source: overrides.source ?? 'Eurostat',
    dataset: overrides.dataset,
    fetchedAt: overrides.fetchedAt,
    countries: Object.fromEntries(
      Object.entries(countries).map(([code, points]) => [
        code,
        { label: code, series: series(points as [string, number | null][]) },
      ]),
    ),
  } as BalticCompareData;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The `<section>` a heading's own content lives in, so assertions cannot
    leak across measures that happen to share a word. */
function sectionOf(headingName: string) {
  const heading = screen.getByRole('heading', { name: headingName });
  const element = heading.closest('section');
  if (!element) throw new Error(`no <section> ancestor for "${headingName}"`);
  return { ...within(element), element };
}

const REAL = {
  inflation: fixture(
    'inflation',
    {
      LV: [['2026-07', 2.1], ['2026-08', 2.5]],
      EE: [['2026-07', 4.0], ['2026-08', 4.2]],
      LT: [['2026-07', 1.0], ['2026-08', 1.5]],
    },
    { title: 'HICP Inflation', unit: '% YoY', dataset: 'prc_hicp_minr', fetchedAt: '2026-09-08T10:00:00Z' },
  ),
  salary: fixture(
    'salary',
    {
      LV: [['2024', 9.5], ['2025', 10.2]],
      EE: [['2024', 13.0], ['2025', 14.1]],
      LT: [['2024', 8.0], ['2025', 8.9]],
    },
    { title: 'Hourly labour cost', unit: 'EUR/hour', dataset: 'lc_lci_lev' },
  ),
  retail: fixture(
    'retail',
    {
      // Latvia is a real, published zero — it must survive as "0.0%", never
      // as an absent reading and never folded into a "missing" note.
      LV: [['2026-07', 0.0], ['2026-08', 0.0]],
      EE: [['2026-07', -1.0], ['2026-08', -1.2]],
      LT: [['2026-07', 2.0], ['2026-08', 2.4]],
    },
    { title: 'Retail sales growth', unit: '% YoY', dataset: 'sts_trtu_m', fetchedAt: '2026-09-08T10:05:00Z' },
  ),
};

function respondWith(map: Partial<Record<string, BalticCompareData | Promise<BalticCompareData | null> | (() => Promise<BalticCompareData | null>)>>) {
  fetchBalticCompare.mockImplementation((id: string) => {
    const entry = map[id];
    if (typeof entry === 'function') return entry();
    if (entry && typeof entry === 'object' && 'then' in entry) return entry;
    return Promise.resolve((entry as BalticCompareData | undefined) ?? null);
  });
}

beforeEach(() => {
  fetchBalticCompare.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  // A fixed instant so `freshnessOf` and `formatPeriod` are deterministic:
  // 2026-08 is one month behind (fresh for a monthly series), 2025 is nine
  // months behind (fresh for an annual one).
  vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a real-shaped fixture, fetched independently per measure', () => {
  it('links its contents to the three actual, focusable measure sections even while loading', () => {
    const pending = deferred<BalticCompareData | null>();
    respondWith({ inflation: pending.promise, salary: pending.promise, retail: pending.promise });
    renderSample();

    const contents = screen.getByRole('navigation', { name: 'Briefing contents' });
    const links = within(contents).getAllByRole('link');
    const sections = [...document.querySelectorAll('section.public-briefing-measure')];
    expect(links).toHaveLength(sections.length);
    expect(sections).toHaveLength(3);
    links.forEach((link, index) => {
      expect(link.getAttribute('href')!.split('#')[1]).toBe(sections[index].id);
      expect(sections[index].getAttribute('tabindex')).toBe('-1');
      expect(sections[index].getAttribute('aria-labelledby'))
        .toBe(sections[index].querySelector('h2')?.id);
    });
  });

  it('makes each country the named research link without a fourth column of repeated View controls', async () => {
    respondWith(REAL);
    renderSample();
    await settle();

    for (const data of Object.values(REAL)) {
      const section = sectionOf(data.title);
      expect(within(section.getByRole('table')).getAllByRole('columnheader').map(cell => cell.textContent))
        .toEqual(['Country', 'Value', 'Period']);
      for (const [code, name] of [['LV', 'Latvia'], ['EE', 'Estonia'], ['LT', 'Lithuania']]) {
        const row = section.getByRole('row', { name: new RegExp(name) });
        const link = within(row).getByRole('link', {
          name: `View ${data.title} for ${name} in Data explorer`,
        });
        expect(link.closest('th')?.getAttribute('scope')).toBe('row');
        expect(link.getAttribute('href')).toBe(`/indicator/${data.indicator}?country=${code}`);
      }
    }
  });

  it('orders own-latest readings by period rather than the payload array position', async () => {
    respondWith({
      ...REAL,
      inflation: fixture('inflation', {
        LV: [['2026-08', 2.5], ['2026-06', 1]],
        EE: [['2026-07', 4.2]],
        LT: [['2026-05', 1.5]],
      }, { title: 'HICP Inflation', unit: '% YoY' }),
    });
    renderSample();
    await settle();
    const table = sectionOf('HICP Inflation').getByRole('table');
    const latvia = within(table).getByRole('row', { name: /Latvia/ });
    expect(latvia.textContent).toContain('2.5%');
    expect(latvia.textContent).toContain('August 2026');
  });

  it('reports a wrong-indicator response as a failed read, not an empty publication', async () => {
    respondWith({ ...REAL, inflation: REAL.retail });
    renderSample();
    await settle();
    const section = sectionOf('HICP Inflation');
    expect(section.getByText('This measure could not be loaded right now.')).toBeTruthy();
    expect(section.queryByText(/No published reading is available/)).toBeNull();
    expect(section.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(sectionOf('Hourly labour cost').getByRole('table')).toBeTruthy();
  });

  it('renders all three measures with their common-period range, units, links, dataset and retrieval time', async () => {
    respondWith(REAL);
    const { container } = renderSample();
    await settle();

    // Every heading present, each backed by its own fetch call.
    expect(screen.getByRole('heading', { name: 'HICP Inflation' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hourly labour cost' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Retail sales growth' })).toBeTruthy();
    expect(fetchBalticCompare).toHaveBeenCalledWith('inflation', 3);
    expect(fetchBalticCompare).toHaveBeenCalledWith('salary', 3);
    expect(fetchBalticCompare).toHaveBeenCalledWith('retail', 3);

    const inflation = sectionOf('HICP Inflation');
    expect(inflation.getByText('In August 2026, the reading ranged from 1.5% in Lithuania to 4.2% in Estonia.')).toBeTruthy();
    expect(inflation.getByRole('link', { name: /View dataset prc_hicp_minr/ }).getAttribute('href'))
      .toBe('https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table?lang=en');
    expect(inflation.element.textContent).toContain('Retrieved');
    expect(inflation.element.textContent).toContain('8 Sept 2026');

    const salary = sectionOf('Hourly labour cost');
    expect(salary.getByText('In 2025, the reading ranged from €8.9/h in Lithuania to €14.1/h in Estonia.')).toBeTruthy();
    // No `fetchedAt` was supplied for this fixture: the omission must not be
    // filled in with the render clock.
    expect(salary.element.textContent).not.toContain('Retrieved');

    const retail = sectionOf('Retail sales growth');
    expect(retail.getByText('In August 2026, the reading ranged from -1.2% in Estonia to 2.4% in Lithuania.')).toBeTruthy();
    // Latvia's real zero renders as a value, not an absent reading.
    expect(retail.queryByText(/No reading available for Latvia/)).toBeNull();
    expect(retail.getAllByText('0.0%').length).toBeGreaterThan(0);

    // Individual country evidence links, one per country per measure.
    for (const [id, code] of [
      ['inflation', 'LV'], ['inflation', 'EE'], ['inflation', 'LT'],
      ['salary', 'LV'], ['salary', 'EE'], ['salary', 'LT'],
      ['retail', 'LV'], ['retail', 'EE'], ['retail', 'LT'],
    ] as const) {
      const link = [...container.querySelectorAll('a')].find(
        (a) => a.getAttribute('href') === `/indicator/${id}?country=${code}`,
      );
      expect(link, `/indicator/${id}?country=${code}`).toBeTruthy();
    }

    // A working export on every measure that has data.
    expect(screen.getByRole('button', { name: 'Download HICP Inflation as CSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Hourly labour cost as JSON' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Retail sales growth as CSV' })).toBeTruthy();
  });

  it('states each country\u2019s value at the shared period, not a mix of periods', async () => {
    respondWith(REAL);
    renderSample();
    await settle();

    const salary = sectionOf('Hourly labour cost');
    expect(salary.getByText('€10.2/h')).toBeTruthy(); // Latvia at 2025
    expect(salary.getByText('€14.1/h')).toBeTruthy(); // Estonia at 2025
    expect(salary.getByText('€8.9/h')).toBeTruthy(); // Lithuania at 2025
    // 2024 values must not leak into the table: they belong to a period the
    // section is not reporting on.
    expect(salary.queryByText('€9.5/h')).toBeNull();
    expect(salary.queryByText('€13.0/h')).toBeNull();
    expect(salary.queryByText('€8.0/h')).toBeNull();
  });

  it('does not fake freshness: an old common period is named as stale', async () => {
    respondWith({
      ...REAL,
      inflation: fixture(
        'inflation',
        { LV: [['2024-01', 2.0]], EE: [['2024-01', 3.0]], LT: [['2024-01', 1.0]] },
        { title: 'HICP Inflation', unit: '% YoY' },
      ),
    });
    renderSample();
    await settle();

    const inflation = sectionOf('HICP Inflation');
    expect(inflation.getByText(/published nothing newer than January 2024/)).toBeTruthy();
    // The badge beside the heading and every row of the table all carry the
    // same period, since the three countries share it.
    expect(inflation.getAllByText('January 2024').length).toBeGreaterThan(0);

    // The control: a section that is current says nothing of the kind.
    const salary = sectionOf('Hourly labour cost');
    expect(salary.queryByText(/published nothing newer/)).toBeNull();
  });
});

describe('when the countries have not published a shared period', () => {
  it('distinguishes a missing country from countries reporting different periods', async () => {
    respondWith({
      ...REAL,
      salary: fixture('salary', { LV: [['2025', 10.2]], EE: [['2025', 14.1]] },
        { title: 'Hourly labour cost', unit: 'EUR/hour' }),
    });
    renderSample();
    await settle();
    const salary = sectionOf('Hourly labour cost');
    expect(salary.getByText(/does not contain readings for all three countries/)).toBeTruthy();
    expect(salary.getByText('No reading available for Lithuania in the retrieved window.')).toBeTruthy();
    expect(salary.queryByText(/different periods|Periods differ/)).toBeNull();
    expect(salary.queryByText(/ranged from/)).toBeNull();
    expect(salary.getByText('€10.2/h')).toBeTruthy();
    expect(salary.getByLabelText('No published reading for Lithuania')).toBeTruthy();
  });

  it('shows each country\u2019s own latest reading and states plainly that no range can be computed', async () => {
    respondWith({
      ...REAL,
      // Three disjoint single readings: no period is shared by all three, so
      // no common period can ever be found, at the newest date or any other.
      salary: fixture(
        'salary',
        { LV: [['2023', 9.0]], EE: [['2025', 14.0]], LT: [['2024', 8.0]] },
        { title: 'Hourly labour cost', unit: 'EUR/hour' },
      ),
    });
    renderSample();
    await settle();

    const salary = sectionOf('Hourly labour cost');
    expect(salary.getByText(/last published this measure for different periods/)).toBeTruthy();
    // No fabricated three-way gap.
    expect(salary.queryByText(/ranged from/)).toBeNull();

    // Each own reading, each with its own period, all shown.
    expect(salary.getByText('€9.0/h')).toBeTruthy();
    expect(salary.getByText('2023')).toBeTruthy();
    expect(salary.getByText('€14.0/h')).toBeTruthy();
    expect(salary.getByText('2025')).toBeTruthy();
    expect(salary.getByText('€8.0/h')).toBeTruthy();
    expect(salary.getByText('2024')).toBeTruthy();

    // Untouched sibling measures still compute their common-period range.
    const inflation = sectionOf('HICP Inflation');
    expect(inflation.getByText(/ranged from/)).toBeTruthy();
  });
});

describe('when nothing at all has been published', () => {
  it('says so without inventing a range, and offers a retry', async () => {
    respondWith({
      ...REAL,
      inflation: fixture('inflation', {}, { title: 'HICP Inflation', unit: '% YoY' }),
    });
    const { container } = renderSample();
    await settle();

    const inflation = sectionOf('HICP Inflation');
    expect(inflation.getByText(/No published reading is available for this measure/)).toBeTruthy();
    expect(inflation.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // No table for a measure with nothing to show.
    expect(container.querySelector('#public-briefing-inflation')?.closest('section')?.querySelector('table')).toBeNull();
  });
});

describe('one measure failing does not affect the others', () => {
  it('does not interpret an absent payload as evidence that nothing was published', async () => {
    respondWith({ inflation: REAL.inflation, retail: REAL.retail });
    renderSample();
    await settle();
    const salary = sectionOf('Hourly labour cost');
    expect(salary.getByText('This measure could not be loaded right now.')).toBeTruthy();
    expect(salary.queryByText(/No published reading is available/)).toBeNull();
    expect(sectionOf('HICP Inflation').getByRole('table')).toBeTruthy();
  });

  it('shows an explicit error and retry for the failed measure only', async () => {
    respondWith({
      inflation: REAL.inflation,
      salary: () => Promise.reject(new Error('network down')),
      retail: REAL.retail,
    });
    renderSample();
    await settle();

    const salary = sectionOf('Hourly labour cost');
    expect(salary.getByText(/This measure could not be loaded right now\./)).toBeTruthy();
    expect(salary.getByRole('button', { name: 'Retry' })).toBeTruthy();

    // The other two sections are unaffected by salary's rejection.
    const inflation = sectionOf('HICP Inflation');
    expect(inflation.getByText(/ranged from/)).toBeTruthy();
    const retail = sectionOf('Retail sales growth');
    expect(retail.getByText(/ranged from/)).toBeTruthy();
  });

  it('recovers on retry, issuing a fresh request rather than reusing the failure', async () => {
    respondWith({
      inflation: REAL.inflation,
      salary: () => Promise.reject(new Error('network down')),
      retail: REAL.retail,
    });
    renderSample();
    await settle();

    expect(sectionOf('Hourly labour cost').getByText(/could not be loaded/)).toBeTruthy();
    expect(fetchBalticCompare.mock.calls.filter(([id]) => id === 'salary')).toHaveLength(1);

    respondWith({ inflation: REAL.inflation, salary: REAL.salary, retail: REAL.retail });
    fireEvent.click(sectionOf('Hourly labour cost').getByRole('button', { name: 'Retry' }));
    await settle();

    expect(fetchBalticCompare.mock.calls.filter(([id]) => id === 'salary')).toHaveLength(2);
    const salary = sectionOf('Hourly labour cost');
    expect(salary.queryByText(/could not be loaded/)).toBeNull();
    expect(salary.getByText(/ranged from/)).toBeTruthy();
  });
});

describe('cancellation', () => {
  it('ignores a response that arrives after the section has unmounted', async () => {
    const pending = deferred<BalticCompareData | null>();
    respondWith({
      inflation: () => pending.promise,
      salary: REAL.salary,
      retail: REAL.retail,
    });
    const { unmount } = renderSample();
    await settle();

    // Inflation is still loading; the other two settled normally.
    expect(sectionOf('Hourly labour cost').getByText(/ranged from/)).toBeTruthy();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    pending.resolve(REAL.inflation);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const unmountedWarning = errorSpy.mock.calls.some((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('unmounted')),
    );
    expect(unmountedWarning, 'a cancelled fetch must not touch state after unmount').toBe(false);
    errorSpy.mockRestore();
  });

  it('ignores a stale attempt superseded by a retry, keeping only the newest response', async () => {
    let salaryCalls = 0;
    const second = deferred<BalticCompareData | null>();
    respondWith({
      inflation: REAL.inflation,
      retail: REAL.retail,
      salary: () => {
        salaryCalls += 1;
        if (salaryCalls === 1) return Promise.reject(new Error('first attempt fails'));
        return second.promise;
      },
    });
    renderSample();
    await settle();

    expect(sectionOf('Hourly labour cost').getByText(/could not be loaded/)).toBeTruthy();
    fireEvent.click(sectionOf('Hourly labour cost').getByRole('button', { name: 'Retry' }));
    await settle();

    // The retry (attempt 2) is in flight; nothing has resolved it yet, so the
    // section is back to its loading state rather than a stale error.
    expect(sectionOf('Hourly labour cost').queryByText(/could not be loaded/)).toBeNull();
    expect(sectionOf('Hourly labour cost').queryByText(/ranged from/)).toBeNull();

    second.resolve(REAL.salary);
    await settle();

    const salary = sectionOf('Hourly labour cost');
    expect(salary.getByText(/ranged from/)).toBeTruthy();
    expect(salaryCalls).toBe(2);
  });
});
