import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { DashboardSection } from '../types';
import { useTheme } from '../ThemeContext';
import { useCountry, COUNTRY_INFO, type Country } from '../CountryContext';
import { useFilter, YEAR_OPTIONS, STROKE_OPTIONS, type YearRange } from '../FilterContext';
import { useOverflowFade } from '../utils/useOverflowFade';

const SECTIONS: { id: DashboardSection | 'all' | 'news'; label: string; path: string }[] = [
  { id: 'news', label: 'News', path: '/' },
  { id: 'all', label: 'Overview', path: '/data' },
  { id: 'economy', label: 'Economy', path: '/data/economy' },
  { id: 'labour', label: 'Labour', path: '/data/labour' },
  { id: 'trade', label: 'Trade', path: '/data/trade' },
  { id: 'government', label: 'Government', path: '/data/government' },
  { id: 'energy', label: 'Energy', path: '/data/energy' },
  { id: 'property', label: 'Property', path: '/data/property' },
  { id: 'environment', label: 'Environment', path: '/data/environment' },
  { id: 'business', label: 'Business', path: '/data/business' },
  { id: 'maritime', label: 'Maritime', path: '/data/maritime' },
];

export function Header() {
  const [clock, setClock] = useState(new Date());
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const { country, setCountry, timezone, tzAbbr } = useCountry();
  const { years, setYears, strokeStyle, setStrokeStyle } = useFilter();
  const [navRef, navFade] = useOverflowFade<HTMLElement>();
  const [controlsRef, controlsFade] = useOverflowFade<HTMLDivElement>();
  const section = location.pathname.startsWith('/data/')
    ? location.pathname.slice('/data/'.length).split('/')[0]
    : null;
  const activeSection = location.pathname === '/data'
    ? 'all'
    : section && SECTIONS.some((item) => item.id === section)
      ? section
      : location.pathname.startsWith('/data') ||
          location.pathname.startsWith('/indicator') ||
          location.pathname.startsWith('/api-docs')
        ? 'all'
        : 'news';

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header>
      <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {/* Top bar. One row, at every width.

            It used to wrap, on the reasoning that at 375 the country, range
            and theme controls together are wider than the viewport and a
            fixed-height row cut the last one off. Wrapping does avoid the
            clip, and it pays for it in height: measured at 375 the bar was
            **148px** across three stacked rows — wordmark, then the two
            segmented groups, then the two toggles — before a reader reaches
            the section tabs or a single figure. Every control is also held at
            44×44 by the touch-target rule, so nine of them cannot fit a phone
            however they are arranged; wrapping only decides whether the
            surplus costs vertical space or scrolls.

            So the controls are one strip that scrolls sideways, the same
            answer the section tabs below already give, with the same
            `useOverflowFade` mask so the cut edge reads as more content
            rather than as a clip. `min-w-0` is what lets the strip give way:
            without it the flex item refuses to shrink below its content and
            pushes the wordmark off instead.

            The clock steps aside first below `sm`, because the time is the
            least load-bearing thing in the row. */}
        <div className="flex items-center justify-between gap-3 h-14">
          <div className="flex items-center gap-3 shrink-0">
            <Link to="/" className="text-callout font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              porta<span style={{ color: 'var(--news-accent)' }}>Baltica</span>
            </Link>
            <span className="hidden sm:inline text-caption font-normal" style={{ color: 'var(--text-tertiary)' }}>Baltic news & data intelligence</span>
          </div>
          <div
            ref={controlsRef}
            // No `justify-end` here, and that is load-bearing rather than
            // tidying: in a scroll container, content that overflows a
            // flex-end row spills off the *start* edge, where scrolling cannot
            // reach it. Measured at 375 with `justify-end`, the strip reported
            // `scrollWidth === clientWidth` — 225px for 440px of controls —
            // and the country selector was clipped and unreachable. The parent
            // row's `justify-between` already holds the strip against the
            // right edge when everything fits.
            className={`flex items-center gap-2 sm:gap-3 min-w-0 overflow-x-auto ${controlsFade}`}
          >
            <span className="hidden sm:inline shrink-0 text-caption font-mono" style={{ color: 'var(--text-secondary)' }}>
              {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone })}
              <span style={{ color: 'var(--text-tertiary)' }} className="ml-1">{tzAbbr}</span>
            </span>
            {/* Country selector.
                The selected segment used to be white text on --text-secondary,
                a *text* token pressed into service as a background: 2.56:1, and
                so the selected state of a control was the least legible thing
                on the page. It is a raised surface with an accent underline
                now, which is a state a reader can both see and, because the
                accent is not the only cue, distinguish without colour. */}
            <div className="flex items-center shrink-0 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-card)' }} role="group" aria-label="Country">
              {(Object.keys(COUNTRY_INFO) as Country[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCountry(c)}
                  className={`px-2 py-1 text-caption transition-colors ${country === c ? 'font-semibold' : ''}`}
                  style={{
                    background: country === c ? 'var(--bg-raised)' : 'var(--bg-card)',
                    color: country === c ? 'var(--text-primary)' : 'var(--text-secondary)',
                    boxShadow: country === c ? 'inset 0 -2px 0 var(--news-accent)' : undefined,
                  }}
                  aria-label={`Switch to ${COUNTRY_INFO[c].label}`}
                  aria-pressed={country === c}
                >
                  {COUNTRY_INFO[c].flag} {c}
                </button>
              ))}
            </div>
            {/* Date range selector */}
            <div className="flex items-center shrink-0 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-card)' }} role="group" aria-label="Date range filter">
              {YEAR_OPTIONS.map((y: YearRange) => (
                <button
                  key={y}
                  onClick={() => setYears(y)}
                  className={`px-2 py-1 text-caption transition-colors ${years === y ? 'font-semibold' : ''}`}
                  style={{
                    background: years === y ? 'var(--bg-raised)' : 'var(--bg-card)',
                    color: years === y ? 'var(--text-primary)' : 'var(--text-secondary)',
                    boxShadow: years === y ? 'inset 0 -2px 0 var(--news-accent)' : undefined,
                  }}
                  aria-label={`Show ${y} year${y > 1 ? 's' : ''} of data`}
                  aria-pressed={years === y}
                >
                  {y}Y
                </button>
              ))}
            </div>
            <button
              onClick={() => setStrokeStyle(strokeStyle === 'patterned' ? 'plain' : 'patterned')}
              className="relative h-8 px-2 shrink-0 flex items-center gap-1 rounded-lg transition-colors"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
              // The label says what the control *does*, not what it currently
              // is: a toggle announced as its own state reads backwards to a
              // screen-reader user, who hears the state twice and the action
              // never.
              aria-label={`Draw chart lines ${strokeStyle === 'patterned' ? 'solid, marked with end shapes' : 'with dash patterns'}`}
              title={STROKE_OPTIONS.find((o) => o.value !== strokeStyle)?.hint}
            >
              <svg width="20" height="10" viewBox="0 0 20 10" aria-hidden="true">
                <line
                  x1="1" y1="5" x2={strokeStyle === 'patterned' ? 19 : 14} y2="5"
                  stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={strokeStyle === 'patterned' ? '5 3' : undefined}
                />
                {strokeStyle === 'plain' && <circle cx="17" cy="5" r="2.5" fill="var(--text-secondary)" />}
              </svg>
              <span className="sr-only">
                Chart lines are currently {strokeStyle === 'patterned' ? 'dashed' : 'solid'}
              </span>
            </button>
            <button
              onClick={toggle}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              <span className="text-ui" aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
            </button>
          </div>
        </div>

        {/* Section tabs. The active tab is marked by the accent rule beneath it
            and by weight, so the state survives both a colour-blind reader and
            a forced-colours mode.

            The strip scrolls sideways below about 900px, and at 375px it used
            to clip the last tab mid-character — "T…" — with nothing to say the
            row continued. A hard cut reads as a layout bug rather than as more
            content, so the mask fades the ends instead. */}
        <nav
          ref={navRef}
          className={`flex gap-0 -mb-px overflow-x-auto ${navFade}`}
          aria-label="Site sections"
        >
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to={s.path}
              className={`px-4 py-2 text-ui whitespace-nowrap transition-colors border-b-2 ${activeSection === s.id ? 'font-semibold' : ''}`}
              style={{
                borderColor: activeSection === s.id ? 'var(--news-accent)' : 'transparent',
                color: activeSection === s.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              aria-current={activeSection === s.id ? 'page' : undefined}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
