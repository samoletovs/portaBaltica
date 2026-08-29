/**
 * A number, formatted so it carries its own unit.
 *
 * Two faults sat here, and they are the same fault at different sizes.
 *
 * **The scale was dropped.** `M EUR` means the series is denominated in
 * *millions* of euro — every Eurostat definition behind it queries
 * `currency=MIO_EUR`. This function read the raw number as if it were euro and
 * only appended a magnitude once the number itself passed a million, so
 * Latvia's quarterly goods imports — 5,623 million euro, about €5.6bn —
 * rendered as `€5,623`, and a quarterly move of 200 million rendered as
 * `−€200`. A reader could not tell whether that was five thousand euro or five
 * billion, and the delta looked like the price of a bicycle.
 *
 * The old unit test asserted exactly that behaviour (`formatValue(3500, 'M EUR')`
 * → `'€3,500'`), which is why nothing caught it: the test was written from the
 * same misreading as the code.
 *
 * **The unit was dropped entirely.** Nine indicators declare units this
 * function had no branch for — `nights`, `passengers/quarter`,
 * `thousand tonnes CO2-eq`, `M tonne-km`, `k tonnes`, `k passengers`,
 * `per 1000 inhabitants` — and every one of them fell through to a generic
 * numeric fallback that prints a bare number. Rail freight showed `1,234`, of
 * nothing.
 *
 * So the rule is: **a formatted value states what it is measured in, or it is
 * deliberately dimensionless.** An index and a survey balance carry their
 * meaning in the label; everything that counts something says what.
 *
 * House style follows DESIGN.md §3.7: `m`, `bn` and `tn`, lower case and with
 * no space, which is the FT and Reuters convention rather than the American
 * `M`/`B`; and a real minus sign (U+2212) rather than a hyphen, because a
 * hyphen is narrower than a digit and breaks column alignment even in a
 * tabular face.
 */

const MINUS = '\u2212';

/** A signed number with a real minus sign, never a hyphen. */
function sign(v: number, body: string): string {
  return v < 0 ? `${MINUS}${body}` : body;
}

/**
 * A magnitude-suffixed number, in house style.
 *
 * `scale` is what one unit of `v` is worth: 1 for a plain count, 1e6 for a
 * series already denominated in millions. Passing it in rather than inferring
 * it from the size of the number is the whole repair — the old code inferred,
 * and a series in millions looks exactly like a series in units until you know
 * which one you are holding.
 */
