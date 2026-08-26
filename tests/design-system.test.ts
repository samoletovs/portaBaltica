import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The design system, enforced.
 *
 * `tests/typography.test.ts` covers the type scale. This covers everything
 * else in DESIGN.md: spacing, radius, surfaces, contrast, focus, motion and
 * the chart rules.
 *
 * It exists for the same reason the typography suite does. A rule that is only
 * written down is a rule the next change breaks, and this site has already
 * proved that twice — once when the type scale was applied to the newsroom and
 * not the dashboard, and again when a focus ring was added to sixteen newsroom
 * components and to no dashboard component at all.
 *
 * Contrast here is computed, not asserted from memory. If a colour changes,
 * the failure message reports the ratio that was actually shipped.
 */

const css = readFileSync(resolve('src/index.css'), 'utf8');

// ─── helpers ───────────────────────────────────────────────────────────────

function components(): { file: string; path: string; text: string }[] {
  const found: { file: string; path: string; text: string }[] = [];

  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.tsx')) {
        found.push({ file: entry.name, path, text: readFileSync(path, 'utf8') });
      }
    }
  }

  walk(resolve('src'));
  return found;
}

/** Every custom property declared inside one selector block. */
function tokensIn(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) return {};
  return Object.fromEntries(
    [...block[1].matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  );
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const expanded = clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean;
  const [r, g, b] = [0, 2, 4]
    .map((i) => Number.parseInt(expanded.slice(i, i + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two opaque colours. */
function contrast(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const THEME = tokensIn('@theme');
// `@theme` holds the scales (spacing, radius, motion); `:root` holds the dark
// colours. A component sees one merged namespace, so the test does too.
const DARK = { ...THEME, ...tokensIn(':root') };
const LIGHT = { ...THEME, ...tokensIn(':root'), ...tokensIn('[data-theme="light"]') };
const THEMES = [
  { name: 'dark', tokens: DARK },
  { name: 'light', tokens: LIGHT },
] as const;

// ─── spacing and radius ────────────────────────────────────────────────────

describe('the spacing scale', () => {
  const STEPS = ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const;

  it('names every step', () => {
    for (const step of STEPS) {
      expect(DARK[`--space-${step}`], `--space-${step} is missing`).toBeDefined();
    }
  });

  it('ascends, and sits on a 4px grid', () => {
    const px = STEPS.map((step) => Number.parseFloat(DARK[`--space-${step}`]) * 16);

    for (let index = 1; index < px.length; index += 1) {
      expect(px[index], `--space-${STEPS[index]}`).toBeGreaterThan(px[index - 1]);
    }
    // 2px is the one deliberate exception, for the inside of a badge.
    for (const value of px.slice(1)) {
      expect(value % 4, `${value}px is off the 4px grid`).toBe(0);
    }
  });

  it('is the only spacing any component writes', () => {
    // Nine steps: 2, 4, 8, 12, 16, 24, 32, 48, 64px. A `py-2.5` next to a
    // `py-3` is not a considered difference, it is two people guessing —
    // which is how thirty-seven distinct padding values accumulated.
    const allowed = new Set(['0', '0.5', '1', '2', '3', '4', '6', '8', '12', '16', 'px', 'auto', 'full']);
    const utility =
      /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(\d+(?:\.\d+)?|px|auto|full)\b/g;
    const offenders: string[] = [];

    for (const { file, text } of components()) {
      for (const match of text.matchAll(utility)) {
        if (!allowed.has(match[1])) offenders.push(`${file}: ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the radius scale', () => {
  it('names three steps plus the pill', () => {
    // Declared in `:root`, not `@theme`, and called `--corner-*` rather than
    // `--radius-*`. `@theme` entries are tree-shaken: `--radius-card` was
    // defined in source and absent from the built stylesheet, so
    // `var(--radius-card)` resolved to nothing in production only.
    const root = tokensIn(':root');

    for (const step of ['chip', 'control', 'card']) {
      expect(root[`--corner-${step}`], `--corner-${step} must be declared in :root`).toBeDefined();
    }
    expect(css, 'radius tokens must not sit in a namespace Tailwind tree-shakes')
      .not.toMatch(/^\s*--radius-(?:chip|control|card):/m);
  });

  it('is the only radius any component writes', () => {
    // `rounded` 4px, `rounded-lg` 8px, `rounded-xl` 12px, `rounded-full`.
    // `rounded-md` was a fifth step used twice, related to nothing.
    const allowed = new Set(['rounded', 'rounded-lg', 'rounded-xl', 'rounded-full', 'rounded-none']);
    const offenders: string[] = [];

    for (const { file, text } of components()) {
      for (const match of text.matchAll(/\brounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?\b/g)) {
        if (!allowed.has(match[0])) offenders.push(`${file}: ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ─── weight ────────────────────────────────────────────────────────────────

describe('weight', () => {
  it('is regular or semibold, and nothing between', () => {
    // The book has claimed two weights since the type pass. It was not true:
    // `font-medium` appeared thirty-two times and an inline `fontWeight: 500`
    // four more. On a system UI face 400 → 500 is barely a change, which is
    // worse than no change — it costs a weight and buys nothing legible.
    const offenders: string[] = [];

    for (const { file, text } of components()) {
      for (const match of text.matchAll(/\bfont-(?:thin|light|medium|bold|extrabold|black)\b/g)) {
        offenders.push(`${file}: ${match[0]}`);
      }
      for (const match of text.matchAll(/fontWeight:\s*(\d+)/g)) {
        if (!['400', '600'].includes(match[1])) offenders.push(`${file}: ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ─── colour ────────────────────────────────────────────────────────────────

describe('contrast', () => {
  // The floor for anything a reader is expected to read is 4.5:1 — WCAG 2.2
  // SC 1.4.3, Level AA. `--text-disabled` is the only step allowed below it,
  // and it is the only step that may never carry information.
  const FLOORS: Record<string, number> = {
    '--text-primary': 12,
    '--text-body': 10,
    '--text-secondary': 7,
    '--text-tertiary': 4.5,
    '--text-disabled': 3,
  };

  for (const { name, tokens } of THEMES) {
    it(`clears every floor on the ${name} page background`, () => {
      const background = tokens['--bg-page'];
      expect(background, `--bg-page missing in ${name}`).toMatch(/^#[0-9a-f]{6}$/i);

      for (const [token, floor] of Object.entries(FLOORS)) {
        const ratio = contrast(tokens[token], background);
        expect(
          Number(ratio.toFixed(2)),
          `${name} ${token} on --bg-page is ${ratio.toFixed(2)}:1, needs ${floor}:1`,
        ).toBeGreaterThanOrEqual(floor);
      }
    });

    it(`clears every floor on the ${name} card surface`, () => {
      // Cards are opaque now precisely so this is computable. While they were
      // `rgba(...)` over the page there was no single answer to what colour a
      // caption actually sat on, and so no way to test it.
      const background = tokens['--bg-card'];
      expect(background, `--bg-card must be opaque in ${name}`).toMatch(/^#[0-9a-f]{6}$/i);

      for (const [token, floor] of Object.entries(FLOORS)) {
        const ratio = contrast(tokens[token], background);
        expect(
          Number(ratio.toFixed(2)),
          `${name} ${token} on --bg-card is ${ratio.toFixed(2)}:1, needs ${floor}:1`,
        ).toBeGreaterThanOrEqual(floor);
      }
    });

    it(`states status legibly in ${name}`, () => {
      for (const token of ['--data-positive', '--data-negative', '--data-warning', '--data-neutral']) {
        const ratio = contrast(tokens[token], tokens['--bg-card']);
        expect(
          Number(ratio.toFixed(2)),
          `${name} ${token} is ${ratio.toFixed(2)}:1 on a card`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`draws every chart series above the non-text floor in ${name}`, () => {
      // WCAG 2.2 SC 1.4.11: a graphical object needed to understand the
      // content needs 3:1. A chart line is the content.
      for (const token of ['--series-lv', '--series-ee', '--series-lt', '--series-fi', '--series-default']) {
        const ratio = contrast(tokens[token], tokens['--bg-card']);
        expect(
          Number(ratio.toFixed(2)),
          `${name} ${token} is ${ratio.toFixed(2)}:1 on a card`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it(`makes the focus ring visible on every surface in ${name}`, () => {
      // SC 2.4.13 asks for a 3:1 change of contrast between the focused and
      // unfocused states. A ring that clears 3:1 against the surface it is
      // drawn on satisfies that however the component is coloured.
      for (const surface of ['--bg-page', '--bg-card', '--bg-raised']) {
        const ratio = contrast(tokens['--focus-ring'], tokens[surface]);
        expect(
          Number(ratio.toFixed(2)),
          `${name} focus ring on ${surface} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it(`steps its surfaces apart in ${name}`, () => {
      // Carbon: "in the dark themes, layers become one step lighter with each
      // added layer". The card used to composite to 1.06:1 against the page
      // inside a border at 1.10:1, so a card was delimited by two boundaries
      // that were between them very nearly invisible.
      const step = contrast(tokens['--bg-card'], tokens['--bg-page']);
      expect(Number(step.toFixed(3)), `${name} page → card is ${step.toFixed(3)}:1`).toBeGreaterThanOrEqual(1.05);

      const raised = contrast(tokens['--bg-raised'], tokens['--bg-card']);
      expect(Number(raised.toFixed(3)), `${name} card → raised is ${raised.toFixed(3)}:1`).toBeGreaterThanOrEqual(1.05);

      const border = contrast(tokens['--border-card'], tokens['--bg-card']);
      expect(Number(border.toFixed(3)), `${name} card border is ${border.toFixed(3)}:1`).toBeGreaterThanOrEqual(1.25);
    });

    it(`never uses pure black or pure white as a surface in ${name}`, () => {
      // Apple, Carbon, Fluent and Material all agree: pure black produces halo
      // artefacts at edges. White is allowed as a light-theme card, which is
      // what paper is.
      expect(tokens['--bg-page'].toLowerCase()).not.toBe('#000000');
      expect(tokens['--bg-page'].toLowerCase()).not.toBe('#ffffff');
      if (name === 'dark') {
        expect(tokens['--text-primary'].toLowerCase()).not.toBe('#ffffff');
      }
    });
  }
});

// ─── focus and motion ──────────────────────────────────────────────────────

describe('focus', () => {
  it('is applied once, globally, rather than per component', () => {
    // Sixteen newsroom components carried a `news-focus` class and not one
    // dashboard component had any focus style. Every indicator card is a
    // <button>, so /data was unusable by keyboard.
    const rule = css.match(/^:focus-visible\s*\{([\s\S]*?)\}/m);
    expect(rule, 'no global :focus-visible rule').not.toBeNull();

    const width = rule![1].match(/outline:\s*(\d+)px/);
    expect(width, 'the focus outline has no px width').not.toBeNull();
    expect(Number(width![1]), 'SC 2.4.13 wants a 2px perimeter').toBeGreaterThanOrEqual(2);
    expect(rule![1]).toMatch(/outline-offset/);
  });

  it('is never removed without a replacement', () => {
    const offenders: string[] = [];

    for (const { file, text } of components()) {
      for (const [line] of text.matchAll(/^.*(?:outline-none|outline:\s*none|focus:outline-none).*$/gm)) {
        if (!/outline|ring|focus-visible/.test(line.replace(/outline-none|outline:\s*none/g, ''))) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no longer relies on the per-component opt-in class', () => {
    for (const { file, text } of components()) {
      expect(text, `${file} still uses news-focus`).not.toMatch(/\bnews-focus\b/);
    }
  });
});

describe('motion', () => {
  it('names durations and easing curves', () => {
    for (const token of ['--motion-fast', '--motion-base', '--motion-slow']) {
      expect(DARK[token], `${token} is missing`).toMatch(/^\d+ms$/);
    }
    for (const token of ['--ease-standard', '--ease-entrance', '--ease-exit']) {
      expect(DARK[token], `${token} is missing`).toMatch(/^cubic-bezier\(/);
    }
  });

  it('honours prefers-reduced-motion', () => {
    // Nothing on this site honoured it, including a ticker that looped
    // forever — the precise case the setting exists for.
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(block, 'no prefers-reduced-motion block').not.toBeNull();
    expect(block![1]).toMatch(/animation-duration/);
    expect(block![1]).toMatch(/transition-duration/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ticker-track/);
  });

  it('never animates every property at once', () => {
    // `transition-all` animates layout and paint properties nothing asked it
    // to, and is the usual cause of a card that shudders on hover.
    const offenders: string[] = [];

    for (const { file, text } of components()) {
      if (/\btransition-all\b/.test(text)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});

// ─── data visualisation ────────────────────────────────────────────────────

describe('charts', () => {
  it('never interpolate across missing data', () => {
    // Carbon: "never interpolate between periods when data is unavailable".
    // `connectNulls` draws a straight line across a gap, inventing readings
    // that were never published — which on a site whose entire claim is
    // traceability is the one thing a chart may not do.
    const offenders: string[] = [];

    for (const { file, text } of components()) {
      if (/\bconnectNulls\b/.test(text)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it('take their colours from the theme, not from a literal', () => {
    // `#1e293b` was hardcoded as a gridline in three chart components while
    // `chartColors.grid` sat unused two lines away, so the light theme drew
    // near-black gridlines on white.
    //
    // Two files are exempt and both are deliberate: ThemeContext *is* the
    // palette, and CorrespondentAvatar is a self-contained SVG mark that has
    // to render correctly if it is ever exported away from the page.
    const exempt = new Set(['ThemeContext.tsx', 'CorrespondentAvatar.tsx']);
    const offenders: string[] = [];

    for (const { file, text } of components()) {
      if (exempt.has(file)) continue;
      for (const [line] of text.matchAll(/^.*#[0-9a-fA-F]{6}\b.*$/gm)) {
        // A fallback inside var() is the one legitimate literal: it is what
        // renders if the stylesheet itself failed to load.
        if (/var\(--[a-z-]+,\s*#[0-9a-fA-F]{6}\)/.test(line)) continue;
        offenders.push(`${file}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keep the JS palette and the CSS tokens in step', () => {
    // Recharts writes colours into SVG presentation attributes, where jsdom
    // will not resolve `var()`, so the chart palette has to exist as literals
    // in ThemeContext. That is a second copy, and a second copy drifts unless
    // something compares them.
    const theme = readFileSync(resolve('src/ThemeContext.tsx'), 'utf8');

    function literalsIn(constant: string): Record<string, string> {
      const block = theme.match(new RegExp(`const ${constant}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
      expect(block, `${constant} not found`).not.toBeNull();
      return Object.fromEntries(
        [...block![1].matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/gi)].map(([, key, value]) => [key, value]),
      );
    }

    const pairs: [string, string][] = [
      ['grid', '--chart-grid'],
      ['axis', '--chart-axis'],
      ['tooltipBg', '--chart-tooltip-bg'],
      ['tooltipBorder', '--chart-tooltip-border'],
      ['seriesDefault', '--series-default'],
      ['reference', '--chart-reference'],
      ['LV', '--series-lv'],
      ['EE', '--series-ee'],
      ['LT', '--series-lt'],
      ['FI', '--series-fi'],
    ];

    for (const [constant, tokens] of [
      ['DARK_CHART', DARK],
      ['LIGHT_CHART', LIGHT],
    ] as const) {
      const literals = literalsIn(constant);
      for (const [key, token] of pairs) {
        expect(
          literals[key]?.toLowerCase(),
          `${constant}.${key} should equal ${token}`,
        ).toBe(tokens[token]?.toLowerCase());
      }
    }
  });
});

// ─── the country palette ───────────────────────────────────────────────────

/** CIE L*a*b*, for perceptual distance rather than luminance ratio. */
function toLab(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => Number.parseInt(clean.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Brettel/Viénot deuteranopia simulation — the common form, ~8% of men. */
function deuteranope(hex: string): string {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => Number.parseInt(clean.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

  const l = 17.8824 * r + 43.5161 * g + 4.11935 * b;
  const s = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
  // The M cone is the one deuteranopia lacks, so it is reconstructed from L
  // and S rather than measured — which is the whole of the simulation.
  const m2 = 0.494207 * l + 1.24827 * s;

  const out = [
    0.080944 * l - 0.130504 * m2 + 0.116721 * s,
    -0.0102485 * l + 0.0540194 * m2 - 0.113615 * s,
    -0.000365294 * l - 0.00412163 * m2 + 0.693513 * s,
  ].map((v) => {
    const clamped = Math.max(0, Math.min(1, v));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255)
      .toString(16)
      .padStart(2, '0');
  });

  return `#${out.join('')}`;
}

describe('the country palette', () => {
  // Roughly 25 is the threshold below which two colours are reported as the
  // same; the raw flag values were nowhere near passing this.
  const CONFUSION = 25;

  for (const { name, tokens } of THEMES) {
    it(`separates Latvia, Estonia and Lithuania in ${name}, including for a deuteranope`, () => {
      const lv = tokens['--series-lv'];
      const ee = tokens['--series-ee'];
      const lt = tokens['--series-lt'];

      for (const [a, b, labelA, labelB] of [
        [lv, ee, 'LV', 'EE'],
        [ee, lt, 'EE', 'LT'],
        [lv, lt, 'LV', 'LT'],
      ] as const) {
        const simulated = deltaE(deuteranope(a), deuteranope(b));
        expect(
          Number(simulated.toFixed(0)),
          `${name} ${labelA}/${labelB} is ΔE ${simulated.toFixed(0)} under deuteranopia`,
        ).toBeGreaterThan(CONFUSION);
      }
    });

    it(`keeps Latvia distinct from "declining" in ${name}`, () => {
      // Latvia's flag is carmine and `--data-negative` is red. At the first
      // attempt they measured ΔE 8.6 — the same colour — so red would have
      // meant both "Latvia" and "falling" on one screen, which is the
      // three-meanings defect this design pass exists to remove.
      const separation = deltaE(tokens['--series-lv'], tokens['--data-negative']);
      expect(
        Number(separation.toFixed(1)),
        `${name} --series-lv vs --data-negative is ΔE ${separation.toFixed(1)}`,
      ).toBeGreaterThan(12);
    });

    it(`keeps Finland off Estonia's blue in ${name}`, () => {
      // Finland's flag is blue, which is Estonia's, and the two collide at
      // ΔE 3 under deuteranopia. Finland is a bidding zone, never one of the
      // three Baltic states, so it takes a non-flag hue.
      const simulated = deltaE(deuteranope(tokens['--series-fi']), deuteranope(tokens['--series-ee']));
      expect(
        Number(simulated.toFixed(0)),
        `${name} FI/EE is ΔE ${simulated.toFixed(0)} under deuteranopia`,
      ).toBeGreaterThan(CONFUSION);
    });
  }

  it('gives every series a second, non-colour encoding', () => {
    // Between-series *luminance* contrast is 1.19–1.76:1, well under the 3:1
    // at which WCAG 2.2's note on SC 1.4.1 lets lightness count as a second
    // distinction. So hue is the only other channel, and hue alone is exactly
    // what the criterion forbids. The stroke pattern is the second channel.
    const chart = components().find((c) => c.file === 'BalticCompareChart.tsx')!.text;

    expect(chart, 'every non-default series needs a dash pattern').toMatch(/dash:\s*'[\d\s]+'/);
    expect(chart, 'the dash must actually reach the line').toMatch(/strokeDasharray=\{/);
  });
});

// ─── operability ───────────────────────────────────────────────────────────

describe('operability', () => {
  it('gives controls a real touch target', () => {
    // Measured across the dashboard, 43 of 43 interactive elements were under
    // 44px, with the country and range chips at 26px tall. WCAG 2.2 SC 2.5.8
    // asks 24px; Apple's HIG and Material both ask 44px.
    const rule = css.match(/min-height:\s*([\d.]+)rem;/);
    expect(rule, 'no minimum target size is set anywhere').not.toBeNull();
    expect(Number(rule![1]) * 16).toBeGreaterThanOrEqual(44);
    expect(css, 'the rule must reach buttons').toMatch(/button,[\s\S]{0,400}min-height/);
  });

  it('sends "back to the dashboard" to the dashboard', () => {
    // `navigate('/')` is the news feed. This broke the one journey the product
    // is built around: article → "check it yourself" → /indicator/:id → back.
    for (const file of ['IndicatorPage.tsx', 'ApiDocsPage.tsx']) {
      const text = components().find((c) => c.file === file)!.text;
      expect(text, `${file} sends the reader to the news feed`).not.toMatch(/navigate\('\/'\)/);
    }
  });

  it('describes every chart to a screen reader', () => {
    // Recharts draws SVG with no role, title, desc or table alternative, so
    // the core content of a data product was simply absent.
    for (const file of ['IndicatorCard.tsx', 'BalticCompareChart.tsx']) {
      const text = components().find((c) => c.file === file)!.text;
      expect(text, `${file} chart needs role="img"`).toMatch(/role="img"/);
      expect(text, `${file} chart needs a described label`).toMatch(
        /aria-label=\{describe(?:Series|Comparison)\(/,
      );
    }
  });

  it('does not announce the decorative ticker twice', () => {
    // It duplicates its item list so the marquee loops seamlessly, so every
    // value was read out twice. Every figure in it also appears, in context
    // and with a source, in the tiles below.
    const ticker = components().find((c) => c.file === 'DataTicker.tsx')!.text;
    expect(ticker).toMatch(/aria-hidden="true"/);
  });
});

// ─── editorial honesty ─────────────────────────────────────────────────────

describe('direction is not sentiment', () => {
  it('routes every delta colour through the polarity module', () => {
    // Colour follows direction — green up, red down — because that is what a
    // reader scanning for momentum expects. But it must go through the
    // polarity module, because twelve series are worse when they rise and
    // colouring those by raw direction renders rising unemployment green.
    const surfaces = ['IndicatorCard.tsx', 'IndicatorTable.tsx'];

    for (const file of surfaces) {
      const text = components().find((component) => component.file === file)?.text;
      expect(text, `${file} not found`).toBeDefined();
      expect(text, `${file} must ask the polarity module what a change means`).toMatch(
        /sentimentOf\(/,
      );
      expect(text, `${file} must not hardcode a sentiment class`).not.toMatch(
        /text-(?:emerald|red|green)-\d{3}/,
      );
    }
  });

  it('colours a series by meaning, never by raw direction', () => {
    // The sparkline is sentiment-coloured again, which the product asked for —
    // but through `sentimentOf`, so it flips on a `lower-better` series rather
    // than drawing a decade of falling unemployment in red.
    for (const file of ['IndicatorCard.tsx', 'IndicatorTable.tsx']) {
      const text = components().find((component) => component.file === file)!.text;
      expect(text, `${file} series colour`).toMatch(/chartColors\.(?:positive|negative)/);
      expect(text, `${file} must not key a series off the sign of the change`).not.toMatch(
        /(?:isUp|isPositiveChange|isRise)\s*\?\s*chartColors/,
      );
    }
  });

  it('defaults an unknown indicator to neutral polarity', async () => {
    const { polarityOf } = await import('../src/utils/polarity');

    expect(polarityOf('something-nobody-has-classified')).toBe('neutral');
    expect(polarityOf('house_prices')).toBe('neutral');
    expect(polarityOf('population')).toBe('neutral');
  });

  it('colours a neutral indicator by direction', async () => {
    const { sentimentOf } = await import('../src/utils/polarity');

    // Green means "went up", not "good". The arrow and the sign say the same
    // thing, so nothing is claimed that the numbers do not support.
    expect(sentimentOf('house_prices', 5)).toBe('positive');
    expect(sentimentOf('population', -1000)).toBe('negative');
  });

  it('flips the twelve series where a rise is unambiguously bad', async () => {
    const { sentimentOf, polarityOf } = await import('../src/utils/polarity');

    const worseWhenRising = [
      'unemployment',
      'cpi',
      'inflation',
      'core_inflation',
      'food_inflation',
      'energy_inflation',
      'services_inflation',
      'goods_inflation',
      'ppi',
      'gov_debt',
      'energy_price_gas',
      'bankruptcies',
    ];

    for (const id of worseWhenRising) {
      expect(polarityOf(id), `${id} polarity`).toBe('lower-better');
      expect(sentimentOf(id, 1), `${id} rising`).toBe('negative');
      expect(sentimentOf(id, -1), `${id} falling`).toBe('positive');
    }

    // And the ordinary direction on everything else.
    expect(sentimentOf('gdp', 1.2)).toBe('positive');
    expect(sentimentOf('gdp', -1.2)).toBe('negative');
  });

  it('treats an unchanged series as neither', async () => {
    const { sentimentOf } = await import('../src/utils/polarity');

    expect(sentimentOf('gdp', 0)).toBe('none');
    expect(sentimentOf('gdp', null)).toBe('none');
  });

  it('never lets colour be the only thing carrying the direction', async () => {
    // `--data-positive` and `--data-negative` are red and green, which measure
    // ΔE 8 apart under a deuteranopia simulation — indistinguishable for
    // roughly 8% of men. The arrow, the sign and the spoken description are
    // what actually carry it (WCAG 2.2 SC 1.4.1).
    const { changeDescription, signed } = await import('../src/utils/polarity');

    expect(changeDescription('unemployment', 0.3)).toContain('up');
    expect(changeDescription('unemployment', 0.3)).toContain('unfavourable');
    expect(changeDescription('house_prices', 0.4)).toBe('up');
    expect(signed('1.2', -1.2)).toBe('\u22121.2');

    for (const file of ['IndicatorCard.tsx', 'IndicatorTable.tsx']) {
      const text = components().find((component) => component.file === file)!.text;
      expect(text, `${file} needs the arrow glyphs`).toMatch(/▲/);
      expect(text, `${file} needs the arrow glyphs`).toMatch(/▼/);
      expect(text, `${file} needs a spoken description`).toMatch(/changeDescription\(/);
    }
  });

  it('signs a delta with a real minus sign', async () => {
    const { signed } = await import('../src/utils/polarity');

    // A hyphen is narrower than a digit and breaks column alignment even in a
    // tabular face, which is the twitch tabular figures exist to prevent.
    expect(signed('1.2', -1.2)).toBe('\u22121.2');
    expect(signed('1.2', 1.2)).toBe('+1.2');
    expect(signed('1.2', -1.2)).not.toContain('-');
  });
});

// ─── the book itself ───────────────────────────────────────────────────────

describe('DESIGN.md', () => {
  it('exists and covers every foundation', () => {
    const book = readFileSync(resolve('DESIGN.md'), 'utf8');

    for (const heading of ['Type', 'Spacing', 'Radius', 'Surfaces', 'Colour', 'Motion', 'Focus']) {
      expect(book, `DESIGN.md says nothing about ${heading}`).toMatch(new RegExp(heading, 'i'));
    }
  });
});
