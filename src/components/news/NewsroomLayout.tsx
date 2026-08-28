import { NavLink, Link, Outlet } from 'react-router-dom';
import { ACCOUNTABLE_PUBLISHER } from '../../newsroom/editorial';
import { useOverflowFade } from '../../utils/useOverflowFade';

/**
 * The shell around every news route.
 *
 * The masthead carries four destinations and one line of disclosure. It used
 * to carry three sentences and a second row of links, which pushed the lead
 * story most of the way down the first screen — the disclosure was so
 * prominent it was competing with the journalism it was there to qualify.
 *
 * The line that remains still says the three things that matter: AI wrote it,
 * an editor reviewed it, a named human is accountable. Everything else moved
 * to the page that exists to explain it, one click away and linked from the
 * nav rather than only from the end of a paragraph.
 */

const NAV = [
  // "Latest" rather than "News": the site header one row above already carries
  // a News tab pointing at this same route, and two links with one label, one
  // under the other, reads as a mistake rather than as a hierarchy.
  { to: '/', label: 'Latest', end: true },
  { to: '/newsroom', label: 'Newsroom', end: false },
  { to: '/corrections', label: 'Corrections', end: false },
  { to: '/about/ai', label: 'How we use AI', end: false },
];

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'shrink-0 whitespace-nowrap border-b-2 px-1 pb-2 text-ui transition-colors',
    isActive ? 'news-nav-active font-semibold' : 'news-nav-idle border-transparent',
  ].join(' ');
}

export function NewsroomLayout() {
  const [navRef, navFade] = useOverflowFade<HTMLElement>();

  return (
    <div>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <header className="news-border border-b pt-6">
          <p className="news-subtle text-caption">
            Written by AI correspondents from open data, reviewed by an AI editor,{' '}
            {ACCOUNTABLE_PUBLISHER} accountable.{' '}
            <Link to="/about/ai" className="news-link underline underline-offset-2">
              What that means
            </Link>
          </p>

          {/* The masthead nav scrolls sideways on a phone, so it needs the same
              mask the site header and the dashboard rail already carry.
              Measured at 320px it hid 83px with a hard cut, and the item it cut
              was the *active* one: "How we use AI" rendered as "Hc" beneath its
              own accent underline, which reads as a broken tab rather than as a
              row that continues. `useOverflowFade` was written for exactly this
              — its docstring names two other strips — and this one was never
              given it. */}
          <nav
            ref={navRef}
            aria-label="Sections"
            className={`mt-3 flex gap-6 overflow-x-auto ${navFade}`}
          >
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main id="main" className="py-8">
          <Outlet />
        </main>

        <footer className="news-border news-subtle border-t py-6 text-caption">
          <p>
            Original analysis of Baltic open data. We do not rewrite other outlets’ reporting —{' '}
            <Link to="/about/ai" className="news-hover underline underline-offset-2">
              read why
            </Link>
            .
          </p>
          <p className="mt-2">
            {/*
              Was `RSS`, a bare anchor to /rss.xml, and it was the ONLY follow
              affordance on the whole site. Measured against production at
              2026-08-28T12:25Z: /rss.xml was one click from every newsroom
              page, /follow was two and only via an article, and /feed.json was
              three. The older, less capable feed was the discoverable one.

              This costs a reader who specifically wants RSS one extra click,
              and buys every reader a page that explains both feeds, gives the
              URLs in a copyable form and points at the weekly review. Feed
              readers are unaffected either way: both feeds are advertised by
              `<link rel="alternate">` in index.html, which is autodiscovered
              without anyone clicking anything.

              It is not in the nav above, and that is measured too. That nav
              already scrolls sideways at phone widths — 83px over at 320 and
              28px over at 375, with four items — so a fifth would push "How we
              use AI" further out of reach to make this one easier to find.
            */}
            <Link to="/follow" className="news-hover underline underline-offset-2">
              Follow
            </Link>
            {' · '}
            <Link to="/newsroom" className="news-hover underline underline-offset-2">
              The newsroom
            </Link>
            {' · '}
            <Link to="/corrections" className="news-hover underline underline-offset-2">
              Corrections
            </Link>
            {' · '}
            <Link to="/data" className="news-hover underline underline-offset-2">
              The dashboard
            </Link>
            {' · '}
            Built by{' '}
            <a href="https://naurolabs.com" className="news-hover underline underline-offset-2">
              NauroLabs
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
