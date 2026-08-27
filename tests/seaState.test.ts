/**
 * The sea state band, which is the one number on this site somebody might plan
 * an afternoon around — and which has now told a reader something specific and
 * wrong twice.
 *
 * Once by labelling a **missing** wave height "Very Rough": every `<` in the
 * chain is false for `NaN`, so an absent reading fell past them all to the
 * final `return` and rendered as the most alarming state we have, in red.
 *
 * And once, for the whole life of the component, by naming every band one WMO
 * degree too high. The thresholds were right — 0.1, 0.5, 1.25 and 2.5 m are the
 * WMO sea state code boundaries exactly — so whoever wrote it had the scale to
 * hand, but the labels were assigned off by one the whole way up.
 *
 * Measured against 8928 hourly readings from the four Latvian ports over 92
 * days: 92% of observations carried a label one degree too alarming, and the
 * highest wave in the entire sample was 2.66 m against a "Very Rough" band that
 * the scale does not open until 4 m.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifySeaState, SEA_STATE_LABELS, type SeaState } from '../src/types';

/**
 * The WMO sea state code, as published.
 *
 * Written out as data rather than as assertions so the table itself is the
 * specification: a wave height, the degree it belongs to, and the name that
 * degree carries. Every row is checked at both ends of its interval.
 */
const WMO = [
  { degree: '0-1', name: 'Calm', key: 'calm', from: 0, to: 0.1 },
  { degree: '2', name: 'Smooth', key: 'smooth', from: 0.1, to: 0.5 },
  { degree: '3', name: 'Slight', key: 'slight', from: 0.5, to: 1.25 },
  { degree: '4', name: 'Moderate', key: 'moderate', from: 1.25, to: 2.5 },
  { degree: '5', name: 'Rough', key: 'rough', from: 2.5, to: 4 },
] as const;

describe('the band follows the WMO sea state code', () => {
  for (const band of WMO) {
    it(`calls ${band.from}m to ${band.to}m "${band.name}" (degree ${band.degree})`, () => {
      // Both ends of the interval: the lower bound is inclusive and the upper
      // belongs to the next band, which is where an off-by-one hides.
      expect(classifySeaState(band.from)).toBe(band.key);
      expect(classifySeaState(band.to - 0.01)).toBe(band.key);
      expect(SEA_STATE_LABELS[band.key as SeaState].label).toBe(band.name);
    });
  }

  it('does not claim a state the Baltic has never been in', () => {
    // "Very Rough" is degree 6 and opens at 4m. The old scale printed it from
    // 2.5m — a metre and a half early — so the label fired on weather the scale
    // calls Rough, and the state it named could not be reached here at all.
    const labels = Object.values(SEA_STATE_LABELS).map((l) => l.label);
    expect(labels).not.toContain('Very Rough');
    expect(classifySeaState(2.66)).toBe('rough');
  });

  it('reads the whole measured Baltic range without falling off either end', () => {
    // Min and max actually observed across 8928 hourly readings, four ports,
    // 92 days. A band table that cannot name its own data is not a band table.
    for (const h of [0, 0.05, 0.3, 0.8, 1.5, 2.66]) {
      expect(classifySeaState(h), `no band for ${h}m`).not.toBeNull();
    }
  });
});

describe('absence is not a sea state', () => {
  it('returns null rather than the last branch', () => {
    // The original defect, kept pinned. Every one of these is false against
    // every `<`, which is precisely how they used to reach "Very Rough".
    for (const absent of [Number.NaN, null, undefined, Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY, '1.2', {}, []]) {
      expect(classifySeaState(absent as never), `${String(absent)} named a state`).toBeNull();
    }
  });

  it('has no label to render, so the caller must say "unavailable"', () => {
    const state = classifySeaState(undefined);
    expect(state).toBeNull();
    // `SEA_STATE_LABELS[null]` is the lookup a careless caller would write.
    expect(SEA_STATE_LABELS[state as unknown as SeaState]).toBeUndefined();
  });
});

