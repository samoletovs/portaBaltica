import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The type scale, enforced across the whole site.
 *
 * Two systems used to run side by side. The newsroom had twelve font sizes,
 * four of them arbitrary values written inline; the dashboard had its own
 * eight, drawn from Tailwind's defaults. Section headings on both sides sat at
 * or below the size of the text underneath them. Nothing repeated, so nothing
 * looked deliberate, and crossing from a story to the dashboard felt like
 * crossing between two products.
 *
 * A scale only stays a scale if adding a size off it is harder than using one
 * on it. These tests are that friction, and they cover every component rather
 * than the news routes alone — scoping the first pass to the newsroom is what
 * produced the mismatch.
 */

const css = readFileSync(resolve('src/index.css'), 'utf8');

/** Every `--text-*` step, in rem. */
function scale(): Record<string, number> {
  return Object.fromEntries(
    [...css.matchAll(/^\s*--text-([a-z]+):\s*([\d.]+)rem;/gm)].map(([, name, value]) => [
      name,
      Number.parseFloat(value),
    ]),
  );
}

/** Every `--text-*--line-height` step, unitless. */
function leading(): Record<string, number> {
  return Object.fromEntries(
    [...css.matchAll(/^\s*--text-([a-z]+)--line-height:\s*([\d.]+);/gm)].map(
      ([, name, value]) => [name, Number.parseFloat(value)],
    ),
  );
}

/** Every component on the site, news and dashboard alike. */
function allComponents(): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];

  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.tsx')) {
        found.push({ file: entry.name, text: readFileSync(path, 'utf8') });
      }
    }
  }

  walk(resolve('src'));
  return found;
}

// The ramp, smallest to largest. Adding a step means adding it here, which is
// the point: it forces the question of what job the new size does that none of
// the existing ones did.
const STEPS = [
  'caption',
  'ui',
  'callout',
  'prose',
  'lead',
  'title',
  'headline',
  'display',
] as const;

