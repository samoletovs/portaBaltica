import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { SiteFooter } from './SiteFooter';

export function SiteLayout() {
  return (
    <div className="desk-site min-h-screen">
      <a href="#main" className="desk-skip-link text-ui">Skip to content</a>
      <Header />
      <div className="desk-workspace">
        <div className="desk-content">
          <Suspense fallback={<main id="main" className="folio-route-loading" aria-busy="true"><p className="text-ui">Opening this view…</p></main>}>
            <Outlet />
          </Suspense>
        </div>
        <SiteFooter />
      </div>
    </div>
  );
}
