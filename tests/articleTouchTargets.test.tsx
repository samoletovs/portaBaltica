/**
 * The standalone links on an article page clear the 44px touch floor.
 *
 * WHY THIS FILE EXISTS — A POPULATION GAP, NOT A MISSING CHECK
 * -----------------------------------------------------------
 * `touchTargets.live.test.ts` measures every rendered control at 375px and is
 * the right instrument for this. It could not see these three, because its
 * population is `navigableRoutes()`, and `tests/routes.ts` drops every route
 * whose path contains a `:` — so `/article/:slug`, the most-read route type on
 * a news site, was never measured. Its sibling
 * `reducedMotionLayout.live.test.ts` already carries `CONCRETE_PARAM_ROUTES`
 * for exactly this reason; the touch-target guard did not.
 *
 * `AGENTS.md`: the set the guard walks and the set the behaviour walks must be
 * the same set. Everything in the gap is unguarded while looking covered.
 *
 * Measured against production at affe582, eight articles, every one identical:
 *
 *     67x18   "Economy"                ArticleView.tsx      (43-99 wide by section)
 *    116x18   "Open the full series"   ChartEmbed.tsx
 *    104x18   "Open the dataset"       ProvenanceBlock.tsx
 *
 *   /indicator/gdp        38 controls, 0 under 44   <- control, param route, clean
 *   /correspondents/nida  31 controls, 0 under 44   <- control, param route, clean
 *
 * at 320, 375, 768 and 1280 alike — so this is not a narrow-viewport defect and
 * a fix scoped to a breakpoint would have been wrong.
 *
 * WHY NOT JUST WIDEN THE LIVE TEST
 * --------------------------------
 * That is done too, and it is the check that measures the rendered outcome. But
 * the live suite runs *after* a deploy, so on its own it cannot stop the
 * regression reaching production. This runs in the gate. The two are the same
 * split `touchTargets.live.test.ts` already describes between itself and
 * `design-system.test.ts`: one reads the declaration, one reads the page.
 *
 * WHAT THIS DOES NOT CLAIM
 * ------------------------
 * jsdom computes no layout, so this cannot measure 44 rendered pixels — the
 * live test does that. What it asserts is that each standalone link carries the
 * utility, and, separately, that the utility still *means* the floor that
 * `index.css` declares. Asserting the class alone would pass if the floor moved
 * underneath it.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tierAArticle } from './fixtures/articles';

// The chart itself pulls recharts through a lazy boundary and is not what is
// under test. Stubbing the inner card keeps the REAL ChartEmbed — and therefore
// its "Open the full series" link — in the render. Mocking ChartEmbed instead,
// as articleView.test.tsx does, would remove one of the three subjects.
vi.mock('../src/components/IndicatorCard', () => ({
  IndicatorChart: ({ id }: { id: string }) => <div data-testid="chart" data-indicator={id} />,
}));

const { ArticleView } = await import('../src/components/news/ArticleView');

/**
 * Tailwind's `min-h-11` is 11 steps of 0.25rem. `index.css` declares the floor
 * for every control it reaches as `2.75rem`. They are the same number, and this
 * file is only meaningful while they stay the same number.
 */
const TAILWIND_STEP_REM = 0.25;
const TARGET_CLASS = 'min-h-11';
const TARGET_STEPS = 11;

function renderArticle() {
  return render(
    <MemoryRouter>
      <ArticleView article={tierAArticle()} />
    </MemoryRouter>,
  );
}

describe('the 44px floor these links are held to', () => {
  it('is the floor index.css actually declares', () => {
    // Ties the utility to the rule. If the floor moves to 48px in index.css and
    // these links keep `min-h-11`, this fails rather than quietly shipping
    // three controls below the new floor.
    const css = readFileSync(resolve('src/index.css'), 'utf8');
    const declared = css.match(/min-height:\s*([\d.]+)rem/);

    expect(declared, 'index.css no longer declares a min-height floor').not.toBeNull();
    expect(TARGET_STEPS * TAILWIND_STEP_REM).toBe(Number(declared![1]));
  });
});

describe('every standalone link on an article clears the touch floor', () => {
  /** The three measured against production, by their accessible name. */
  const STANDALONE = [
    [/^Economy$/, 'the section kicker — ArticleView'],
    [/Open the full series/, 'the chart→dashboard link — ChartEmbed'],
    [/Open the dataset/, 'the provenance dataset link — ProvenanceBlock'],
  ] as const;

  it.each(STANDALONE)('%s is at least 44px tall (%s)', (name, where) => {
    renderArticle();
    const link = screen.getByRole('link', { name });

    expect(
      link.className.split(/\s+/),
      `${where}: this link measured 18px tall in production and is not in running ` +
        `prose, so SC 2.5.8's prose exemption does not reach it. It needs ${TARGET_CLASS}.`,
    ).toContain(TARGET_CLASS);
  });

  it('finds all three, so a rename cannot empty this check', () => {
    // VACUITY GUARD. `it.each` over a list that stopped matching would report
    // three passes having asserted nothing about the page. getByRole throws on
    // a miss, but only inside the case — this states the population as a count.
    renderArticle();
    const found = STANDALONE.filter(([name]) => screen.queryAllByRole('link', { name }).length > 0);
    expect(found.length, 'an article no longer renders all three measured links').toBe(3);
  });

  it('leaves links in running prose alone, which is what makes the rule a rule', () => {
    // NEGATIVE CONTROL, same render, same query. SC 2.5.8 exempts a link inside
    // a sentence, `index.css` says so, and `touchTargets.live.test.ts` excludes
    // them by computed `display: inline`. If this check were simply "every link
    // carries min-h-11" it would pass by matching everything and would wreck the
    // leading of the prose it padded.
    renderArticle();

    const prose = screen
      .getAllByRole('link')
      .filter((el) => el.closest('p') !== null && !el.className.includes('flex'));

    expect(prose.length, 'no prose link in this fixture — the control cannot discriminate').toBeGreaterThan(0);
    for (const el of prose) {
      expect(el.className, 'a prose link must not be padded to 44px').not.toContain(TARGET_CLASS);
    }
  });
});