describe('the type scale', () => {
  it('defines every named step, with a line height', () => {
    const sizes = scale();
    const heights = leading();

    for (const step of STEPS) {
      expect(sizes[step], `--text-${step} is missing`).toBeGreaterThan(0);
      expect(heights[step], `--text-${step}--line-height is missing`).toBeGreaterThan(0);
    }
  });

  it('ascends strictly, so no step collides with its neighbour', () => {
    const sizes = scale();

    for (let index = 1; index < STEPS.length; index += 1) {
      const previous = STEPS[index - 1];
      const current = STEPS[index];
      expect(
        sizes[current],
        `--text-${current} must be larger than --text-${previous}`,
      ).toBeGreaterThan(sizes[previous]);
    }
  });

  it('keeps the ratio between neighbours inside a usable band', () => {
    const sizes = scale();

    // Below ~1.06 two steps are indistinguishable and one of them is dead
    // weight; above ~1.4 the jump reads as a different document. The ramp is
    // deliberately tighter at the interface end and wider at the editorial
    // end, which is the split Carbon and Fluent both make.
    for (let index = 1; index < STEPS.length; index += 1) {
      const ratio = sizes[STEPS[index]] / sizes[STEPS[index - 1]];
      expect(ratio, `${STEPS[index - 1]} → ${STEPS[index]}`).toBeGreaterThanOrEqual(1.06);
      expect(ratio, `${STEPS[index - 1]} → ${STEPS[index]}`).toBeLessThanOrEqual(1.4);
    }
  });

  it('leads body text at 1.5 or more, and tightens as the type grows', () => {
    const heights = leading();

    // WCAG 2.1 SC 1.4.8 asks a block of text for at least space-and-a-half.
    for (const step of ['caption', 'ui', 'callout', 'prose'] as const) {
      expect(heights[step], `--text-${step}--line-height`).toBeGreaterThanOrEqual(1.5);
    }

    // Leading is proportional: the same ratio that reads as comfortable on a
    // caption reads as a gap on a headline.
    for (const step of ['lead', 'title', 'headline', 'display'] as const) {
      expect(heights[step], `--text-${step}--line-height`).toBeLessThan(1.5);
    }
    expect(heights.display).toBeLessThanOrEqual(heights.headline);
    expect(heights.headline).toBeLessThanOrEqual(heights.title);
  });

  it('sizes every step in rem, so browser zoom still works', () => {
    // WCAG 2.1 SC 1.4.4 wants text resizable to 200%. A px-valued scale
    // defeats a reader who has set a larger default size.
    const pxSteps = [...css.matchAll(/^\s*--text-[a-z]+:\s*([\d.]+)px;/gm)];
    expect(pxSteps.map((match) => match[0])).toEqual([]);
  });

  it('holds the reading column inside a comfortable measure', () => {
    const measure = css.match(/--container-measure:\s*([\d.]+)rem;/);
    expect(measure, '--container-measure is missing').not.toBeNull();

    const sizes = scale();
    const remWidth = Number.parseFloat(measure![1]);
    // A UI sans averages near 0.5em per character across running prose.
    const characters = (remWidth * 16) / (sizes.prose * 16 * 0.5);

    // Bringhurst puts a comfortable line at 45–75 characters and calls 66
    // ideal; WCAG 2.1 SC 1.4.8 caps a block of text at 80.
    expect(characters).toBeGreaterThanOrEqual(45);
    expect(characters).toBeLessThanOrEqual(80);
  });

  it('never names a step that a colour variable already squats on', () => {
    // Tailwind v4 reads `--text-*` as the font-size namespace, but this file
    // also defines `--text-primary`, `--text-body` and friends as colours in
    // `:root`. Those are emitted after `@theme`, so a step sharing one of
    // those names loses: the utility resolves to a hex value, which is not a
    // length, and silently does nothing. `--text-body: 1.125rem` was written
    // exactly once and cost an afternoon.
    const colours = new Set(
      [...css.matchAll(/^\s*--text-([a-z-]+):\s*(#[0-9a-f]{3,8}|rgb)/gim)].map(
        ([, name]) => name,
      ),
    );

    for (const step of STEPS) {
      expect(colours.has(step), `--text-${step} is also defined as a colour`).toBe(false);
    }
  });
});

describe('every page', () => {
  it('sizes text from the scale rather than inventing a size', () => {
    const offenders: string[] = [];

    for (const { file, text } of allComponents()) {
      for (const [line] of text.matchAll(/^.*className=[^\n]*$/gm)) {
        // An arbitrary size — text-[13px], text-[0.85em] — is a size that
        // exists exactly once and relates to nothing.
        if (/\btext-\[[^\]]*(?:px|rem|em)\]/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
        // Tailwind's default ramp is a second, competing scale. The site
        // picks one, and it applies to the dashboard as much as the newsroom.
        if (/\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('sets no font size in a px-valued inline style', () => {
    // An inline `fontSize: 20` bypasses both the scale and browser zoom.
    const offenders: string[] = [];

    for (const { file, text } of allComponents()) {
      for (const [match] of text.matchAll(/fontSize:\s*(?:\d+\b|'[\d.]+px')/g)) {
        offenders.push(`${file}: ${match}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('uses two weights, not three', () => {
    // `font-bold` beside `font-semibold` reads as a third weight the scale
    // never asked for, and on a system UI face the difference is mostly noise.
    const offenders: string[] = [];

    for (const { file, text } of allComponents()) {
      if (/\bfont-(?:bold|extrabold|black)\b/.test(text)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it('tracks every small-caps label the same way', () => {
    // `tracking-wider` and `tracking-widest` on the same kind of label is the
    // sort of near-miss that makes a page look assembled rather than designed.
    const offenders: string[] = [];

    for (const { file, text } of allComponents()) {
      for (const [line] of text.matchAll(/^.*\buppercase\b[^\n]*$/gm)) {
        if (/\btracking-(?:wide|wider)\b/.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never sets a heading smaller than the prose it introduces', () => {
    const sizes = scale();
    const markdown = readFileSync(resolve('src/newsroom/markdown.tsx'), 'utf8');

    const headings = Object.fromEntries(
      [...markdown.matchAll(/^\s*(\d):\s*'([^']+)',$/gm)].map(([, level, classes]) => [
        Number(level),
        classes,
      ]),
    );

    function sizeOf(classes: string): number {
      const token = classes.match(/\btext-([a-z]+)\b/)?.[1];
      return token ? sizes[token] ?? 0 : 0;
    }

    // h1 → h3 are levels of one document and must descend. h4 is deliberately
    // a small uppercase label rather than a fourth notch down the ramp, so it
    // is excluded.
    expect(sizeOf(headings[1])).toBeGreaterThan(sizeOf(headings[2]));
    expect(sizeOf(headings[2])).toBeGreaterThan(sizeOf(headings[3]));
    expect(sizeOf(headings[3])).toBeGreaterThan(sizes.prose);
  });

  it('gives a heading more space above it than below, and less as it descends', () => {
    // Carbon: "the top level headers have more space surrounding them giving
    // them focus and prominence. Then as the headers descend in importance
    // they receive less space." A heading belongs to the content beneath it,
    // so it must sit closer to that than to whatever it follows.
    const markdown = readFileSync(resolve('src/newsroom/markdown.tsx'), 'utf8');
    const headings = Object.fromEntries(
      [...markdown.matchAll(/^\s*(\d):\s*'([^']+)',$/gm)].map(([, level, classes]) => [
        Number(level),
        classes,
      ]),
    );

    function step(classes: string, prefix: 'mt' | 'mb'): number {
      const value = classes.match(new RegExp(`\\b${prefix}-(\\d+)\\b`))?.[1];
      return value ? Number(value) : 0;
    }

    for (const level of [2, 3, 4]) {
      expect(
        step(headings[level], 'mt'),
        `h${level} needs more room above it than below it`,
      ).toBeGreaterThan(step(headings[level], 'mb'));
    }

    // Normalising an off-scale `mt-9`/`mt-7` pair onto the scale collapsed h3
    // and h4 onto the same step, which erased a level of the hierarchy.
    expect(step(headings[2], 'mt')).toBeGreaterThan(step(headings[3], 'mt'));
    expect(step(headings[3], 'mt')).toBeGreaterThan(step(headings[4], 'mt'));
  });

  it('never makes an h2 a 12px label', () => {
    // An `h2` introduces a section, and a section heading set smaller than the
    // content beneath it stops reading as a heading. The dashboard headed its
    // insights panel and its comparison grid with 12px uppercase labels — the
    // same inversion the type pass fixed one level up and left here.
    //
    // `text-caption` on an `h4`, or on a `<p>` label inside a card, is a
    // different object and stays allowed: see markdown.tsx.
    const offenders: string[] = [];

    for (const { file, text } of allComponents()) {
      for (const [match] of text.matchAll(/<h2[^>]*className="[^"]*"/g)) {
        if (/\btext-caption\b/.test(match)) offenders.push(`${file}: ${match}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('gives dashboard sections the same heading step as newsroom sections', () => {
    // The dashboard used to head each section with a 14px uppercase label,
    // which is smaller than the cards beneath it. News and data are one
    // product; their section headings are the same object.
    //
    // Eight of the nine tiles now delegate the heading to `TileHeader`, which
    // is what stopped the same flex-row wrap defect existing eight times. A
    // tile satisfies this by rendering a conforming `h2` itself *or* by using
    // that component — and the component is then held to the same rule, so the
    // indirection cannot be used to escape it.
    const tiles = [
      'EconomyTile',
      'EnergyTile',
      'GovernmentTile',
      'LabourTile',
      'TradeTile',
      'EnvironmentTile',
      'PropertyTile',
      'BusinessTile',
      'MaritimeTile',
    ];

    const shared = readFileSync(resolve('src/components/TileHeader.tsx'), 'utf8');
    const sharedHeading = shared.match(/<h2[^>]*className="([^"]+)"/);
    expect(sharedHeading, 'TileHeader has no h2').not.toBeNull();
    expect(sharedHeading![1], 'TileHeader section heading').toContain('text-title');

    for (const tile of tiles) {
      const text = readFileSync(resolve(`src/components/${tile}.tsx`), 'utf8');
      if (text.includes('<TileHeader')) {
        // Delegating is only allowed if it delegates *everything* — a tile that
        // uses the shared header and also hand-rolls an h2 has two section
        // headings, which is the drift this rule exists to stop.
        expect(text.match(/<h2[^>]*className="([^"]+)"/), `${tile} has both a TileHeader and its own h2`).toBeNull();
        continue;
      }
      const heading = text.match(/<h2[^>]*className="([^"]+)"/);
      expect(heading, `${tile} has no h2`).not.toBeNull();
      expect(heading![1], `${tile} section heading`).toContain('text-title');
    }
  });
});

describe('the typeface', () => {
  it('is one family for the whole site', () => {
    // A previous pass set articles in a serif and left the dashboard on the UI
    // face. Across a product a reader crosses constantly, that read as two
    // sites rather than as two registers.
    expect(css).not.toMatch(/--font-serif:/);
    expect(css).toMatch(/--font-sans:\s*system-ui/);
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  });

  it('never fetches a font from a third party', () => {
    // The CSP is `font-src 'self' data:`, so a remote font would be blocked —
    // and requesting one discloses every reader's IP address to whoever serves
    // it, which a news site read in the EU should not do for a typeface.
    expect(css).not.toMatch(/@import\s+url\(['"]?https?:/);
    expect(css).not.toMatch(/url\(['"]?https?:\/\/[^)]*\.(?:woff2?|ttf|otf)/);

    const html = readFileSync(resolve('index.html'), 'utf8');
    expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
  });

  it('names no font it does not actually serve', () => {
    // `--font-body` named Inter for the whole life of the site while the CSP
    // blocked the request that would have loaded it, so every reader got the
    // system stack and nobody saw the design as drawn.
    const platformFaces = new Set([
      'Segoe UI',
      'Helvetica Neue',
      'Noto Sans',
      'SF Mono',
      'Cascadia Mono',
      'Segoe UI Mono',
    ]);

    const families = [...css.matchAll(/^\s*--font-[a-z]+:\s*([^;]+);/gm)].map(
      (match) => match[1],
    );

    for (const family of families) {
      for (const [, quoted] of family.matchAll(/"([^"]+)"/g)) {
        expect(
          platformFaces.has(quoted),
          `${quoted} is named in a font stack but nothing serves it`,
        ).toBe(true);
      }
    }
  });

  it('sets no font family outside the tokens', () => {
    for (const { file, text } of allComponents()) {
      for (const [match, value] of text.matchAll(/fontFamily:\s*'([^']+)'/g)) {
        expect(value, `${file}: ${match}`).toMatch(/^var\(--font-/);
      }
    }
  });
});
