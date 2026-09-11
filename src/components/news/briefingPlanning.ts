import { formatPeriod } from '../../dataFreshness';
import { formatValue } from '../../utils/formatValue';

interface Reading {
  period: string;
  value: number;
}

/** Only the monthly and annual period shapes used by this bounded sample. */
function precedingPeriod(period: string): string | null {
  if (/^\d{4}$/.test(period)) return String(Number(period) - 1);
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!month) return null;
  const ordinal = Number(month[1]) * 12 + Number(month[2]) - 2;
  return `${Math.floor(ordinal / 12)}-${String(ordinal % 12 + 1).padStart(2, '0')}`;
}

function changeLabel(change: number, unit: string): string | null {
  if (!Number.isFinite(change)) return null;
  const size = Math.abs(change);
  if (unit.startsWith('%')) {
    const amount = size > 0 && size < 0.05 ? 'less than 0.1' : size.toFixed(1);
    return `${amount} percentage points`;
  }
  if (unit === 'EUR/hour') {
    return size > 0 && size < 0.05 ? `less than ${formatValue(0.1, unit)}` : formatValue(size, unit);
  }
  return null;
}

export function briefingChange(readings: Reading[], latest: Reading, country: string, unit: string) {
  const opening = `${country}: ${formatValue(latest.value, unit)} in ${formatPeriod(latest.period)}`;
  const period = precedingPeriod(latest.period);
  // Match the period, not the preceding non-null array entry: a missing
  // month/year cannot silently turn into a longer comparison.
  const previous = period ? readings.find(reading => reading.period === period) : null;
  if (!previous) {
    return {
      statement: `${opening}.`,
      missingBasis: period
        ? `Change not calculated: ${formatPeriod(period)} has no published reading for ${country}.`
        : 'Change not calculated: this period format has no supported comparison in the sample.',
    };
  }
  const delta = latest.value - previous.value;
  const size = changeLabel(delta, unit);
  const comparison = delta === 0 ? 'unchanged'
    : size ? `${delta > 0 ? 'up' : 'down'} ${size}` : 'compared';
  return {
    statement: `${opening}, ${comparison} ${comparison === 'compared' ? 'with' : 'from'} ${formatValue(previous.value, unit)} in ${formatPeriod(previous.period)}.`,
    missingBasis: null,
  };
}

export function briefingNextCheck(latest: Reading, unit: string, condition: string): string {
  const cadence = /^\d{4}$/.test(latest.period) ? 'annual '
    : /^\d{4}-(0[1-9]|1[0-2])$/.test(latest.period) ? 'monthly ' : '';
  return `Compare the next published ${cadence}reading with ${formatValue(latest.value, unit)} for ${formatPeriod(latest.period)}. ${condition}`;
}
