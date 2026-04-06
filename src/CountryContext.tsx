import { createContext, useContext, useState, type ReactNode } from 'react';

export type Country = 'LV' | 'EE' | 'LT';

interface CountryContextValue {
  country: Country;
  setCountry: (c: Country) => void;
  countryLabel: string;
  flag: string;
}

const COUNTRY_INFO: Record<Country, { label: string; flag: string }> = {
  LV: { label: 'Latvia', flag: '🇱🇻' },
  EE: { label: 'Estonia', flag: '🇪🇪' },
  LT: { label: 'Lithuania', flag: '🇱🇹' },
};

const CountryContext = createContext<CountryContextValue>({
  country: 'LV',
  setCountry: () => {},
  countryLabel: 'Latvia',
  flag: '🇱🇻',
});

export function useCountry() {
  return useContext(CountryContext);
}

export function CountryProvider({ children }: { children: ReactNode }) {
  const [country, setCountry] = useState<Country>('LV');
  const info = COUNTRY_INFO[country];

  return (
    <CountryContext.Provider value={{ country, setCountry, countryLabel: info.label, flag: info.flag }}>
      {children}
    </CountryContext.Provider>
  );
}

export { COUNTRY_INFO };
