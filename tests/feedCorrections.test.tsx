/**
 * A corrected article must not present its uncorrected claim on a feed.
 *
 * WHAT WAS WRONG
 * --------------
 * Measured against production on 2026-09-01: 18 of the 93 articles in the live
 * index carried a correction, and **none of them said so** on `/` or `/weekly`.
 * Several of those headlines are the retracted claim itself — "hits record
 * 38.5%", "drops to a record low", "set record with 1,175 thousand tonnes". A
 * reader scanning the front page met a superlative we had publicly withdrawn,
 * with nothing to tell them so, and found out only by clicking.
 *
 * WHY THE MARKER IS NOT A FIELD ON THE SUMMARY
 * --------------------------------------------
 * The obvious repair — write `corrections` onto `ArticleSummary` in
 * `write_index` — marks nothing, and the measurement is in `correctedSlugs`.
 * The feed reads `corrections.json`, which is the same file `/corrections`
 * reads, so the two surfaces cannot disagree about who was corrected.
 *
 * WHAT THIS FILE DOES NOT COVER
 * -----------------------------
 * That any of it reaches a reader. jsdom does not lay out and does not compute
 * an accessibility tree the way a browser does, so a marker could be present
 * here and invisible in production. `tests/correctionsReachTheFeed.live.test.ts`
 * is the check that answers that, in a real browser, against the deployed site.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NewsFeed from '../src/components/news/NewsFeed';
import WeeklyPage from '../src/components/news/WeeklyPage';
import { correctedSlugs } from '../src/news-api';
import type { CorrectionLogEntry } from '../src/news-api';
import type { ArticleSummary } from '../src/news-types';
import { tierASummary } from './fixtures/articles';

const BADGE = 'Corrected';
const NOTICE = /Correction notices could not be loaded/i;

const CORRECTED_SLUG = 'latvias-food-inflation-drops-to-a-record-low';
const CLEAN_SLUG = 'latvian-wage-growth-outpaces-inflation';

function corrected(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  return tierASummary({
    id: 'corrected-1',
    slug: CORRECTED_SLUG,
    headline: "Latvia's food inflation drops to a record low of -2%",
    ...overrides,
  });
}

function clean(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  return tierASummary({
    id: 'clean-1',
    slug: CLEAN_SLUG,
    headline: 'Latvian wage growth outpaced inflation for a third straight quarter',
    ...overrides,
  });
}

function logEntry(slug: string, at: string): CorrectionLogEntry {
  return {
    slug,
    headline: 'as published',
    corrected_at: at,
    description:
      'CORRECTED. This article said the reading was a record low. It was the lowest in the ' +
      'window we had retrieved, not in the series, and the notice says so.',
  };
}

/**
 * Route by URL, because the page now makes two independent reads.
 *
 * The existing feed tests stub one response for every call, which leaves
 * `fetchCorrections` parsing the index object — an array check rejects it, so
 * they land in the `ok` state with an empty set and go on passing. That is the
 * right outcome for them and useless here, where the whole subject is telling
 * the three states apart.
 */
function stubFetch(options: {
  articles: unknown[];
  corrections?: CorrectionLogEntry[];
  correctionsStatus?: number;
}) {
  const { articles, corrections = [], correctionsStatus = 200 } = options;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('corrections.json')) {
        return {
          ok: correctionsStatus === 200,
          status: correctionsStatus,
          json: async () => corrections,
        } as unknown as Response;
      }
      if (String(url).includes('index.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            generated_at: '2026-09-01T06:00:00Z',
            count: articles.length,
            articles,
          }),
        } as unknown as Response;
      }
      // Anything else — `/weekly` also reads its run report — is simply absent.
      return { ok: false, status: 404, json: async () => null } as unknown as Response;
    }),
  );
}

const renderFeed = () =>
  render(
    <MemoryRouter>
      <NewsFeed />
    </MemoryRouter>,
  );

const renderWeekly = () =>
  render(
    <MemoryRouter>
      <WeeklyPage />
    </MemoryRouter>,
  );

/** Yield the event loop once: drain microtasks, then one macrotask. */
async function turn(): Promise<void> {
  await act(async () => {
    await new Promise<void>((done) => {
      setImmediate(done);
    });
  });
}