describe('colour and emoji agree with each other', () => {
  const bands = Object.values(SEA_STATE_LABELS);

  it('gives the two most severe bands different colours', () => {
    // The manager's ruling and the only boundary a reader would act on. This is
    // the pair the deleted compatibility layer collapsed: orange and red both
    // resolved to `--data-negative`, so Rough and Very Rough were one colour
    // while the emoji still showed two.
    expect(SEA_STATE_LABELS.moderate.token).not.toBe(SEA_STATE_LABELS.rough.token);
    expect(SEA_STATE_LABELS.moderate.emoji).not.toBe(SEA_STATE_LABELS.rough.emoji);
  });

  it('carries at least four distinguishable colours across the five bands', () => {
    expect(new Set(bands.map((b) => b.token)).size).toBeGreaterThanOrEqual(4);
  });

  it('never lets the two encodings claim different granularity', () => {
    // The root cause. Colour resolved five bands onto three tokens while the
    // emoji showed five steps, so the page contradicted itself. Whatever the
    // granularity is, both encodings must have it — and they must group the
    // *same* bands, not merely the same number of them.
    const colourGroups = new Map<string, string[]>();
    const emojiGroups = new Map<string, string[]>();
    for (const [key, band] of Object.entries(SEA_STATE_LABELS)) {
      colourGroups.set(band.token, [...(colourGroups.get(band.token) ?? []), key]);
      emojiGroups.set(band.emoji, [...(emojiGroups.get(band.emoji) ?? []), key]);
    }

    const shape = (m: Map<string, string[]>) =>
      [...m.values()].map((g) => g.slice().sort().join('+')).sort();

    expect(shape(colourGroups)).toEqual(shape(emojiGroups));
  });

  it('draws every band from a semantic token, never a literal', () => {
    // DESIGN.md: semantic colour is for status and only for status, and the
    // four tokens are the whole vocabulary.
    for (const band of bands) {
      expect(band.token, `${band.label} is not a token`)
        .toMatch(/^var\(--data-(positive|negative|warning|neutral)\)$/);
    }
  });

  it('rises monotonically in severity, so no band outranks a worse one', () => {
    // A ramp that doubles back would say a rougher sea is calmer. Ordered
    // deliberately: neutral sits between positive and warning because an
    // unremarkable sea is neither good news nor a caution.
    const rank = ['positive', 'neutral', 'warning', 'negative'];
    const severity = (['calm', 'smooth', 'slight', 'moderate', 'rough'] as const)
      .map((k) => rank.indexOf(
        SEA_STATE_LABELS[k].token.replace('var(--data-', '').replace(')', ''),
      ));
    for (const step of severity) expect(step).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < severity.length; i++) {
      expect(severity[i], 'severity ramp doubles back').toBeGreaterThanOrEqual(severity[i - 1]);
    }
  });
});

describe('the port card renders an absent reading rather than throwing', () => {
  const source = readFileSync(resolve('src/components/PortCard.tsx'), 'utf8');

  it('never calls .toFixed() straight on a payload value', () => {
    // `classifySeaState` guards the wave height and the card then called
    // `.toFixed(1)` on that same value one line later — so a payload it had
    // just declared unusable would throw while rendering "Sea state
    // unavailable". `fixed()` exists in utils/payload for exactly this and its
    // own docstring says so.
    const raw = source.match(/(?:marine|weather)[.\w?]*\.\w+\.toFixed\(/g) ?? [];
    expect(raw, `unguarded .toFixed(): ${raw.join(', ')}`).toEqual([]);
  });

  it('filters the forecast bars rather than formatting them', () => {
    // `(null / peak) * 100` is NaN, `height: NaN%` is dropped silently by CSS,
    // and the bar then renders at the container's full height — an hour with no
    // reading drawn taller than a real one. Same defect as the EU-funds bars.
    expect(source).toMatch(/finite\(height\)/);
  });
});
