import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { DASHBOARD_INDICATORS, resolveChartRef } from '../src/newsroom/chart-ref';

const require_ = createRequire(import.meta.url);
const INDICATORS = require_('../api/shared/indicators.js');

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

/**
 * The mirror this module claims to be.
 *
 * "Mirrors api/shared/indicators.js" was a comment, not an assertion, and the
 * two lists drifted apart in both directions: six ids here named nothing the
 * API serves, and twenty-three indicators the API does serve were missing.
 * Both failures are invisible at runtime — one renders an empty chart frame,
 * the other renders no chart where an article promised one.
 */
describe('chart vocabulary matches the indicator registry', () => {
  const registry: string[] = Object.keys(INDICATORS);

  it('serves every id it advertises', () => {
    const phantom = [...DASHBOARD_INDICATORS].filter((id) => !registry.includes(id));
    expect(
      phantom,
      'these ids pass resolveChartRef but /api/baltic-compare answers 400 for them, ' +
        'which renders a "Live data" panel containing nothing'
    ).toEqual([]);
  });

  it('advertises every id it serves', () => {
    const missing = registry.filter((id) => !DASHBOARD_INDICATORS.has(id));
    expect(
      missing,
      'the dashboard serves these but resolveChartRef rejects them, so an article ' +
        'citing one has its chart silently dropped'
    ).toEqual([]);
  });

  it('points every alias at an id the dashboard actually serves', () => {
    // An alias to a retired id is the original bug wearing a different hat.
    for (const legacy of ['gov_debt', 'renewable_share', 'new_vehicles', 'tourist_arrivals']) {
      const resolved = resolveChartRef(legacy);
      expect(resolved, `${legacy} should resolve to a live indicator`).toBeDefined();
      expect(registry).toContain(resolved);
    }
  });

  it('declines the legacy ids that have no real counterpart', () => {
    // building_permits and biz_confidence were never served by anything. The
    // honest answer is no chart, not the nearest-looking one.
    expect(resolveChartRef('building_permits')).toBeUndefined();
    expect(resolveChartRef('biz_confidence')).toBeUndefined();
  });
});
