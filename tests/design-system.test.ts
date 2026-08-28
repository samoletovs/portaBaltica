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

// ─── the compatibility layer ───────────────────────────────────────────────

/**
 * The colour a Tailwind utility class actually resolves to, once the
 * compatibility layer at the bottom of index.css has had its say.
 *
 * That layer exists because ~224 hardcoded Tailwind colour classes are still
 * scattered through the dashboard components, and it remaps each one onto a
 * theme token with `!important`. The tests above could not see any of it: they
 * read the token block and stopped, so a token could be correct while the rule
 * that was supposed to use it hardcoded something else. That is exactly what
 * happened — `.text-emerald-400` was pinned to #059669 (3.77:1) and both amber
 * classes to #d97706 (3.19:1) while `--data-positive` and `--data-warning` sat
 * two hundred lines above at 5.48:1 and 4.92:1, correct and unused.
 */
function overriddenColour(className: string, tokens: Record<string, string>, theme: 'dark' | 'light'): string | null {
  // Tailwind escapes the slash in an opacity modifier, so `text-amber-400/80`
  // is written `.text-amber-400\/80` in the stylesheet. Put the CSS escape in
  // first, then escape the result for the regex.
  const escaped = className.replace(/\//g, '\\/').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  // Both the unconditional rules and the [data-theme="light"] ones, in source
  // order, so the last matching declaration wins exactly as the cascade does.
  const rule = new RegExp(
    String.raw`(^|,)\s*(\[data-theme="light"\]\s+)?\.${escaped}\s*(,[^{]*)?\{([^}]*)\}`,
    'gm',
  );
  let resolved: string | null = null;
  for (const match of css.matchAll(rule)) {
    if (match[2] && theme !== 'light') continue;
    const declaration = match[4].match(/(?:^|;)\s*color:\s*([^;!]+)/);
    if (!declaration) continue;
    const value = declaration[1].trim();
    const variable = value.match(/^var\((--[a-z0-9-]+)\)$/);
    resolved = variable ? tokens[variable[1]] ?? null : value;
  }
  return resolved;
}

describe('the named colour utilities', () => {
  // The three classes that carry *status* meaning as text. These are text, so
  // SC 1.4.3 governs them at 4.5:1 — not the 3:1 that governs a chart line,
  // which is exactly the confusion the old literals encoded when
  // `.text-emerald-400` was pinned to #059669 at 3.77:1.
  //
  // They used to be Tailwind classes rescued by an `!important` override, and
  // this suite could only reach them by resolving the cascade. They are
  // declared now, which is the point of naming them: a declared rule is
  // measurable, an absent one is not.
  const STATUS_TEXT = ['dash-positive', 'dash-negative', 'dash-warning'];
  const TEXT_RAMP: Record<string, number> = {
    'dash-fg': 12,
    'dash-body': 10,
    'dash-muted': 7,
    'dash-subtle': 4.5,
  };

  for (const { name, tokens } of THEMES) {
    it(`states status legibly in ${name}`, () => {
      for (const className of STATUS_TEXT) {
        const resolved = overriddenColour(className, tokens, name);
        expect(resolved, `.${className} resolves to nothing in ${name}`).toMatch(/^#[0-9a-f]{6}$/i);

        const ratio = contrast(resolved!, tokens['--bg-card']);
        expect(
          Number(ratio.toFixed(2)),
          `${name} .${className} resolves to ${resolved} — ${ratio.toFixed(2)}:1 on a card, needs 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`states status legibly on its own tint in ${name}`, () => {
      // A badge and a stale-data notice put `--data-warning` text on a
      // warning-coloured background, so the floor has to be measured against
      // *that* background rather than against the card.
      //
      // This exists because deriving the tint with
      // `color-mix(--data-warning, --bg-card)` passes in dark and fails in
      // light: there `--data-warning` is a dark amber, so mixing it into a
      // white card darkens the ground and drags the text down with it —
      // 4.21:1 at 12%, 4.32:1 at 10%, and 6% is the most that clears the floor
      // while being too faint to see. The tint is a value per theme, not a
      // formula, and this measures the value.
      const tint = tokens['--tint-warning'];
      expect(tint, `--tint-warning missing in ${name}`).toMatch(/^#[0-9a-f]{6}$/i);

      const ratio = contrast(tokens['--data-warning'], tint);
      expect(
        Number(ratio.toFixed(2)),
        `${name} --data-warning on --tint-warning is ${ratio.toFixed(2)}:1, needs 4.5:1`,
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`clears every text floor through the class a component writes in ${name}`, () => {
      // The same floors §1.5 gives the tokens, asserted through the class the
      // components actually use. A utility wired to the wrong token would pass
      // every token test and fail here.
      for (const [className, floor] of Object.entries(TEXT_RAMP)) {
        const resolved = overriddenColour(className, tokens, name);
        expect(resolved, `.${className} resolves to nothing in ${name}`).toMatch(/^#[0-9a-f]{6}$/i);

        const ratio = contrast(resolved!, tokens['--bg-card']);
        expect(
          Number(ratio.toFixed(2)),
          `${name} .${className} is ${ratio.toFixed(2)}:1 on a card, needs ${floor}:1`,
        ).toBeGreaterThanOrEqual(floor);
      }
    });
  }

  it('leaves no status colour class uncovered', () => {
    // The historical failure: a literal had to be restated once per theme per
    // class, so a class nobody remembered kept its raw Tailwind value and
    // rendered a dark-theme colour on white. Four did — `text-amber-300`,
    // `text-amber-400/80`, `text-green-400` and `text-orange-400`.
    //
    // Named classes remove the category rather than patch it, so this asserts
    // the absence: no component writes a raw status colour at all.
    const used = new Set<string>();
    for (const { text } of components()) {
      for (const match of text.matchAll(
        /\btext-(?:emerald|green|red|rose|orange|amber|yellow|teal|cyan)-\d{3}(?:\/\d+)?\b/g,
      )) {
        used.add(match[0]);
      }
    }

    expect([...used], 'use dash-positive / dash-negative / dash-warning').toEqual([]);
  });

  it('routes status colour through the tokens rather than a second set of hexes', () => {
    // One source of truth. A literal is a value that can drift from the token
    // it was copied from, and silently did: `.text-emerald-400` was pinned to
    // #059669 while `--data-positive` sat correct and unused two hundred lines
    // above it.
    for (const [utility, token] of [
      ['dash-positive', '--data-positive'],
      ['dash-negative', '--data-negative'],
      ['dash-warning', '--data-warning'],
    ]) {
      expect(css, `.${utility} must reference ${token}`).toMatch(
        new RegExp(String.raw`\.${utility}\s*\{\s*color:\s*var\(${token}\)\s*;?\s*\}`),
      );
    }
  });

  it('never asks Tailwind for a variant of a class Tailwind does not own', () => {
    // Tailwind generates `disabled:bg-slate-800` because it owns
    // `bg-slate-800`. It cannot generate `disabled:dash-raised`, because
    // `dash-raised` is hand-written in index.css and Tailwind has never heard
    // of it -- so the rule is simply never emitted. Nothing warns. The class
    // sits in the markup looking load-bearing and does nothing.
    //
    // That is how the beneficial-owner search button came to render
    // identically enabled and disabled: `disabled:dash-raised` was silently
    // inert, so the only background left was the resting one.
    //
    // A control's states belong in CSS beside the control -- `.dash-btn:disabled`
    // -- where they are a rule that either exists or does not.
    const declared = new Set(
      [...css.matchAll(/^\s*\.([a-z][a-z0-9-]*)(?=[\s,:{])/gm)].map((m) => m[1]),
    );
    // Only project-owned names can be wrong this way; a Tailwind utility of the
    // same shape is fine.
    const owned = [...declared].filter((c) => /^(dash|news|ticker)-/.test(c));
    expect(owned.length, 'expected project-owned utilities to exist').toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const { file, text } of components()) {
      for (const m of text.matchAll(/\b([a-z-]+(?::[a-z-]+)*):([a-z][a-z0-9-]*)\b/g)) {
        if (owned.includes(m[2])) offenders.push(`${file}: ${m[0]}`);
      }
    }

    expect(offenders, 'these classes are never emitted — declare the state in CSS').toEqual([]);
  });

  it('never paints text with a token meant for a border or a gridline', () => {
    // The ticker separated its items with a `·` coloured `--border-card`, which
    // measured 1.54:1 in dark and 1.23:1 in light -- invisible in both. It was
    // also redundant: the track already puts 32px between items, so the mark
    // sat 8px from its own item and read as a trailing artefact rather than a
    // separator. It is gone.
    //
    // The general fault is using a token at a job whose contrast floor it was
    // never tuned for -- a border token has no text floor to meet, so borrowing
    // it for text cannot pass. This is the same shape as a chart-line colour
    // used for a 12px figure.
    //
    // A background token as text is the one legitimate case: knockout type on
    // an accent fill, as the error boundary's Reload button does at 8.94:1 dark
    // and 5.58:1 light. What makes it legitimate is that the element paints its
    // own ground, so the check asks for that rather than banning the token.
    const offenders: string[] = [];
    for (const { file, text } of components()) {
      // Inline styles are objects, so read one property bag at a time: knockout
      // text is legitimate, and the thing that makes it legitimate — the element
      // painting its own fill — is a sibling property, not a separate concern.
      for (const bag of text.matchAll(/style=\{\{([^}]*)\}\}/g)) {
        const decl = bag[1];
        const colour = decl.match(/(?:^|[\s,{])color:\s*['"`]var\((--[a-z0-9-]+)\)/);
        if (!colour) continue;
        const token = colour[1];
        if (/^--(border|chart-grid|scrollbar)/.test(token)) {
          offenders.push(`${file}: color uses ${token}`);
        } else if (/^--bg-/.test(token) && !/background(?:Color)?:/.test(decl)) {
          // A page or card colour as text is knockout type, which only reads
          // if the element paints its own ground. Without one it is text in
          // the colour of what is behind it.
          offenders.push(`${file}: color uses ${token} with no background of its own`);
        }
      }
    }
    expect(offenders, 'these tokens have no text contrast floor at this job').toEqual([]);
  });

  it('gives a control a state it can actually move to', () => {
    // `--bg-raised`, `--bg-card-hover` and `--bg-input` all hold the same
    // value, so a control resting on it has nowhere to go and its hover reads
    // as no change. DESIGN.md §2.2 requires the surface to move one step up.
    for (const { name, tokens } of THEMES) {
      const rest = tokens['--bg-input'];
      const hover = tokens['--bg-control-hover'];
      expect(hover, `${name}: --bg-control-hover must exist`).toBeTruthy();
      expect(hover, `${name}: hover must differ from rest`).not.toBe(rest);
    }
  });
});

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

/**
 * OKLCH, for the saturation axis.
 *
 * L*a*b* above answers "how far apart are these two colours". This answers
 * "how loud is this one", which is a different question and the one nothing was
 * asking when the previous palette was chosen.
 */
function toOklch(hex: string): { L: number; C: number; h: number } {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => Number.parseInt(clean.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C: Math.hypot(a, bb), h };
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
    // at which WCAG 2.2's note on SC 1.4.1 lets a difference in lightness count
    // as a second distinction. So hue is the only other channel, and hue alone
    // is exactly what the criterion forbids. The stroke pattern is the second
    // channel.
    const chart = components().find((c) => c.file === 'BalticCompareChart.tsx')!.text;

    expect(chart, 'every non-default series needs a dash pattern').toMatch(/dash:\s*'[\d\s]+'/);
    expect(chart, 'the dash must actually reach the line').toMatch(/strokeDasharray=\{/);
  });

  it('keeps that second encoding when a reader turns the dashes off', () => {
    // The stroke style is a reader preference now, and a preference that can
    // remove the only non-colour distinction is a preference that turns off
    // SC 1.4.1. So `plain` has to supply its own: a distinct shape at the end
    // of each line.
    //
    // This is the check that stops the setting decaying into
    // `strokeDasharray={undefined}` and nothing else, which is what it would
    // have been if the marker were left as a nicety rather than a requirement.
    const chart = components().find((c) => c.file === 'BalticCompareChart.tsx')!.text;

    // Anchored on the trailing comma so this reads the three data entries and
    // not the `marker: 'circle' | 'square' | 'triangle'` in the type above them.
    const markers = [...chart.matchAll(/marker:\s*'(circle|square|triangle)',/g)].map((m) => m[1]);
    expect(markers.length, 'every country needs an end-of-line marker shape').toBe(3);
    expect(new Set(markers).size, `the three markers must differ, got ${markers.join(', ')}`).toBe(3);

    expect(chart, 'the marker must be drawn when the dash is off').toMatch(/strokeStyle === 'plain'/);
    expect(chart, 'the dash must be conditional, not deleted').toMatch(
      /strokeDasharray=\{strokeStyle === 'patterned'/,
    );
  });

  it('draws dashes that read as a line rather than as a row of dots', () => {
    // Lithuania was `2 4` — two on, four off. At a 2px stroke that is not a
    // dashed line, it is a dot every six pixels, and over a dense multi-year
    // series a reader sees texture rather than a series. The power chart had
    // the same `2 3`, plus an `8 2 2 2` that read as morse.
    //
    // The redundant encoding stays; it is the only thing separating these
    // series for a deuteranope. It just has to be quiet enough to read as a
    // line first. A mark at least 6px long, and never shorter than the gap
    // that follows it, is the difference.
    const offenders: string[] = [];

    for (const { file, text } of components()) {
      for (const match of text.matchAll(/(?:dash|[a-z]{2}):\s*'([\d\s]+)'/g)) {
        const steps = match[1].trim().split(/\s+/).map(Number);
        for (let i = 0; i < steps.length; i += 2) {
          const mark = steps[i];
          const gap = steps[i + 1] ?? 0;
          if (mark < 6) offenders.push(`${file}: '${match[1]}' has a ${mark}px mark`);
          else if (gap > mark) offenders.push(`${file}: '${match[1]}' has a gap longer than its mark`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  for (const { name, tokens } of THEMES) {
    it(`draws the Baltic series as light, not as ink, in ${name}`, () => {
      // 3:1 is the floor SC 1.4.11 sets for a graphical object, and the first
      // light palette treated it as a target: #a4262c, #0057a8 and #b4700a all
      // landed near 7:1, which is AAA *text* contrast applied to a line. The
      // charts read as dark and muddy and the gold read as brown, and readers
      // said so.
      //
      // Contrast cannot express that, because in a dark theme "brighter" means
      // *more* contrast and in a light theme it means less. Lightness can. L*
      // 45 is the floor in both themes; the old light palette sat at 37.
      //
      // Finland is exempt: it is a bidding zone rather than a Baltic state,
      // and it has to stay clear of Estonia's blue under deuteranopia, which
      // costs it the freedom to be light.
      for (const token of ['--series-lv', '--series-ee', '--series-lt']) {
        const lightness = toLab(tokens[token])[0];
        expect(
          Number(lightness.toFixed(1)),
          `${name} ${token} is ${tokens[token]} at L* ${lightness.toFixed(1)} — too dark to read as a line`,
        ).toBeGreaterThanOrEqual(45);
      }
    });

    it(`keeps a chart line from being the link colour in ${name}`, () => {
      // DESIGN.md §1.5 reserves the accent for links, the active navigation
      // indicator and the primary call to action, and says it is deliberately
      // not a chart colour. In light it was `--series-default` byte for byte.
      expect(
        tokens['--series-default'].toLowerCase(),
        `${name} --series-default is the accent, so a chart line looks like a link`,
      ).not.toBe(tokens['--news-accent'].toLowerCase());
    });

    it(`does not draw the Baltic series at the edge of the gamut in ${name}`, () => {
      // The axis that was missing, and the reason the palette had to be redone.
      //
      // The previous values were optimised for lightness (L* >= 45, so the
      // charts do not read as muddy) and for separation under deuteranopia.
      // Nothing in that objective pushed back on *saturation*, so the optimiser
      // took all of it: measured against the maximum chroma sRGB can produce at
      // each hue and lightness, the old palette sat at LV 80%, EE 93%, LT 99%
      // in light and EE 100% — the gamut boundary exactly — in dark.
      //
      // Contrast cannot express that and neither can ΔE: a maximally saturated
      // colour passes both happily. Readers reported the charts as painful,
      // which is a real property of a high-chroma line on a bright ground —
      // Datawrapper's "avoid bright, saturated colors" and the Bartram/Patra/
      // Stone CHI 2017 work on affective colour say the same thing.
      //
      // The ceiling is 0.16, comfortably above where these sit (0.10 light,
      // 0.14 dark) and comfortably below where the old ones did (0.20). It is a
      // ratchet against the next well-meaning "make it pop", not a target.
      for (const token of ['--series-lv', '--series-ee', '--series-lt', '--series-fi']) {
        const { C } = toOklch(tokens[token]);
        expect(
          Number(C.toFixed(3)),
          `${name} ${token} is ${tokens[token]} at OKLCH chroma ${C.toFixed(3)} — too saturated for a chart line`,
        ).toBeLessThanOrEqual(0.16);
      }
    });
  }
});

// ─── operability ───────────────────────────────────────────────────────────

/**
 * Chart components deliberately left without an accessible name, and why.
 *
 * **Empty, and the equality is what emptied it.** It carried one entry —
 * `IndicatorTable.tsx`, eight 24px sparklines — deferred because another
 * workstream was changing that file and the right answer depended on what its
 * rows ended up saying. They now say everything: read out of Chromium's
 * accessibility tree, one row announces *"GDP Growth Rate % QoQ 0.6% Q1 2026
 * 0.7% ▼ −0.1% down, which is unfavourable for this indicator"* — name, unit,
 * value, its period, previous, change and the spoken polarity. So the
 * sparkline is decorative and is hidden, which the check below accepts as a
 * complete answer rather than as an exception.
 *
 * Written as an equality rather than a filter, this went red the moment the
 * file was fixed and forced this comment to be rewritten. A filter would still
 * be excusing a component that no longer needs it.
 */
const EXCLUDED_FROM_CHART_DESCRIPTION: string[] = [];

/**
 * Chart components whose surface is still an unnamed `role="application"`.
 *
 * Recharts 3 turns `accessibilityLayer` on by default, giving every chart
 * `role="application"` and `tabIndex={0}`. Measured in Chromium against the
 * real build, `/data/economy` had **80 tab stops, 27 of them chart surfaces**,
 * every one announcing as an unnamed "application" — the heaviest role in
 * ARIA, which tells a screen reader to hand it every keystroke.
 *
 * `IndicatorTable` is fixed and absent from this list. The rest are named here
 * rather than filtered out, because they are in files this pass did not own.
 * `tests/chartKeyboard.test.tsx` proves the two remedies against the library
 * rather than describing them: a chart may pass `role="img"` and `aria-label`
 * to name its surface in place, or `accessibilityLayer={false}` to leave the
 * tab order entirely.
 */
const CHARTS_WITH_UNNAMED_APPLICATION_LAYER = [
  'BalticCompareChart.tsx',
  'EconomyTile.tsx',
  'GridStatePanel.tsx',
  'IndicatorCard.tsx',
  'PowerMarketCard.tsx',
];

/**
 * The markup between a chart's enclosing `<div` and the chart itself — which
 * is that div's opening tag, comments and all.
 *
 * Chart checks need to know whether *this* chart is hidden, not whether the
 * file contains an `aria-hidden` anywhere. A file-scoped regex conflates them,
 * and a planted fault proved it: removing `aria-hidden` from
 * `IndicatorTable`'s sparkline left the guard green, because the same file
 * carries an unrelated `aria-hidden` span reading "↓ better".
 *
 * The first attempt at this scanned forward for the tag's closing `>`,
 * tracking brace and quote depth. It returned an empty string for
 * `PowerMarketCard` — every apostrophe in a JSX comment ("tomorrow's final
 * slot") opened quote mode and swallowed the rest of the file. Taking the
 * slice *up to* the chart needs no scanner at all and so cannot have that
 * class of bug; comments are stripped afterwards so that prose mentioning an
 * attribute cannot satisfy a check about one.
 */
function chartContext(text: string, index: number): string {
  const start = text.slice(0, index).lastIndexOf('<div');
  if (start === -1) return '';
  return text
    .slice(start, index)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** Every chart in a file, as `{ enclosing markup, the chart element's own props }`. */
function chartsIn(text: string): { enclosing: string; element: string }[] {
  const found: { enclosing: string; element: string }[] = [];
  for (const match of text.matchAll(/<ResponsiveContainer\b/g)) {
    const index = match.index!;
    // The chart element recharts renders into, which is where
    // `accessibilityLayer` and an in-place `role` are written.
    const after = text.slice(index, index + 600);
    const element =
      after.match(/<(?:Area|Line|Bar|Composed|Pie|Radar|Scatter|Radial)[A-Za-z]*Chart\b[\s\S]{0,300}?>/)?.[0] ?? '';
    found.push({ enclosing: chartContext(text, index), element });
  }
  return found;
}

describe('operability', () => {
  it('leaves no chart surface an unnamed application', () => {
    // The equality is the point. `expect(offenders.filter(notKnown)).toEqual([])`
    // passes today and goes on passing forever once a component is fixed,
    // matching nothing and reporting success — so a fix would never prune the
    // list. This way the list cannot outlive the defect it records.
    const offenders = components()
      .filter(({ text }) => /<ResponsiveContainer\b/.test(text))
      .filter(({ text }) => !/accessibilityLayer=\{false\}/.test(text))
      // Naming the surface in place also settles it: the role stops being
      // `application` because recharts prefers an explicit `role` prop.
      .filter(({ text }) => !/<(?:Area|Line|Bar|Composed|Pie|Radar|Scatter)Chart[^>]*\brole="img"/.test(text))
      .map(({ file }) => file);

    expect(offenders.sort(), 'a chart that is a focusable unnamed application')
      .toEqual([...CHARTS_WITH_UNNAMED_APPLICATION_LAYER].sort());
  });

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
    //
    // **The population is derived, and this is the fourth instance of that
    // lesson in this repo.** This assertion named two files by hand:
    // `IndicatorCard` and `BalticCompareChart`. Both were correct, and both
    // stayed correct while four more components learned to draw a chart —
    // measured in Chromium on `/data`, 78 recharts surfaces render and **10
    // announce as anonymous graphics**. A list of two went stale in silence;
    // a list of six would go stale the same way. So the set is read from the
    // source, and `AGENTS.md`'s rule applies: the set the guard walks and the
    // set the behaviour walks must be the same set, which is only guaranteed
    // when there is one of them.
    //
    // `ResponsiveContainer` is the marker because it is what recharts requires
    // to draw into a sized box — every chart on this site has one, and nothing
    // that is not a chart does. The count assertion below is the control: if
    // the marker ever stops identifying charts, this fails loudly rather than
    // passing over an empty set, which is the failure mode the whole rule is
    // about.
    const charts = components().filter(({ text }) => /<ResponsiveContainer\b/.test(text));

    expect(
      charts.length,
      'no chart components found — the derivation is broken, and an empty set passes everything',
    ).toBeGreaterThanOrEqual(5);

    // A chart may satisfy this in one of three ways, and the distinctions are
    // the point rather than a convenience:
    //
    //   * `describeSeries` / `describeComparison` — one vocabulary, from
    //     `chartAccessibility.ts`, for a chart whose content is a series;
    //   * a hand-written `aria-label` — for a chart whose content is not
    //     reducible to "what is plotted, over what span, from where to where".
    //     `GridStatePanel` is the live example: its point is the *gap* between
    //     generation and demand and the direction of the resulting flow, which
    //     no per-series description states.
    //   * `aria-hidden` — for a chart that is genuinely decorative, meaning
    //     the text beside it already says everything the graphic could.
    //     `IndicatorTable`'s sparklines are that: the row announces the
    //     indicator, its value, that value's period, the change and the spoken
    //     polarity, so describing the trace repeats all of it.
    //
    // What is not permitted is a fourth way: a chart that is neither named nor
    // hidden. Note that hiding is only a complete answer when the chart is
    // also out of the tab order — `aria-hidden` over a focusable node hides
    // something a keyboard can still land on, which is worse than either. The
    // application-layer check above is what enforces that half.
    const undescribed: string[] = [];
    for (const { file, text } of charts) {
      if (EXCLUDED_FROM_CHART_DESCRIPTION.includes(file)) continue;
      for (const { enclosing, element } of chartsIn(text)) {
        // Element-scoped, not file-scoped. Both halves must be true of *this*
        // chart: hidden from the tree, and out of the tab order.
        const hidden = /aria-hidden="true"/.test(enclosing);
        const unfocusable = /accessibilityLayer=\{false\}/.test(element);
        if (hidden && unfocusable) continue;

        const named = /role="img"/.test(enclosing) || /role="img"/.test(element);
        if (!named) {
          undescribed.push(`${file}: a chart that is neither named nor hidden`);
          continue;
        }
        if (!/aria-label=/.test(enclosing) && !/aria-label=/.test(element)) {
          undescribed.push(`${file}: has role="img" but no aria-label`);
        }
      }
    }

    expect(undescribed, 'a chart with no accessible name is invisible on a site made of charts')
      .toEqual([]);
  });

  it('keeps the chart exclusions honest, as an equality', () => {
    // An equality rather than a filter, so an exclusion cannot outlive its
    // reason — and this is the run where that paid. The list held
    // `IndicatorTable`, deferred because another workstream was editing the
    // file and the right answer depended on what its rows ended up saying.
    // They now say everything, the sparklines are hidden, and **this
    // assertion went red and forced the list to be emptied**. A filter would
    // still be silently excusing a component that no longer needs it.
    const charts = components()
      .filter(({ text }) => /<ResponsiveContainer\b/.test(text))
      .map(({ file }) => file);

    const stillUndescribed = charts.filter((file) => {
      const text = components().find((c) => c.file === file)!.text;
      return chartsIn(text).some(({ enclosing, element }) => {
        if (/aria-hidden="true"/.test(enclosing) && /accessibilityLayer=\{false\}/.test(element)) {
          return false;
        }
        return !/role="img"/.test(enclosing) && !/role="img"/.test(element);
      });
    });

    expect(stillUndescribed.sort(), 'an exclusion that no longer matches anything must be deleted')
      .toEqual([...EXCLUDED_FROM_CHART_DESCRIPTION].sort());
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
    const surfaces = ['IndicatorCard.tsx', 'IndicatorTable.tsx', 'DataTicker.tsx'];

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

  it('has decided about every id it colours, rather than defaulting quietly', async () => {
    // `polarityOf` answers `neutral` for anything it does not recognise, which
    // is the right default and also means a card added tomorrow with an
    // unregistered id is coloured by direction with nobody having decided
    // anything. The five abstentions are deliberate and reasoned; the way to
    // keep that true is to make the difference between a decision and an
    // omission checkable rather than a comment.
    //
    // The newsroom hit the identical shape on the same day: a parity test
    // excluded `freq` with a comment naming the field the newsroom carries it
    // in, nothing checked that field, and the exclusion read as "not
    // comparable" rather than "compared elsewhere".
    const { DELIBERATELY_NEUTRAL, polarityOf } = await import('../src/utils/polarity');

    // Every id handed to sentimentOf, gathered the way the page does it.
    const ids = new Set<string>();
    for (const { text } of components()) {
      for (const m of text.matchAll(/<IndicatorCard[^>]*\bid="([^"]+)"/g)) ids.add(m[1]);
    }
    const table = components().find((c) => c.file === 'IndicatorTable.tsx')!.text;
    const list = table.match(/const INDICATORS = \[([^\]]+)\]/);
    if (list) for (const m of list[1].matchAll(/'([^']+)'/g)) ids.add(m[1]);
    const panels = components().find((c) => c.file === 'PortPanelParts.tsx')!.text;
    for (const m of panels.matchAll(/^\s{2}\w+:\s*'([a-z_]+)',$/gm)) ids.add(m[1]);

    expect(ids.size, 'the sweep found no ids, so it is proving nothing').toBeGreaterThan(20);

    const undecided = [...ids]
      .filter((id) => polarityOf(id) === 'neutral' && !DELIBERATELY_NEUTRAL.has(id))
      .sort();

    expect(
      undecided,
      'these are coloured by direction because nobody classified them, not because ' +
        'anyone decided they were ungradable. Either give them a polarity or add them ' +
        'to DELIBERATELY_NEUTRAL with a line saying why a rise is not self-evidently ' +
        'good news.'
    ).toEqual([]);
  });

  it('keeps the deliberate list honest in the other direction too', async () => {
    // An entry here claims an id is ungradable. If it is also in POLARITY the
    // two disagree, and POLARITY silently wins.
    const { DELIBERATELY_NEUTRAL, polarityOf } = await import('../src/utils/polarity');

    const contradicted = [...DELIBERATELY_NEUTRAL].filter((id) => polarityOf(id) !== 'neutral');
    expect(contradicted, 'these are listed as ungraded and also graded').toEqual([]);
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

  it('claims a direction and never a period, because the comparison is positional', async () => {
    // Both cards compute `previous` as `values[values.length - 2]` **after**
    // filtering nulls out, so it is the second-newest *reading*, not the
    // previous *period*. By the rule the maritime side follows — a hole is
    // dangerous where the consumer indexes by position and self-limiting where
    // it addresses by label — that is the dangerous side.
    //
    // It is correct today for two independent reasons, and only one is in
    // these files: no time word is attached anywhere, and the live contiguity
    // assertion makes a hole inside the newest eight observations impossible.
    // The second lives in tests/indicators.live.test.ts and nothing links it to
    // the arrow on a card, so this pins the first — the half a well-meaning
    // copy edit can break without touching a guard.
    const { changeDescription } = await import('../src/utils/polarity');

    for (const id of ['gdp', 'unemployment', 'population', 'house_prices']) {
      for (const change of [1.5, -1.5, 0, null]) {
        const said = changeDescription(id, change);
        expect(
          said,
          `changeDescription('${id}', ${change}) said "${said}" — a positional comparison ` +
            'may not name a period, because the reading it compares against is the previous ' +
            'non-null value rather than the previous period. If a period claim is wanted, ' +
            'compute it from the two periods rather than assuming they are adjacent.'
        ).not.toMatch(/month|quarter|year|week|since|last|ago|previous/i);
      }
    }
  });

  it('explains the twelve series where the colour contradicts the arrow', async () => {
    // On a `lower-better` series a fall is drawn green, which is correct and is
    // the point of the polarity module. But put it next to a red ▼ on a card
    // that is also falling — imports and producer prices, both on the overview
    // — and colour alone cannot say whether green meant "up" or meant "good".
    // On that screen it means both.
    //
    // §3.5 used to hold that the arrow resolved this. A reader reported that it
    // does not, and they were right: a 12px glyph tinted the same colour as the
    // number beside it reads as part of one coloured token, not as a second
    // channel. So the surface says it in words.
    //
    // Note what this may not do: the note says "Lower is better" and never
    // "than last quarter", because the comparison behind it is positional. The
    // assertion above governs that, and this one has to stay compatible with
    // it — the two tests are about different things and neither may quietly
    // relax the other.
    const { polarityNote } = await import('../src/utils/polarity');

    expect(polarityNote('unemployment')).toBe('Lower is better');
    expect(polarityNote('ppi')).toBe('Lower is better');
    // Only where the colour is surprising. On `higher-better` and `neutral` a
    // rise is already green, which is what an unprimed reader assumes, so a
    // note would be noise explaining the obvious.
    expect(polarityNote('gdp')).toBeNull();
    expect(polarityNote('imports')).toBeNull();
    expect(polarityNote('nonsense_indicator')).toBeNull();

    for (const file of ['IndicatorCard.tsx', 'IndicatorTable.tsx']) {
      const text = components().find((component) => component.file === file)!.text;
      expect(text, `${file} must explain a colour that contradicts its arrow`).toMatch(
        /polarityNote\(/,
      );
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
