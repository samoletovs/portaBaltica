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
    // the failure this whole change exists to stop.
    const stopped: PortMeasure = {
      ...passengers,
      ports: [
        passengers.ports[0],
        {
          code: 'LV_0LVRIX',
          name: 'Riga',
          latest: '2021-Q4',
          series: series([['2021-Q4', 120], ['2024-Q4', null], ['2025-Q4', null]]),
        },
      ],
    };

    render(<PassengerPanel measure={stopped} />);
    expect(screen.queryByText('Riga')).toBeNull();
    expect(screen.queryByText('120K')).toBeNull();
    expect(screen.getByText('Ventspils')).toBeTruthy();
  });

  it('states the cruise exclusion, which is a property of the table', () => {
    render(<PassengerPanel measure={passengers} />);
    expect(screen.getByText(/Excludes cruise passengers/)).toBeTruthy();
  });

  it('flags a national total instead of passing it off as a port', () => {
    render(<PassengerPanel measure={{ ...passengers, countryOnly: true }} />);
    expect(screen.getByText(/no port breakdown for this country/)).toBeTruthy();
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
    render(<CargoPanel measure={goods} mix={{ period: '2025-Q4', total: 4833, categories: [] }} />);
    expect(screen.queryByText('By type')).toBeNull();
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
