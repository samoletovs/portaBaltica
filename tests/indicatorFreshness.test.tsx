import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
// Imported at module scope, not inside a test.
//
// `tests/suiteDeterminism.test.ts` names a wall-clock wait beside a dynamic
// import as the combination that flaked, and it is right: a `await import()`
// in a test body is real work — Vite transforming a module — competing with
// every other worker, which is precisely what turns a timer into a coin flip.
// This file carried both when it was first written.
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { IndicatorCard, IndicatorChart } from '../src/components/IndicatorCard';
import { IndicatorTable } from '../src/components/IndicatorTable';
import { WARN_AFTER_MONTHS, STALE_AFTER_MONTHS } from '../src/dataFreshness';

/**
 * A frozen series must not render as news.
 *
 * WHAT WAS BROKEN
 * ---------------
 * `/api/historical-data` computes `es.isSeriesStale(series)` and ships the
 * verdict in its payload. `IndicatorCard` read the series and dropped the
 * field. Measured by rendering these components against a series whose newest
 * observation was `2022-Q1`, with the server reporting `stale: true, age: 54`:
 *
 *   IndicatorCard   2.2%  ▲ +0.3% up, which is favourable for this indicator
 *   IndicatorChart  2.2% Latest · 1.9% Previous · +0.30 Change
 *   IndicatorTable  no period anywhere in the rendered DOM
 *
 * Four and a half years old, under the word **Latest**, in green. Not a missing
 * computation — a computed answer discarded at the render layer, which is worse
 * than an absent feature because everything upstream reports success.
 *
 * `AGENTS.md` records the case this is about: `prc_hicp_manr` served HTTP 200
 * with valid JSON-stat and plausible values while frozen at 2025-12 for eight
 * months. `tests/indicators.live.test.ts` would catch that post-deploy. For
 * those eight months the reader would have seen a confident number with a
 * favourable green arrow.
 *
 * WHY THE DATE MATTERS MORE THAN THE NOTICE
 * -----------------------------------------
 * The stale notice only helps a series that has already crossed a threshold we
 * chose. The period beside the value helps every series every day, and it is
 * what lets a *reader* catch a freeze the thresholds have not. So the "dates
 * its value" tests below are the load-bearing ones, and they assert the fresh
 * case as much as the stale one.
 */

const NOW_QUARTER = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
})();

/** Five quarterly readings ending at `last`. */
function seriesEnding(last: string) {
  return [
    { period: '2021-Q1', value: 1.0 },
    { period: '2021-Q2', value: 1.3 },
    { period: '2021-Q3', value: 1.6 },
    { period: '2021-Q4', value: 1.9 },
    { period: last, value: 2.2 },
  ];
}

function payload(last: string) {
  return {
    indicator: 'gdp',
    title: 'GDP growth rate',
    unit: '% change',
    source: 'Eurostat (namq_10_gdp)',
    countries: { LV: { series: seriesEnding(last) } },
    reference: null,
    assumptions: [],
  };
}

const fetchBalticCompare = vi.fn();
vi.mock('../src/api', () => ({
  fetchBalticCompare: (...a: unknown[]) => fetchBalticCompare(...(a as [])),
}));

vi.mock('../src/CountryContext', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useCountry: () => ({ country: 'LV', countryLabel: 'Latvia', flag: '', setCountry: () => {} }),
  };
});

beforeEach(() => {
  fetchBalticCompare.mockReset();
  // The Latvian PxWeb path is not under test here and must not reach the
  // network — `tests/noNetwork.ts` would refuse it anyway, which is the point.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => null } as unknown as Response),
  );
});

async function shell(node: ReactNode) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <CountryProvider>
          <FilterProvider>{node}</FilterProvider>
        </CountryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/**
 * Let the component's fetch settle, without a clock.
 *
 * `tests/suiteDeterminism.test.ts` forbids `waitFor`/`findBy*` here and it is
 * right to: a wall-clock wait inside a parallel suite is what makes
 * `dashboardCadence` fail once in two runs under worker contention, and this
 * file was a fresh offender the moment it was written — it carried a clock and
 * a dynamic import, the combination that guard names as the amplifier.
 *
 * The mocked API resolves immediately, so there is nothing to wait *for*: two
 * drains of the microtask queue inside `act` settle the fetch and the state
 * update it schedules. That is deterministic under any load, where a timer is
 * a guess about how busy the machine is.
 */
