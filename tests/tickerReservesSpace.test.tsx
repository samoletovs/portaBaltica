import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { DataTicker } from '../src/components/DataTicker';

/**
 * The ticker holds its place while it is loading, and gives it up when it has
 * nothing.
 *
 * WHAT WAS WRONG
 * --------------
 * `items.length === 0` meant two different things — *the fetch has not come
 * back* and *there is nothing to show* — and the component returned `null` for
 * both. So on every route the strip was absent for the first ~800ms and 35px
 * tall afterwards, and the whole page below it moved down by 35px when the
 * data landed. `DataTicker` renders above every route including the newsroom,
 * so that was the site's floor.
 *
 * Measured against production at 2026-09-02T10:2xZ, at 1280px. The worst shift
 * on two routes was `div.mx-auto.max-w-7xl` going `100,800 -> 135,765` — the
 * entire page container — at 850-919ms:
 *
 *     /data/property   CLS 0.3523   POOR
 *     /data/energy     CLS 0.1168
 *     every other route carried the same 0.0243 floor
 *
 * After: no route above 0.1, and the routes that were worst measure 0.03-0.06.
 *
 * WHY THIS IS A UNIT TEST AND THE CLS CHECK IS NOT EXTENDED
 * --------------------------------------------------------
 * The dashboard's remaining shifts come from a dozen independent fetches
 * landing in whatever order the network gives them, and three sweeps put
 * `/data/maritime` at 0.0306, 0.0420 and — once — 0.3047. An assertion on that
 * would be a flake, and a flaky gate is worse than no gate because people
 * learn to re-run it. `layoutStability.live.test.ts` therefore stays on the
 * front page, which is deterministic at 0.000, and the mechanism is pinned
 * here instead.
 *
 * The height itself cannot be asserted in jsdom, which has no layout. What can
 * be asserted is the thing the height rests on: the placeholder is the same
 * box as the real strip. That is compared by rendering both and diffing their
 * classes, not by writing the classes down — a copied string would keep
 * passing after the real strip changed.
 */

function mount(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <CountryProvider>
          <FilterProvider>{ui}</FilterProvider>
        </CountryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const WHOLE = {
  electricityCurrent: 82.4,
  exchangeRates: [{ currency: 'USD', rate: 1.0842 }],
  indicators: [{ label: 'GDP Growth', value: '2.1%', change: '+0.3pp' }],
};

function serve(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)),
  );
}

/** A request that never comes back, which is what "still loading" is. */
function serveNever() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
}

function serveFailure() {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false } as Response)));
}

/** The strip's box, as `[outer, inner]` class strings. */
function stripClasses(container: HTMLElement): [string, string] | null {
  const outer = container.querySelector('.ticker-viewport');
  const inner = outer?.querySelector('.ticker-track');
  if (!outer || !inner) return null;
  return [outer.className, inner.className];
}

describe('the ticker while it does not yet know', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
  afterEach(() => vi.unstubAllGlobals());

  it('holds the strip open before the fetch comes back', async () => {
    serveNever();
    const { container } = mount(<DataTicker />);

    // The placeholder is present immediately, on the first commit — which is
    // the only moment that matters, because the shift happens between that
    // commit and the one carrying the data.
    expect(
      container.querySelector('.ticker-viewport'),
      'nothing reserves the strip while the request is in flight, so the page below it ' +
        'moves down when the data lands',
    ).not.toBeNull();
  });

  it('reserves the same box it will later fill', async () => {
    serveNever();
    const loading = mount(<DataTicker />);
    const reserved = stripClasses(loading.container);
    loading.unmount();

    vi.unstubAllGlobals();
    serve(WHOLE);
    const loaded = mount(<DataTicker />);
    await waitFor(() => expect(loaded.container.textContent).toContain('EUR/USD'));
    const real = stripClasses(loaded.container);

    // Both derived from a render. Writing the expected classes down here would
    // pass forever after the real strip changed, which is the failure this is
    // guarding against.
    expect(reserved, 'the loading state renders no strip at all').not.toBeNull();
    expect(real, 'the loaded state renders no strip at all').not.toBeNull();
    expect(
      reserved,
      'the placeholder is a different box from the strip it stands in for, so it cannot ' +
        'be the same height and the page will still move when the data arrives',
    ).toEqual(real);
  });

  it('gives the space back when there is genuinely nothing to show', async () => {
    // The other half of the same distinction, and the reason it is not simply
    // "always reserve": a ticker with nothing in it is 35px of chrome
    // asserting that there is data.
    serveFailure();
    const { container } = mount(<DataTicker />);

    await waitFor(() =>
      expect(
        container.querySelector('.ticker-viewport'),
        'the strip is still held open after a failed fetch',
      ).toBeNull(),
    );
  });

  it('still renders its contents when the payload is whole', async () => {
    // CONTROL. Without it, every assertion above is satisfied by a component
    // that renders a placeholder and never anything else.
    serve(WHOLE);
    const { container } = mount(<DataTicker />);
    await waitFor(() => expect(container.textContent).toContain('EUR/USD'));

    expect(container.textContent).toContain('Electricity');
    expect(container.textContent).toContain('GDP Growth');
  });
});
