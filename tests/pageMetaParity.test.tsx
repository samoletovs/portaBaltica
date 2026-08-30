/**
 * Two implementations of one head, held to each other.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every page decides its own title, description and canonical in TypeScript
 * compiled for the browser. `api/shared/pageMeta.js` now decides the same
 * things in CommonJS on the Function host, because **social crawlers never run
 * the first one**. Measured against production on 2026-08-28, raw HTML with no
 * JavaScript executed: `/data`, `/data/economy`, `/api-docs`, `/follow`,
 * `/weekly`, `/newsroom`, `/corrections`, `/about/ai` and `/indicator/*` all
 * shipped `canonical=https://portabaltica.naurolabs.com` and the generic site
 * title, while `/article/<slug>` shipped its own — the control, which fires.
 *
 * MEASURED: `src/` CANNOT IMPORT FROM `api/shared/`
 * -------------------------------------------------
 * `tsconfig.app.json` sets `"include": ["src"]`, and a probe importing
 * `../../api/shared/<file>.js` from a `src/` module failed with
 * `TS2307: Cannot find module`. The Function App is deployed from `api/` alone
 * and never sees `src/`. So there is no single source available in either
 * direction and the second implementation is a mirror.
 *
 * A mirror nobody checks is a second opinion waiting to disagree, so this suite
 * RENDERS each real component in jsdom, lets `usePageMeta` write the head, and
 * requires it to equal what `pageMeta.metaFor` produces for the same URL. It is
 * behavioural rather than a parse of the source: a reworded description fails
 * here, which is the point.
 *
 * This is the pattern `tests/articleMetaParity.test.ts` established, for the
 * same reason and against the same class of defect.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { ReactElement } from 'react';

import NewsFeed from '../src/components/news/NewsFeed';
import FollowPage from '../src/components/news/FollowPage';
import WeeklyPage from '../src/components/news/WeeklyPage';
import CorrectionsPage from '../src/components/news/CorrectionsPage';
import AiPolicyPage from '../src/components/news/AiPolicyPage';
import CorrespondentPage from '../src/components/news/CorrespondentPage';
import { ApiDocsPage } from '../src/components/ApiDocsPage';
import { IndicatorPage } from '../src/components/IndicatorPage';
import App from '../src/App';
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { DASHBOARD_SECTIONS } from '../src/sections';
import { CORRESPONDENTS } from '../src/newsroom/correspondents';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');

interface PageMeta {
  title: string | null;
  description: string | null;
  canonical: string | null;
  index: boolean;
}

const pageMeta = require(resolve(ROOT, 'api/shared/pageMeta.js')) as {
  metaFor: (path: string) => PageMeta | null;
  SECTIONS: Record<string, unknown>;
  INDICATOR_COPY: Record<string, unknown>;
};
const registry = require(resolve(ROOT, 'api/shared/indicators.js')) as Record<string, unknown>;

// Charts and markdown are irrelevant here and expensive; the head is the subject.
vi.mock('../src/components/IndicatorCard', () => ({
  IndicatorChart: () => null,
}));
vi.mock('../src/components/BalticCompareChart', () => ({
  BalticCompareChart: () => null,
}));

// The dashboard's nine tiles each fetch and draw. `App` is included here
// because the ten `/data*` URLs are the ones the original defect was measured
// on — a parity suite that skipped them would leave the largest and most
// broken group unchecked, which a planted fault proved: changing one word of a
// section description stayed green until this was added.
vi.mock('../src/components/OnboardingTutorial', () => ({ OnboardingTutorial: () => null }));
vi.mock('../src/components/InsightsBanner', () => ({ InsightsBanner: () => null }));
vi.mock('../src/components/SectionRail', () => ({ SectionRail: () => null }));
vi.mock('../src/components/EconomyTile', () => ({ EconomyTile: () => null }));
vi.mock('../src/components/TradeTile', () => ({ TradeTile: () => null }));
vi.mock('../src/components/GovernmentTile', () => ({ GovernmentTile: () => null }));
vi.mock('../src/components/LabourTile', () => ({ LabourTile: () => null }));
vi.mock('../src/components/EnergyTile', () => ({ EnergyTile: () => null }));
vi.mock('../src/components/PropertyTile', () => ({ PropertyTile: () => null }));
vi.mock('../src/components/EnvironmentTile', () => ({ EnvironmentTile: () => null }));
vi.mock('../src/components/MaritimeTile', () => ({ MaritimeTile: () => null }));
vi.mock('../src/components/BusinessTile', () => ({ BusinessTile: () => null }));
vi.mock('../src/components/SystemStatusFooter', () => ({ SystemStatusFooter: () => null }));

/** The registry catalogue and an empty article index, for any page that asks. */
function stubNetwork() {
  const indicators = Object.entries(registry).map(([id, def]) => ({
    id,
    ...(def as { title: string; unit: string; dataset: string; freq: string }),
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ indicators, generated_at: '', count: 0, articles: [] }),
    } as unknown as Response),
  );
}