async function settle() {
  await act(async () => {});
  await act(async () => {});
}

/** Every inline colour a rendered element carries, with the text it colours. */
function colours(container: HTMLElement): { text: string; colour: string }[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="color"]')].map((el) => ({
    text: (el.textContent ?? '').trim(),
    colour: /color:\s*([^;]+)/.exec(el.getAttribute('style') ?? '')?.[1]?.trim() ?? '',
  }));
}

const STALE_SENTENCE = /This series has published nothing newer than/;

describe('the compact indicator card', () => {
  async function card(last: string) {
    fetchBalticCompare.mockResolvedValue(payload(last));
    const view = await shell(<IndicatorCard id="gdp" title="GDP growth rate" unit="% change" />);
    await settle();
    return view.container;
  }

  /** The baseline row that carries the headline value, its date and its delta. */
  function valueRow(container: HTMLElement): HTMLElement | undefined {
    return [...container.querySelectorAll<HTMLElement>('div.flex.items-baseline')][0];
  }

  it('dates its value, fresh or stale', async () => {
    // The load-bearing assertion. A figure with no date asks to be trusted
    // rather than read, and this is the half that helps every series.
    //
    // Scoped to the row holding the value, not to the card. The card also draws
    // the two axis endpoints under its sparkline, which carry the same period —
    // so a page-wide `toContain` would pass with the date removed from the
    // value entirely. A planted fault proved exactly that on the sibling test
    // for the detail chart.
    const stale = valueRow(await card('2022-Q1'));
    expect(stale, 'no value row').toBeTruthy();
    expect(stale!.textContent, 'the headline value carries no period').toContain('Q1 2022');

    const fresh = valueRow(await card(NOW_QUARTER));
    expect(fresh!.textContent).toContain(
      `Q${Number(NOW_QUARTER.slice(-1))} ${NOW_QUARTER.slice(0, 4)}`,
    );
  }, 30_000);

  it('says so when the series has stopped', async () => {
    expect((await card('2022-Q1')).textContent).toMatch(STALE_SENTENCE);
  }, 30_000);

  it('says nothing of the sort when the series is current', async () => {
    // The companion. Without it the assertion above passes on a component that
    // cries stale at everything, which is the warning readers learn to ignore —
    // worse than none, because it covers the real ones too.
    expect((await card(NOW_QUARTER)).textContent).not.toMatch(STALE_SENTENCE);
  }, 30_000);

  it('drops the sentiment colour on a stale change, and keeps it on a fresh one', async () => {
    // Item 3, and the argument is in the component: the delta is a true
    // statement about the last two readings, so it stays. The *colour* is a
    // present-tense claim that a rise is favourable, and applying that to a
    // series which stopped in 2022 is the same fault as colouring by raw
    // direction — which `polarity.ts` exists to prevent.
    const fresh = colours(await card(NOW_QUARTER)).find((c) => c.text.includes('+0.3'));
    expect(fresh?.colour, 'a current change must still carry its meaning').toBe(
      'var(--data-positive)',
    );

    const stale = colours(await card('2022-Q1')).find((c) => c.text.includes('+0.3'));
    expect(stale?.colour, 'a dead series has no sentiment').toBe('var(--text-secondary)');
  }, 30_000);

  it('keeps the change visible rather than hiding it', async () => {
    // Suppression was the other candidate and it is worse. A card that shows a
    // delta when fresh and nothing when stale is structurally different from
    // its neighbours in a grid of twenty, and a missing delta reads as "no
    // change" rather than "no recent change" — absence rendering as a value,
    // which `payload.ts` records this dashboard shipping twice.
    expect((await card('2022-Q1')).textContent).toContain('+0.3');
  }, 30_000);

  it('tells a screen reader the same thing the colour does', async () => {
    // The defect this caught in its own first draft: the delta went grey while
    // the spoken description still said "which is favourable". One claim with
    // two answers, split by how you read the page.
    const stale = (await card('2022-Q1')).textContent ?? '';
    expect(stale).not.toContain('which is favourable');
    expect(stale).toContain('the last reading published');

    expect((await card(NOW_QUARTER)).textContent).toContain('which is favourable');
  }, 30_000);
});

