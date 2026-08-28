import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary } from '../../news-types';
import { fetchArticleIndex } from '../../news-api';
import { usePageMeta } from '../../newsroom/usePageMeta';

/**
 * How a reader keeps up with a site that publishes irregularly.
 *
 * WHAT THIS PAGE IS NOT ALLOWED TO DO
 * -----------------------------------
 * Promise a cadence. The newsroom runs on a timer but writes only when a series
 * has actually moved, and scheduled runs frequently produce nothing at all — so
 * "daily analysis" would be a false claim made on the one page whose whole job
 * is to set an expectation. The rate is therefore measured from the published
 * index rather than asserted, the same way `/corrections` computes its own
 * error rate instead of describing it.
 *
 * And when the index cannot be read, the measurement is absent rather than
 * zero. "0 articles in the last 30 days" is a sentence about the newsroom;
 * a failed fetch is a sentence about the network, and rendering the second as
 * the first would tell a reader we had stopped publishing.
 */

const FEEDS = [
  {
    path: '/rss.xml',
    name: 'RSS',
    format: 'RSS 2.0',
    carries:
      'Everything we write: original analysis, and the official releases we reproduce verbatim. ' +
      'Link-outs to other outlets are not included, because that is their journalism and it ' +
      'belongs in their feed.',
  },
  {
    path: '/feed.json',
    name: 'JSON Feed',
    format: 'JSON Feed 1.1',
    carries:
      'The same items as the RSS feed, in JSON, for readers and scripts that prefer it. ' +
      'Each item carries its tier and, on a weekly review, its format.',
  },
] as const;

/** `YYYY-MM-DD` in Riga, which is where the day this site reports on begins. */
const RIGA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Riga',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const WINDOW_DAYS = 30;

interface Cadence {
  articles: number;
  days: number;
}

/**
 * What we actually published lately, counted rather than claimed.
 *
 * Days are bucketed in Europe/Riga, not UTC. Bucketing a Baltic publishing day
 * by UTC misfiles everything between local midnight and 02:00 or 03:00 into the
 * previous day — a plausible figure, one day out, which no reader could catch.
 */
