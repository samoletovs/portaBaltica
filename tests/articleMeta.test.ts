/**
 * The metadata a social crawler actually receives for an article URL.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every article on this site rendered its `<title>`, description, Open Graph
 * tags and JSON-LD client-side. LinkedIn, Slack, Facebook, X, WhatsApp and
 * Discord do not run JavaScript, so all seventy-three articles previewed
 * identically: "portaBaltica — Baltic open data, reported", the site
 * description, no headline in the document and no `application/ld+json`
 * anywhere. Measured against production on 2026-08-27.
 *
 * `api/shared/articleMeta.js` moves that decision into the bytes, and this
 * suite tests that module rather than the React component that used to own it.
 * A test that reads the component proves the component was written; the
 * function is what ships on this route.
 *
 * THE TEST THAT MATTERS MOST
 * --------------------------
 * "does not put a retracted headline into a share card". Article
 * `lithuania-s-business-bankruptcy-declarations-spike-to-130-9-index-364200` is
 * real, is retracted, and is still served at its stable URL because the
 * corrections policy promises the evidence is not deleted. `ArticleView`
 * refuses to print its headline, because in that fault the headline *was* the
 * error — it named a metric the article never measured.
 *
 * The obvious implementation of this feature — take `index.json`'s headline,
 * put it in `og:title` — would have republished that withdrawn claim as a share
 * card, where it travels further than the page ever did. The fixture below is
 * that article's real shape, so this test fails against that implementation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '..');

const meta = require(resolve(ROOT, 'api/shared/articleMeta.js'));

/** The real shell, so the strip/inject rules are tested against what ships. */
const SHELL = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');

interface TestArticle {
  id: string;
  slug: string;
  tier: 'A' | 'B' | 'C';
  status: string;
  section: string;
  headline: string;
  dek?: string;
  persona?: { id: string; name: string; beat: string; byline: string };
  provenance: Record<string, unknown>;
  corrections?: { corrected_at: string; description: string }[];
  created_at: string;
  published_at?: string;
}

function article(overrides: Partial<TestArticle> = {}): TestArticle {
  return {
    id: '01M115W57T56VK9HZ69EY80WAV',
    slug: 'latvia-s-ports-set-record-with-1-175-thousand-tonnes-6d06ee',
    tier: 'A',
    status: 'published',
    section: 'maritime',
    headline: "Latvia's ports set record with 1,175 thousand tonnes of containerised cargo in Q4 2025",
    dek: 'This significant increase in seaborne containerised cargo handled highlights a shift in logistics through Latvian ports, despite remaining the lowest among Baltic states.',
    persona: {
      id: 'kolka',
      name: 'Gintaras Vaitkus',
      beat: 'Maritime & Trade',
      byline: 'Gintaras Vaitkus · AI correspondent, Maritime & Trade',
    },
    provenance: {
      sources: [
        {
          source_id: 'eurostat',
          dataset: 'mar_go_qm_lv',
          dataset_version: '2026-08-27',
          retrieved_at: '2026-08-27T08:00:00Z',
          url: 'https://ec.europa.eu/eurostat/databrowser/view/mar_go_qm_lv',
        },
      ],
      accountable_editor: 'Andre Kõpu',
      validator: { passed: true, checked_at: '2026-08-27T08:30:00Z', checks: [] },
    },
    created_at: '2026-08-27T08:30:00Z',
    published_at: '2026-08-27T08:37:03Z',
    ...overrides,
  };
}

/** The real retracted article, in the shape blob storage still serves it. */
const RETRACTED_SLUG = 'lithuania-s-business-bankruptcy-declarations-spike-to-130-9-index-364200';
const RETRACTED_HEADLINE =
  "Lithuania's business bankruptcy declarations spike to 130.9 index points in Q2 2026";

function retracted(): TestArticle {
  return article({
    slug: RETRACTED_SLUG,
    status: 'retracted',
    section: 'business',
    headline: RETRACTED_HEADLINE,
    dek: 'Business bankruptcy declarations reached a record in the second quarter.',
    // It passed every check and was wrong anyway: the figures were real and
    // attached to the wrong series. So the validator verdict is `true` here,
    // and only `status` withholds it.
    provenance: {
      sources: [],
      validator: { passed: true, checked_at: '2026-08-27T07:00:00Z', checks: [] },
    },
    corrections: [
      { corrected_at: '2026-08-27T08:08:13Z', description: 'RETRACTED. A caching fault…' },
    ],
  });
}

function render(a: TestArticle | null, slug: string): string {
  const kind = meta.classify(a);
  const html = meta.renderShell(SHELL, kind === 'none' ? null : a, slug, kind);
  expect(html).not.toBeNull();
  return html as string;
}

