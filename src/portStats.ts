/**
 * Arithmetic and formatting shared by the maritime panels.
 *
 * Kept apart from the components so the parts that can be wrong in a way a
 * reader would not notice — unit conversion, year-on-year alignment, summing a
 * quarter across ports — are testable without rendering anything.
 *
 * The unit codes are Eurostat's own and they do not mean what their names
 * suggest at a glance: `THS_T` is *thousand tonnes*, so 4,237 is 4.24 million
 * tonnes, and `THS` on the passenger table is *thousand passengers*, so 2,857
 * is 2.86 million people. Formatting these as bare numbers understated every
 * figure on the tile by three orders of magnitude, which is exactly the sort of
 * error that looks plausible on screen.
 */

import type { PortMeasure, PortSeries } from './types';

export type PortUnit = PortMeasure['unit'];

/**
 * Value a port reported in a given quarter, or null if it did not.
 *
 * `null` for anything that is not a finite number, not merely for `null` and
 * `undefined`. A `NaN` passes an `!== null` check, and `PortBars` filters on
 * exactly that before computing `Math.max` and a `reduce` — both of which
 * propagate NaN, so one bad cell would set every bar's width to `NaN%`, which
 * CSS drops, leaving every bar at the container's full width. The valid ports
 * are destroyed along with the bad one, and the panel reads "all ports equal".
 *
 * The series type says `number | null`, but it describes a payload we did not
 * write, so it is a claim rather than a guarantee (DESIGN.md §3.8).
 */
export function valueAt(entry: PortSeries, period: string | null): number | null {
  if (!period) return null;
  const hit = entry.series.find(p => p.period === period);
  if (!hit) return null;
  return typeof hit.value === 'number' && Number.isFinite(hit.value) ? hit.value : null;
}

/** `2025-Q4` → `2024-Q4`. Year-on-year is the only honest comparison here,
 *  because Baltic port traffic is strongly seasonal and quarter-on-quarter
 *  would report the summer as growth every year. */
export function sameQuarterLastYear(period: string | null): string | null {
  if (!period) return null;
  const m = /^(\d{4})-?Q([1-4])$/.exec(period);
  if (!m) return null;
  return `${+m[1] - 1}-Q${m[2]}`;
}

/** Total across every port that reported in `period`; null if none did. */
export function totalAt(measure: PortMeasure, period: string | null): number | null {
  if (!period) return null;
  let sum = 0;
  let any = false;
  for (const port of measure.ports) {
    const v = valueAt(port, period);
    if (v === null) continue;
    sum += v;
    any = true;
  }
  return any ? sum : null;
}

export interface YearOnYear {
  current: number;
  previous: number;
  /** Signed percentage change, e.g. -4.2. */
  pct: number;
}

/**
 * Change against the same quarter a year earlier.
 *
 * Compared only across ports that reported in *both* quarters, so a port
 * appearing or dropping out of the table does not read as a collapse or a
 * boom in traffic that never happened.
 */
export function yearOnYear(measure: PortMeasure): YearOnYear | null {
  const period = measure.latest;
  const prior = sameQuarterLastYear(period);
  if (!period || !prior) return null;

  let current = 0;
  let previous = 0;
  let any = false;

  for (const port of measure.ports) {
    const now = valueAt(port, period);
    const then = valueAt(port, prior);
    if (now === null || then === null) continue;
    current += now;
    previous += then;
    any = true;
  }

  if (!any || previous === 0) return null;
  return { current, previous, pct: ((current - previous) / previous) * 100 };
}

/** Quarters present in a measure, oldest first. */
export function periodsOf(measure: PortMeasure): string[] {
  const seen = new Set<string>();
  for (const port of measure.ports) {
    for (const point of port.series) seen.add(point.period);
  }
  return [...seen].sort();
}

