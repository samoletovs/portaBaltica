/**
 * What a social crawler actually receives from the deployed site.
 *
 * WHY THIS IS THE TEST THAT COUNTS
 * --------------------------------
 * Every other test in this repo about article metadata reads a module. A module
 * test proves the module was written; it cannot prove Static Web Apps routed
 * `/article/*` to it, that the rewrite survived, that the shell came back, or
 * that the security headers a managed function does not inherit were replaced.
 * All four of those are configuration, and configuration is where this feature
 * fails silently — a route rule behind the catch-all keeps serving the static
 * shell and looks exactly like nothing changed.
 *
 * So this fetches the bytes, with no browser and no JavaScript, which is
 * precisely what LinkedIn, Slack, Facebook, X, WhatsApp and Discord do.
 *
 * BASELINE, measured 2026-08-27 before the change. All three of these returned
 * the same generic head:
 *
 *   og:title : portaBaltica — Baltic open data, reported   (× 3 articles)
 *   ld+json  : absent
 *   headline : absent from the document
 *   robots   : "index, follow", including on a retracted article
 *
 * Lives in the live suite because it needs a deployment. Run after a release:
 *
 *     npm run test:live
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The module that decides what every non-article page says about itself.
 *
 * Read here rather than restated as a literal, because a literal is what broke
 * this file. The front page's `og:title` was written down as
 * "portaBaltica — Baltic open data, reported" on 2026-08-27, when `/` really was
 * served as the static shell. #47 then moved the front page to a pipe for house
 * style, and #228 put every page's head in the served bytes — so from 2026-08-28
 * this assertion failed on every single deploy, and the release notification
 * said "LIVE CHECKS FAILED" for a site that was serving exactly what it should.
 *
 * A live test's job is to prove the deployment serves what the code says. Taking
 * the expectation from the code makes it impossible for it to go stale: reword
 * the front page and this follows. That the code says the right thing is a
 * different question, answered by `tests/pageMetaParity.test.tsx`, which renders
 * the real component and holds this mirror to it.
 */
const pageMeta = require(resolve(__dirname, '..', 'api/shared/pageMeta.js')) as {
  metaFor: (path: string) => { title: string | null } | null;
};

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';
const ARTICLES =
  process.env.PB_ARTICLES_BASE_URL ??
  'https://stportabalticabpmff5so.blob.core.windows.net/articles';

/** A retracted article, still served at its stable URL by design. */
const RETRACTED_SLUG = 'lithuania-s-business-bankruptcy-declarations-spike-to-130-9-index-364200';

/** Deliberately the same length as nothing in particular; it just must not exist. */
const ABSENT_SLUG = 'there-is-no-article-here-at-all';

/**
 * A live tier B article whose slug carries diacritics, which fail the slug
 * pattern in src/news-api.ts. The client renders "Article not found" for it.
 */
const DIACRITIC_SLUG =
  'eiropas-komisāra-valda-dombrovska-runa-rīgas-tehniskajā-universitātē-df6376be';

interface Summary {
  slug: string;
  tier: string;
  headline: string;
  dek?: string;
}

interface Fetched {
  status: number;
  headers: Headers;
  body: string;
}

async function get(url: string): Promise<Fetched> {
  const response = await fetch(url, { redirect: 'follow' });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

function metaContent(html: string, attribute: string, name: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+${attribute}="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*content="([^"]*)"`,
    'i'
  );
  const match = pattern.exec(html);
  if (match) return match[1];
  // Attribute order is not guaranteed; try content-first too.
  const reversed = new RegExp(
    `<meta[^>]+content="([^"]*)"[^>]+${attribute}="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
    'i'
  );
  const other = reversed.exec(html);
  return other ? other[1] : null;
}

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function titleTag(html: string): string | null {
  const match = /<title>([^<]*)<\/title>/i.exec(html);
  return match ? decode(match[1]) : null;
}

/** `api/page-shell` drops the site suffix from og:title; og:site_name prints it. */
function ogTitleFor(title: string): string {
  return title.replace(/ \| portaBaltica$/, '');
}

let tierA: Summary[] = [];

beforeAll(async () => {
  const index = (await get(`${ARTICLES}/index.json`)).body;
  const parsed = JSON.parse(index) as { articles: Summary[] };
  tierA = parsed.articles.filter(
    (a) => a.tier === 'A' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.slug)
  );
  expect(tierA.length).toBeGreaterThan(0);
});

