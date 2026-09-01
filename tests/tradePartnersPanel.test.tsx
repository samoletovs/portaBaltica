/**
 * What the trade-partner panel puts in front of a reader.
 *
 * The endpoint's own suite (`tradePartners.test.ts`) proves the figures are the
 * ones the cube holds. This proves the *rendering*, which is a separate
 * question and one `AGENTS.md` records the numeric contract being structurally
 * blind to: a correct figure in an unreadable scale, or under a raw Latvian
 * column heading, passes every check about the number.
 *
 * Four things are pinned because each was a real decision rather than a
 * default:
 *
 *   1. **No Latvian identifiers reach the reader.** The cube's columns are
 *      `Gads`, `Menesis`, `Partnervalsts`, `Preces_KN_kods`. The UI is English
 *      and i18n is deferred, so a raw column name on screen would be an
 *      accident rather than a translation policy.
 *
 *   2. **An unnameable partner code is shown as a code.** Six of the 160 codes
 *      in a month are Eurostat geonomenclature, not ISO 3166. Inventing a
 *      country for one is worse than admitting we cannot name it.
 *
 *   3. **Magnitudes are readable.** `AGENTS.md` records the newsroom publishing
 *      "4653 thousand rail passengers" while the dashboard rendered the same
 *      number as `4.65m`. Raw euros are worse: 1695600000 as a bare number is
 *      unreadable in any context.
 *
 *   4. **Direction is not carried by colour alone.** `--data-positive` and
 *      `--data-negative` sit at ΔE 8 under a deuteranopia simulation, so for
 *      roughly 8% of men colour carries nothing (WCAG 2.2 SC 1.4.1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TradePartnersData } from '../src/types';

const fetchTradePartners = vi.fn();
vi.mock('../src/api', () => ({
  fetchTradePartners: (...args: unknown[]) => fetchTradePartners(...args),
}));

const country = { current: 'LV' };
vi.mock('../src/CountryContext', () => ({
  useCountry: () => ({ country: country.current, countryLabel: 'Latvia', flag: '🇱🇻' }),
}));

import { TradePartnersPanel } from '../src/components/TradePartnersPanel';

/** A month shaped exactly like the live one, with the live figures. */
function payload(over: Partial<TradePartnersData> = {}): TradePartnersData {
  const direction = (label: string, total: number, prev: number) => ({
    label,
    period: '2026-06',
    totalEur: total,
    lines: 29860,
    partners: [
      { code: 'LT', name: 'Lithuania', valueEur: 330080739, share: 0.195 },
      { code: 'EE', name: 'Estonia', valueEur: 193938032, share: 0.114 },
      { code: 'XU', name: 'United Kingdom (excl. N. Ireland)', valueEur: 93800000, share: 0.055 },
      // The case that matters: a code with no name behind it.
      { code: 'ZZ', name: null, valueEur: 1000000, share: 0.0006 },
    ],
    otherPartnersEur: 443200000,
    chapters: [
      { code: 'HS44', name: 'Wood and wood articles', valueEur: 248674149, share: 0.147 },
      { code: 'HS85', name: 'Electrical machinery', valueEur: 191273337, share: 0.113 },
    ],
    otherChaptersEur: 500000000,
    previous: { period: '2025-06', valueEur: prev, changePct: ((total - prev) / prev) * 100 },
  });

  return {
    country: 'LV',
    countryOnly: true,
    exports: direction('Exports', 1695600000, 1429600000),
    imports: direction('Imports', 2171600000, 1903800000),
    balanceEur: -476000000,
    unit: 'EUR',
    dataAsOf: '2026-06',
    periodsDiffer: false,
    source: 'Centrala statistikas parvalde, ats_kn8_men (data.gov.lv, CC BY 4.0)',
    fetchedAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  country.current = 'LV';
  fetchTradePartners.mockResolvedValue(payload());
});