describe('the indicator detail chart', () => {
  async function chart(last: string) {
    fetchBalticCompare.mockResolvedValue(payload(last));
    const view = await shell(<IndicatorChart id="gdp" />);
    await settle();
    return view.container;
  }

  it('dates the figure it labels "Latest"', async () => {
    // "Latest" is a claim about recency and it was carrying no date at all,
    // which is precisely what let a 2022 reading read as today's.
    //
    // Scoped to the stat box rather than to the page. The first version of this
    // asserted the date appeared anywhere in the rendered text, and a planted
    // fault proved that vacuous: deleting the date from "Latest" entirely left
    // the test green, because the stale notice below carries the same period.
    // The assertion has to name the element whose honesty is in question.
    const container = await chart('2022-Q1');

    const latestBox = [...container.querySelectorAll<HTMLElement>('div')].find((el) =>
      /^2\.2%Latest/.test((el.textContent ?? '').trim()),
    );

    expect(latestBox, 'no stat box labelled Latest').toBeTruthy();
    expect(latestBox!.textContent, 'the Latest figure carries no period').toContain('Q1 2022');
  }, 30_000);

  it('dates it on a current series too, not only a stale one', async () => {
    // The date is the half that helps every series every day. A component that
    // only dated a figure once it had already been judged stale would leave the
    // undetected freeze exactly as invisible as before.
    const container = await chart(NOW_QUARTER);
    const expected = `Q${Number(NOW_QUARTER.slice(-1))} ${NOW_QUARTER.slice(0, 4)}`;

    const latestBox = [...container.querySelectorAll<HTMLElement>('div')].find((el) =>
      /^2\.2%Latest/.test((el.textContent ?? '').trim()),
    );

    expect(latestBox, 'no stat box labelled Latest').toBeTruthy();
    expect(latestBox!.textContent).toContain(expected);
  }, 30_000);

  it('warns before the source line rather than after it', async () => {
    // The caveat has to reach the reader before the attribution that would
    // otherwise reassure them.
    const text = (await chart('2022-Q1')).textContent ?? '';
    const notice = text.search(STALE_SENTENCE);
    const source = text.indexOf('Source:');

    expect(notice, 'no stale notice on the detail chart').toBeGreaterThan(-1);
    expect(source).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(source);
  }, 30_000);

  it('stays quiet on a current series', async () => {
    expect((await chart(NOW_QUARTER)).textContent).not.toMatch(STALE_SENTENCE);
  }, 30_000);
});

describe('the key indicators table', () => {
  async function table(last: string) {
    fetchBalticCompare.mockResolvedValue(payload(last));
    const view = await shell(<IndicatorTable />);
    await settle();
    return view.container;
  }

  it('dates every row, having previously shown no period at all', async () => {
    // Measured on master before this change: the rendered table contained no
    // period text anywhere — header `Indicator | Latest | Previous | Change |
    // Trend (3Y)`, and not a date in any cell.
    expect((await table('2022-Q1')).textContent).toContain('Q1 2022');
  }, 30_000);

  it('marks a stopped row without needing a column for the sentence', async () => {
    // A row has no room for the full notice, so the date itself carries the
    // warning colour and the sentence is spoken. There is no fourth track
    // available: at 320px the row has 254px inside its padding and three tracks
    // already resolve the title column to 98px.
    const container = await table('2022-Q1');
    const warned = colours(container).filter((c) => c.colour === 'var(--data-warning)');

    expect(warned.length, 'no row flagged its stopped series').toBeGreaterThan(0);
    expect(warned[0].text).toContain('Q1 2022');
    expect(container.textContent).toContain('this series has published nothing newer');
  }, 30_000);

  it('leaves a current row unmarked', async () => {
    const container = await table(NOW_QUARTER);

    expect(colours(container).filter((c) => c.colour === 'var(--data-warning)')).toEqual([]);
    expect(container.textContent).not.toContain('this series has published nothing newer');
  }, 30_000);
});

