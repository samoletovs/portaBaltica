/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react';

export type Country = 'LV' | 'EE' | 'LT';

interface CountryContextValue {
  country: Country;
  setCountry: (c: Country) => void;
  countryLabel: string;
  flag: string;
  timezone: string;
  tzAbbr: string;
}

const COUNTRY_INFO: Record<Country, { label: string; flag: string; timezone: string; tzAbbr: string }> = {
  LV: { label: 'Latvia', flag: '🇱🇻', timezone: 'Europe/Riga', tzAbbr: 'EET' },
  EE: { label: 'Estonia', flag: '🇪🇪', timezone: 'Europe/Tallinn', tzAbbr: 'EET' },
  LT: { label: 'Lithuania', flag: '🇱🇹', timezone: 'Europe/Vilnius', tzAbbr: 'EET' },
};

const CountryContext = createContext<CountryContextValue>({
  country: 'LV',
  setCountry: () => {},
  countryLabel: 'Latvia',
  flag: '🇱🇻',
  timezone: 'Europe/Riga',
  tzAbbr: 'EET',
});

export function useCountry() {
  return useContext(CountryContext);
}

export function CountryProvider({ children }: { children: ReactNode }) {
  const [country, setCountry] = useState<Country>('LV');
  const info = COUNTRY_INFO[country];

  return (
    <CountryContext.Provider value={{ country, setCountry, countryLabel: info.label, flag: info.flag, timezone: info.timezone, tzAbbr: info.tzAbbr }}>
      {children}
    </CountryContext.Provider>
  );
}

export { COUNTRY_INFO };
