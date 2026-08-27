/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type YearRange = 1 | 3 | 5 | 10;

export const YEAR_OPTIONS: YearRange[] = [1, 3, 5, 10];

/**
 * How a multi-series line chart tells its series apart.
 *
 * `patterned` gives Latvia a solid stroke, Estonia `9 4` and Lithuania `18 6`.
 * `plain` draws all three solid and marks the end of each line with a distinct
 * shape instead.
 *
 * **Both carry a second, non-colour encoding, and that is not negotiable.**
 * WCAG 2.2 SC 1.4.1 forbids colour as the only means of distinguishing an
 * element, and between-series *luminance* contrast here is 1.19–1.76:1 — well
 * under the 3:1 at which the criterion's own note lets lightness count as a
 * second distinction. So hue alone is exactly what is forbidden, and a setting
 * that merely removed the dashes would be a setting that turns off
 * accessibility. The end-of-line marker is what makes `plain` legitimate; it is
 * also what Highcharts' accessibility guidance recommends for line charts in
 * preference to dashing, on the grounds that a dash over a dense multi-year
 * series reads as texture rather than as a series.
 *
 * The default stays `patterned` because it survives greyscale printing, which
 * a marker does not.
 */
export type StrokeStyle = 'patterned' | 'plain';

export const STROKE_OPTIONS: { value: StrokeStyle; label: string; hint: string }[] = [
  { value: 'patterned', label: 'Dashed', hint: 'Each country gets its own dash pattern' },
  { value: 'plain', label: 'Solid', hint: 'Solid lines, each marked with its own end shape' },
];

interface FilterContextValue {
  years: YearRange;
  setYears: (y: YearRange) => void;
  strokeStyle: StrokeStyle;
  setStrokeStyle: (s: StrokeStyle) => void;
}

const FilterContext = createContext<FilterContextValue>({
  years: 5,
  setYears: () => {},
  strokeStyle: 'patterned',
  setStrokeStyle: () => {},
});

export function useFilter() {
  return useContext(FilterContext);
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [years, setYears] = useState<YearRange>(5);
  const [strokeStyle, setStrokeStyle] = useState<StrokeStyle>(() => {
    if (typeof window === 'undefined') return 'patterned';
    const stored = localStorage.getItem('pb-stroke');
    return stored === 'plain' || stored === 'patterned' ? stored : 'patterned';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('pb-stroke', strokeStyle);
  }, [strokeStyle]);

  return (
    <FilterContext.Provider value={{ years, setYears, strokeStyle, setStrokeStyle }}>
      {children}
    </FilterContext.Provider>
  );
}