describe('later than usual, but still publishing', () => {
  /**
   * The state this change made reachable, and the one the site had never shown.
   *
   * `freshnessOf` has always returned two flags. Every one of the 21 gates that
   * read a verdict read `stale` — "the feed looks dead" — and measured against
   * production across 72 comparison indicators and 216 series, **0 are stale**.
   * So the entire apparatus was dormant, while 20 series across 8 indicators sat
   * between 4 and 20 months behind and rendered as though current.
   *
   * A quarterly series at 8 months is past `WARN_AFTER_MONTHS.Q` (6) and well
   * inside `STALE_AFTER_MONTHS.Q` (14), which is the band these tests exercise.
   */
  async function card(last: string) {
    fetchBalticCompare.mockResolvedValue(payload(last));
    const view = await shell(<IndicatorCard id="gdp" title="GDP growth rate" unit="% change" />);
    await settle();
    return view.container;
  }

  /** Eight months behind: late for a quarterly series, nowhere near stale. */
  const LATE_QUARTER = (() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 8);
    return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  })();

  it('says so, in the shared vocabulary', async () => {
    const container = await card(LATE_QUARTER);

    expect(container.textContent, 'a late series says nothing about its age')
      .toMatch(/is later than usual: nothing newer than/);

    // The control, and it is the assertion that makes the one above mean
    // something: a *fresh* series must stay silent. Without it this passes on a
    // component that shows the notice unconditionally.
    const fresh = await card(NOW_QUARTER);
    expect(fresh.textContent, 'a current series is warned about anyway')
      .not.toMatch(/is later than usual/);
  }, 30_000);

  it('does not claim the series has stopped', async () => {
    // The two sentences are different claims and the weaker one must not
    // borrow the stronger one's words. "Has published nothing newer than" is a
    // statement about a dead feed; on a series that publishes again next
    // quarter it is simply false.
    const container = await card(LATE_QUARTER);

    expect(container.textContent).not.toMatch(STALE_SENTENCE);
  }, 30_000);

  it('keeps the change coloured, because the direction is real', async () => {
    // **The control on the scope of the whole change.** The obvious reading of
    // "wire `late` into the gates that read `stale`" is to wire it into all of
    // them, which would grey the change arrow on 20 live series whose direction
    // is correctly measured and genuinely informative.
    //
    // `late` draws attention to the date. `stale` stops asserting direction.
    // They are different jobs and only the first is widened here.
    const late = colours(await card(LATE_QUARTER));
    const fresh = colours(await card(NOW_QUARTER));

    const sentimentOf = (rows: { text: string; colour: string }[]) =>
      rows.filter((r) => /[▲▼]/.test(r.text)).map((r) => r.colour);

    expect(sentimentOf(fresh).length, 'no change arrow rendered — the probe is blind')
      .toBeGreaterThan(0);
    expect(sentimentOf(late), 'a late series lost its sentiment colour')
      .toEqual(sentimentOf(fresh));
  }, 30_000);

  it('warns before the stale threshold, not at it', async () => {
    // The bands are what make `late` a distinct product rather than a rename.
    // If `WARN_AFTER_MONTHS` ever equalled `STALE_AFTER_MONTHS` for a cadence
    // the dashboard reports quarterly on, this whole state would be
    // unreachable there — which is exactly the case for `W`, deliberately, on
    // a population of three series.
    expect(WARN_AFTER_MONTHS.Q, 'a quarterly series would never be warned first')
      .toBeLessThan(STALE_AFTER_MONTHS.Q);

    // And the ordering the shared component depends on: `stale` implies `late`
    // for every cadence, so the stale branch must be tested first or it becomes
    // unreachable.
    for (const cadence of ['W', 'M', 'Q', 'S', 'A'] as const) {
      expect(
        WARN_AFTER_MONTHS[cadence],
        `stale would not imply late for ${cadence}`,
      ).toBeLessThanOrEqual(STALE_AFTER_MONTHS[cadence]);
    }
  });
});

