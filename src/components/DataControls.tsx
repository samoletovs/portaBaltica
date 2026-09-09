import { useCountry, COUNTRY_INFO, type Country } from '../CountryContext';
import { useFilter, YEAR_OPTIONS, STROKE_OPTIONS } from '../FilterContext';
import { useSearchParams } from 'react-router-dom';

/** Research controls belong with the data, not above every article. */
export function DataControls() {
  const { country, setCountry } = useCountry();
  const { years, setYears, strokeStyle, setStrokeStyle } = useFilter();
  const [params, setParams] = useSearchParams();

  function chooseCountry(code: Country) {
    setCountry(code);
    const next = new URLSearchParams(params);
    next.set('country', code);
    setParams(next, { replace: true });
  }

  return (
    <div className="desk-data-toolbar">
      <p className="text-caption">Country &amp; history</p>
      <div className="desk-data-controls flex min-w-0 items-center gap-3">
        <div className="desk-segments flex shrink-0" role="group" aria-label="Country">
          {(Object.keys(COUNTRY_INFO) as Country[]).map(code => (
            <button key={code} type="button" className="text-caption" onClick={() => chooseCountry(code)}
              aria-label={`Switch to ${COUNTRY_INFO[code].label}`} aria-pressed={country === code}>
              {code}
            </button>
          ))}
        </div>
        <div className="desk-segments flex shrink-0" role="group" aria-label="Date range filter">
          {YEAR_OPTIONS.map(year => (
            <button key={year} type="button" className="text-caption" onClick={() => setYears(year)}
              aria-label={`Show ${year} year${year > 1 ? 's' : ''} of data`} aria-pressed={years === year}>
              {year}Y
            </button>
          ))}
        </div>
        <button type="button" className="desk-line-control shrink-0 text-caption"
          onClick={() => setStrokeStyle(strokeStyle === 'patterned' ? 'plain' : 'patterned')}
          aria-label={`Draw chart lines ${strokeStyle === 'patterned' ? 'solid, marked with end shapes' : 'with dash patterns'}`}
          title={STROKE_OPTIONS.find(option => option.value !== strokeStyle)?.hint}>
          <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
            <line x1="1" y1="6" x2="22" y2="6" stroke="currentColor" strokeWidth="2"
              strokeDasharray={strokeStyle === 'patterned' ? '5 3' : undefined} />
            {strokeStyle === 'plain' && <circle cx="20" cy="6" r="3" fill="currentColor" />}
          </svg>
          <span className="sr-only">Chart lines are currently {strokeStyle === 'patterned' ? 'dashed' : 'solid'}</span>
        </button>
      </div>
    </div>
  );
}
