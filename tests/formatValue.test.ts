import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatValue, isHandledUnit, unitCaption } from '../src/utils/formatValue';

const require_ = createRequire(import.meta.url);
const INDICATORS = require_('../api/shared/indicators.js') as Record<string, { unit: string }>;

const MINUS = '\u2212';

describe('formatValue', () => {
  it('returns N/A for null', () => {
    expect(formatValue(null, '%')).toBe('N/A');
  });

  // ── the scale bug ────────────────────────────────────────────────────────
  //
  // `M EUR` is millions of euro at source — every definition behind it queries
  // `currency=MIO_EUR`. The previous version read the raw number as euro, so
  // Latvia's quarterly goods imports (5,623 million, about €5.6bn) rendered as
  // `€5,623` and a 200-million move rendered as `−€200`.
  //
  // The old test asserted that behaviour, which is why nothing caught it: it
  // was written from the same misreading as the code.
  describe('a series denominated in millions', () => {
    it('reads 5,623 M EUR as billions, not as thousands of euro', () => {
      expect(formatValue(5623, 'M EUR')).toBe('€5.62bn');
    });

    it('keeps a sub-billion figure in millions, without inventing precision', () => {
      // `€74.00m` asserts a hundredth of a million the source never published.
      expect(formatValue(200, 'M EUR')).toBe('€200m');
      expect(formatValue(74, 'M EUR')).toBe('€74m');
      expect(formatValue(12.5, 'M EUR')).toBe('€12.5m');
    });

    it('reaches trillions rather than printing seven figures of millions', () => {
      expect(formatValue(2_500_000, 'M EUR')).toBe('€2.50tn');
    });

    it('signs a negative balance with a real minus, not a hyphen', () => {
      expect(formatValue(-301, 'M EUR')).toBe(`${MINUS}€301m`);
      expect(formatValue(-301, 'M EUR')).not.toContain('-');
    });

    it('treats MIO_EUR identically — it is the same denomination', () => {
      expect(formatValue(5623, 'MIO_EUR')).toBe(formatValue(5623, 'M EUR'));
    });
  });

  // ── units that used to vanish ────────────────────────────────────────────
  describe('a value states what it counts', () => {
    it('names freight rather than printing a bare number', () => {
      expect(formatValue(1234, 'M tonne-km')).toBe('1.23bn t-km');
      expect(formatValue(1234, 'k tonnes')).toBe('1.23m t');
    });

    it('names passengers', () => {
      expect(formatValue(1234, 'k passengers')).toBe('1.23m passengers');
      expect(formatValue(528988, 'passengers/quarter')).toBe('528,988 passengers');
    });

    it('names nights and emissions', () => {
      expect(formatValue(1_500_000, 'nights')).toBe('1.50m nights');
      expect(formatValue(1234, 'thousand tonnes CO2-eq')).toBe('1.23m t CO\u2082e');
    });

    it('spells out a rate per thousand inhabitants', () => {
      expect(formatValue(-2.4, 'per 1000 inhabitants')).toBe('-2.4 per 1,000');
      expect(formatValue(381, 'per 1000')).toBe('381.0 per 1,000');
    });
  });

  // ── house style ──────────────────────────────────────────────────────────
  it('abbreviates in FT style — lower case, no space, never the American B', () => {
    expect(formatValue(2_500_000_000, 'persons')).toBe('2.50bn');
    expect(formatValue(5_000_000, 'widgets')).toBe('5.00m');
    for (const [value, unit] of [[2_500_000_000, 'persons'], [5623, 'M EUR']] as const) {
      expect(formatValue(value, unit)).not.toMatch(/\d\s*[BM]\b/);
    }
  });

  // ── unchanged behaviour ──────────────────────────────────────────────────
  it('formats money that is genuinely per-unit', () => {
    expect(formatValue(1523, 'EUR/month')).toBe('€1,523');
    expect(formatValue(21.1, 'EUR/hour')).toBe('€21.1/h');
    expect(formatValue(0.2288, 'EUR/kWh')).toBe('€0.2288');
  });

  it('formats percentages, indices and balances', () => {
    expect(formatValue(2.3, '% YoY')).toBe('2.3%');
    expect(formatValue(-1.5, '%')).toBe('-1.5%');
    expect(formatValue(152.4, 'index (2020=100)')).toBe('152.4');
    expect(formatValue(-3.2, 'balance')).toBe('-3.2');
  });

  it('labels years, which used to be a bare decimal', () => {
    expect(formatValue(78.5, 'years')).toBe('78.5 yrs');
  });

  it('formats people and energy', () => {
    expect(formatValue(1_890_000, 'persons')).toBe('1.89m');
    expect(formatValue(605802, 'persons')).toBe('605,802');
    expect(formatValue(12345, 'GWh')).toBe('12,345 GWh');
  });
});