/**
 * Let the stubbed fetches settle, without waiting on a clock.
 *
 * `tests/suiteDeterminism.test.ts` holds an equality naming every file that
 * still polls a timer, and the message on that assertion asks for this instead:
 * a polling budget measures how busy the machine is rather than whether the
 * code works. Each turn drains microtasks and yields one macrotask through
 * `setImmediate` — the check phase, no timer, no duration to exceed — and the
 * bound is a turn count.
 *
 * The idiom is `pageMetaParity.test.tsx`'s. Copied rather than shared because
 * three files already each carry their own; a helper module would be the better
 * change and is not this one.
 */
async function settle(until: () => boolean, turns = 50): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    if (until()) return;
    await turn();
  }
  throw new Error(
    `the page had not settled after ${turns} turns of the event loop; it is waiting on ` +
      'something this helper cannot drain',
  );
}

/**
 * Settle on a headline, then drain far enough for the SECOND read to land.
 *
 * These pages make two independent reads. "The headline is present" is true as
 * soon as the index resolves, which is before the corrections log possibly can
 * be — so settling there and asserting on a marker would be measuring a race
 * rather than the component. The extra turns are still a turn count, not a
 * clock; there is no duration here to exceed on a busy machine.
 */
async function settled(headline: string): Promise<void> {
  await settle(() => screen.queryAllByText(headline).length > 0);
  for (let i = 0; i < 5; i += 1) await turn();
}

afterEach(() => vi.unstubAllGlobals());

describe('correctedSlugs', () => {
  it('answers with articles, not with entries', () => {
    // The live log holds 28 entries over 25 slugs, because three articles have
    // been corrected more than once. The feed marks articles, `/corrections`
    // lists entries, and they are supposed to differ — so nothing here should
    // let a caller show a count.
    const twice = [
      logEntry(CORRECTED_SLUG, '2026-08-30T06:43:00Z'),
      logEntry(CORRECTED_SLUG, '2026-08-31T14:08:22Z'),
      logEntry('another-article', '2026-08-31T15:00:00Z'),
    ];
    const slugs = correctedSlugs(twice);

    expect(slugs.size).toBe(2);
    expect(slugs.has(CORRECTED_SLUG)).toBe(true);
    // The control: the population it was built from really did have a duplicate,
    // so the collapse above is a fact about the function rather than about the
    // fixture.
    expect(twice.length).toBe(3);
  });

  it('is empty for an empty log, and says nothing about failure', () => {
    expect(correctedSlugs([]).size).toBe(0);
  });
});

describe('the front page marks a corrected article', () => {
  it('marks the corrected one and leaves the other alone', async () => {
    stubFetch({
      articles: [corrected(), clean()],
      corrections: [logEntry(CORRECTED_SLUG, '2026-08-30T06:43:00Z')],
    });

    renderFeed();

    // Both articles render, so neither assertion below is about a missing card.
    await settled(corrected().headline);
    expect(screen.getByText(clean().headline)).toBeTruthy();

    // POSITIVE: the corrected article carries the marker.
    const marked = screen.getByText(corrected().headline).closest('article');
    expect(marked).toBeTruthy();
    expect(within(marked!).getByText(BADGE)).toBeTruthy();

    // NEGATIVE, on the same page and read the same way. Without this the test
    // would pass just as well over a badge painted onto every card.
    const unmarked = screen.getByText(clean().headline).closest('article');
    expect(unmarked).toBeTruthy();
    expect(within(unmarked!).queryByText(BADGE)).toBeNull();

    // The control on the negative: that card really was read, and really does
    // carry the other badges. An `article` element that failed to render would
    // otherwise satisfy the line above.
    expect(within(unmarked!).getByText('Our analysis')).toBeTruthy();
  });

  it('puts the marker before the headline it qualifies', async () => {
    // `ArticleView` settled the ordering and the argument carries over: the
    // notice comes first so the claim is not read before the retraction of it.
    // In the accessibility tree, reading order is the only order there is.
    stubFetch({
      articles: [corrected()],
      corrections: [logEntry(CORRECTED_SLUG, '2026-08-30T06:43:00Z')],
    });

    renderFeed();

    await settled(corrected().headline);
    const card = screen.getByText(corrected().headline).closest('article')!;
    const text = card.textContent ?? '';

    expect(text.indexOf(BADGE)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(BADGE)).toBeLessThan(text.indexOf(corrected().headline));
  });

  it('marks the lead, not only the items below it', async () => {
    // The lead is a different render path — `ArticleCard variant="lead"` rather
    // than `FeedItem` — and it is the largest headline on the site.
    stubFetch({
      articles: [corrected()],
      corrections: [logEntry(CORRECTED_SLUG, '2026-08-30T06:43:00Z')],
    });

    renderFeed();

    await settled(corrected().headline);
    const lead = screen.getByText(corrected().headline).closest('article')!;
    expect(within(lead).getByText(BADGE)).toBeTruthy();
  });

  it('says once, and only once, that a doubly-corrected article was corrected', async () => {
    // No count. A second correction is a fact about our process, not about
    // whether this headline can be trusted — and one of the three doubly
    // corrected articles in the live log is doubly corrected because we
    // corrected our own correction, which a "2" would render to a reader as two
    // errors.
    stubFetch({
      articles: [corrected()],
      corrections: [
        logEntry(CORRECTED_SLUG, '2026-08-30T06:43:00Z'),
        logEntry(CORRECTED_SLUG, '2026-08-31T14:08:22Z'),
      ],
    });

    renderFeed();

    await settled(corrected().headline);
    expect(screen.getAllByText(BADGE)).toHaveLength(1);
  });
});

