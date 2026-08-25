import { useMemo, useState } from 'react';
import type { ArticleSummary } from '../../news-types';
import { LinkOutCardFromSummary } from './LinkOutCard';

/**
 * The "elsewhere" rail: other outlets' reporting, link-out only.
 *
 * This rail is a pointer to other people's work, not a second feed. Two things
 * follow from that and are deliberate rather than incidental:
 *
 * 1. It stays capped. Left uncapped it ran longer than our own reporting and
 *    turned the front page into a scroll.
 * 2. It filters by outlet. One prolific feed can otherwise fill the whole rail
 *    and make it look like we syndicate a single publication. Being able to
 *    say "only ERR News" is the reader taking control of that, and it costs
 *    nothing because every item is already in memory.
 *
 * The filter never changes what an item *is*. Tier C renders as a link-out
 * card in every case; narrowing the list cannot promote anything into our
 * prose.
 */

const ALL = '__all__';

function outletOf(summary: ArticleSummary): string {
  return summary.syndicated?.attribution?.trim() || 'Unattributed';
}

function useOutlets(items: ArticleSummary[]) {
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const outlet = outletOf(item);
      counts.set(outlet, (counts.get(outlet) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [items]);
}

const CAP = 4;

export default function ElsewhereRail({ items }: { items: ArticleSummary[] }) {
  const [outlet, setOutlet] = useState<string>(ALL);
  const [showAll, setShowAll] = useState(false);
  const outlets = useOutlets(items);

  const shown = useMemo(
    () => (outlet === ALL ? items : items.filter((item) => outletOf(item) === outlet)),
    [items, outlet],
  );

  // Narrowing to one outlet should start from the top of a short list rather
  // than inherit an expansion the reader asked for on a different list.
  function choose(next: string) {
    setOutlet(next);
    setShowAll(false);
  }

  const visible = showAll ? shown.length : CAP;
  const hidden = shown.length - visible;

  return (
    <aside aria-labelledby="elsewhere-heading">
      <h2
        id="elsewhere-heading"
        className="news-border news-subtle border-b pb-2 text-caption font-semibold uppercase tracking-widest"
      >
        Elsewhere in the Baltics
      </h2>
      <p className="news-subtle mt-2 text-caption">
        Other outlets’ reporting. Headline and their own summary only. We link out rather than
        reproduce.
      </p>

      {outlets.length > 1 && (
        <div
          className="mt-3 flex flex-wrap gap-1.5"
          role="group"
          aria-label="Filter by outlet"
        >
          <button
            type="button"
            onClick={() => choose(ALL)}
            aria-pressed={outlet === ALL}
            className={[
              'news-focus rounded-full border px-3 py-1 text-caption font-medium transition-colors',
              outlet === ALL ? 'news-tab-active' : 'news-tab-inactive news-hover',
            ].join(' ')}
          >
            All outlets
          </button>
          {outlets.map(({ name, count }) => (
            <button
              key={name}
              type="button"
              onClick={() => choose(name)}
              aria-pressed={outlet === name}
              // The count is a visual affordance separated by margin, which a
              // screen reader does not read as a gap: without this the control
              // announces as "EUobserver2".
              aria-label={`${name}, ${count} ${count === 1 ? 'story' : 'stories'}`}
              className={[
                'news-focus rounded-full border px-3 py-1 text-caption font-medium transition-colors',
                outlet === name ? 'news-tab-active' : 'news-tab-inactive news-hover',
              ].join(' ')}
            >
              {name}
              <span className="news-subtle ml-1 tabular-nums">{count}</span>
            </button>
          ))}
        </div>
      )}

      <p className="sr-only" role="status">
        {shown.length} {shown.length === 1 ? 'story' : 'stories'}
        {outlet === ALL ? ' from other outlets' : ` from ${outlet}`}
      </p>

      {shown.length === 0 ? (
        <p className="news-subtle mt-4 text-caption">Nothing filed here right now.</p>
      ) : (
        <>
          <div className="mt-4 space-y-4">
            {shown.slice(0, visible).map((summary) => (
              <LinkOutCardFromSummary key={summary.id ?? summary.slug} summary={summary} />
            ))}
          </div>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="news-link news-focus mt-4 text-caption font-medium underline underline-offset-4"
            >
              Show {hidden} more{outlet === ALL ? ' from other outlets' : ` from ${outlet}`}
            </button>
          )}
        </>
      )}
    </aside>
  );
}