describe('the panel renders the month it was given', () => {
  it('draws both directions and dates them', async () => {
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(screen.getByText('Imports')).toBeTruthy();
    // `formatPeriod` turns `2026-06` into a human month.
    expect(document.body.textContent).toMatch(/Jun\w*\s*2026/i);
  });

  it('renders euro magnitudes readably, never as a raw integer', async () => {
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    const text = document.body.textContent ?? '';

    // 1695600000 is unreadable; €1.7bn is not.
    expect(text).not.toContain('1695600000');
    expect(text).not.toContain('330080739');
    expect(text).toMatch(/€1\.7\d?bn/);
    expect(text).toMatch(/€330m/);
  });

  it('shows an unnameable partner code as a code, never as a country', async () => {
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    // Bracketed, so a reader can see it is a code rather than a place.
    expect(screen.getAllByText('[ZZ]').length).toBeGreaterThan(0);
  });

  it('names the codes that are not countries', async () => {
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(screen.getAllByText('United Kingdom (excl. N. Ireland)').length).toBeGreaterThan(0);
  });

  it('states the remainder, so a top-N ranking does not read as everything', async () => {
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(document.body.textContent).toMatch(/Everything else/);
  });
});

describe('no Latvian column identifier reaches a reader', () => {
  const LATVIAN_COLUMNS = [
    'Gads', 'Menesis', 'Mēnesis', 'Partnervalsts', 'Preces_KN', 'Preču',
    'Statistiska_vertiba', 'Statistiskā', 'Neto_masa', 'Papildmervieniba',
    'Daudzums', 'Eksports', 'Imports_',
  ];

  it('renders none of them', async () => {
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    const text = document.body.textContent ?? '';

    for (const column of LATVIAN_COLUMNS) {
      expect(text, `${column} is a raw upstream column name and must not be shown`)
        .not.toContain(column);
    }
  });

  it('would catch one if it appeared', async () => {
    // The negative control. Without it, the assertion above passes for a panel
    // that renders nothing at all — which is exactly what jsdom produces when a
    // component throws, and would read as "no Latvian identifiers found".
    fetchTradePartners.mockResolvedValue(payload({
      exports: { ...payload().exports, label: 'Eksports' },
    }));
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Eksports')).toBeTruthy());
    expect(document.body.textContent).toContain('Eksports');
  });
});

describe('direction is carried by more than colour', () => {
  it('prints a glyph and an explicit sign beside every change', async () => {
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    const text = document.body.textContent ?? '';

    // ▲ for a rise, and a typographic plus. Both directions rose in the live
    // month, so both are up.
    expect(text).toContain('\u25b2');
    expect(text).toMatch(/\+18\.6%/);
    expect(text).toMatch(/\+14\.1%/);
  });

  it('describes the change in words for a screen reader', async () => {
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    // `changeDescription` produces the prose. The point is that the direction
    // survives with colour and the glyph both removed.
    expect(document.body.textContent).toMatch(/up .*against the same month a year earlier/i);
  });

  it('draws a fall with the falling glyph and a minus', async () => {
    const base = payload();
    fetchTradePartners.mockResolvedValue(payload({
      exports: {
        ...base.exports,
        totalEur: 1000000000,
        previous: { period: '2025-06', valueEur: 1429600000, changePct: -30.0 },
      },
    }));
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    const text = document.body.textContent ?? '';
    expect(text).toContain('\u25bc');
    // A typographic minus, not a hyphen — it aligns with the digits.
    expect(text).toContain('\u221230.0%');
  });
});

