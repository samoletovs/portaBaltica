import { useLayoutEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCountry } from '../CountryContext';

export function useCountryFromQuery() {
  const [params] = useSearchParams();
  const { setCountry } = useCountry();
  const requested = params.get('country')?.toUpperCase();
  useLayoutEffect(() => {
    if (requested === 'LV' || requested === 'EE' || requested === 'LT') setCountry(requested);
  }, [requested, setCountry]);
}
