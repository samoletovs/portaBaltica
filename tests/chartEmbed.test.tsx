/**
 * The embedded chart must answer for the article's country.
 *
 * `IndicatorChart` reads the country from `CountryContext` — the dashboard's
 * LV/EE/LT switcher. That is right on /data, where the reader chose it, and
 * wrong under an article, where the story chose it.
 *
 * The visible symptom was an article about Estonian unemployment showing
 * "No historical data available for this indicator", because the switcher sat
 * on its LV default and the chart dutifully fetched the Latvian series. The
 * quieter and worse case is when the other country *does* have data: the chart
 * then renders a plausible series that does not support the sentence above it,
 * under a caption promising "the same series the story was written from".
 *
 * A wrong chart is worse than no chart, because the reader has been invited to
 * check the claim and is shown something that appears to confirm it.
 *
 * The mock below therefore resolves the country exactly as the real chart does
 * — prop first, context second — and the assertions are about which series the
 * reader ends up looking at, not about which props were passed. Asserting on
 * the prop alone would pass while the reader sees Latvia.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CountryProvider, useCountry } from '../src/CountryContext';

vi.mock('../src/components/IndicatorCard', async () => {
  const { useCountry: useDashboardCountry } =
    await vi.importActual<typeof import('../src/CountryContext')>('../src/CountryContext');

  // Named and capitalised so `react-hooks/rules-of-hooks` can see this for
  // what it is — a component that legitimately calls a hook — rather than a
  // hook call smuggled into a plain arrow function.
  function IndicatorChart({ id, country }: { id: string; country?: string }) {
    const dashboard = useDashboardCountry();
    const resolved = country ?? dashboard.country;
    return <div data-testid="chart" data-indicator={id} data-country={resolved} />;
  }

  return { IndicatorChart };
});

const { ChartEmbed } = await import('../src/components/news/ChartEmbed');

/** Reports the dashboard switcher's value, to prove the fallback is live. */
function CountryProbe() {
  return <span data-testid="dashboard-country">{useCountry().country}</span>;
}

function renderEmbed(props: { indicatorId: string; country?: 'LV' | 'EE' | 'LT' }) {
  return render(
    <MemoryRouter>
      <CountryProvider>
        <CountryProbe />
        <ChartEmbed {...props} />
      </CountryProvider>
    </MemoryRouter>,
  );
}

describe('ChartEmbed', () => {
  it('charts the article country, not the dashboard selection', async () => {
    renderEmbed({ indicatorId: 'unemployment', country: 'EE' });

    // The switcher is on its LV default: the two genuinely disagree here.
    expect(screen.getByTestId('dashboard-country').textContent).toBe('LV');
    expect((await screen.findByTestId('chart')).getAttribute('data-country')).toBe('EE');
  });

  it('never renders a different country than the story is about', async () => {
    renderEmbed({ indicatorId: 'unemployment', country: 'EE' });
    expect((await screen.findByTestId('chart')).getAttribute('data-country')).not.toBe('LV');
  });

  it('falls back to the dashboard selection when the article has no single country', async () => {
    // EU-wide and multi-country stories have no one series to show; deferring
    // to the reader's own selection is honest, inventing one is not.
    renderEmbed({ indicatorId: 'unemployment' });
    expect((await screen.findByTestId('chart')).getAttribute('data-country')).toBe('LV');
  });

  it('links to the full series for the same indicator and the same country', async () => {
    renderEmbed({ indicatorId: 'unemployment', country: 'EE' });

    const chart = await screen.findByTestId('chart');
    expect(chart.getAttribute('data-indicator')).toBe('unemployment');

    // The link used to carry no country, so it landed on whatever the
    // dashboard switcher was last left on — the same class of mismatch this
    // file exists to prevent, just one click later. Following it from an
    // Estonian story could open Lithuania.
    const link = screen.getByRole('link', { name: /Open the full series/ });
    expect(link.getAttribute('href')).toBe('/indicator/unemployment?country=EE');
  });

  it('omits the country from the link when the story has no single one', async () => {
    renderEmbed({ indicatorId: 'unemployment' });

    const link = screen.getByRole('link', { name: /Open the full series/ });
    expect(link.getAttribute('href')).toBe('/indicator/unemployment');
  });
});
