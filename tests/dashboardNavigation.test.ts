import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = readFileSync(resolve('src/App.tsx'), 'utf8');
const rail = readFileSync(resolve('src/components/SectionRail.tsx'), 'utf8');
const css = readFileSync(resolve('src/index.css'), 'utf8');
const html = readFileSync(resolve('index.html'), 'utf8');

/**
 * The dashboard overview is about 13,000px at 1440 and 28,000px at 375 —
 * fourteen screens and thirty-one. Everything here is about a reader being able
 * to find their way through that, and about the page saying where one subject
 * ends and the next begins.
 */
describe('the dashboard as a page a reader can move through', () => {
  it('separates sections by more than it separates the cards inside them', () => {
    // Sections were 32px apart while the blocks inside each were 24px, so a
    // section boundary was barely more emphatic than the gap between two cards
    // — which is what made nine distinct subjects read as one continuous
    // block. DESIGN.md §1.2 names `--space-2xl`, 48px, for this gap.
    const wrapper = app.match(/<div className="space-y-(\d+)">\s*\{show\('economy'\)/);
    expect(wrapper, 'the section wrapper is not where this test thought it was').not.toBeNull();
    expect(Number(wrapper![1]), 'sections must be --space-2xl (space-y-12) apart').toBe(12);
  });

  it('gives every section an anchor to be jumped to', () => {
    const sections = [
      'economy', 'trade', 'government', 'labour', 'energy',
      'property', 'environment', 'business', 'maritime',
    ];
    for (const id of sections) {
      expect(app, `no anchor for ${id}`).toContain(`<Section id="${id}">`);
    }
  });

  it('clears the sticky rail when it jumps to one', () => {
    // WCAG 2.2 SC 2.4.11: a target scrolled to must not end up underneath
    // sticky chrome. `.dash-section` is the class the anchors carry.
    expect(css, '.dash-section needs a scroll-margin-top').toMatch(
      /\.dash-section\s*\{[^}]*scroll-margin-top:/,
    );
  });

  it('does not offer a choice of one', () => {
    // On a single-section route there is nothing to navigate between, and a
    // navigation control listing one destination is noise.
    expect(app).toMatch(/activeSection === 'all' && <SectionRail/);
  });
});

describe('the section rail', () => {
  it('uses real fragment links rather than click handlers', () => {
    // A fragment link works with JavaScript disabled, survives being copied
    // out of the address bar, and is keyboard-operable without any work.
    expect(rail).toMatch(/href=\{`#\$\{id\}`\}/);
  });

  it('says where the reader is without claiming to be the page', () => {
    // The masthead tab already carries aria-current="page". The rail describes
    // a position within that page, which is what `location` is for.
    expect(rail).toMatch(/aria-current=\{isActive \? 'location' : undefined\}/);
    expect(rail, 'the rail needs a name of its own').toMatch(/aria-label="Jump to a dashboard section"/);
  });

  it('sticks, so a way out is always one tap away', () => {
    expect(rail).toMatch(/className="sticky top-0/);
  });
});

describe('scrolling', () => {
  it('is smooth only for readers who have not asked otherwise', () => {
    // Scroll animation is a documented vestibular trigger, so this one matters
    // more than a hover transition. `prefers-reduced-motion: no-preference`
    // rather than a blanket rule plus an override, so the default for an
    // unknown preference is the safe one.
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*html\s*\{\s*scroll-behavior: smooth;/,
    );
  });
});

describe('a horizontally scrolling strip', () => {
  it('fades only the end that is actually cut off', () => {
    // A fixed mask dims the first and last item whether or not anything is
    // hidden past them. The section tabs do not overflow at 1440, so an
    // always-on fade would grey out "News" and "Maritime" permanently to solve
    // a problem that only exists on a phone.
    for (const rule of ['.edge-fade-start', '.edge-fade-end']) {
      expect(css, `${rule} is missing`).toContain(rule);
    }

    for (const file of ['Header.tsx', 'InsightsBanner.tsx', 'SectionRail.tsx']) {
      const text = readFileSync(resolve(`src/components/${file}`), 'utf8');
      expect(text, `${file} must measure its own overflow`).toContain('useOverflowFade');
      expect(text, `${file} must not use the unconditional fade`).not.toContain('edge-fade-x');
    }
  });

  it('keeps the unconditional fade for the one strip that always scrolls', () => {
    const ticker = readFileSync(resolve('src/components/DataTicker.tsx'), 'utf8');
    expect(ticker).toContain('edge-fade-x');
  });

  it('fades by a fixed distance rather than a share of the strip', () => {
    // The fade was `3%`, which made it shrink with the viewport: 43px at 1440
    // and **12px at 402**. So the affordance was weakest at exactly the widths
    // where these strips overflow. Measured on a phone, the ticker's leading
    // item read as a crisp cut rather than a fade — "R/USD" for EUR/USD, and
    // "0.8574" with its label gone. A percentage cannot be right here, because
    // the thing being masked is a character and a character is a length.
    const fadeRules = css.match(/mask-image: linear-gradient\(to right[^;]*;/g) ?? [];
    expect(fadeRules.length, 'the edge-fade rules are not where this test thought they were')
      .toBeGreaterThanOrEqual(6);

    for (const rule of fadeRules) {
      expect(rule, `a percentage stop shrinks the fade on a phone: ${rule}`)
        .not.toMatch(/#000 \d+%/);
      expect(rule, `the fade must come from the token: ${rule}`).toContain('var(--edge-fade)');
    }

    // `:root`, not `@theme` — Tailwind tree-shakes theme entries no utility
    // references, and these rules read the token with `var()`. A token that
    // never reaches the stylesheet resolves to nothing and the mask silently
    // stops masking, in production only.
    expect(css, '--edge-fade must be declared in :root so it always ships')
      .toMatch(/:root\s*\{[\s\S]*?--edge-fade:\s*[^;]+;/);
  });
});

describe('brand metadata', () => {
  it('serves its icons and share card from our own origin', () => {
    // The CSP is `img-src 'self' data:`. An asset fetched from a third party
    // would disclose every reader's IP address to whoever served it, which is
    // the same reason there are no webfonts.
    const remote = [...html.matchAll(/(?:href|content)="(https?:\/\/[^"]+)"/g)]
      .map((match) => match[1])
      .filter((url) => /\.(?:png|jpe?g|svg|webp|ico|woff2?)$/i.test(url))
      .filter((url) => !url.startsWith('https://portabaltica.naurolabs.com/'));

    expect(remote, 'these assets are fetched from somewhere else').toEqual([]);
  });

  it('names an icon, a theme colour for each scheme, and a share card', () => {
    expect(html, 'no svg favicon').toMatch(/<link rel="icon"[^>]*href="\/favicon\.svg"/);
    expect(html, 'no apple touch icon').toMatch(/<link rel="apple-touch-icon"/);
    expect(html, 'no dark theme-color').toMatch(
      /<meta name="theme-color" content="#0a0f1a" media="\(prefers-color-scheme: dark\)"/,
    );
    expect(html, 'no light theme-color').toMatch(
      /<meta name="theme-color" content="#f6f8fb" media="\(prefers-color-scheme: light\)"/,
    );
    expect(html, 'no og:image').toMatch(/<meta property="og:image" content="[^"]+og\.png"/);
    expect(html, 'a cropped card cuts the wordmark in half').toMatch(
      /<meta name="twitter:card" content="summary_large_image"/,
    );
  });

  it('states the theme colours the stylesheet actually uses', () => {
    // These are duplicated out of src/index.css by necessity — index.html
    // cannot read a custom property. Duplication that nothing checks is
    // duplication that drifts.
    const dark = css.match(/:root\s*\{[\s\S]*?--bg-page:\s*(#[0-9a-f]{6})/i);
    const light = css.match(/\[data-theme="light"\]\s*\{[\s\S]*?--bg-page:\s*(#[0-9a-f]{6})/i);
    expect(html).toContain(`content="${dark![1]}" media="(prefers-color-scheme: dark)"`);
    expect(html).toContain(`content="${light![1]}" media="(prefers-color-scheme: light)"`);
  });

  it('no longer ships an unrelated scaffold logo', () => {
    // public/favicon.svg was a purple template mark from the initial scaffold,
    // referenced by nothing, while index.html drew an anchor emoji inline —
    // which said "shipping company" for a site that stopped being maritime-only
    // some time ago.
    const favicon = readFileSync(resolve('public/favicon.svg'), 'utf8');
    expect(favicon, 'the scaffold mark is still there').not.toContain('#863bff');
    expect(favicon, 'the mark should use the site accent').toContain('#38bdf8');
    expect(html, 'the inline emoji icon is still there').not.toContain('%E2%9A%93');
    expect(html).not.toMatch(/<link rel="icon" href="data:/);
  });
});
