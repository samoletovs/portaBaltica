import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifySeaState, SEA_STATE_LABELS } from '../src/types';

/**
 * What a component does with a value it did not get.
 *
 * The dashboard reads eleven upstreams and one of them is a language model, so
 * "the payload is not the shape I expected" is a normal Tuesday rather than an
 * edge case. The rule this file enforces is that an absent or unrecognised
 * value must degrade to something that *says* it is absent — never to a
 * confident reading the code did not measure.
 */
describe('a missing sea state', () => {
  it('is null rather than the worst reading on the scale', () => {
    // Every comparison against NaN is false, so a chain of `<` with a bare
    // `return` at the end sends a missing wave height to the *last* branch.
    // That branch was 'very-rough': a port with no data was labelled "Very
    // Rough", in red, exactly as confidently as a real storm.
    expect(classifySeaState(Number.NaN)).toBeNull();
    expect(classifySeaState(null)).toBeNull();
    expect(classifySeaState(undefined)).toBeNull();
    expect(classifySeaState(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('still classifies a real reading at every band boundary', () => {
    // Thresholds unchanged — 0.1, 0.5, 1.25 and 2.5 m are the WMO sea state
    // code boundaries and always were. The *names* moved: they used to sit one
    // degree high all the way up, so 0.1 m read "Slight" (degree 3) when the
    // scale calls it Smooth (degree 2), and 2.5 m read "Very Rough" (degree 6,
    // which starts at 4 m) when it is Rough (degree 5).
    expect(classifySeaState(0)).toBe('calm');
    expect(classifySeaState(0.09)).toBe('calm');
    expect(classifySeaState(0.1)).toBe('smooth');
    expect(classifySeaState(0.49)).toBe('smooth');
    expect(classifySeaState(0.5)).toBe('slight');
    expect(classifySeaState(1.24)).toBe('slight');
    expect(classifySeaState(1.25)).toBe('moderate');
    expect(classifySeaState(2.49)).toBe('moderate');
    expect(classifySeaState(2.5)).toBe('rough');
    expect(classifySeaState(9)).toBe('rough');
  });

  it('names every band it can return', () => {
    for (const height of [0, 0.3, 1, 2, 5]) {
      const state = classifySeaState(height)!;
      expect(SEA_STATE_LABELS[state], `no label for ${state}`).toBeDefined();
    }
  });

  it('is rendered as absent rather than skipped', () => {
    // A port whose sea state is unknown must say so. Rendering nothing would
    // leave the card looking complete while one of its two headline facts had
    // quietly vanished.
    const card = readFileSync(resolve('src/components/PortCard.tsx'), 'utf8');
    expect(card).toMatch(/Sea state unavailable/);
  });
});

describe('an unrecognised air-quality band', () => {
  it('has no colour of its own to borrow', () => {
    // The lookup used to fall back to `AQI_STYLES.good`, so a failed reading
    // was painted the same green as clean air.
    const tile = readFileSync(resolve('src/components/EnvironmentTile.tsx'), 'utf8');
    expect(tile, 'the band lookup must be able to return nothing').toMatch(
      /AQI_BANDS\[aq\.status\]\s*\?\?\s*null/,
    );
    expect(tile, 'an unknown band must not fall back to a coloured one').not.toMatch(
      /\?\?\s*AQI_BANDS\.good/,
    );
  });

  it('carries its band as a position, not only as a hue', () => {
    // good vs unhealthy is ΔE 8.3 under deuteranopia in the dark theme, so hue
    // cannot be the carrier. Three segments filled to the current band is a
    // position encoding, which survives any colour vision and greyscale.
    const tile = readFileSync(resolve('src/components/EnvironmentTile.tsx'), 'utf8');
    expect(tile, 'each band needs an ordinal rank').toMatch(/rank:\s*[123]/);
    expect(tile, 'the rank needs to be stated in words too').toMatch(/Band \{band\.rank\} of 3/);
  });
});

describe('an unrecognised insight level', () => {
  it('does not take the tile down with it', () => {
    // `/api/ai-insights` is model-fed, so an unfamiliar level string is a
    // question of when. Reading `.color` straight off the lookup threw, and
    // before the per-section boundaries existed that blanked the whole page.
    const banner = readFileSync(resolve('src/components/InsightsBanner.tsx'), 'utf8');
    expect(banner, 'the badge lookup needs a default').toMatch(/INSIGHT_BADGES\[insight\.level\]\s*\?\?/);
  });
});
