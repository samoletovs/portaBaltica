import { Outlet } from 'react-router-dom';
import { DataTicker } from './DataTicker';
import { Header } from './Header';

export function SiteLayout() {
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="news-accent-panel news-fg sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Header />
        <DataTicker />
      </div>
      <Outlet />
    </div>
  );
}
