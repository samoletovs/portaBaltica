import type { ReactNode } from 'react';
import type { PortMeasure } from '../types';
import { formatPeriod } from '../dataFreshness';
import { changeDescription, sentimentColor, sentimentOf } from '../utils/polarity';
import { dormantPorts, formatMeasure, formatPct, isDiscontinued, measureNoun, totalAt, unitLabel, valueAt, yearOnYear, type PortUnit } from '../portStats';

/**
 * Shared chrome for the three maritime panels.
 *
 * They render three different measures — tonnes, passengers, vessels — from
 * one Eurostat shape, so the layout, the empty state and the "which quarter is
 * this" line are defined once. Three panels that each invented their own way
 * of saying "no data" was how the old maritime tile ended up telling readers
 * that ferry figures were "published biweekly by the Ministry of Transport"
 * long after the ministry had stopped publishing them at all.
 */

export function PanelShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dash-card border dash-edge rounded-xl p-6">
      <h3 className="text-callout font-semibold dash-fg mb-2">{title}</h3>
      {children}
    </section>
  );
}

export function PanelEmpty({ title, reason }: { title: string; reason: string }) {
  return (
    <PanelShell title={title}>
      <p className="dash-muted text-ui">{reason}</p>
    </PanelShell>
  );
}

/**
 * The polarity id a measure is graded against.
 *
 * None of these are registered in `POLARITY`, so they resolve to neutral and
 * are coloured by direction — which is the honest default for port throughput.
 * A rise in tonnage is trade or it is transit dependency; a rise in passengers
 * is tourism or it is emigration. The design book leaves exactly this class of
 * indicator ungraded rather than cheering it, and naming the ids here gives a
 * later editorial decision somewhere to land.
 */
const POLARITY_ID: Record<PortUnit, string> = {
  THS_T: 'port_goods',
  THS: 'port_passengers',
  NR: 'port_vessels',
};

/** Headline figure for a quarter, with the year-on-year move beside it. */
export function MeasureHeadline({ measure }: { measure: PortMeasure }) {
  const yoy = yearOnYear(measure);
  const unit = measure.unit as PortUnit;
  // The headline is the quarter's total, which is known whenever anything
  // reported. The comparison is a separate question: a series with no
  // year-earlier quarter to compare against must still show its figure rather
  // than collapse the whole panel to a dash.
  const total = totalAt(measure, measure.latest);

  // Routed through the polarity module rather than coloured off the sign.
  // Two things were wrong with `pct >= 0 ? emerald : orange`. The orange
  // (`dash-negative`) is one of the few palette classes the theme
  // compatibility layer in `index.css` does not remap, so in light mode it
  // shipped at 2.26:1 against white — below the 4.5:1 floor, on the number
  // that carries the news. And `>= 0` painted an unchanged quarter green: a
  // series that did not move has not delivered good news, and `sentimentOf`
  // returns `none` for zero so it reads as ordinary text.
  const sentiment = yoy ? sentimentOf(POLARITY_ID[unit], yoy.pct) : 'none';

  return (
    <>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-title font-semibold dash-fg font-mono">
          {total !== null ? formatMeasure(total, unit) : '—'}
        </span>
        {yoy ? (
          <>
            {/* Colour is the third encoding, never the first: the sign is in
                `formatPct`, the meaning is in the screen-reader text, and the
                colour only confirms what both already said. */}
            <span className="text-ui" style={{ color: sentimentColor(sentiment) }}>
              {formatPct(yoy.pct)}
              <span className="sr-only"> {changeDescription(POLARITY_ID[unit], yoy.pct)}</span>
            </span>
            <span className="text-caption dash-subtle">year on year</span>
          </>
        ) : (
          <span className="text-caption dash-subtle">no year-earlier quarter to compare</span>
        )}
      </div>
      <p className="text-caption dash-subtle mb-3">
        {unitLabel(unit)}
        {measure.latest ? ` · ${formatPeriod(measure.latest)}` : ''}
      </p>
    </>
  );
}

/** Ranked bars take the categorical ramp, `--cat-1` for the largest. */
const BAR_TOKENS = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5'];

