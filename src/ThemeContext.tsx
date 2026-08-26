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
  /**
   * Sentiment, as literals for SVG. The DOM uses `--data-positive` /
   * `--data-negative` via `sentimentColor()`; a chart cannot, for the same
   * `var()`-in-jsdom reason as everything else here.
   */
  positive: string;
  negative: string;
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
 *
 * ─── The country palette is the flags ───
 * Latvia carmine, Estonia blue, Lithuania yellow. A reader who knows the flags
 * does not have to consult a legend at all, which is the cheapest legibility
 * win available on a three-country chart.
 *
 * Four constraints shaped the exact values, all measured rather than guessed:
 *
 *  1. Raw flag colours fail. Latvian carmine #9E3039 is 2.40:1 on a card and
 *     Lithuanian green #006A44 is 2.87:1, both under the 3:1 that WCAG 2.2
 *     SC 1.4.11 asks of a graphical object. They are lightened until they pass.
 *  2. Lithuania is yellow, not green. Against Latvian carmine, flag green
 *     measures ΔE 6 under a deuteranopia simulation — total convergence, so
 *     around 8% of men could not tell Latvia from Lithuania. Yellow measures
 *     ΔE 52. Yellow is also the stripe most people picture.
 *  3. Latvia must not be the same red as "declining". At #e4707a it sat ΔE 8.6
 *     from `--data-negative`, which is to say the same colour, and red would
 *     then have meant both "Latvia" and "falling" on one screen.
 *  4. **3:1 is the floor, not the target.** The first light palette answered
 *     constraint 1 by pushing all three to about 7:1 — #a4262c, #0057a8,
 *     #b4700a — which is AAA *text* contrast applied to a line. Readers
 *     reported the light charts as dark and muddy, and they were right:
 *     #b4700a reads brown, not gold. These values are the brightest that still
 *     clear 3:1 on a white card, and they are 14–16 L* lighter than what they
 *     replace while every separation still holds:
 *
 *       LV #e6414e  4.01:1   EE #1a7ae0  4.28:1   LT #c28206  3.24:1
 *       deuteranopia ΔE — LV/EE 109, EE/LT 135, LV/LT 26; LV vs negative ΔE 14
 *
 * Finland is not a flag colour. Its flag is blue, which is Estonia's, and the
 * two collide at ΔE 3 under deuteranopia. It is fuchsia in both themes — a
 * brighter Estonia crowded the violet it used to be, down to ΔE 23 in light.
 * It appears only as a Nord Pool bidding zone, never as a Baltic state.
 */
const DARK_CHART: ChartColors = {
  grid: '#1e293b',
  axis: '#9fb0c4',
  tooltipBg: '#1c2740',
  tooltipBorder: '#26344f',
  series: { LV: '#dc3b4a', EE: '#4da6ff', LT: '#fdb913', FI: '#f0abfc' },
  seriesDefault: '#7dd3fc',
  reference: '#9fb0c4',
  positive: '#3ddc97',
  negative: '#ff7a85',
};

const LIGHT_CHART: ChartColors = {
  grid: '#e2e8f0',
  axis: '#455468',
  tooltipBg: '#ffffff',
  tooltipBorder: '#dbe2ea',
  series: { LV: '#e6414e', EE: '#1a7ae0', LT: '#c28206', FI: '#8b1a9c' },
  // Not #0369a1 — that is the link accent byte for byte, and DESIGN.md §1.5
  // reserves the accent for links, the active nav indicator and the primary
  // call to action. A chart line is none of those.
  seriesDefault: '#0891b2',
  reference: '#455468',
  positive: '#047857',
  negative: '#be123c',
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
