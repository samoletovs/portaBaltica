/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react';

export type YearRange = 1 | 3 | 5 | 10;

export const YEAR_OPTIONS: YearRange[] = [1, 3, 5, 10];

interface FilterContextValue {
  years: YearRange;
  setYears: (y: YearRange) => void;
}

const FilterContext = createContext<FilterContextValue>({
  years: 5,
  setYears: () => {},
});

export function useFilter() {
  return useContext(FilterContext);
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [years, setYears] = useState<YearRange>(5);

  return (
    <FilterContext.Provider value={{ years, setYears }}>
      {children}
    </FilterContext.Provider>
  );
}
