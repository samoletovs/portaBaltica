import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The type scale, enforced.
 *
 * The editorial surface had grown twelve font sizes — 11, 12, 13, 14, 15, 16,
 * 17, 18, 20, 24, 30 and 36px — four of them arbitrary values written inline
 * at the point of use. Nothing repeated, so nothing looked deliberate, and the
 * section headings on three pages had drifted to the same size as the body
 * text underneath them.
 *
 * A scale only stays a scale if adding a size off it is harder than using one
 * on it. These tests are that friction. They follow the pattern of
 * newsTheme.test.ts, which guards the colour tokens the same way.
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

/** Source of every editorial surface: the news components and the policy renderer. */
function editorialSources(): { file: string; text: string }[] {
  const directory = resolve('src/components/news');
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ file, text: readFileSync(join(directory, file), 'utf8') }));

  return [
    ...files,
    { file: 'markdown.tsx', text: readFileSync(resolve('src/newsroom/markdown.tsx'), 'utf8') },
  ];
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
    // Source Serif 4 averages near 0.48em per character across running prose.
    const characters = (remWidth * 16) / (sizes.prose * 16 * 0.48);

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

describe('editorial surfaces', () => {
  it('use the scale rather than inventing a size', () => {
    const offenders: string[] = [];

    for (const { file, text } of editorialSources()) {
      for (const [line] of text.matchAll(/^.*className=(?:"|\{\[)[^\n]*$/gm)) {
        // An arbitrary size — text-[13px], text-[0.85em] — is a size that
        // exists exactly once and relates to nothing.
        if (/\btext-\[[^\]]*(?:px|rem|em)\]/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
        // Tailwind's default ramp is a second, competing scale. The editorial
        // surface picks one.
        if (/\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never set a heading smaller than the prose it introduces', () => {
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
    // a small uppercase label in the interface face rather than a fourth notch
    // down the ramp, so it is excluded.
    expect(sizeOf(headings[1])).toBeGreaterThan(sizeOf(headings[2]));
    expect(sizeOf(headings[2])).toBeGreaterThan(sizeOf(headings[3]));
    expect(sizeOf(headings[3])).toBeGreaterThan(sizes.prose);
  });
});

describe('the editorial typeface', () => {
  it('is self-hosted, with every referenced file present', () => {
    const references = [...css.matchAll(/url\('(\/fonts\/[^']+)'\)/g)].map((match) => match[1]);
    expect(references.length).toBeGreaterThan(0);

    for (const reference of references) {
      expect(
        existsSync(resolve(join('public', reference))),
        `${reference} is referenced by @font-face but not present in public/`,
      ).toBe(true);
    }
  });

  it('ships its licence beside the files it licenses', () => {
    expect(existsSync(resolve('public/fonts/source-serif-4-OFL.txt'))).toBe(true);
  });

  it('never fetches a font from a third party', () => {
    // A remote font would be blocked by `font-src 'self' data:` anyway, and
    // requesting one discloses every reader's IP address to whoever serves it.
    expect(css).not.toMatch(/@import\s+url\(['"]?https?:/);
    expect(css).not.toMatch(/url\(['"]?https?:\/\/[^)]*\.(?:woff2?|ttf|otf)/);
  });

  it('keeps the serif for prose and the platform face for the interface', () => {
    expect(css).toMatch(/\.editorial\s*\{[^}]*font-family:\s*var\(--font-serif\)/);
    expect(css).toMatch(/\.editorial-heading\s*\{[^}]*font-family:\s*var\(--font-serif\)/);
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
    expect(css).toMatch(/--font-sans:\s*system-ui/);
  });

  it('names no font it does not actually serve', () => {
    // --font-body named Inter for the whole life of the site while the CSP
    // blocked the request that would have loaded it, so every reader got the
    // system stack and nobody saw the design as drawn.
    const families = [...css.matchAll(/^\s*--font-[a-z]+:\s*([^;]+);/gm)].map(
      (match) => match[1],
    );
    const declared = new Set(
      [...css.matchAll(/font-family:\s*'([^']+)'/g)].map((match) => match[1]),
    );

    for (const family of families) {
      for (const [, quoted] of family.matchAll(/"([^"]+)"/g)) {
        // Anything quoted is a specific face rather than a generic or a
        // platform keyword. It must either be one we serve, or a face the
        // operating system is known to provide.
        const platformFaces = [
          'Segoe UI',
          'Helvetica Neue',
          'Noto Sans',
          'Georgia',
          'Cambria',
          'Times New Roman',
          'SF Mono',
          'Cascadia Mono',
          'Segoe UI Mono',
        ];
        if (platformFaces.includes(quoted)) continue;
        expect(
          declared.has(quoted),
          `${quoted} is named in a font stack but no @font-face serves it`,
        ).toBe(true);
      }
    }
  });
});