/** What a crawler ends up with: the attribute value after entity decoding. */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(html: string, selector: RegExp): string | null {
  const match = selector.exec(html);
  return match ? decodeEntities(match[1]) : null;
}

const ogTitle = (html: string) =>
  attr(html, /<meta property="og:title" content="([^"]*)"/);
const ogDescription = (html: string) =>
  attr(html, /<meta property="og:description" content="([^"]*)"/);
const description = (html: string) =>
  attr(html, /<meta name="description" content="([^"]*)"/);
const robots = (html: string) => attr(html, /<meta name="robots" content="([^"]*)"/);
const title = (html: string) => attr(html, /<title>([\s\S]*?)<\/title>/);
const canonical = (html: string) => attr(html, /<link rel="canonical" href="([^"]*)"/);

describe('the head served for a servable article', () => {
  const html = render(article(), article().slug);

  it('carries the article headline as og:title, not the site name', () => {
    expect(ogTitle(html)).toBe(article().headline);
    expect(ogTitle(html)).not.toBe(meta.GENERIC_TITLE);
  });

  it('sets the document title the same way the client does after hydration', () => {
    // ArticlePage: `${article.headline} | portaBaltica`.
    expect(title(html)).toBe(`${article().headline} | portaBaltica`);
  });

  it('uses the dek as the description everywhere a crawler looks', () => {
    expect(description(html)).toBe(article().dek);
    expect(ogDescription(html)).toBe(article().dek);
    expect(attr(html, /<meta name="twitter:description" content="([^"]*)"/)).toBe(article().dek);
  });

  it('marks it as an article rather than the site', () => {
    expect(attr(html, /<meta property="og:type" content="([^"]*)"/)).toBe('article');
  });

  it('points canonical and og:url at this article', () => {
    const expected = `https://portabaltica.naurolabs.com/article/${article().slug}`;
    expect(canonical(html)).toBe(expected);
    expect(attr(html, /<meta property="og:url" content="([^"]*)"/)).toBe(expected);
  });

  it('is indexable', () => {
    expect(robots(html)).toBe('index, follow');
  });

  it('carries the NewsArticle JSON-LD in the bytes', () => {
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(block).not.toBeNull();
    const parsed = JSON.parse((block as RegExpExecArray)[1]);
    expect(parsed['@type']).toBe('NewsArticle');
    expect(parsed.headline).toBe(article().headline);
    // The EU AI Act Article 50 machine-readable disclosure must survive the
    // move into the served bytes. It is the half of the disclosure a crawler
    // can read, and it only existed client-side before.
    expect(parsed.digitalSourceType).toBe(
      'https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
    );
  });

  it('leaves exactly one of each tag it replaces', () => {
    // Two og:title elements is not a cosmetic problem: Facebook reads the
    // first and other crawlers read the last, so a duplicate is a coin toss
    // over which headline gets shared.
    for (const pattern of [
      /<meta property="og:title"/g,
      /<meta property="og:description"/g,
      /<meta name="description"/g,
      /<meta name="robots"/g,
      /<title>/g,
      /<link rel="canonical"/g,
    ]) {
      expect(html.match(pattern)?.length ?? 0).toBe(1);
    }
  });

  it('still boots the same app', () => {
    // The whole feature is worthless if it fixes sharing and breaks reading.
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('/src/main.tsx');
    // Tags that are right for every page are left alone rather than re-emitted.
    expect(html).toContain('<meta property="og:site_name" content="portaBaltica" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<meta property="og:image"');
  });
});

