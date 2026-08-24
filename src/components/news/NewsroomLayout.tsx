import { Link, Outlet } from 'react-router-dom';
import { ACCOUNTABLE_EDITOR } from '../../newsroom/editorial';

/**
 * The shell around every news route.
 *
 * The AI disclosure sits in the masthead, above the fold, on every page. It is
 * not a footer line: a reader should know what wrote this before they read it,
 * not after.
 */
export function NewsroomLayout() {
  return (
    <div>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <header className="news-border border-b pt-5 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="news-subtle text-xs leading-relaxed">
            Articles here are written by named AI correspondents from open data, checked against the
            source before publishing, and edited by {ACCOUNTABLE_EDITOR}.{' '}
            <Link to="/about/ai" className="news-link news-focus underline underline-offset-2">
              What that means
            </Link>
          </p>
          <nav aria-label="Newsroom information" className="flex gap-3 text-xs">
            <Link className="news-link news-focus underline underline-offset-2" to="/correspondents">Correspondents</Link>
            <Link className="news-link news-focus underline underline-offset-2" to="/corrections">Corrections</Link>
            <Link className="news-link news-focus underline underline-offset-2" to="/about/ai">How we use AI</Link>
          </nav>
          </div>
        </header>

        <main id="main" className="py-8">
          <Outlet />
        </main>

        <footer className="news-border news-subtle border-t py-6 text-xs">
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
