import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { DataControls } from './DataControls';
import { SiteFooter } from './SiteFooter';

export function SiteLayout() {
  const { pathname } = useLocation();
  const isData = pathname === '/data' || pathname.startsWith('/data/') || pathname.startsWith('/indicator/') || pathname === '/explore';

  return (
    <div className="desk-site min-h-screen">
      <a href="#main" className="desk-skip-link text-ui">Skip to content</a>
      <Header />
      <div className="desk-workspace">
        <div className="desk-content">
          {isData && <DataControls />}
          <Suspense fallback={<main id="main" className="folio-route-loading" aria-busy="true"><p className="text-ui">Opening this view…</p></main>}>
            <Outlet />
          </Suspense>
        </div>
        <SiteFooter />
      </div>
    </div>
  );
}