/**
 * Let the mocked fetches settle, without waiting on a clock.
 *
 * `tests/suiteDeterminism.test.ts` refuses a new wall-clock wait in a parallel
 * suite, because a polling budget measures how busy the machine is rather than
 * whether the code works. Each turn drains microtasks and yields one macrotask
 * via `setImmediate` — the check phase, no timer, no duration to exceed. The
 * bound is a turn count.
 */
async function settle(until: () => boolean, turns = 50): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    if (until()) return;
    await act(async () => {
      await new Promise<void>((r) => { setImmediate(r); });
    });
  }
  throw new Error(
    `the page had not settled after ${turns} turns of the event loop; it is waiting on ` +
      'something this helper cannot drain',
  );
}

/** What the browser implementation puts in the head for one route. */
async function renderedHead(
  path: string,
  routePath: string,
  element: ReactElement,
  ready: () => boolean = () => true,
): Promise<{ title: string; canonical: string | null; description: string | null }> {
  const view = render(
    <ThemeProvider>
      <CountryProvider>
        <FilterProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={routePath} element={element} />
            </Routes>
          </MemoryRouter>
        </FilterProvider>
      </CountryProvider>
    </ThemeProvider>,
  );
  await settle(ready);
  const head = {
    title: document.title,
    canonical: document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
      ?.getAttribute('href') ?? null,
    description: document.head.querySelector('meta[name="description"]')
      ?.getAttribute('content') ?? null,
  };
  view.unmount();
  return head;
}

/** The mirror's answer, with the canonical rewritten to the test origin. */
function mirrored(path: string) {
  const meta = pageMeta.metaFor(path);
  if (!meta) return null;
  return {
    title: meta.title,
    canonical: meta.canonical
      ? meta.canonical.replace('https://portabaltica.naurolabs.com', window.location.origin)
      : null,
    description: meta.description,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll('link[rel="canonical"], meta[name="description"], meta[name="robots"]')
    .forEach((node) => node.remove());
  document.title = '';
});