/** One bar per port, sized against the largest, with its share of the total. */
export function PortBars({ measure }: { measure: PortMeasure }) {
  const period = measure.latest;
  const rows = measure.ports
    .map(p => ({ name: p.name, value: valueAt(p, period) }))
    .filter((r): r is { name: string; value: number } => r.value !== null);

  if (rows.length === 0) return null;

  const max = Math.max(...rows.map(r => r.value), 1);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const unit = measure.unit as PortUnit;

  return (
    <div className="space-y-2">
      {rows.map((row, idx) => {
        // A port reporting a true zero still gets a hairline, so "reported
        // nothing" is visibly different from "not in the table at all".
        const width = Math.max((row.value / max) * 100, row.value > 0 ? 1 : 0);
        const share = total > 0 ? ((row.value / total) * 100).toFixed(1) : '0.0';
        return (
          <div key={row.name}>
            <div className="flex items-center justify-between text-caption mb-0.5">
              <span className="dash-body truncate max-w-[55%]" title={row.name}>{row.name}</span>
              <div className="flex items-center gap-2">
                <span className="dash-muted">{share}%</span>
                <span className="dash-fg font-mono w-16 text-right">
                  {formatMeasure(row.value, unit)}
                </span>
              </div>
            </div>
            <div className="h-2.5 dash-raised rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${width}%`,
                  background: `var(${BAR_TOKENS[Math.min(idx, BAR_TOKENS.length - 1)]})`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Footnote naming the source and, when relevant, warning that the figure is a
 * national total rather than a port.
 */
export function PanelNote({ measure, table }: { measure: PortMeasure; table: string }) {
  return (
    <p className="text-caption dash-subtle mt-3">
      {measure.countryOnly && (
        // `dash-warning` looks covered by the theme layer in `index.css`
        // and is not: that layer remaps `.dash-warning`, and the slashed
        // opacity variant is a different class it never matches. So this shipped
        // at amber-on-white in light mode. The token resolves per theme.
        <span style={{ color: 'var(--data-warning)' }}>
          Eurostat publishes no port breakdown for this country; the figure is a national total.{' '}
        </span>
      )}
      Source: Eurostat {table}, quarterly.
    </p>
  );
}

/**
 * Names the ports that are in the table but not in the quarter on screen.
 *
 * `PortBars` already drops a port with no value for the displayed quarter,
 * which is the right call — carrying a four-year-old figure forward, formatted
 * identically to this quarter's, is the failure the maritime rewrite existed to
 * stop. But dropping it without a word leaves the reader with a different false
 * impression: that Latvia's sea passengers are simply Ventspils, and Riga is
 * not a passenger port. Riga *was* the passenger port. It reported 258,000
 * passengers in 2019-Q3, four literal zeroes through 2021 after the Tallink
 * Stockholm route was suspended, and nothing since.
 *
 * Two absences, stated separately, because they are not the same claim:
 *
 *   - a port over a year behind has **stopped** reporting;
 *   - a port a quarter or two behind simply has not filed **yet**, which is
 *     ordinary for a table published in arrears.
 *
 * Collapsing them would tell a reader a working port had closed. Both are dated
 * from the port's own `latest`, never the block's. Note the wording claims only
 * what the data supports — that filings stopped — rather than asserting a
 * closure, which Eurostat does not report.
 */
export function DormantPorts({ measure }: { measure: PortMeasure }) {
  const absent = dormantPorts(measure);
  if (absent.length === 0) return null;

  const noun = measureNoun(measure.unit as PortUnit);
  const stopped = absent.filter(port => isDiscontinued(port, measure));
  const late = absent.filter(port => !isDiscontinued(port, measure));
  const list = (ports: typeof absent) =>
    ports.map(port => `${port.name} (${formatPeriod(port.latest as string)})`).join(', ');

  return (
    <>
      {stopped.length > 0 && (
        <p className="text-caption mt-2" style={{ color: 'var(--data-warning)' }}>
          Not in the figures above: {list(stopped)}.{' '}
          {stopped.length === 1 ? 'That is the last quarter it' : 'Those are the last quarters they'}{' '}
          reported {noun}, and nothing has been filed since.
        </p>
      )}
      {late.length > 0 && (
        <p className="text-caption mt-2" style={{ color: 'var(--text-tertiary)' }}>
          Awaiting this quarter: {list(late)} — last reported {noun} then.
        </p>
      )}
    </>
  );
}