function compact(v: number, scale = 1): string {
  const n = Math.abs(v) * scale;

  for (const [limit, suffix] of [[1e12, 'tn'], [1e9, 'bn'], [1e6, 'm']] as const) {
    if (n >= limit) {
      const scaled = n / limit;
      // Three significant figures, so `5.62bn` keeps its precision and `301m`
      // does not pretend to any it does not have. The trailing `.0` is then
      // dropped — `€74.0m` is a decimal place asserting a precision the source
      // did not publish, and `€74m` is how the FT and Reuters would set it.
      const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${scaled.toFixed(decimals).replace(/\.0$/, '')}${suffix}`;
    }
  }

  if (n >= 1e3) return Math.round(n).toLocaleString('en-GB');
  // Below a hundred a decimal is information rather than noise.
  return n >= 100 ? Math.round(n).toLocaleString('en-GB') : n.toFixed(1);
}

/** Money, scaled and suffixed together so the € and the magnitude cannot separate. */
function money(v: number, scale = 1): string {
  return sign(v, `\u20ac${compact(v, scale)}`);
}

export function formatValue(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v)) return 'N/A';

  // ── money ────────────────────────────────────────────────────────────────
  if (unit === 'EUR/month') return sign(v, `\u20ac${Math.round(Math.abs(v)).toLocaleString('en-GB')}`);
  if (unit === 'EUR/hour') return sign(v, `\u20ac${Math.abs(v).toFixed(1)}/h`);
  if (unit === 'EUR/kWh') return sign(v, `\u20ac${Math.abs(v).toFixed(4)}`);
  // Declared on the card rather than in the indicator registry, which is how it
  // escaped: household gas is priced per gigajoule and rendered as a bare
  // `23.0`, a price with no currency on it.
  if (unit === 'EUR/GJ') return sign(v, `\u20ac${Math.abs(v).toFixed(1)}/GJ`);
  // Denominated in millions of euro at source, so 5623 is €5.62bn.
  if (unit === 'M EUR' || unit === 'MIO_EUR') return money(v, 1e6);
  if (unit === 'EUR') return money(v);

  // ── proportions ──────────────────────────────────────────────────────────
  // Covers '%', '% YoY', '% MoM', '% QoQ', '% GDP', '% of population', …
  if (unit.startsWith('%')) return `${v.toFixed(1)}%`;
  if (unit === 'per 1000' || unit === 'per 1000 inhabitants') {
    return `${v.toFixed(1)} per 1,000`;
  }

  // ── dimensionless by design ──────────────────────────────────────────────
  // An index and a survey balance carry their meaning in the label, not in a
  // suffix; appending one would invent a unit that does not exist.
  if (unit.startsWith('index')) return v.toFixed(1);
  if (unit === 'balance') return v.toFixed(1);
  if (unit === 'years') return `${v.toFixed(1)} yrs`;

  // ── counts ───────────────────────────────────────────────────────────────
  if (unit === 'persons') return sign(v, compact(v));
  if (unit === 'nights') return sign(v, `${compact(v)} nights`);
  if (unit === 'passengers/quarter') return sign(v, `${compact(v)} passengers`);
  if (unit === 'deaths/week') return sign(v, `${compact(v)} deaths`);
  if (unit === 'applications/month') return sign(v, `${compact(v)} applications`);
  if (unit === 'k passengers') return sign(v, `${compact(v, 1e3)} passengers`);
  if (unit === 'thousands') return sign(v, compact(v, 1e3));

  // ── physical quantities ──────────────────────────────────────────────────
  if (unit === 'GWh') return sign(v, `${compact(v)} GWh`);
  if (unit === 'k tonnes') return sign(v, `${compact(v, 1e3)} t`);
  if (unit === 'M tonne-km') return sign(v, `${compact(v, 1e6)} t-km`);
  if (unit === 'thousand tonnes CO2-eq') return sign(v, `${compact(v, 1e3)} t CO\u2082e`);

  // ── fallback ─────────────────────────────────────────────────────────────
  // Reached only by a unit nobody has taught this function. It still prints the
  // magnitude in house style, and `tests/formatValue.test.ts` asserts that the
  // indicator registry contains no unit that lands here — so a new indicator
  // with an unhandled unit fails the suite rather than shipping a bare number.
  return sign(v, compact(v));
}

/**
 * Every unit string this function has an explicit branch for.
 *
 * Exported so the test can compare it against the indicator registry. A unit
 * that reaches the fallback prints a number with nothing to say what it counts,
 * which is the defect above; naming the covered set is what stops it returning
 * one indicator at a time.
 */
export const HANDLED_UNITS: readonly string[] = [
  'EUR/month', 'EUR/hour', 'EUR/kWh', 'EUR/GJ', 'M EUR', 'MIO_EUR', 'EUR',
  'per 1000', 'per 1000 inhabitants',
  'balance', 'years',
  'persons', 'nights', 'passengers/quarter', 'deaths/week', 'k passengers', 'thousands',
  'applications/month',
  'GWh', 'k tonnes', 'M tonne-km', 'thousand tonnes CO2-eq',
];

/** Whether `formatValue` has a branch for this unit — `%` and `index` are prefixes. */
export function isHandledUnit(unit: string): boolean {
  return unit.startsWith('%') || unit.startsWith('index') || HANDLED_UNITS.includes(unit);
}

/**
 * The unit, for a card to print beside a value that cannot carry it.
 *
 * Most formatted values state their own unit — `€5.62bn`, `6.8%`, `12,345 GWh`.
 * An index cannot: it is dimensionless by construction, so `formatValue`
 * correctly returns a bare `150.2`, and a card headed "Manufacturing wages"
 * then reads as though wages were €150.20. The number is right and the card is
 * still misleading.
 *
 * So the card prints the basis instead. `null` for everything whose formatted
 * value already says what it is, because repeating it would be noise.
 */
export function unitCaption(unit: string): string | null {
  if (unit.startsWith('index')) return unit === 'index' ? 'index' : unit;
  if (unit === 'balance') return 'survey balance';
  return null;
}