/**
 * The registry, not the imagination.
 *
 * Every unit in this suite above was one somebody thought of. The nine that
 * shipped broken were the ones nobody did — so the check that matters is not a
 * longer list of examples but a comparison against the actual set of units the
 * product declares. A new indicator with an unhandled unit fails here rather
 * than shipping a number with nothing to say what it counts.
 *
 * **Units are declared in two places**, and the first version of this check
 * only knew about one. `api/shared/indicators.js` carries the unit the API
 * returns, and each `<IndicatorCard unit="…">` carries a fallback used when the
 * API does not answer. That second source is how `EUR/GJ` escaped: household
 * gas price is declared only on the card, was in no registry, and rendered as a
 * bare `23.0` — a price with no currency on it — while a registry-only check
 * reported a clean sweep.
 */
describe('every declared unit', () => {
  /** Units declared on the API side. */
  function registryUnits(): { source: string; unit: string }[] {
    return Object.entries(INDICATORS)
      .filter(([, d]) => typeof d?.unit === 'string' && d.unit.length > 0)
      .map(([id, d]) => ({ source: `indicators.js → ${id}`, unit: d.unit }));
  }

  /** Units declared as a `unit="…"` prop on a component. */
  function componentUnits(): { source: string; unit: string }[] {
    const found: { source: string; unit: string }[] = [];

    function walk(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.tsx')) {
          const text = readFileSync(path, 'utf8');
          for (const match of text.matchAll(/\bunit=["']([^"']+)["']/g)) {
            found.push({ source: `${entry.name} → unit="${match[1]}"`, unit: match[1] });
          }
        }
      }
    }

    walk(resolve('src'));
    return found;
  }

  it('is one formatValue can print with its unit attached', () => {
    const declared = [...registryUnits(), ...componentUnits()];
    const unhandled = [...new Set(
      declared.filter((d) => !isHandledUnit(d.unit)).map((d) => d.source),
    )];

    expect(unhandled, `these reach the generic fallback:\n  ${unhandled.join('\n  ')}`).toEqual([]);
  });

  it('is covered from both sources, so the check above is not vacuous', () => {
    // If either scanner silently returned nothing the assertion above would
    // pass over an empty list, which is the failure mode it exists to prevent.
    expect(new Set(registryUnits().map((d) => d.unit)).size).toBeGreaterThan(15);
    expect(new Set(componentUnits().map((d) => d.unit)).size).toBeGreaterThan(5);
  });
});

describe('unitCaption', () => {
  it('names the basis where the value cannot carry it', () => {
    // "Manufacturing wages 150.2" reads as €150.20 unless the card says index.
    expect(unitCaption('index (2020=100)')).toBe('index (2020=100)');
    expect(unitCaption('index')).toBe('index');
    expect(unitCaption('balance')).toBe('survey balance');
  });

  it('stays quiet where the value already says what it is', () => {
    for (const unit of ['M EUR', '% YoY', 'GWh', 'persons', 'EUR/GJ', 'years']) {
      expect(unitCaption(unit), `${unit} does not need a caption`).toBeNull();
    }
  });
});