describe('the mirror agrees with the page, route by route', () => {
  const CASES: [string, string, () => ReactElement][] = [
    ['/', '/', () => <NewsFeed />],
    ['/follow', '/follow', () => <FollowPage />],
    ['/weekly', '/weekly', () => <WeeklyPage />],
    ['/corrections', '/corrections', () => <CorrectionsPage />],
    ['/about/ai', '/about/ai', () => <AiPolicyPage />],
    ['/api-docs', '/api-docs', () => <ApiDocsPage />],
    ['/newsroom', '/newsroom', () => <CorrespondentPage />],
  ];

  it.each(CASES)('says the same thing about %s', async (path, routePath, element) => {
    stubNetwork();
    const rendered = await renderedHead(path, routePath, element(), () => document.title !== '');
    const mirror = mirrored(path);

    expect(mirror, `pageMeta has nothing for ${path}`).not.toBeNull();
    expect(rendered.title, `${path} title`).toBe(mirror!.title);
    expect(rendered.canonical, `${path} canonical`).toBe(mirror!.canonical);
    // `/newsroom` passes no description, so `usePageMeta` leaves whatever the
    // shell had. The mirror says the same by carrying null.
    if (mirror!.description !== null) {
      expect(rendered.description, `${path} description`).toBe(mirror!.description);
    }
  });

  it.each(CORRESPONDENTS.map((c) => c.id))('says the same thing about /newsroom/%s', async (id) => {
    stubNetwork();
    const rendered = await renderedHead(
      `/newsroom/${id}`, '/newsroom/:id', <CorrespondentPage />, () => document.title !== '',
    );
    const mirror = mirrored(`/newsroom/${id}`);

    expect(mirror).not.toBeNull();
    expect(rendered.title).toBe(mirror!.title);
    expect(rendered.canonical).toBe(mirror!.canonical);
    expect(rendered.description).toBe(mirror!.description);
  });

  it.each(Object.keys(registry))('says the same thing about /indicator/%s', async (id) => {    stubNetwork();
    const rendered = await renderedHead(
      `/indicator/${id}`, '/indicator/:id', <IndicatorPage />,
      () => document.title !== '' && !document.title.startsWith('Indicator |'),
    );
    const mirror = mirrored(`/indicator/${id}`);

    expect(mirror).not.toBeNull();
    expect(rendered.title, `/indicator/${id} title`).toBe(mirror!.title);
    expect(rendered.canonical).toBe(mirror!.canonical);
    expect(rendered.description, `/indicator/${id} description`).toBe(mirror!.description);
  });
});

describe('the mirror covers what the app declares', () => {
  it('has copy for every dashboard section', () => {
    // A section added to the app without copy here would silently fall back to
    // the overview's head — plausible, wrong, and invisible.
    expect(Object.keys(pageMeta.SECTIONS).sort()).toEqual([...DASHBOARD_SECTIONS].sort());
  });

  it('has copy for every correspondent with a page', () => {
    const roster = require(resolve(ROOT, 'api/shared/articleMeta.js')) as {
      CORRESPONDENT_ROSTER: Record<string, unknown>;
    };
    expect(Object.keys(roster.CORRESPONDENT_ROSTER).sort())
      .toEqual(CORRESPONDENTS.map((c) => c.id).sort());
  });

  it('carries editorial copy for exactly the ids that have it in the component', () => {
    // 24 in `IndicatorPage.tsx`, every one carrying a title. Ten name ids the
    // registry does not hold — the PxWeb family — and of the fourteen it does,
    // NINE have an editorial title that differs from the registry's. The client
    // resolves `info?.title ?? registered?.title`, so a mirror preferring the
    // registry would serve nine crawlers a headline the page does not print.
    expect(Object.keys(pageMeta.INDICATOR_COPY).length).toBe(24);

    const untitled = Object.entries(pageMeta.INDICATOR_COPY)
      .filter(([, entry]) => (entry as { title?: string }).title === undefined)
      .map(([id]) => id);
    expect(untitled, 'every editorial entry must carry its own title').toEqual([]);

    const disagreeing = Object.entries(pageMeta.INDICATOR_COPY).filter(([id, entry]) => {
      const definition = registry[id] as { title?: string } | undefined;
      return definition !== undefined && definition.title !== (entry as { title: string }).title;
    });
    // The control: if these ever agreed, the rule above would be guarding
    // nothing and the mirror could safely be simplified.
    expect(disagreeing.length, 'editorial and registry titles no longer disagree anywhere')
      .toBeGreaterThan(0);
  });
});