describe('a retracted article', () => {
  /**
   * WHY THIS IS NOT SIMPLY SUPPRESSED
   * ---------------------------------
   * `#113` established that a retracted page stays up and says so, because the
   * corrections policy promises exactly that and because the previous refusal
   * screen ("it has not passed the checks we run before publishing") was false
   * about it — that article passed all nine checks and was withdrawn later.
   *
   * So the head mirrors what ArticlePage sets: `Retracted: <headline>`. The
   * marking travels with the headline, which matters more on a share card than
   * anywhere else, because a card has no page around it to carry the context.
   * What it must never do is present the piece as journalism we stand behind:
   * no dek, no NewsArticle, no `og:type: article`, and never indexable.
   */
  it('marks the headline rather than repeating it bare', () => {
    const html = render(retracted(), RETRACTED_SLUG);
    expect(ogTitle(html)).toBe(`Retracted: ${RETRACTED_HEADLINE}`);
    expect(title(html)).toBe(`Retracted: ${RETRACTED_HEADLINE} | portaBaltica`);
    // The bare headline must not appear anywhere unmarked.
    expect(html).not.toContain(`content="${RETRACTED_HEADLINE}"`);
  });

  it('never claims it as journalism', () => {
    const html = render(retracted(), RETRACTED_SLUG);
    expect(html).not.toContain('application/ld+json');
    expect(attr(html, /<meta property="og:type" content="([^"]*)"/)).toBe('website');
    // Its dek argued the claim we withdrew. It is not a description of this page.
    expect(description(html)).toBe(meta.GENERIC_DESCRIPTION);
    expect(html).not.toContain('reached a record in the second quarter');
  });

  it('tells crawlers not to index it', () => {
    expect(robots(render(retracted(), RETRACTED_SLUG))).toBe('noindex, nofollow');
  });

  it('is classified before the servable check, not after', () => {
    // isServable rejects a retracted article, so testing it first would
    // collapse a retraction into the generic refusal — the exact bug #113
    // fixed on the page.
    expect(meta.classify(retracted())).toBe('retracted');
    expect(meta.isServable(retracted())).toBe(false);
  });

  it('is not readable merely by being marked retracted', () => {
    // A draft that never passed the validator does not become a public
    // retraction notice by having its status changed.
    const neverValid = retracted();
    neverValid.provenance = {
      sources: [],
      validator: { passed: false, checked_at: '', checks: [] },
    };
    expect(meta.classify(neverValid)).toBe('none');
    const html = render(neverValid, RETRACTED_SLUG);
    expect(html).not.toContain(RETRACTED_HEADLINE);
    expect(ogTitle(html)).toBe(meta.GENERIC_TITLE);
  });
});

describe('a corrected article', () => {
  /**
   * THE SIXTH SURFACE, and the one that travels furthest.
   *
   * A corrected article shared to Slack, Twitter or a chat preview rendered a
   * card carrying the withdrawn superlative with nothing to say it had been
   * corrected. Measured on master `033a819`, before this: `'Retracted: '`
   * appeared twice in `articleMeta.js` and `'Corrected: '` not at all.
   *
   * The concealing sibling is in the same file. `newsArticleJsonLd` sets
   * `creativeWorkStatus = 'Corrected'` and maps every note into `correction`,
   * so anyone checking whether this file knows about corrections found that it
   * does — MACHINE-READABLY, in a place no human sees. The argument for marking
   * the card was also already written here, for retraction: "a card is exactly
   * where a withdrawn claim most needs one, because a share card carries no
   * page around it to say so."
   */
  const CORRECTED_HEADLINE = article().headline;

  function corrected(): TestArticle {
    return article({
      corrections: [
        {
          corrected_at: '2026-08-31T14:08:22Z',
          description: 'CORRECTED. It said the reading was a record; it was not.',
        },
      ],
    });
  }

  it('marks the share card and the document title', () => {
    const html = render(corrected(), corrected().slug);
    expect(ogTitle(html)).toBe(`Corrected: ${CORRECTED_HEADLINE}`);
    expect(title(html)).toBe(`Corrected: ${CORRECTED_HEADLINE} | portaBaltica`);
  });

  it('leaves an uncorrected article alone', () => {
    // The negative control, on the same renderer. Without it the assertion
    // above is satisfied by a prefix pasted onto every article.
    const html = render(article(), article().slug);
    expect(ogTitle(html)).toBe(CORRECTED_HEADLINE);
    expect(title(html)).toBe(`${CORRECTED_HEADLINE} | portaBaltica`);
    expect(html).not.toContain('Corrected:');
  });

  it('treats an empty corrections array as no correction', () => {
    // `Array.isArray([]) && [].length` is the whole guard, and an empty array
    // is a shape the stored document can legitimately carry.
    const html = render(article({ corrections: [] }), article().slug);
    expect(ogTitle(html)).toBe(CORRECTED_HEADLINE);
  });

  it('stays retracted when it is both, because that is the stronger fact', () => {
    // Retracted means WITHDRAWN; corrected means AMENDED AND STILL STANDING.
    // Collapsing them would tell a reader a withdrawn piece still stands, and
    // every retracted article in the live log carries a `corrections` entry —
    // so this is the common case, not a corner.
    const html = render(retracted(), RETRACTED_SLUG);
    expect(title(html)).toBe(`Retracted: ${RETRACTED_HEADLINE} | portaBaltica`);
    expect(title(html)).not.toContain('Corrected:');
  });

  it('still carries the correction machine-readably, which is what made this easy to miss', () => {
    // A control on the DIAGNOSIS rather than on the fix: the machine-readable
    // half was always right, and that is precisely why the human half went
    // unnoticed for weeks.
    const html = render(corrected(), corrected().slug);
    expect(html).toContain('CORRECTED. It said the reading was a record');
    expect(html).toContain('CorrectionComment');
  });

  it('does not claim a schema.org status the pipeline never writes', () => {
    // MEASURED WHILE WRITING THE TEST ABOVE, and left as a finding rather than
    // repaired here.
    //
    // `creativeWorkStatus` is `article.status === 'corrected' ? 'Corrected' :
    // 'Published'`, and `revisions.py` deliberately keeps a corrected article
    // `published` because both `isServable` and `is_servable` require it. So
    // the `'corrected'` arm is UNREACHABLE, and production serves
    // `creativeWorkStatus: "Published"` beside a populated `correction` array —
    // verified against the live wrap on 2026-09-01.
    //
    // That reads as a contradiction and is arguably not one: the article IS
    // published, and `correction` already carries the amendment. Making the
    // dead arm fire would swap a documented schema.org value for one this
    // repository invented, which is a bigger claim than the defect. So the
    // behaviour is PINNED here rather than changed, and the dead arm is
    // reported in the PR for someone to rule on.
    const html = render(corrected(), corrected().slug);
    expect(html).toContain('"creativeWorkStatus":"Published"');
    expect(html).not.toContain('"creativeWorkStatus":"Corrected"');
  });
});