describe('one condition, one sentence', () => {
  it('defines the freshness sentence once, and nowhere else', () => {
    // Two surfaces inventing two vocabularies for one condition is how a design
    // system dies: a reader who meets "nothing newer than" on a chart and "out
    // of date" on a card has to work out whether those are the same claim.
    //
    // This assertion used to require the sentence to appear **in both**
    // `BalticCompareChart` and `IndicatorCard`, byte-identical by hand. That
    // pinned the technique rather than the property, and it broke on the change
    // that made the property stronger: there are now two verdicts — `stale` and
    // `late` — and five surfaces maintaining the same two-branch rule by hand is
    // precisely the drift the comment above warns about, arriving the long way
    // round.
    //
    // So the outcome is asserted instead: the sentence is **defined once**, in
    // the shared component. Written as an equality over the whole source tree,
    // so a second copy anywhere fails here rather than passing quietly.
    const SENTENCE = 'has published nothing newer than';

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(resolve(dir, e.name))
          : /\.tsx?$/.test(e.name) ? [resolve(dir, e.name)] : []);

    const definers = walk(resolve('src'))
      .filter((path) => readFileSync(path, 'utf8').includes(SENTENCE))
      .map((path) => path.split(/[\\/]/).pop()!)
      .sort();

    expect(definers, 'the freshness sentence must live in exactly one component')
      .toEqual(['FreshnessNotice.tsx']);
  });

  it('routes every surface that shows a freshness verdict through the shared one', () => {
    // The companion the assertion above cannot make. "Defined once" is also
    // satisfied by a component nobody renders — a sentence with no reader is
    // the seam defect this repo has hit four times. So the carriers are named,
    // as an equality, and each must import it.
    const CARRIERS = [
      'src/components/BalticCompareChart.tsx',
      'src/components/FreightModalSplit.tsx',
      'src/components/IndicatorCard.tsx',
      'src/components/RankedComparison.tsx',
    ];

    for (const file of CARRIERS) {
      expect(
        readFileSync(resolve(file), 'utf8'),
        `${file} no longer routes through the shared freshness sentence`,
      ).toMatch(/import \{ FreshnessNotice \} from '\.\/FreshnessNotice'/);
    }

    // `MaritimeTile` and `IndicatorTable` are deliberately not carriers, and
    // saying so here is what stops the omission looking like an oversight:
    //
    //   MaritimeTile    speaks about three measures at once, names the oldest
    //                   and the newest, and adds the fact only it can — that
    //                   the weather beside the figures is live while they are
    //                   not. It carries `freshness.label`, so it states its own
    //                   age and reads correctly at either verdict.
    //   IndicatorTable  has one row per indicator and no room for a sentence;
    //                   it colours the period and speaks the verdict to a
    //                   screen reader instead.
    //
    // Both must still read `late`, or they are excluded from the change as well
    // as from the sentence.
    for (const file of ['src/components/MaritimeTile.tsx', 'src/components/IndicatorTable.tsx']) {
      expect(
        readFileSync(resolve(file), 'utf8'),
        `${file} states its own wording but must still read the late verdict`,
      ).toMatch(/freshness[?.]*\.late/);
    }
  });

  it('judges staleness with the module the rest of the dashboard uses', () => {
    // Not a second opinion. `freshnessOf` reads the cadence off the period
    // label's own shape, so it needs nothing declared, and
    // `tests/dashboardCadence.test.tsx` asserts `STALE_AFTER_MONTHS` equals the
    // API's `MAX_AGE_MONTHS` — so the client verdict is the server's verdict.
    for (const file of ['src/components/IndicatorCard.tsx', 'src/components/IndicatorTable.tsx']) {
      const text = readFileSync(resolve(file), 'utf8');
      expect(text, `${file} must import the shared judgement`).toMatch(
        /import \{[^}]*freshnessOf[^}]*\} from '\.\.\/dataFreshness'/,
      );
      expect(text, `${file} must not invent its own threshold`).not.toMatch(
        /monthsBehind\s*>\s*\d+|age\s*>\s*\d+/,
      );
    }
  });
});
