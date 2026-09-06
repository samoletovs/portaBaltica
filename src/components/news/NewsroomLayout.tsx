import { Link, Outlet } from 'react-router-dom';
import { ACCOUNTABLE_PUBLISHER } from '../../newsroom/editorial';

export function NewsroomLayout() {
  return (
    <div>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <header className="news-border border-b py-3">
          <p className="news-subtle text-caption">
            Written by AI correspondents, reviewed by an AI editor.{' '}
            {ACCOUNTABLE_PUBLISHER} accountable.{' '}
            <Link to="/about/ai" className="news-link underline underline-offset-2">
              What that means
            </Link>
          </p>
        </header>

        <main id="main" className="py-6">
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
          <nav aria-label="Newsroom resources" className="mt-2">
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

              These resources also live in the global About menu; they no longer
              need a second navigation row above every news page.
            */}
            <Link to="/follow" className="news-hover underline underline-offset-2">
              Follow
            </Link>
            {' · '}
            <Link to="/briefings" className="news-hover underline underline-offset-2">
              Business briefings
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
            <Link to="/about/ai" className="news-hover underline underline-offset-2">
              How we use AI
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
          </nav>
        </footer>
      </div>
    </div>
  );
}
