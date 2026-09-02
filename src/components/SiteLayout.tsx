import { Outlet } from 'react-router-dom';
import { DataTicker } from './DataTicker';
import { Header } from './Header';

export function SiteLayout() {
  return (
    <div className="min-h-screen">
      {/*
        `py-3` and not `py-2`, which is 4px of difference and the whole point.

        `index.css` raises every control to 44px — the floor Apple's HIG and
        Material both ask for, and which `design-system.test.ts` asserts. Its
        selector list is `button, [role=button], summary, nav a, label, select,
        input`. This is a standalone `<a>`: it is not in a `nav`, so no rule
        reaches it, and it rendered **139x40** when focused.

        Measured across all 17 navigable routes at 375px, 886 of 886 other
        interactive controls clear 44x44. This was the only one under it — and
        it is the FIRST control a keyboard or switch user ever reaches.

        `py-3` gives 48px. The floor is enforced against the rendered page by
        `tests/touchTargets.live.test.ts`, because the CSS check can only ever
        confirm that a rule exists for the selectors somebody thought of.
      */}
      <a
        href="#main"
        className="news-accent-panel news-fg sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:px-4 focus:py-3"
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
