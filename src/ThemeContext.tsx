/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ChartColors {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  /** Per-country series colours, shared by the comparison and power charts. */
  series: { LV: string; EE: string; LT: string; FI: string };
  /** The colour of a single-series line or area. Never sentiment-coloured. */
  seriesDefault: string;
  /** A reference line — zero, or "now" on an intraday chart. */
  reference: string;
}

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  chartColors: ChartColors;
}

/**
 * Chart colours are literals here, not `var(--series-lv)`.
 *
 * Recharts writes them into SVG presentation attributes, and while browsers do
 * resolve `var()` there, jsdom does not — so a test asserting what a chart is
 * drawn in would read the literal string "var(--series-lv)" and pass on
 * nonsense. These mirror the `--series-*` and `--chart-*` tokens in index.css,
 * and tests/design-system.test.ts asserts the two never drift apart.
 */
const DARK_CHART: ChartColors = {
  grid: '#1e293b',
  axis: '#9fb0c4',
  tooltipBg: '#1c2740',
  tooltipBorder: '#26344f',
  series: { LV: '#38bdf8', EE: '#fbbf24', LT: '#f472b6', FI: '#a78bfa' },
  seriesDefault: '#7dd3fc',
  reference: '#9fb0c4',
};

const LIGHT_CHART: ChartColors = {
  grid: '#e2e8f0',
  axis: '#455468',
  tooltipBg: '#ffffff',
  tooltipBorder: '#dbe2ea',
  series: { LV: '#0284c7', EE: '#b45309', LT: '#be185d', FI: '#6d28d9' },
  seriesDefault: '#0369a1',
  reference: '#455468',
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
  chartColors: DARK_CHART,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    return (localStorage.getItem('pb-theme') as Theme) ?? 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pb-theme', theme);
  }, [theme]);

  function toggle() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  const chartColors = theme === 'dark' ? DARK_CHART : LIGHT_CHART;

  return (
    <ThemeContext.Provider value={{ theme, toggle, chartColors }}>
      {children}
    </ThemeContext.Provider>
  );
}
