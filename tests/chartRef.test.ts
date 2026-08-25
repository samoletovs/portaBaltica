import { describe, it, expect } from 'vitest';
import { DASHBOARD_INDICATORS, resolveChartRef } from '../src/newsroom/chart-ref';

/**
 * The join between an article and the chart that backs it.
 *
 * The pipeline emitted `labour.unemployment` and `unemployment_rate`; the
 * dashboard serves `unemployment`. `/api/baltic-compare?indicator=unemployment_rate`
 * answers 400, so the one original article on the site rendered a panel headed
 * "Live data" containing nothing, and its "check it yourself" link went to a
 * page that could not answer either.
 *
 * The pipeline now emits dashboard ids, but published articles keep the ref
 * they were stored with and the corrections policy forbids rewriting them, so
 * the reader side has to understand the old vocabulary too.
 */

describe('resolveChartRef', () => {
  it('passes through an id the dashboard serves', () => {
    expect(resolveChartRef('unemployment')).toBe('unemployment');
    expect(resolveChartRef('house_prices')).toBe('house_prices');
  });

  it('translates the refs already baked into published articles', () => {
    // These are on the live site right now.
    expect(resolveChartRef('unemployment_rate')).toBe('unemployment');
    expect(resolveChartRef('hicp_annual_rate')).toBe('inflation');
  });

  it('translates the dotted refs the collector used to emit', () => {
    expect(resolveChartRef('labour.unemployment')).toBe('unemployment');
    expect(resolveChartRef('economy.inflation')).toBe('inflation');
  });

  it('refuses an id it cannot serve rather than guessing', () => {
    // The caller renders no chart for undefined. Returning a plausible-looking
    // id here would put a chart under a claim it does not support, which is
    // the one outcome worse than showing nothing.
    expect(resolveChartRef('gross_domestic_product')).toBeUndefined();
    expect(resolveChartRef('made_up_metric')).toBeUndefined();
    expect(resolveChartRef('economy.nonsense')).toBeUndefined();
  });

  it('handles absent and empty refs', () => {
    expect(resolveChartRef(undefined)).toBeUndefined();
    expect(resolveChartRef(null)).toBeUndefined();
    expect(resolveChartRef('')).toBeUndefined();
    expect(resolveChartRef('   ')).toBeUndefined();
  });

  it('knows a realistic number of indicators', () => {
    // Guard the guard: an empty or tiny set would make every ref unresolvable
    // and silently remove every chart on the site.
    expect(DASHBOARD_INDICATORS.size).toBeGreaterThan(25);
    expect(DASHBOARD_INDICATORS.has('unemployment')).toBe(true);
    expect(DASHBOARD_INDICATORS.has('inflation')).toBe(true);
  });

  it('never returns an id outside the dashboard vocabulary', () => {
    const probes = [
      'unemployment', 'unemployment_rate', 'labour.unemployment',
      'hicp_annual_rate', 'economy.inflation', 'nonsense', '',
    ];

    for (const probe of probes) {
      const result = resolveChartRef(probe);
      if (result !== undefined) {
        expect(DASHBOARD_INDICATORS.has(result)).toBe(true);
      }
    }
  });
});