describe('what it does when the data is not there', () => {
  it('says the year-earlier figure is missing rather than comparing to something else', async () => {
    const base = payload();
    fetchTradePartners.mockResolvedValue(payload({
      exports: { ...base.exports, previous: null },
    }));
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(screen.getByText(/No year-earlier figure published/)).toBeTruthy();
  });

  it('draws an honest empty state when the fetch fails', async () => {
    fetchTradePartners.mockRejectedValue(new Error('upstream down'));
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText(/Trade partner data unavailable/)).toBeTruthy());
    // Not a zero. A confident zero is this codebase's signature failure.
    expect(document.body.textContent).not.toMatch(/€0\b/);
  });

  it('survives a payload that is not the shape it claims', async () => {
    // `{ exports: {} }` is the interesting one. A truthiness guard passes it
    // straight through, and the panel then draws a block with an empty
    // heading, `N/A` for a total and two "unavailable" lists — which looks
    // broken rather than saying it has nothing. A direction is only a
    // direction if it names the month it describes.
    for (const hostile of [{}, { exports: null }, { exports: {}, imports: {} }, { exports: payload().exports }]) {
      fetchTradePartners.mockResolvedValue(hostile);
      const { unmount } = render(<TradePartnersPanel />);
      await waitFor(() => expect(screen.getByText(/Trade partner data unavailable/)).toBeTruthy());
      unmount();
    }
  });

  it('renders a direction whose partner list is empty without claiming zero', async () => {
    const base = payload();
    fetchTradePartners.mockResolvedValue(payload({
      exports: { ...base.exports, partners: [], otherPartnersEur: null },
    }));
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(screen.getByText(/Partner breakdown unavailable/)).toBeTruthy();
  });
});

describe('the panel does not pretend to follow the country selector', () => {
  it('says so when the reader is looking at another country', async () => {
    country.current = 'EE';
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(screen.getByText(/does not follow the country selector/)).toBeTruthy();
  });

  it('stays quiet when the reader is already on Latvia', async () => {
    country.current = 'LV';
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(screen.queryByText(/does not follow the country selector/)).toBeNull();
  });

  it('reads countryOnly from the payload rather than assuming it', async () => {
    // If the API ever stops claiming to be Latvia-only, the notice must stop
    // too — otherwise the panel is asserting something the producer no longer
    // says, which is the producer/consumer drift this repo keeps paying for.
    country.current = 'EE';
    fetchTradePartners.mockResolvedValue(payload({ countryOnly: false }));
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(screen.queryByText(/does not follow the country selector/)).toBeNull();
  });

  it('compares the selector against the country the payload names', async () => {
    // The discriminating case, and the only one that separates reading
    // `data.country` from restating `'LV'`: a payload that says it describes
    // Estonia, read by a reader who is already on Estonia. Against the literal
    // this shows the notice — telling a reader looking at Estonian data that
    // it is not Estonian.
    country.current = 'EE';
    fetchTradePartners.mockResolvedValue(payload({ country: 'EE' }));
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(screen.queryByText(/does not follow the country selector/)).toBeNull();
  });

  it('renders in the unit the payload names, rather than one of its own', async () => {
    // `EUR/month` formats as whole euro with no magnitude suffix, so it is
    // visibly different from `EUR` on the same number. A panel restating
    // `'EUR'` renders €1.7bn here; one reading the payload renders the full
    // figure. Neither is wrong about the number — they disagree about what the
    // API said, which is the whole point.
    fetchTradePartners.mockResolvedValue(payload({ unit: 'EUR/month' }));
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/€1,695,600,000/);
    expect(text).not.toMatch(/€1\.7\d?bn/);
  });

  it('names its source, so a reader can go and check', async () => {
    render(<TradePartnersPanel />);
    await waitFor(() => expect(screen.getByText('Exports')).toBeTruthy());
    expect(document.body.textContent).toContain('ats_kn8_men');
  });
});

describe('the panel is mounted where a reader will meet it', () => {
  it('is rendered by the Trade tile', () => {
    // The imports are at module scope rather than dynamic: `suiteDeterminism`
    // flags a file carrying both a wall clock and a dynamic import, because
    // that combination is what flaked. Hoisting costs nothing and removes the
    // amplifier rather than declaring it.
    const tile = readFileSync(resolve('src/components/TradeTile.tsx'), 'utf8');

    // `<TradePartnersPanel` and not the bare symbol: the loose form is
    // satisfied by an import that is never rendered, which is a component that
    // exists and that nobody can see.
    expect(tile, 'the panel must actually be rendered, not merely imported')
      .toMatch(/<TradePartnersPanel\b/);
  });
});
