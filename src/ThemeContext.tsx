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
 * The dark series are lightened for Signal Desk's petrol surfaces. The
 * quantitative history below describes the preceding palette; current
 * contrast, chroma and separation are asserted by design-system.test.ts.
 *
 * ─── The country palette is the flags ───
 * Latvia carmine, Estonia blue, Lithuania gold. A reader who knows the flags
 * does not have to consult a legend at all, which is the cheapest legibility
 * win available on a three-country chart.
 *
 * The values are measured rather than picked, and the axis that decides them is
 * **chroma** — which the previous generation of this palette did not constrain
 * at all. It optimised for lightness (L* ≥ 45, so the charts do not read as
 * muddy) and for separation under deuteranopia, and with nothing pushing back
 * on saturation the answer sat at 80–100% of the chroma sRGB can even produce
 * at those hues: LV 80%, EE 93%, LT 99%, and dark Estonia at 100% — the gamut
 * edge exactly. Readers reported it as painful to look at. They were describing
 * a real property of the palette, not a preference.
 *
 * These sit at chroma ≈ 0.10 (light) and ≈ 0.13 (dark), inside the C 0.08–0.15
 * band Our World in Data and Tableau 10 use, and Datawrapper's "avoid bright,
 * saturated colors" is the same advice in words. Nothing was given up for it:
 *
 *                        weakest deuteranopia pair    LV vs --data-negative
 *   light  before                 ΔE 26                      ΔE 13.9
 *   light  after                  ΔE 37                      ΔE 37.8
 *   dark   before                 ΔE 52                      ΔE 22.7
 *   dark   after                  ΔE 36                      ΔE 19.3
 *
 * ─── Why Lithuania is still gold and not green ───
 * The old reason was that flag green sat ΔE 6 from Latvian carmine under a
 * deuteranopia simulation — total convergence. That reason is now **obsolete**:
 * against the muted Latvia above, green separates *better* than gold does
 * (ΔE 44 vs 37 in light). It was re-measured rather than assumed, because
 * DESIGN.md invited exactly that re-opening if the palette moved.
 *
 * Green is still unavailable, for a different and harder reason. Lithuania's
 * flag green `#006A44` is hue 160, and green is intrinsically mid-lightness: on
 * a white card it has to go dark to clear 3:1, which walks straight into the
 * L* ≥ 45 floor that exists *because* readers called the old palette muddy.
 * Scanned across the whole green range at this palette's chroma, the light
 * theme yields **87 candidates at hue 128, 10 at hue 136, and zero from hue 140
 * onward** — nothing at all at the flag's own hue. Green survives only as
 * olive, which does not read as the Lithuanian stripe.
 *
 * And green already means something here: `--data-positive` colours every
 * delta and every sparkline that moved the good way. A green country line
 * would be a third meaning for one colour, which is the defect this palette
 * exists to remove.
 *
 * Finland is not a flag colour. Its flag is blue, which is Estonia's, and the
 * two collide at ΔE 3 under deuteranopia. It is plum in both themes and
 * appears only as a Nord Pool bidding zone, never as a Baltic state.
 */
const DARK_CHART: ChartColors = {
  grid: '#35565c',
  axis: '#bfd3cf',
  tooltipBg: '#21474e',
  tooltipBorder: '#4f7478',
  series: { LV: '#cf7f85', EE: '#7aa2cf', LT: '#c3a157', FI: '#b27791' },
  seriesDefault: '#b0d1c6',
  reference: '#bfd3cf',
  positive: '#3ddc97',
  negative: '#ff7a85',
};

const LIGHT_CHART: ChartColors = {
  grid: '#c7d2ce',
  axis: '#3d5559',
  tooltipBg: '#fafcfb',
  tooltipBorder: '#b4c4c1',
  series: { LV: '#bb6d70', EE: '#5580b4', LT: '#9c761f', FI: '#96688c' },
  // A single-series line remains separate from the interface accent.
  seriesDefault: '#0891b2',
  reference: '#3d5559',
  positive: '#047857',
  negative: '#be123c',
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggle: () => {},
  chartColors: LIGHT_CHART,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    return localStorage.getItem('pb-theme') === 'dark' ? 'dark' : 'light';
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
