import { describe, it, expect } from 'vitest';
import { formatValue } from '../src/utils/formatValue';

describe('formatValue', () => {
  it('returns N/A for null', () => {
    expect(formatValue(null, '%')).toBe('N/A');
  });

  // EUR/month
  it('formats EUR/month with € and thousand separator', () => {
    expect(formatValue(1523, 'EUR/month')).toBe('€1,523');
  });

  // EUR/hour
  it('formats EUR/hour with 1 decimal', () => {
    expect(formatValue(21.1, 'EUR/hour')).toBe('€21.1/h');
  });

  // Persons
  it('formats persons over 1M as M', () => {
    expect(formatValue(1_890_000, 'persons')).toBe('1.89M');
  });
  it('formats persons under 1M with separator', () => {
    expect(formatValue(605802, 'persons')).toBe('605,802');
  });

  // M EUR
  it('formats M EUR billions', () => {
    expect(formatValue(2_500_000_000, 'M EUR')).toBe('€2.5B');
  });
  it('formats M EUR millions', () => {
    expect(formatValue(1_200_000, 'M EUR')).toBe('€1M');
  });
  it('formats M EUR thousands', () => {
    expect(formatValue(3500, 'M EUR')).toBe('€3,500');
  });

  // Percentage
  it('formats % YoY', () => {
    expect(formatValue(2.3, '% YoY')).toBe('2.3%');
  });
  it('formats % with negative', () => {
    expect(formatValue(-1.5, '%')).toBe('-1.5%');
  });

  // Index
  it('formats index values', () => {
    expect(formatValue(152.4, 'index (2020=100)')).toBe('152.4');
  });

  // EUR/kWh
  it('formats EUR/kWh with 4 decimals', () => {
    expect(formatValue(0.2288, 'EUR/kWh')).toBe('€0.2288');
  });

  // GWh
  it('formats GWh with separator', () => {
    expect(formatValue(12345, 'GWh')).toBe('12,345 GWh');
  });

  // Years
  it('formats years with 1 decimal', () => {
    expect(formatValue(78.5, 'years')).toBe('78.5');
  });

  // Balance
  it('formats balance with 1 decimal', () => {
    expect(formatValue(-3.2, 'balance')).toBe('-3.2');
  });

  // Fallback large numbers
  it('formats unknown unit with large number as M', () => {
    expect(formatValue(5_000_000, 'widgets')).toBe('5.0M');
  });
  it('formats unknown unit with thousands separator', () => {
    expect(formatValue(12500, 'widgets')).toBe('12,500');
  });
  it('formats unknown unit small number with 1 decimal', () => {
    expect(formatValue(3.7, 'widgets')).toBe('3.7');
  });
});