describe('an article the client would refuse', () => {
  it('refuses an article whose validator did not pass, however published', () => {
    const failed = article({
      provenance: {
        sources: [],
        validator: { passed: false, checked_at: '2026-08-27T08:30:00Z', checks: [] },
      },
    });
    expect(meta.isServable(failed)).toBe(false);
    const html = render(failed, failed.slug);
    expect(html).not.toContain(failed.headline);
    expect(robots(html)).toBe('noindex, nofollow');
  });

  it('refuses draft and pending articles', () => {
    for (const status of ['draft', 'pending_approval', 'rejected', 'corrected']) {
      expect(meta.isServable(article({ status }))).toBe(false);
      expect(meta.classify(article({ status }))).toBe('none');
    }
  });

  it('is byte-identical for a failed article and a slug that never existed', () => {
    // Holding the slug fixed is the point: the question a leak would answer is
    // "did something used to be here?", and only varying storage tests that.
    // Comparing two different slugs would only prove canonical URLs echo them.
    const failed = article({
      slug: RETRACTED_SLUG,
      provenance: { sources: [], validator: { passed: false, checked_at: '', checks: [] } },
    });
    expect(render(failed, RETRACTED_SLUG)).toBe(render(null, RETRACTED_SLUG));
  });
});

describe('the gate itself', () => {
  it('rejects the shapes it is supposed to reject', () => {
    // Guard against asserting protection that cannot fail: each of these must
    // actually be refused, and the happy fixture must actually be accepted.
    expect(meta.isServable(article())).toBe(true);
    expect(meta.isServable(null)).toBe(false);
    expect(meta.isServable({})).toBe(false);
    expect(meta.isServable({ status: 'published' })).toBe(false);
    expect(meta.isServable({ status: 'published', provenance: {} })).toBe(false);
    expect(
      meta.isServable({ status: 'published', provenance: { validator: { passed: 'yes' } } })
    ).toBe(false);
  });

  it('rejects the live slugs the client itself rejects', () => {
    // Eight live index entries carry diacritics and fail src/news-api.ts's
    // slug pattern, so those pages render "Article not found" in a browser.
    // Being more permissive here would answer 200 with rich metadata for a URL
    // no reader can read.
    expect(meta.isValidSlug('eiropas-komisāra-valda-dombrovska-runa-rīgas-df6376be')).toBe(false);
    expect(meta.isValidSlug('reason-for-cia-chief-s-trip-via-rīga-8a530118')).toBe(false);
    expect(meta.isValidSlug(article().slug)).toBe(true);
  });

  it('rejects anything that could escape the blob path', () => {
    for (const hostile of [
      '../index',
      'a/../../secret',
      'slug?x=1',
      'slug#x',
      'UPPER',
      '',
      'sl ug',
      '.',
    ]) {
      expect(meta.isValidSlug(hostile)).toBe(false);
    }
  });
});