/** Compact display of a value in its Eurostat unit. */
export function formatMeasure(value: number, unit: PortUnit): string {
  if (unit === 'THS_T') {
    // Thousand tonnes in, so 1,000 is a million tonnes.
    if (value >= 1000) return `${(value / 1000).toFixed(2)} Mt`;
    return `${Math.round(value).toLocaleString('en-GB')} kt`;
  }
  if (unit === 'THS') {
    // Thousand passengers in.
    if (value >= 1000) return `${(value / 1000).toFixed(2)}M`;
    return `${Math.round(value).toLocaleString('en-GB')}K`;
  }
  return Math.round(value).toLocaleString('en-GB');
}

/** What the measure counts, for the line under the headline number. */
export function unitLabel(unit: PortUnit): string {
  if (unit === 'THS_T') return 'gross weight of goods';
  if (unit === 'THS') return 'passengers embarked & disembarked';
  return 'vessels arriving';
}

/** The same thing in two or three words, for use mid-sentence in a footnote. */
export function measureNoun(unit: PortUnit): string {
  if (unit === 'THS_T') return 'cargo';
  if (unit === 'THS') return 'passengers';
  return 'vessel arrivals';
}

/**
 * Ports present in the response that did not report in the displayed quarter.
 *
 * These are the ones the bars silently drop. Riga filed no sea passengers after
 * 2021-Q4 — confirmed against the unpinned `mar_pa_qm_LV` cube, which carries
 * zero non-null cells for it across every unit, direction and partner since
 * 2022 — so it vanishes from a chart headed "Q4 2025" with nothing to tell the
 * reader it was ever there. Dropping it is right; dropping it silently leaves a
 * reader believing Latvia's passenger traffic is simply Ventspils.
 *
 * Driven by each port's own `latest`, never the block's.
 */
export function dormantPorts(measure: PortMeasure): PortSeries[] {
  const period = measure.latest;
  if (!period) return [];
  return measure.ports
    .filter(port => port.latest !== null && valueAt(port, period) === null)
    .sort((a, b) => (b.latest ?? '').localeCompare(a.latest ?? ''));
}

/**
 * Months a period trails another, or null if either is unreadable.
 *
 * Mirrors `periodToMonthIndex` in `api/shared/eurostat.js`: a quarter resolves
 * to the last month it covers, so 2025-Q4 is December 2025.
 */
function monthsBetween(period: string, reference: string): number | null {
  const idx = (p: string): number | null => {
    const q = /^(\d{4})-?Q([1-4])$/.exec(p);
    if (q) return +q[1] * 12 + +q[2] * 3;
    const m = /^(\d{4})-(\d{2})$/.exec(p);
    if (m) return +m[1] * 12 + +m[2];
    const y = /^(\d{4})$/.exec(p);
    if (y) return +y[1] * 12 + 12;
    return null;
  };
  const a = idx(period);
  const b = idx(reference);
  return a === null || b === null ? null : b - a;
}

/**
 * A port that has stopped reporting rather than merely fallen a quarter behind.
 *
 * Twelve months, matching `DISCONTINUED_AFTER_MONTHS` in `api/port-data` and
 * `PORT_DATA_STALE_AFTER_MONTHS` here, so the two layers draw the line in the
 * same place.
 *
 * Recomputed on the client rather than trusted from the payload alone, for the
 * same reason `dataFreshness.ts` recomputes age: `/api/port-data` is cached for
 * hours at the edge and longer in localStorage, so a response predating this
 * field must still render honestly. The API sends `discontinued` too, for
 * consumers that are not this UI.
 */
export const DISCONTINUED_AFTER_MONTHS = 12;

export function isDiscontinued(port: PortSeries, measure: PortMeasure): boolean {
  if (port.discontinued !== undefined) return port.discontinued;
  if (!port.latest || !measure.latest) return false;
  const behind = monthsBetween(port.latest, measure.latest);
  return behind !== null && behind >= DISCONTINUED_AFTER_MONTHS;
}

/** Signed percentage, e.g. `+4.2%`. */
export function formatPct(pct: number): string {
  const rounded = Math.abs(pct) < 0.05 ? 0 : pct;
  return `${rounded > 0 ? '+' : rounded < 0 ? '\u2212' : ''}${Math.abs(rounded).toFixed(1)}%`;
}