function measureCadence(articles: readonly ArticleSummary[], now: number): Cadence {
  const since = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const days = new Set<string>();
  let count = 0;

  for (const article of articles) {
    // Ours only. A link-out card is a pointer to somebody else's reporting and
    // counting it would inflate our own rate with their work.
    if (article.tier === 'C') continue;
    if (!article.published_at) continue;
    const at = new Date(article.published_at).getTime();
    if (Number.isNaN(at) || at < since || at > now) continue;
    count += 1;
    days.add(RIGA_DAY.format(new Date(at)));
  }

  return { articles: count, days: days.size };
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  // A control that cannot work is not shown. `navigator.clipboard` is absent
  // outside a secure context, and a Copy button that silently does nothing is
  // worse than no button: the URL beside it is selectable either way.
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') return null;

  return (
    <button
      type="button"
      onClick={() => {
        clipboard.writeText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      className="news-border news-panel news-hover-panel shrink-0 rounded border px-2 py-1 text-caption font-semibold uppercase tracking-widest"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function FeedRow({
  path,
  name,
  format,
  carries,
}: {
  path: string;
  name: string;
  format: string;
  carries: string;
}) {
  const absolute = `${typeof window === 'undefined' ? '' : window.location.origin}${path}`;

  return (
    <li className="news-border news-panel rounded-lg border px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="news-fg text-callout font-semibold">{name}</h3>
        <span className="news-subtle text-caption font-semibold uppercase tracking-widest">
          {format}
        </span>
      </div>

      <p className="pretty-text news-muted mt-2 text-ui">{carries}</p>

      <div className="mt-3 flex items-center gap-2">
        {/* The URL wraps rather than scrolling sideways.
            
            It used to carry `overflow-x-auto whitespace-nowrap`, and measured
            against production at 320 / 375 / 414px **both chips rendered
            byte-identical visible text** — `https://portabaltica.` — because
            the only part that distinguishes RSS from JSON Feed is the path,
            and the path is exactly what the cut removed. Two controls whose
            whole job is to say *which* address, reading the same. It is the
            §4.4 ticker defect (`R/USD` for EUR/USD) one page over, and worse,
            because here the hidden characters are the informative ones.
            
            A fade would have made the cut read as a cut rather than as a bug
            and left the two chips indistinguishable, so this shows the whole
            URL instead: `break-words` is what `markdown.tsx` already uses for
            the same reason, a URL offering a line break nowhere. Costs one
            line at 320px. */}
        <a
          href={path}
          className="news-link news-border news-panel-muted min-w-0 flex-1 break-words rounded border px-2 py-1 font-mono text-ui underline underline-offset-2"
        >
          {absolute}
        </a>
        <CopyButton value={absolute} />
      </div>
    </li>
  );
}

export default function FollowPage() {
  const [cadence, setCadence] = useState<Cadence | null>(null);

  usePageMeta({
    title: 'Follow portaBaltica | portaBaltica',
    description:
      'Every way to keep up with portaBaltica: RSS, JSON Feed and the weekly review. No email list, no account, no tracking.',
    canonicalPath: '/follow',
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchArticleIndex(controller.signal)
      .then((index) => setCadence(measureCadence(index.articles, Date.now())))
      // Absent, not zero. A failed fetch says nothing about how much we publish.
      .catch(() => setCadence(null));
    return () => controller.abort();
  }, []);

  return (
    <div className="mx-auto max-w-measure">
      <h1 className="balance-text news-fg text-display font-semibold tracking-tight">
        Follow portaBaltica
      </h1>

      <p className="pretty-text news-muted mt-4 text-prose">
        Everything we publish is available as a feed, and reading one requires no account and
        tells us nothing about you. Point a feed reader at either address below.
      </p>

      <section aria-labelledby="feeds" className="mt-12">
        <h2 id="feeds" className="balance-text news-fg text-title font-semibold tracking-tight">
          The feeds
        </h2>

        <ul className="mt-4 space-y-4">
          {FEEDS.map((feed) => (
            <FeedRow key={feed.path} {...feed} />
          ))}
        </ul>

        <p className="pretty-text news-muted mt-4 text-ui">
          Both carry the same items. A withdrawn article leaves both the moment it is withdrawn,
          which is the only thing that stops a headline we have publicly taken back going on
          circulating. The reason is always in the{' '}
          <Link to="/corrections" className="news-link underline underline-offset-2">
            corrections log
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="how-often" className="mt-12">
        <h2 id="how-often" className="balance-text news-fg text-title font-semibold tracking-tight">
          How often
        </h2>

        <p className="pretty-text news-muted mt-4 text-prose">
          We publish when the data warrants it and not otherwise. The newsroom runs on a timer,
          but a run that finds nothing new in the series writes nothing, so some days carry
          several articles and some carry none. We would rather be quiet than padded.
        </p>

        {/*
          Measured, not claimed — and omitted entirely when it could not be
          measured, because a zero here would read as "they have stopped".
        */}
        {cadence !== null && (
          <p className="news-border news-panel news-muted mt-4 rounded-lg border px-4 py-3 text-ui">
            In the last {WINDOW_DAYS} days we published{' '}
            <span className="news-fg font-mono">{cadence.articles}</span>{' '}
            {cadence.articles === 1 ? 'article' : 'articles'} on{' '}
            <span className="news-fg font-mono">{cadence.days}</span> of those days. Counted from
            the published index when you loaded this page, not written down in advance.
          </p>
        )}
      </section>

      <section aria-labelledby="weekly" className="mt-12">
        <h2 id="weekly" className="balance-text news-fg text-title font-semibold tracking-tight">
          Once a week, if the week earned it
        </h2>

        <p className="pretty-text news-muted mt-4 text-prose">
          If a feed of everything is more than you want, the weekly review is one piece that reads
          back over what we reported. It is written on Sundays and published only when the week
          produced enough findings to be worth reviewing.
        </p>

        <p className="mt-4 text-ui">
          <Link to="/weekly" className="news-link underline underline-offset-4">
            The latest weekly review →
          </Link>
        </p>
      </section>

      <section aria-labelledby="no-email" className="mt-12">
        <h2 id="no-email" className="balance-text news-fg text-title font-semibold tracking-tight">
          There is no email list
        </h2>

        <p className="pretty-text news-muted mt-4 text-prose">
          Deliberately. We do not collect addresses, so there is nothing here to leak, nothing to
          sell, and nothing to unsubscribe from. A feed reader gives you the same articles without
          us knowing who you are or whether you opened them.
        </p>
      </section>

      <section aria-labelledby="the-data" className="mt-12">
        <h2 id="the-data" className="balance-text news-fg text-title font-semibold tracking-tight">
          Or skip us and read the data
        </h2>

        <p className="pretty-text news-muted mt-4 text-prose">
          Every figure we publish comes from a series you can open and check yourself. The
          dashboard updates independently of whether anyone wrote about it.
        </p>

        <p className="mt-4 text-ui">
          <Link to="/data" className="news-link underline underline-offset-4">
            Open the live dashboard →
          </Link>
        </p>
      </section>
    </div>
  );
}
