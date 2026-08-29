/**
 * /weekly can say why there is no review, instead of implying a quiet week.
 *
 * WHAT WAS WRONG
 * --------------
 * `WeeklyPage` already keeps three states apart, and its own docblock names
 * them: "we do not know yet", "we could not find out", "we found out, and there
 * is none". It then collapsed a fourth distinction *inside* the last one. These
 * two rendered the identical sentence:
 *
 *     the review ran on Sunday and decided the week was too thin
 *     the review has not run at all since August
 *
 * A cron that stops firing therefore reads as a quiet week, for as long as it
 * stays stopped. That is not hypothetical here: an audit recorded this page as
 * "renders but is unpopulated", which is exactly what both states look like,
 * and settling which one it was took a session and a blob fetch.
 *
 * The instrument already existed and nothing read it. `weekly.py` writes
 * `runs/weekly-latest.json` on every run whatever the outcome, and says why in
 * its own comment -- "a weekly cron that never fires and a week with nothing
 * worth wrapping produce the same artefact". Measured before this change: that
 * blob was written by one file and read by none. The answer was computed and
 * dropped at the seam.
 *
 * WHAT THESE ASSERT
 * -----------------
 * The four reasons, each distinguished from the others rather than merely
 * rendered -- a test that only checks its own sentence appears would pass on a
 * page that printed all four at once. And the populated case as a control,
 * because every assertion below is about an absence, and an absence is a claim
 * about the instrument before it is a claim about the code.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WeeklyPage from '../src/components/news/WeeklyPage';
import { explainNoReview, WEEKLY_REVIEW_OVERDUE_DAYS } from '../src/news-api';
import type { ArticleSummary } from '../src/news-types';
import { tierASummary } from './fixtures/articles';

const NOW = new Date('2026-09-01T12:00:00Z');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function report(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    outcome: 'not_enough_findings',
    finished_at: daysBefore(1),
    slug: '',
    ...overrides,
  };
}

function wrap(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  return tierASummary({
    id: 'wrap-1',
    slug: 'the-week-in-baltic-data-2026-08-30',
    headline: 'The week: ports, prices and a sentiment slide',
    format: 'weekly_wrap',
    published_at: '2026-08-30T15:00:00Z',
    ...overrides,
  });
}

/**
 * Answers the index and the run report separately, which is the shape the page
 * actually meets. A stub returning one payload for every URL would hand the
 * report parser an article index and prove nothing about either.
 */
function stubFetch(options: { articles?: unknown[]; report?: unknown | 'fail' }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('weekly-latest')) {
        if (options.report === 'fail') throw new Error('offline');
        if (options.report === undefined) return { ok: true, status: 404 } as unknown as Response;
        return {
          ok: true,
          status: 200,
          json: async () => options.report,
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          generated_at: '2026-09-01T06:00:00Z',
          count: (options.articles ?? []).length,
          articles: options.articles ?? [],
        }),
      } as unknown as Response;
    }),
  );
}

/**
 * Drain the event loop rather than poll a clock.
 *
 * `tests/suiteDeterminism.test.ts` holds an equality of the files allowed a
 * wall-clock wait, and this one is deliberately not joining it: `waitFor` times
 * out under worker contention on a component that resolved perfectly well. Three
 * flushes because the page issues two independent fetches and sets state from
 * each.
 */
