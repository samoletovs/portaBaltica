import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { ThemeProvider } from '../src/ThemeContext';
import { Header } from '../src/components/Header';

function renderHeader(path: string) {
  return render(
    <ThemeProvider>
      <CountryProvider>
        <FilterProvider>
          <MemoryRouter initialEntries={[path]}>
            <Header />
          </MemoryRouter>
        </FilterProvider>
      </CountryProvider>
    </ThemeProvider>,
  );
}

describe('unified site header', () => {
  it('shows News beside the dashboard sections on article routes', () => {
    renderHeader('/article/example');

    expect(screen.getByRole('link', { name: 'News' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/data');
    expect(screen.getByLabelText(/Switch to .* theme/)).toBeTruthy();
    expect(screen.getByLabelText('Date range filter')).toBeTruthy();
  });

  it('keeps dashboard section URLs and active state', () => {
    renderHeader('/data/economy');

    expect(screen.getByRole('link', { name: 'Economy' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'News' }).getAttribute('href')).toBe('/');
  });
});

/**
 * The top bar is one row, and stays one.
 *
 * A wiring guard, not a layout proof: jsdom does not lay out, so it cannot see
 * a stacked row. It holds the structure that makes a single row possible, and
 * `tests/headerOneRow.live.test.ts` measures that it works in a browser.
 *
 * Measured at 375px before this: the bar wrapped into three rows and stood
 * 148px tall, because nine controls held at 44×44 by the touch-target rule
 * cannot fit a phone however they are arranged. The surplus now scrolls
 * sideways instead of costing height.
 */
describe('the header top bar', () => {
  const source = readFileSync(resolve('src/components/Header.tsx'), 'utf8');
  const topBar = source.match(/<div className="(flex items-center justify-between[^"]*)"/)?.[1];

  it('does not wrap its controls onto a second row', () => {
    expect(topBar, 'the top bar row was not found').toBeTruthy();
    expect(topBar, 'a wrapping row buys the clip back in height').not.toContain('flex-wrap');
    expect(topBar, 'the row needs a fixed single-row height').toMatch(/\bh-14\b/);
  });

  it('lets the control strip scroll rather than wrap or clip', () => {
    const strip = source.match(/className=\{`(flex items-center[^`]*)`\}/)?.[1];
    expect(strip, 'the control strip was not found').toBeTruthy();
    expect(strip, 'the strip must be able to scroll').toContain('overflow-x-auto');
    expect(strip, 'without min-w-0 a flex item refuses to shrink below its content').toContain('min-w-0');
    // Overflow in a flex-end row spills off the start edge, where scrolling
    // cannot reach it: measured at 375px, the country selector was clipped and
    // unreachable while the strip reported no overflow at all.
    expect(strip, 'justify-end puts the overflow where scrolling cannot reach').not.toContain('justify-end');
    expect(strip, 'the strip fades its cut edge so a clip reads as more content').toContain('controlsFade');
  });

  it('keeps every control at its full size inside the strip', () => {
    // A shrinking chip is how a 44px touch target quietly becomes a 20px one.
    const strip = source.slice(source.indexOf('ref={controlsRef}'), source.indexOf('Section tabs'));
    const children = strip.match(/className="[^"]*"/g) ?? [];
    const groups = children.filter((c) => /rounded-lg/.test(c));
    expect(groups.length, 'the segmented groups were not found').toBeGreaterThanOrEqual(3);
    for (const group of groups) {
      expect(group, `${group} may be squeezed by the row`).toContain('shrink-0');
    }
  });
});