describe('hostile article content', () => {
  it('cannot break out of an attribute', () => {
    // Tier B and C headlines are quoted verbatim from other outlets, so this
    // is third-party input reaching our document head.
    const nasty = article({
      headline: 'Ports "surge" <script>alert(1)</script> & \'more\'',
      dek: 'A dek with "quotes" & <b>markup</b>',
    });
    const html = render(nasty, nasty.slug);
    // The live script tag must not survive into the document…
    expect(html).not.toContain('<script>alert(1)</script>');
    // …and the raw bytes must carry the escaped form, not the original.
    expect(html).toContain(
      '<meta property="og:title" content="Ports &quot;surge&quot; &lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;more&#39;" />'
    );
    // Decoded, it is still exactly the headline — escaping, not mangling.
    expect(ogTitle(html)).toBe(nasty.headline);
    expect(html).toContain('<div id="root"></div>');
  });

  it('cannot close the JSON-LD script element', () => {
    const nasty = article({ headline: 'Cargo up </script><script>alert(1)</script>' });
    const html = render(nasty, nasty.slug);
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(block).not.toBeNull();
    // The payload is still valid JSON and still carries the real headline.
    const parsed = JSON.parse((block as RegExpExecArray)[1]);
    expect(parsed.headline).toBe('Cargo up </script><script>alert(1)</script>');
    expect(html).not.toContain('</script><script>alert(1)</script>');
  });
});

describe('tier', () => {
  it('gives JSON-LD only to our own reporting', () => {
    // Claiming a press release or a link-out as original reporting is a lie
    // told to a crawler. Mirrors src/newsroom/structured-data.ts.
    expect(meta.newsArticleJsonLd(article({ tier: 'B' }))).toBeNull();
    expect(meta.newsArticleJsonLd(article({ tier: 'C' }))).toBeNull();
    expect(meta.newsArticleJsonLd(article({ tier: 'A', persona: undefined }))).toBeNull();
    expect(meta.newsArticleJsonLd(article())).not.toBeNull();
  });

  it('still gives a syndicated page its own title and keeps the site description', () => {
    // Fifty-three of seventy-three live articles carry no dek. The client
    // leaves the site description in place for those, so this does too rather
    // than reproducing another outlet's snippet in our metadata.
    const linkOut = article({ tier: 'C', persona: undefined, dek: undefined });
    const html = render(linkOut, linkOut.slug);
    expect(ogTitle(html)).toBe(linkOut.headline);
    expect(description(html)).toBe(meta.GENERIC_DESCRIPTION);
    expect(html).not.toContain('application/ld+json');
  });
});

describe('the shell it injects into', () => {
  it('refuses a body that is not this app', () => {
    // If the origin answers with an error page or a redirect interstitial,
    // dressing it up with an article's metadata would advertise a page that
    // cannot render. Refusing lets the caller fall back.
    expect(meta.renderShell('<html><head></head><body>nope</body></html>', article(), 's')).toBeNull();
    expect(meta.renderShell('', article(), 's')).toBeNull();
    expect(meta.renderShell('<div id="root"></div>', article(), 's')).toBeNull();
  });

  it('matches the generic head against the real index.html', () => {
    // api/ is deployed without the site's static files, so the fallback title
    // and description are a copy. This is what stops the copy drifting.
    expect(SHELL).toContain(`<title>${meta.GENERIC_TITLE}</title>`);
    expect(SHELL).toContain(
      `<meta property="og:description" content="${meta.GENERIC_DESCRIPTION}" />`
    );
  });
});

describe('finding the slug in the request', () => {
  it('reads the original URL Static Web Apps passes through', () => {
    // The route rewrites to /api/article-page, so req.url no longer carries
    // the slug. x-ms-original-url is the only place it survives.
    expect(
      meta.slugFromRequest({
        headers: { 'x-ms-original-url': 'https://portabaltica.naurolabs.com/article/my-slug-abc' },
        url: 'https://portabaltica.naurolabs.com/api/article-page',
      })
    ).toBe('my-slug-abc');
  });

  it('drops query strings and fragments', () => {
    expect(
      meta.slugFromRequest({
        headers: { 'x-ms-original-url': 'https://x/article/my-slug-abc?utm_source=slack' },
      })
    ).toBe('my-slug-abc');
  });

  it('decodes a percent-encoded slug', () => {
    expect(
      meta.slugFromRequest({ headers: { 'x-ms-original-url': 'https://x/article/r%C4%ABga-abc' } })
    ).toBe('rīga-abc');
  });

  it('falls back to req.url when the header is absent', () => {
    expect(meta.slugFromRequest({ headers: {}, url: '/article/my-slug-abc' })).toBe('my-slug-abc');
  });

  it('returns null when there is no article path at all', () => {
    expect(meta.slugFromRequest({ headers: {}, url: '/api/article-page' })).toBeNull();
    expect(meta.slugFromRequest({})).toBeNull();
  });
});
