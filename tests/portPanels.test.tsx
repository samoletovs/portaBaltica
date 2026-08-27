/**
 * What the maritime panels actually put on screen.
 *
 * The panels these replaced spent months telling readers that ferry figures
 * were "published biweekly by the Ministry of Transport" while the ministry
 * had stopped publishing them, and rendering a ship-visit list that only ever
 * contained *cancelled* calls under the heading "Vessel Activity". Neither was
 * a crash; both were confident, well-formatted and wrong, and nothing in the
 * suite looked at the rendered output.
 *
 * The fixture is real Eurostat output for 2025-Q4, shaped exactly as
 * `/api/port-data` returns it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import type { PortDataResponse, PortMeasure } from '../src/types';
import { VesselTrafficPanel } from '../src/components/VesselTrafficPanel';
import { PassengerPanel } from '../src/components/PassengerPanel';
import { CargoPanel } from '../src/components/CargoPanel';

function series(points: [string, number | null][]) {
  return points.map(([period, value]) => ({ period, value }));
}

const goods: PortMeasure = {
  unit: 'THS_T',
  countryOnly: false,
  latest: '2025-Q4',
  ports: [
    { code: 'LV_0LVRIX', name: 'Riga', latest: '2025-Q4', series: series([['2024-Q4', 4561], ['2025-Q4', 4237]]) },
    { code: 'LV_0LVVNT', name: 'Ventspils', latest: '2025-Q4', series: series([['2024-Q4', 2450], ['2025-Q4', 1843]]) },
    { code: 'LV_0LVSKU', name: 'Skulte', latest: '2025-Q4', series: series([['2024-Q4', 150], ['2025-Q4', 162]]) },
  ],
};

const passengers: PortMeasure = {
  unit: 'THS',
  countryOnly: false,
  latest: '2025-Q4',
  ports: [
    { code: 'LV_0LVVNT', name: 'Ventspils', latest: '2025-Q4', series: series([['2024-Q4', 53], ['2025-Q4', 56]]) },
    { code: 'LV_0LVRIX', name: 'Riga', latest: '2025-Q4', series: series([['2024-Q4', 0], ['2025-Q4', 0]]) },
  ],
};

const vessels: PortMeasure = {
  unit: 'NR',
  countryOnly: false,
  latest: '2025-Q4',
  ports: [
    { code: 'LV_0LVRIX', name: 'Riga', latest: '2025-Q4', series: series([['2024-Q4', 540], ['2025-Q4', 568]]) },
    { code: 'LV_0LVLPX', name: 'Liepāja', latest: '2025-Q4', series: series([['2024-Q4', 280], ['2025-Q4', 274]]) },
  ],
};

const cargoMix: PortDataResponse['cargoMix'] = {
  period: '2025-Q4',
  total: 7828,
  categories: [
    { code: 'DBK', name: 'Dry bulk', weight: 3644 },
    { code: 'LBK', name: 'Liquid bulk', weight: 1554 },
    { code: 'LCNT', name: 'Containers', weight: 1175 },
  ],
};

describe('VesselTrafficPanel', () => {
  it('counts arrivals, and never claims to show cancellations', () => {
    render(<VesselTrafficPanel measure={vessels} />);

    expect(screen.getByText('Vessel Arrivals')).toBeTruthy();
    expect(screen.getByText('842')).toBeTruthy();          // 568 + 274
    expect(screen.getByText(/vessels arriving/)).toBeTruthy();
    expect(screen.queryByText(/cancelled/i)).toBeNull();
    expect(screen.queryByText(/rejected/i)).toBeNull();
  });

  it('names the quarter, so a reader is never told when we fetched instead', () => {
    render(<VesselTrafficPanel measure={vessels} />);
    expect(screen.getByText(/Q4 2025/)).toBeTruthy();
  });

  it('shows the year-on-year move rather than an undated absolute', () => {
    // 842 against 820 a year earlier.
    render(<VesselTrafficPanel measure={vessels} />);
    expect(screen.getByText('+2.7%')).toBeTruthy();
  });

  it('says so plainly when there is nothing to show', () => {
    render(<VesselTrafficPanel measure={{ ...vessels, ports: [], latest: null }} />);
    expect(screen.getByText(/No vessel traffic reported/)).toBeTruthy();
  });

  it('still shows the quarter total when there is no year-earlier quarter', () => {
    // Estonia's vessel series has no comparable prior quarter. Collapsing the
    // headline to a dash threw away a figure we had, and made a healthy panel
    // look broken.
    const noPrior: PortMeasure = {
      ...vessels,
      ports: [
        { code: 'EE_0EETLL', name: 'Tallinn', latest: '2025-Q4', series: series([['2025-Q4', 1690]]) },
        { code: 'EE_0EEPRN', name: 'Pärnu', latest: '2025-Q4', series: series([['2025-Q4', 91]]) },
      ],
    };

    render(<VesselTrafficPanel measure={noPrior} />);
    expect(screen.getByText('1,781')).toBeTruthy();
    expect(screen.getByText(/no year-earlier quarter to compare/)).toBeTruthy();
  });
});

describe('PassengerPanel', () => {
  it('reads thousand-passenger units as people', () => {
    render(<PassengerPanel measure={passengers} />);
    // 56 thousand, not "56". Twice over: the national headline and the only
    // port contributing to it.
    expect(screen.getAllByText('56K')).toHaveLength(2);
    expect(screen.queryByText('56')).toBeNull();
  });

  it('keeps a port that genuinely reports zero, because that is the story', () => {
    render(<PassengerPanel measure={passengers} />);
    expect(screen.getByText('Riga')).toBeTruthy();
    expect(screen.getByText('0K')).toBeTruthy();
  });

  it('drops a port that stopped reporting, rather than carrying its last figure forward', () => {
    // Riga has filed nothing since 2021, when the Stockholm route ended.
    // Showing a four-year-old number formatted exactly like this quarter's is
    // the failure this whole change exists to stop. It is named in the
    // footnote instead, which is a different claim from a bar on the chart.
    const stopped: PortMeasure = {
      ...passengers,
      ports: [
        passengers.ports[0],
        {
          code: 'LV_0LVRIX',
          name: 'Riga',
          latest: '2021-Q4',
          discontinued: true,
          series: series([['2021-Q4', 120], ['2024-Q4', null], ['2025-Q4', null]]),
        },
      ],
    };

    render(<PassengerPanel measure={stopped} />);
    expect(screen.queryByText('120K')).toBeNull();
    expect(screen.getByText('Ventspils')).toBeTruthy();

    // Riga appears only in the footnote, never as a value in the bars.
    const bars = screen.getByText('Ventspils').closest('div')!.parentElement!;
    expect(within(bars).queryByText('Riga')).toBeNull();
  });

  it('states the cruise exclusion, which is a property of the table', () => {
    render(<PassengerPanel measure={passengers} />);
    expect(screen.getByText(/Excludes cruise passengers/)).toBeTruthy();
  });

  it('flags a national total instead of passing it off as a port', () => {
    render(<PassengerPanel measure={{ ...passengers, countryOnly: true }} />);
    expect(screen.getByText(/no port breakdown for this country/)).toBeTruthy();
  });

  it('says a dropped port stopped reporting, and when', () => {
    // Dropping Riga from the bars is right. Dropping it in silence is not:
    // Riga was Latvia's passenger port — 258,000 in 2019-Q3 — and it filed
    // four literal zeroes through 2021 after the Tallink Stockholm route was
    // suspended, then nothing. A reader shown only Ventspils, with no note,
    // concludes Riga was never a passenger port. The chart and the footnote
    // together are what make the omission honest.
    const stopped: PortMeasure = {
      ...passengers,
      ports: [
        passengers.ports[0],
        {
          code: 'LV_0LVRIX',
          name: 'Riga',
          latest: '2021-Q4',
          discontinued: true,
          series: series([['2021-Q4', 0], ['2024-Q4', null], ['2025-Q4', null]]),
        },
      ],
    };

    render(<PassengerPanel measure={stopped} />);

    // Still absent from the bars, still not carrying a stale figure forward.
    expect(screen.queryByText('0K')).toBeNull();

    // But named, dated, and described as stopped rather than merely missing.
    const note = screen.getByText(/Not in the figures above/);
    expect(note.textContent).toContain('Riga');
    expect(note.textContent).toContain('Q4 2021');
    expect(note.textContent).toMatch(/nothing has been filed since/);
  });

  it('distinguishes a port that stopped from one that is a quarter late', () => {
    // Two different claims. Telling a reader that a working port had closed
    // would be its own falsehood, so a recent absence is worded as a table
    // that has not caught up.
    const mixed: PortMeasure = {
      ...passengers,
      latest: '2025-Q4',
      ports: [
        passengers.ports[0],
        {
          code: 'LV_0LVRIX', name: 'Riga', latest: '2021-Q4', discontinued: true,
          series: series([['2021-Q4', 0], ['2025-Q4', null]]),
        },
        {
          code: 'LV_0LVLPX', name: 'Liepāja', latest: '2025-Q3', discontinued: false,
          series: series([['2025-Q3', 12], ['2025-Q4', null]]),
        },
      ],
    };

    render(<PassengerPanel measure={mixed} />);

    expect(screen.getByText(/Not in the figures above/).textContent).toContain('Riga');
    expect(screen.getByText(/Not in the figures above/).textContent).not.toContain('Liepāja');

    const awaiting = screen.getByText(/Awaiting this quarter/);
    expect(awaiting.textContent).toContain('Liepāja');
    expect(awaiting.textContent).toContain('Q3 2025');
  });

  it('says nothing when every port reported, rather than an empty footnote', () => {
    render(<PassengerPanel measure={passengers} />);
    expect(screen.queryByText(/Not in the figures above/)).toBeNull();
    expect(screen.queryByText(/Awaiting this quarter/)).toBeNull();
  });

  it('judges a stale port from its own latest when the payload predates the flag', () => {
    // `/api/port-data` is cached for hours at the edge and longer in
    // localStorage, so a response served from before `discontinued` existed
    // must still render honestly rather than treat the missing field as false.
    const legacy: PortMeasure = {
      ...passengers,
      ports: [
        passengers.ports[0],
        {
          code: 'LV_0LVRIX', name: 'Riga', latest: '2021-Q4',
          series: series([['2021-Q4', 0], ['2025-Q4', null]]),
        },
      ],
    };

    render(<PassengerPanel measure={legacy} />);
    expect(screen.getByText(/Not in the figures above/).textContent)
      .toMatch(/nothing has been filed since/);
  });
});

describe('CargoPanel', () => {
  it('reads thousand tonnes as tonnes', () => {
    render(<CargoPanel measure={goods} mix={cargoMix} />);
    // 4237 + 1843 + 162 = 6242 thousand tonnes = 6.24 Mt, not "6,242".
    expect(screen.getByText('6.24 Mt')).toBeTruthy();
    expect(screen.getByText('4.24 Mt')).toBeTruthy();
  });

  it('keeps a small port in kt rather than rounding it away', () => {
    render(<CargoPanel measure={goods} mix={cargoMix} />);
    expect(screen.getByText('162 kt')).toBeTruthy();
  });

  it('offers the type breakdown when there is one', () => {
    render(<CargoPanel measure={goods} mix={cargoMix} />);
    expect(screen.getByText('By type')).toBeTruthy();
    expect(screen.getByText('By port')).toBeTruthy();
  });

  it('hides the toggle when the country publishes no breakdown', () => {
    // Estonia reports a total and nothing else; offering a view that renders
    // empty is worse than not offering it.
    render(<CargoPanel measure={goods} mix={{ period: '2025-Q4', total: 4833, categories: [], breakdown: 'unpublished' }} />);
    expect(screen.queryByText('By type')).toBeNull();
  });

  it('says why there is no breakdown, instead of just withholding the control', () => {
    // The live defect: `/api/port-data?country=EE` returned a total of 4,833
    // with an empty `categories`, and the panel quietly dropped the toggle. An
    // Estonian reader saw a control their Latvian counterpart had, missing,
    // with no way to tell a settled fact about Eurostat from a chart that had
    // broken. `mar_go_qm_ee` carries exactly one cargo code against Latvia's
    // 36, and saying so is worth more than hiding it.
    render(
      <CargoPanel
        measure={goods}
        mix={{ period: '2025-Q4', total: 4833, categories: [], breakdown: 'unpublished' }}
      />,
    );

    const note = screen.getByText(/no cargo-type breakdown for this country/);
    expect(note).toBeTruthy();
    expect(note.textContent).toMatch(/single\s+total and no categories/);
  });

  it('distinguishes "not published" from "could not be loaded"', () => {
    // Two different claims about two different causes, and the design book
    // lists collapsing them into one grey box as a known defect. A failed
    // fetch may recover; Estonia's table never will.
    render(
      <CargoPanel
        measure={goods}
        mix={{ period: null, total: null, categories: [], breakdown: 'unavailable' }}
      />,
    );

    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/no cargo-type breakdown for this country/)).toBeNull();
  });

  it('claims nothing about the breakdown when a cached response predates the field', () => {
    render(<CargoPanel measure={goods} mix={{ period: '2025-Q4', total: 4833, categories: [] }} />);
    expect(screen.queryByText(/no cargo-type breakdown for this country/)).toBeNull();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('separates an empty panel that failed from one with nothing to report', () => {
    const { unmount } = render(
      <CargoPanel
        measure={{ ...goods, ports: [], latest: null }}
        mix={{ period: null, total: null, categories: [], breakdown: 'unavailable' }}
      />,
    );
    expect(screen.getByText(/could not be loaded from Eurostat/)).toBeTruthy();
    unmount();

    render(
      <CargoPanel
        measure={{ ...goods, ports: [], latest: null }}
        mix={{ period: null, total: null, categories: [], breakdown: 'unpublished' }}
      />,
    );
    expect(screen.getByText(/No cargo volumes reported/)).toBeTruthy();
  });

  it('falls back to the type view when no port breakdown exists', () => {
    render(
      <CargoPanel
        measure={{ ...goods, ports: [], latest: null, countryOnly: true }}
        mix={cargoMix}
      />,
    );
    expect(screen.getByText('Dry bulk')).toBeTruthy();
    expect(screen.queryByText('By port')).toBeNull();
  });

  it('says so plainly when neither view has data', () => {
    render(
      <CargoPanel
        measure={{ ...goods, ports: [], latest: null }}
        mix={{ period: null, total: null, categories: [] }}
      />,
    );
    expect(screen.getByText(/No cargo volumes reported/)).toBeTruthy();
  });
});

describe('every panel', () => {
  it('names Eurostat as the source, not the ministry that stopped publishing', () => {
    const { container } = render(
      <>
        <VesselTrafficPanel measure={vessels} />
        <PassengerPanel measure={passengers} />
        <CargoPanel measure={goods} mix={cargoMix} />
      </>,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('Eurostat mar_tf_qm');
    expect(text).toContain('Eurostat mar_pa_qm');
    expect(text).toContain('Eurostat mar_go_qm');
    expect(text).not.toMatch(/Ministry of Transport/i);
    expect(text).not.toMatch(/data\.gov\.lv/i);
    expect(text).not.toMatch(/biweekly/i);
    expect(text).not.toMatch(/SKLOIS/i);
  });

  it('shares one bar layout, so a share always sits beside its value', () => {
    const { container } = render(<CargoPanel measure={goods} mix={cargoMix} />);
    const riga = within(container).getByText('Riga').closest('div')!;
    expect(riga.textContent).toContain('4.24 Mt');
    expect(riga.textContent).toMatch(/\d+\.\d%/);
  });
});

describe('the maritime tile in light mode', () => {
  /**
   * Two colour classes on this tile escaped the theme-compatibility layer in
   * `src/index.css` and shipped illegibly on white:
   *
   *   - `text-orange-400` on the year-on-year delta, 2.26:1
   *   - `text-amber-300` on the staleness banner, 1.44:1
   *
   * A third escaped for a subtler reason and was found while fixing them:
   * `text-amber-400/80` on the national-total footnote. The layer remaps
   * `.text-amber-400`, and Tailwind emits the slashed opacity variant as a
   * *different* class, `.text-amber-400\/80`, which that selector never
   * matches. It measured 1.67:1.
   *
   * The floor for body text is 4.5:1 (WCAG 2.2 SC 1.4.3). All three now read
   * their colour from a theme token, which is defined per theme and therefore
   * cannot be silently missed by a remapping rule.
   */
  const FILES = ['PortPanelParts.tsx', 'MaritimeTile.tsx', 'CargoPanel.tsx',
    'PassengerPanel.tsx', 'VesselTrafficPanel.tsx'];

  const sourceOf = (file: string) =>
    readFileSync(resolve('src/components', file), 'utf8');

  /** Source with comments removed, for assertions about code rather than prose. */
  const codeOf = (file: string) =>
    sourceOf(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it.each(FILES)('%s sets no text colour the theme layer does not remap', (file) => {
    // Amber and orange are the two families with no complete remapping. Both
    // now go through `--data-warning` / the polarity module instead.
    const offenders = [...sourceOf(file).matchAll(/className="[^"]*"/g)]
      .flatMap(match => [...match[0].matchAll(/\btext-(?:amber|orange|yellow)-\d{3}(?:\/\d+)?/g)])
      .map(match => match[0]);

    expect(offenders, `${file} sets an unremapped text colour`).toEqual([]);
  });

  it('confirms the compatibility layer now covers these classes', () => {
    // This assertion is the inverse of the one it replaces, and the reversal
    // is the point.
    //
    // As written in #78 it asserted the layer *missed* `text-orange-400`,
    // `text-amber-300` and the slashed `text-amber-400/80` — documenting a
    // real gap, with a comment saying that if a later change closed it the
    // test should be "removed deliberately, not silently". #81 closed it, in
    // a parallel branch, by moving those rules out of `[data-theme="light"]`
    // so they bind in both themes. Master went red the moment the two met.
    //
    // So this is that deliberate removal. Asserting the gap is closed is the
    // more useful invariant anyway: the earlier form would have gone green
    // again if someone deleted the override, which is the failure it existed
    // to catch.
    const css = readFileSync(resolve('src/index.css'), 'utf8');

    expect(css, 'text-orange-400 is remapped').toMatch(/\.text-orange-400\s*[,{]/);
    expect(css, 'text-amber-300 is remapped').toMatch(/\.text-amber-300\s*[,{]/);
    // The slashed variant is a distinct class from the bare one — Tailwind
    // emits `.text-amber-400\/80` separately, which is precisely how the
    // footnote escaped the layer in the first place. Naming the bare class is
    // not enough and never was.
    expect(css, 'the slashed amber-400 variant is remapped too').toMatch(/\.text-amber-400\\\//);
  });

  it('colours the delta through the polarity module, not the sign', () => {
    // A rise is not automatically good news, and an unchanged quarter is not
    // good news at all. `>= 0` painted a flat quarter green. Asserted against
    // the code alone, because the comment above the fix names the old
    // expression on purpose so nobody restores it.
    const code = codeOf('PortPanelParts.tsx');
    expect(code).toMatch(/sentimentOf\(/);
    expect(code).toMatch(/sentimentColor\(/);
    expect(code).not.toMatch(/pct\s*>=\s*0\s*\?/);
  });

  it('leaves an unchanged quarter uncoloured', () => {
    const flat: PortMeasure = {
      unit: 'NR', countryOnly: false, latest: '2025-Q4',
      ports: [{
        code: 'LV_0LVRIX', name: 'Riga', latest: '2025-Q4',
        series: series([['2024-Q4', 500], ['2025-Q4', 500]]),
      }],
    };

    render(<VesselTrafficPanel measure={flat} />);
    const delta = screen.getByText('0.0%');
    expect(delta.getAttribute('style')).toContain('--text-secondary');
  });

  it('describes the change in words as well as colour', () => {
    // Colour is never the only encoding: red and green are the classic
    // confusion pair, and roughly 8% of men cannot separate them.
    render(<VesselTrafficPanel measure={vessels} />);
    expect(screen.getByText('+2.7%').textContent).toMatch(/up/);
  });
});