async function settle() {
  await act(async () => {});
  await act(async () => {});
  await act(async () => {});
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WeeklyPage />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('explainNoReview', () => {
  it('says unknown when there is no report, rather than guessing', () => {
    expect(explainNoReview(null, NOW)).toEqual({ reason: 'unknown' });
  });

  it('says unknown when the timestamp cannot be read', () => {
    // Absence must not resolve to a verdict. A NaN date compared with `>` is
    // always false, so without the explicit check this would have fallen through
    // to a confident "nothing to review".
    const parsed = explainNoReview(
      { outcome: 'published', finishedAt: 'not a date', slug: 'x' },
      NOW,
    );
    expect(parsed).toEqual({ reason: 'unknown' });
  });

  it('reports a lapsed schedule when the last run is older than its cadence', () => {
    const since = daysBefore(WEEKLY_REVIEW_OVERDUE_DAYS + 1);
    expect(explainNoReview({ outcome: 'not_enough_findings', finishedAt: since, slug: '' }, NOW))
      .toEqual({ reason: 'not-run', since });
  });

  it('does not call a run lapsed on the day the allowance expires', () => {
    // The boundary, asserted rather than assumed. One day of slack past the
    // seven-day schedule is deliberate: a late or retried run is not a fault.
    const since = daysBefore(WEEKLY_REVIEW_OVERDUE_DAYS);
    expect(explainNoReview({ outcome: 'draft_refused', finishedAt: since, slug: '' }, NOW).reason)
      .toBe('nothing-to-review');
  });

  it('does not read a future timestamp as an overdue one', () => {
    // Clock skew between the Function App and a reader stamps a report slightly
    // ahead. A negative age must not become a large positive one.
    const ahead = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(explainNoReview({ outcome: 'published', finishedAt: ahead, slug: 'x' }, NOW).reason)
      .toBe('withdrawn');
  });

  it('is not fooled by a clock further ahead than the whole allowance', () => {
    // The case above cannot fail the mutation it was written about. One hour
    // ahead is 0.04 days, and `Math.abs(0.04) > 8` is false, so rewriting the
    // comparison as `Math.abs(days) > WEEKLY_REVIEW_OVERDUE_DAYS` leaves every
    // assertion in this file green -- measured, 14 passed. The comment at that
    // line names `Math.abs` as the mutation that would break it silently, and
    // named it without executing it, which is the failure `AGENTS.md` describes
    // for examples in guidance arriving in a code comment.
    //
    // So the skew here is deliberately larger than the allowance: only then do
    // the correct arithmetic and the mutation disagree. Not synthetic either --
    // a reader whose device clock is set to the wrong month is ordinary, and it
    // must not make our newsroom accuse itself of a dead cron.
    const wayAhead = new Date(
      NOW.getTime() + (WEEKLY_REVIEW_OVERDUE_DAYS + 22) * 86_400_000,
    ).toISOString();
    expect(
      explainNoReview({ outcome: 'not_enough_findings', finishedAt: wayAhead, slug: '' }, NOW)
        .reason,
      'a report from the future is not a report that never arrived',
    ).toBe('nothing-to-review');
  });

  it('reports a withdrawal as fact when the run published and the reader cannot see it', () => {
    expect(explainNoReview({ outcome: 'published', finishedAt: daysBefore(2), slug: 'x' }, NOW))
      .toEqual({ reason: 'withdrawn' });
  });

  it('reports a thin week when the run declined to write one', () => {
    expect(explainNoReview({ outcome: 'not_enough_findings', finishedAt: daysBefore(2), slug: '' }, NOW))
      .toEqual({ reason: 'nothing-to-review' });
    expect(explainNoReview({ outcome: 'draft_refused', finishedAt: daysBefore(2), slug: '' }, NOW))
      .toEqual({ reason: 'nothing-to-review' });
  });
});

describe('the page says which kind of empty it is', () => {
  it('names a lapsed schedule as our fault, not a quiet week', async () => {
    stubFetch({ articles: [], report: report({ finished_at: daysBefore(30) }) });
    renderPage();
    await settle();

    expect(screen.getByRole('status').textContent).toMatch(/has not run since/i);
    // Distinguished, not merely present: the thin-week wording must be absent,
    // or the page is printing every explanation and this assertion is vacuous.
    expect(screen.queryByText(/did not produce enough findings/i)).toBeNull();
  });

  it('states a withdrawal rather than offering it as one half of a guess', async () => {
    stubFetch({ articles: [], report: report({ outcome: 'published', slug: 'gone' }) });
    renderPage();
    await settle();

    expect(screen.getByText(/most recent review has been withdrawn/i)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/Either the week did not produce enough/i)).toBeNull();
  });

  it('says the review ran and found the week too thin', async () => {
    stubFetch({ articles: [], report: report() });
    renderPage();
    await settle();

    expect(screen.getByText(/ran and did not write one/i)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('falls back to the mechanism when the report cannot be read', async () => {
    // The report is a diagnostic. Failing to fetch it must not become a claim
    // about what the newsroom decided.
    stubFetch({ articles: [], report: 'fail' });
    renderPage();
    await settle();

    expect(screen.getByText(/Either the week did not produce enough to review/i)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('still reports no review at all when the report is missing entirely', async () => {
    stubFetch({ articles: [] });
    renderPage();
    await settle();

    expect(screen.getByText(/No weekly review is published at the moment/i)).toBeTruthy();
    expect(screen.getByText(/Either the week did not produce enough to review/i)).toBeTruthy();
  });
});

describe('the controls', () => {
  it('shows the review and none of the absence wording when there is one', async () => {
    // The populated case. Every other assertion in this file is about an absence,
    // and an absence is a claim about the instrument before it is a claim about
    // the code -- this proves the page can render a wrap at all.
    stubFetch({ articles: [wrap()], report: report({ outcome: 'published', slug: 'x' }) });
    renderPage();
    await settle();

    const links = screen
      .getAllByRole('link')
      .filter((a) => (a.getAttribute('href') ?? '').startsWith('/article/'));
    expect(links.length).toBeGreaterThan(0);
    expect(screen.queryByText(/No weekly review is published/i)).toBeNull();
    expect(screen.queryByText(/has not run since/i)).toBeNull();
    expect(screen.queryByText(/has been withdrawn/i)).toBeNull();
  });

  it('renders the archive even when the run report is unreachable', async () => {
    // The two fetches fail independently on purpose. A 500 on a diagnostic blob
    // must not take down the article list, which is the more important artefact.
    stubFetch({ articles: [wrap()], report: 'fail' });
    renderPage();
    await settle();

    expect(screen.getByText(wrap().headline)).toBeTruthy();
    expect(screen.queryByText(/The archive could not be loaded/i)).toBeNull();
  });
});
