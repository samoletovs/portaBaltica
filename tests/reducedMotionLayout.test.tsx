import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { Header } from '../src/components/Header';

const css = readFileSync(resolve('src/index.css'), 'utf8');

/**
 * The page must not scroll sideways, and it must not depend on an animation
 * to avoid it.
 *
 * The bug this pins: the ticker track is ~3300px of `max-content` inside a
 * 1226px box with `overflow: hidden`. That clipped it visually, and every
 * ancestor measured `scrollWidth === clientWidth` — yet `document.scrollWidth`
 * was 3338 against a 1274px viewport, so every route on the site scrolled
 * 2064px into blank space.
 *
 * It happened **only under `prefers-reduced-motion: reduce`**. With the marquee
 * running there is a transform on the track at all times, and a transform
 * creates a containing block that holds the overflow in. Containment was a
 * side effect of the animation, so the layout was accidentally correct for
 * readers who let the page move and broken for the ones who asked it not to —
 * the failing case being, once again, the one nothing exercises.
 *
 * jsdom does not lay out, so these cannot measure `scrollWidth` directly. They
 * assert the two things that can be checked without layout and that together
 * make the defect impossible: the clipping is declared independently of any
 * transform, and no strip relies on a transform to contain itself. The
 * measured proof lives in the PR, where a real browser reports
 * `maxScrollLeft` 2064 → 0.
 */
describe('containment does not depend on motion', () => {
  it('declares the ticker viewport as painting inside its own box', () => {
    // `contain: paint` says the thing directly. `overflow: hidden` alone did
    // not hold it, and `transform: translateZ(0)` would work by re-creating
    // exactly the coupling that caused the bug.
    expect(css, 'the ticker viewport must contain its own paint').toMatch(
      /\.ticker-viewport\s*\{[^}]*contain:\s*paint/,
    );
    expect(css, 'and still clip').toMatch(/\.ticker-viewport\s*\{[^}]*overflow:\s*hidden/);
  });

  it('does not use a transform to achieve that containment', () => {
    // A `translateZ(0)` or `will-change: transform` here would pass a
    // scrollWidth check while restoring the dependency this fixes: the
    // containment would again be a property of the compositing, not of the
    // box.
    const rule = css.match(/\.ticker-viewport\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule, 'containment must not be a side effect of a transform').not.toMatch(
      /transform|will-change|translate/,
    );
  });

  it('keeps the marquee itself animation-driven, so reduced motion still stops it', () => {
    // The fix must not quietly become "constrain the track", which would stop
    // the ticker scrolling for everyone.
    expect(css).toMatch(/\.ticker-track\s*\{[^}]*width:\s*max-content/);
    expect(css).toMatch(/\.ticker-track\s*\{[^}]*animation:\s*ticker-scroll/);
  });

  it('stops every animation under prefers-reduced-motion', () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(block, 'animations must be neutralised').toMatch(/animation-duration:\s*0\.01ms/);
    expect(block, 'infinite loops must be stopped').toMatch(/animation-iteration-count:\s*1/);
    expect(block, 'smooth scrolling is a vestibular trigger').toMatch(/scroll-behavior:\s*auto/);
  });
});

describe('a flex row that holds a fixed-size control', () => {
  it('lets the growing item shrink past its content', () => {
    // A flex item defaults to `min-width: auto`, which refuses to shrink below
    // its content. Beside a control held at the 44px minimum touch target,
    // that pushed the row 6px past the viewport at 768px and scrolled two
    // routes sideways — in *both* motion modes, so it was a second and
    // unrelated defect that the reduced-motion sweep happened to surface.
    const business = readFileSync(resolve('src/components/BusinessTile.tsx'), 'utf8');
    const growers = [...business.matchAll(/className="flex-1([^"]*)"/g)].map((m) => m[1]);

    expect(growers.length, 'expected the two search inputs').toBeGreaterThan(0);
    for (const rest of growers) {
      expect(rest, 'a flex-1 input beside a 44px button needs min-w-0').toMatch(/\bmin-w-0\b/);
    }
  });
});

describe('the masthead', () => {
  it('renders its scrolling strip without asking the document to scroll', () => {
    // jsdom cannot measure this, so it is asserted structurally: the nav is a
    // scroll container of its own, which is what keeps its overflowing tabs
    // out of the document's scrollable area.
    const { container } = render(
      <MemoryRouter>
        <ThemeProvider>
          <CountryProvider>
            <FilterProvider>
              <Header />
            </FilterProvider>
          </CountryProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const nav = container.querySelector('nav[aria-label="Site sections"]');
    expect(nav, 'the section nav is missing').not.toBeNull();
    expect(nav!.className, 'the tab strip must scroll within itself').toContain('overflow-x-auto');
  });
});