describe('the HTML a crawler receives for a published article', () => {
  it('carries that article\'s own headline, not the site name', async () => {
    // Three different articles, because the defect was that all of them were
    // identical. One article passing proves nothing about that.
    const sample = tierA.slice(0, 3);
    expect(sample.length).toBeGreaterThanOrEqual(2);

    const titles: string[] = [];
    for (const article of sample) {
      const page = await get(`${BASE}/article/${article.slug}`);
      expect(page.status).toBe(200);

      const ogTitle = metaContent(page.body, 'property', 'og:title');
      expect(ogTitle, `og:title missing for ${article.slug}`).not.toBeNull();
      expect(decode(ogTitle as string)).toBe(article.headline);

      // The headline must be in the bytes, which is the whole point.
      expect(page.body).toContain('og:title');
      titles.push(ogTitle as string);
    }

    // The regression this guards: every article sharing one title.
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('sets a per-article description when the article has a dek', async () => {
    const withDek = tierA.find((a) => a.dek && a.dek.length > 0);
    expect(withDek, 'no tier A article carries a dek').toBeDefined();
    const page = await get(`${BASE}/article/${(withDek as Summary).slug}`);

    expect(decode(metaContent(page.body, 'name', 'description') as string)).toBe(
      (withDek as Summary).dek
    );
    expect(decode(metaContent(page.body, 'property', 'og:description') as string)).toBe(
      (withDek as Summary).dek
    );
  });

  it('declares itself an article with a canonical URL of its own', async () => {
    const article = tierA[0];
    const page = await get(`${BASE}/article/${article.slug}`);
    expect(metaContent(page.body, 'property', 'og:type')).toBe('article');
    expect(metaContent(page.body, 'property', 'og:url')).toBe(
      `${BASE}/article/${article.slug}`
    );
    expect(page.body).toContain(`<link rel="canonical" href="${BASE}/article/${article.slug}"`);
  });

  it('carries NewsArticle structured data in the bytes', async () => {
    const article = tierA[0];
    const page = await get(`${BASE}/article/${article.slug}`);

    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page.body);
    expect(block, 'no application/ld+json in the served HTML').not.toBeNull();

    const parsed = JSON.parse((block as RegExpExecArray)[1]);
    expect(parsed['@type']).toBe('NewsArticle');
    expect(parsed.headline).toBe(article.headline);
    // The EU AI Act Article 50 machine-readable disclosure, which was
    // previously invisible to anything that does not run a browser.
    expect(parsed.digitalSourceType).toBe(
      'https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
    );
    // The author is the current roster name, not the stale one stored in the
    // article document.
    expect(parsed.author.name).toContain('AI correspondent');
  });

  it('emits exactly one of each tag it owns', async () => {
    const page = await get(`${BASE}/article/${tierA[0].slug}`);
    for (const pattern of [/<title>/g, /property="og:title"/g, /name="description"/g, /name="robots"/g]) {
      expect(page.body.match(pattern)?.length ?? 0, `duplicate ${pattern}`).toBe(1);
    }
  });

  it('still boots the app', async () => {
    // If this fails the feature has traded sharing for reading, which is the
    // one trade it must not make.
    const page = await get(`${BASE}/article/${tierA[0].slug}`);
    expect(page.body).toContain('id="root"');
    expect(page.body).toMatch(/<script[^>]+type="module"[^>]+src="\/assets\/[^"]+\.js"/);

    // And the assets it names must actually exist in this deployment.
    const asset = /<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"/.exec(page.body);
    expect(asset).not.toBeNull();
    const assetResponse = await fetch(`${BASE}${(asset as RegExpExecArray)[1]}`);
    expect(assetResponse.status).toBe(200);
  });

  it('keeps the security headers a managed function does not inherit', async () => {
    // globalHeaders in staticwebapp.config.json reach static content only.
    // Measured 2026-08-27: /rss.xml and /api/* carry none of these.
    const page = await get(`${BASE}/article/${tierA[0].slug}`);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('the HTML a crawler receives for a retracted article', () => {
  it('marks the headline rather than repeating it bare, and is never indexable', async () => {
    // The corrections policy keeps this page up and #113 makes it say why. So
    // the card carries the marking with the headline — a share card has no
    // page around it to supply the context — but claims nothing else.
    const stored = await get(`${ARTICLES}/${RETRACTED_SLUG}.json`);
    expect(stored.status, 'the retracted article is no longer stored').toBe(200);
    const document = JSON.parse(stored.body) as { status: string; headline: string };
    expect(document.status).toBe('retracted');

    const page = await get(`${BASE}/article/${RETRACTED_SLUG}`);
    // Still served, because the policy promises the page stays up.
    expect(page.status).toBe(200);
    expect(decode(metaContent(page.body, 'property', 'og:title') as string)).toBe(
      `Retracted: ${document.headline}`
    );
    // The bare headline appears nowhere unmarked.
    expect(page.body).not.toContain(`content="${document.headline}"`);
    expect(metaContent(page.body, 'name', 'robots')).toBe('noindex, nofollow');
    // And it is not presented as journalism we stand behind.
    expect(page.body).not.toContain('application/ld+json');
    expect(metaContent(page.body, 'property', 'og:type')).toBe('website');
  });
});

describe('the HTML a crawler receives for an article that is not there', () => {
  it('answers 404 for a slug that never existed', async () => {
    const absent = await get(`${BASE}/article/${ABSENT_SLUG}`);
    expect(absent.status).toBe(404);
    expect(metaContent(absent.body, 'name', 'robots')).toBe('noindex, nofollow');
  });

  it('answers 404 for a slug the client itself rejects', async () => {
    // A live tier B article whose slug carries diacritics. The client renders
    // "Article not found" for it, so the status must say the same thing.
    const page = await get(`${BASE}/article/${encodeURI(DIACRITIC_SLUG)}`);
    expect(page.status).toBe(404);
  });

  it('still renders the app for a 404, rather than an error page', async () => {
    const page = await get(`${BASE}/article/${ABSENT_SLUG}`);
    expect(page.status).toBe(404);
    expect(page.body).toContain('id="root"');
    expect(page.body).toMatch(/<script[^>]+type="module"[^>]+src="\/assets\/[^"]+\.js"/);
  });
});

describe('the rest of the site is untouched', () => {
  it('serves the front page with the head its own module specifies', async () => {
    const page = await get(`${BASE}/`);
    expect(page.status).toBe(200);

    // Guard the guard: an expectation read from a module that returned nothing
    // would assert null against null and pass on a blank page.
    const home = pageMeta.metaFor('/');
    expect(home?.title, 'pageMeta has no entry for /').toBeTruthy();

    expect(titleTag(page.body), 'front page title').toBe(home!.title);
    expect(metaContent(page.body, 'property', 'og:title'), 'front page og:title').toBe(
      ogTitleFor(home!.title as string)
    );
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('still serves the dashboard', async () => {
    const page = await get(`${BASE}/data`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('id="root"');
  });
});

describe('the deploy-race recovery reaches readers', () => {
  /**
   * Whether the inline recovery survives the build is a question about what
   * ships, so it is asked of what ships.
   *
   * It used to be asked of `dist/index.html`, which is gitignored and which
   * `npm test` never builds — so in CI the file was absent and the assertion
   * could not pass, and locally it read whatever stale build happened to be in
   * the working directory. Behaviour and ordering are checked from source in
   * `tests/deployRecovery.test.ts`; this is the half that needs a real build,
   * and the deployed HTML is the realest one there is.
   */
  for (const route of ['/', '/data']) {
    it(`${route} carries it`, async () => {
      const page = await get(`${BASE}${route}`);
      expect(page.body).toContain('pb-asset-recovery');
      expect(page.body).toContain('unhandledrejection');
    });
  }

  it('an article page carries it, and before the bundle it guards', async () => {
    // This route is assembled by a function rather than served as a file, so
    // it is the one where the recovery could be dropped without anyone noticing.
    const page = await get(`${BASE}/article/${tierA[0].slug}`);
    const recovery = page.body.indexOf('pb-asset-recovery');
    const entry = page.body.indexOf('<script type="module"');
    expect(recovery).toBeGreaterThanOrEqual(0);
    expect(entry).toBeGreaterThanOrEqual(0);
    expect(recovery).toBeLessThan(entry);
  });

  it('watches the path the deployed bundle is actually served from', async () => {
    // The guard only fires on `/assets/`. If a build ever emitted the entry
    // somewhere else, it would sit watching for something that never happens.
    const page = await get(`${BASE}/`);
    const entry = /<script type="module"[^>]*src="([^"]+)"/.exec(page.body);
    expect(entry, 'deployed HTML has no module entry').not.toBeNull();
    expect((entry as RegExpExecArray)[1]).toContain('/assets/');
  });
});