describe('when the corrections log cannot be read', () => {
  it('says so rather than showing a feed that looks clean', async () => {
    stubFetch({ articles: [corrected(), clean()], correctionsStatus: 500 });

    renderFeed();

    await settled(corrected().headline);

    // An unmarked card would otherwise mean either "not corrected" or "we could
    // not find out", which is one artefact for two states — and the second is
    // the one that leaves a withdrawn claim looking sound.
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('treats a 404 as an empty log rather than as a failure', async () => {
    // The log genuinely does not exist until the first correction is issued.
    // "None have been issued" is an answer, and announcing it as a fault would
    // be the opposite error to the one this file exists for.
    stubFetch({ articles: [clean()], correctionsStatus: 404 });

    renderFeed();

    await settled(clean().headline);
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.queryByText(BADGE)).toBeNull();
  });

  it('does not warn on a page with no headline to warn about', async () => {
    stubFetch({ articles: [], correctionsStatus: 500 });

    renderFeed();

    await settled('Nothing to report yet today');
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

describe('/weekly marks both of its surfaces', () => {
  const wrapOf = (over: Partial<ArticleSummary>) =>
    tierASummary({ format: 'weekly_wrap', ...over });

  const latest = wrapOf({
    id: 'wrap-latest',
    slug: 'electricity-prices-and-renewable-energy-share-rise-in-the-baltics',
    headline: 'Electricity prices and renewable energy share rise in the Baltics',
    published_at: '2026-08-31T15:00:00Z',
  });
  const earlier = wrapOf({
    id: 'wrap-earlier',
    slug: 'the-week-in-baltic-data-2026-08-21',
    headline: 'The week: ports, prices and a three-month sentiment slide',
    published_at: '2026-08-23T15:00:00Z',
  });

  it('marks the lead review', async () => {
    stubFetch({
      articles: [latest, earlier],
      corrections: [logEntry(latest.slug, '2026-08-31T14:08:22Z')],
    });

    renderWeekly();

    await settled(latest.headline);
    const card = screen.getByText(latest.headline).closest('article')!;
    expect(within(card).getByText(BADGE)).toBeTruthy();
  });

  it('marks the archive list, which is not a card', async () => {
    // THE SECOND SURFACE. "Earlier reviews" renders a bare heading and a link
    // rather than an `ArticleCard`, so marking the card component alone left
    // every archived review here showing a corrected claim unmarked. Found by
    // enumerating every `.headline` render in `src/` rather than by assuming
    // the card covered the page.
    stubFetch({
      articles: [latest, earlier],
      corrections: [logEntry(earlier.slug, '2026-08-25T09:00:00Z')],
    });

    renderWeekly();

    await settled(earlier.headline);

    const item = screen.getByText(earlier.headline).closest('li')!;
    expect(within(item).getByText(BADGE)).toBeTruthy();

    // NEGATIVE, on the same page: the lead is not corrected and is not marked.
    const lead = screen.getByText(latest.headline).closest('article')!;
    expect(within(lead).queryByText(BADGE)).toBeNull();
    // ...and the control that the lead rendered at all.
    expect(within(lead).getByText('Our analysis')).toBeTruthy();
  });

  it('warns once when the log cannot be read', async () => {
    stubFetch({ articles: [latest, earlier], correctionsStatus: 500 });

    renderWeekly();

    await settled(latest.headline);
    expect(screen.getAllByText(NOTICE)).toHaveLength(1);
    expect(screen.queryByText(BADGE)).toBeNull();
  });
});
