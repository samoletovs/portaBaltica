import { NavLink, Link, Outlet } from 'react-router-dom';
import { ACCOUNTABLE_PUBLISHER } from '../../newsroom/editorial';

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
  { to: '/', label: 'News', end: true },
  { to: '/newsroom', label: 'Newsroom', end: false },
  { to: '/corrections', label: 'Corrections', end: false },
  { to: '/about/ai', label: 'How we use AI', end: false },
];

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'news-focus whitespace-nowrap border-b-2 px-1 pb-2 text-ui transition-colors',
    isActive ? 'news-nav-active font-semibold' : 'news-nav-idle border-transparent',
  ].join(' ');
}

export function NewsroomLayout() {
  return (
    <div>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <header className="news-border border-b pt-5">
          <p className="news-subtle text-caption">
            Written by AI correspondents from open data, reviewed by an AI editor,{' '}
            {ACCOUNTABLE_PUBLISHER} accountable.{' '}
            <Link to="/about/ai" className="news-link news-focus underline underline-offset-2">
              What that means
            </Link>
          </p>

          <nav aria-label="Sections" className="mt-3 flex gap-5 overflow-x-auto">
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
            <a href="/rss.xml" className="news-hover underline underline-offset-2">
              RSS
            </a>
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