describe('the mirror refuses to invent a head', () => {
  it('says nothing about a route it does not know', () => {
    // Every route on this SPA answers HTTP 200 — `/utterly-invented-page`
    // included, measured against production — so an invented head cannot be
    // caught by a status check, by us or by a crawler.
    expect(pageMeta.metaFor('/utterly-invented-page')).toBeNull();
    expect(pageMeta.metaFor('/pricing')).toBeNull();
  });

  it('leaves /article/* to the function that owns it', () => {
    // Two implementations claiming one URL would put two canonicals in one
    // document, and crawlers disagree about which wins.
    expect(pageMeta.metaFor('/article/some-published-slug')).toBeNull();
  });

  it('marks an unknown indicator noindex rather than indexing a dead end', () => {
    const meta = pageMeta.metaFor('/indicator/not-a-real-indicator');

    expect(meta).not.toBeNull();
    expect(meta!.index).toBe(false);
    // It still names itself: see "a dead end is marked, never blanked" below.
    // Returning a null title strips the shell's and puts nothing back.
    expect(meta!.title).toBe('Indicator | portaBaltica');
  });

  it('gives an unknown section the overview, not a canonical of its own', () => {
    // `App.tsx` falls back to 'all' for an unknown section, so the page a
    // reader sees at `/data/not-a-section` IS the overview. Emitting
    // `canonical=/data/not-a-section` would invent a page.
    const meta = pageMeta.metaFor('/data/not-a-section');

    expect(meta!.canonical).toBe('https://portabaltica.naurolabs.com/data');
  });

  it('would notice if the mirror started answering for everything', () => {
    // The control. Every assertion above about `null` is vacuous if `metaFor`
    // returns null for real routes too.
    expect(pageMeta.metaFor('/follow')).not.toBeNull();
    expect(pageMeta.metaFor('/data/economy')).not.toBeNull();
    expect(pageMeta.metaFor('/indicator/gdp')).not.toBeNull();
  });
});

describe('the dashboard, which is where it was broken', () => {
  /**
   * Ten of the twenty-two non-article URLs are `/data` and its nine sections,
   * and every one of them shipped the home page's canonical. Rendering `App`
   * costs thirteen mocks; skipping it cost more — a planted fault that changed
   * one word of a section description stayed GREEN until this block existed,
   * because the largest and most broken group was the one the suite did not
   * look at.
   */
  it.each(['/data', ...DASHBOARD_SECTIONS.map((s) => `/data/${s}`)])(
    'says the same thing about %s',
    async (path) => {
      stubNetwork();
      const rendered = await renderedHead(
        path, '/data/:section?', <App />, () => document.title !== '',
      );
      const mirror = mirrored(path);

      expect(mirror, `pageMeta has nothing for ${path}`).not.toBeNull();
      expect(rendered.title, `${path} title`).toBe(mirror!.title);
      expect(rendered.canonical, `${path} canonical`).toBe(mirror!.canonical);
      expect(rendered.description, `${path} description`).toBe(mirror!.description);
    },
  );
});

