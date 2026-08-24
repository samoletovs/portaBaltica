import { NavLink, Link, Outlet } from 'react-router-dom';
import { ACCOUNTABLE_EDITOR } from '../../newsroom/editorial';

const NAV = [
  { to: '/', label: 'Front page', end: true },
  { to: '/data', label: 'Data', end: false },
  { to: '/correspondents/nida', label: 'Correspondents', end: false },
  { to: '/corrections', label: 'Corrections', end: false },
  { to: '/about/ai', label: 'How we use AI', end: false },
];

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400',
    isActive
      ? 'border-ocean-400 font-medium text-white'
      : 'border-transparent text-slate-400 hover:text-slate-200',
  ].join(' ');
}

/**
 * The shell around every news route.
 *
 * The AI disclosure sits in the masthead, above the fold, on every page. It is
 * not a footer line: a reader should know what wrote this before they read it,
 * not after.
 */
export function NewsroomLayout() {
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ocean-600 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <header>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-6">
            <Link
              to="/"
              className="text-2xl font-semibold tracking-tight text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
            >
              porta<span className="text-ocean-400">Baltica</span>
            </Link>
            <p className="text-xs text-slate-500">Baltic open data, reported</p>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Articles here are written by named AI correspondents from open data, checked against the
            source before publishing, and edited by {ACCOUNTABLE_EDITOR}.{' '}
            <Link to="/about/ai" className="underline underline-offset-2 hover:text-slate-300">
              What that means
            </Link>
          </p>

          <nav
            aria-label="Sections"
            className="mt-3 flex gap-1 overflow-x-auto border-b border-slate-800/60"
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

        <footer className="border-t border-slate-800/50 py-6 text-xs text-slate-500">
          <p>
            Original analysis of Baltic open data. We do not rewrite other outlets’ reporting —{' '}
            <Link to="/about/ai" className="underline underline-offset-2 hover:text-slate-300">
              read why
            </Link>
            .
          </p>
          <p className="mt-2">
            <a href="/rss.xml" className="underline underline-offset-2 hover:text-slate-300">
              RSS
            </a>
            {' · '}
            <Link to="/corrections" className="underline underline-offset-2 hover:text-slate-300">
              Corrections
            </Link>
            {' · '}
            <Link to="/data" className="underline underline-offset-2 hover:text-slate-300">
              The dashboard
            </Link>
            {' · '}
            Built by{' '}
            <a href="https://naurolabs.com" className="underline underline-offset-2 hover:text-slate-300">
              NauroLabs
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