describe('the injected document', () => {
  /**
   * `metaFor` decides WHAT to say; `renderPageShell` puts it in the bytes. A
   * suite that only checked the first passed a planted fault that stopped
   * stripping the shell's own tags — leaving two canonicals and two `og:title`
   * elements in one document, which crawlers resolve inconsistently: Facebook
   * takes the first, others take the last. A duplicate is not cosmetic, it is a
   * coin toss over which headline gets shared.
   */
  const handler = require(resolve(ROOT, 'api/page-shell/index.js')) as {
    renderPageShell: (shell: string, path: string, page: unknown) => string | null;
    pathFromRequest: (req: unknown) => string | null;
  };
  const SHELL = readFileSync(resolve(ROOT, 'index.html'), 'utf-8').replace(
    '<script type="module" src="/src/main.tsx"></script>',
    '<script type="module" crossorigin src="/assets/index-CZq7fNB6.js"></script>',
  );

  function inject(path: string): string {
    const out = handler.renderPageShell(SHELL, path, pageMeta.metaFor(path));
    expect(out, `nothing was injected for ${path}`).not.toBeNull();
    return out as string;
  }

  function shellTitle(): string | null {
    const match = /<title>([^<]*)<\/title>/i.exec(SHELL);
    return match ? match[1] : null;
  }

  function shellMeta(attribute: string, name: string): string | null {
    const match = new RegExp(
      `<meta[^>]+${attribute}="${name}"[^>]*content="([^"]*)"`,
      'i',
    ).exec(SHELL);
    return match ? match[1] : null;
  }

  it.each(['/', '/data/economy', '/follow', '/newsroom/kolka', '/indicator/gdp'])(
    'carries exactly one canonical and one og:title for %s',
    (path) => {
      const out = inject(path);

      expect((out.match(/rel="canonical"/g) ?? []).length, 'canonical').toBe(1);
      expect((out.match(/property="og:title"/g) ?? []).length, 'og:title').toBe(1);
      expect((out.match(/<title>/g) ?? []).length, 'title').toBe(1);
      expect((out.match(/name="description"/g) ?? []).length, 'description').toBe(1);
      expect((out.match(/name="robots"/g) ?? []).length, 'robots').toBe(1);
    },
  );

  it('would notice a duplicate, which is the control', () => {
    // The shell itself carries a full set, so an injector that appended rather
    // than replaced would double every count above. Asserting the shell has
    // them proves the assertions are not passing on an empty document.
    expect((SHELL.match(/rel="canonical"/g) ?? []).length).toBe(1);
    expect((SHELL.match(/property="og:title"/g) ?? []).length).toBe(1);
  });

  it('puts this page in the bytes rather than the shell default', () => {
    const out = inject('/data/economy');

    expect(out).toContain('<title>Economy | portaBaltica</title>');
    expect(out).toContain('href="https://portabaltica.naurolabs.com/data/economy"');
    expect(out).not.toContain(`<title>${shellTitle()}</title>`);
  });

  /**
   * The shell's own head and the front page's injected head must agree.
   *
   * `/` is the one route where the fallback and the injection describe the same
   * page, so a difference between them is always a fault. There was one: #47
   * moved the front page from an em dash to a pipe for house style and left this
   * file behind, which nothing noticed while `/` was still served statically.
   * #228 then made `/` an injected route, and the two started disagreeing in
   * production — the deployed page said one thing, the fallback another, and the
   * live smoke test (which asserted the fallback) failed on every deploy for two
   * days while the site itself was correct.
   *
   * Asserting equality here is what makes the copy in two files one decision.
   */
  it('says the same thing about / as the shell it falls back to', () => {
    const home = pageMeta.metaFor('/');

    expect(home?.title, 'pageMeta has no entry for /').toBeTruthy();
    expect(shellTitle(), 'index.html has no <title>').toBeTruthy();
    expect(shellTitle(), 'index.html <title> vs pageMeta /').toBe(home!.title);
    expect(shellMeta('property', 'og:title'), 'index.html og:title vs pageMeta /').toBe(
      home!.title!.replace(/ \| portaBaltica$/, ''),
    );
  });

  it('leaves the document able to boot', () => {
    // The trade this must never make: fix sharing, break reading. The shell's
    // content-hashed asset tag and its root element have to survive.
    const out = inject('/follow');

    expect(out).toContain('id="root"');
    expect(out).toContain('index-CZq7fNB6.js');
  });

  it('reads the reader’s path, not the rewritten function path', () => {
    // SWA passes the original URL in `x-ms-original-url` while `req.url` is
    // `/api/page-shell`. Reading the latter would give every page the same head.
    expect(handler.pathFromRequest({
      headers: { 'x-ms-original-url': 'https://portabaltica.naurolabs.com/data/energy?x=1' },
      url: '/api/page-shell',
    })).toBe('/data/energy');

    expect(handler.pathFromRequest({ headers: {}, url: '/api/page-shell' })).toBeNull();
  });
});


describe('a dead end is marked, never blanked', () => {
  /**
   * An earlier version returned `title: null` for an unknown indicator, which
   * stripped the shell's title and put nothing back — leaving the document with
   * NO title at all, which is worse than the generic one it replaced. Every
   * unit test passed; it was caught by reading the raw HTML the handler
   * produces. So the rule is asserted here rather than remembered.
   */
  it.each(['/indicator/not-a-real-indicator', '/newsroom/nobody'])(
    '%s keeps a title and is withheld from the index',
    (path) => {
      const meta = pageMeta.metaFor(path) as unknown as
        { title: string | null; index: boolean; canonical: string | null };

      expect(meta).not.toBeNull();
      expect(meta.index, 'a dead end must not be indexed').toBe(false);
      expect(meta.title, 'a dead end must still name itself').toBeTruthy();
      expect(meta.canonical).toContain(path);
    },
  );

  it('leaves a real page indexed, which is the control', () => {
    const meta = pageMeta.metaFor('/indicator/gdp') as unknown as { index: boolean };
    expect(meta.index).toBe(true);
  });
});
