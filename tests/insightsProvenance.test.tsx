import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';

// Imported statically. `tests/suiteDeterminism.test.ts` names a dynamic import
// in a test body beside a wall-clock wait as the pair that flaked, and this
// file has no reason to need either.
import { InsightsBanner } from '../src/components/InsightsBanner';
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';

/**
 * `/api/ai-insights` ships `insights`, `generatedAt` and `source`. Until
 * `4cfefa5`'s successor the banner read only the first, so machine-written
 * text rendered with **no generation time and no attribution** — on a site
 * whose newsroom half puts a provenance block under every article, and whose
 * status panel omits a figure entirely rather than defaulting it.
 *
 * A seam sweep found it by diffing the field names the producer writes against
 * the names any consumer reads: 2 of 3 dropped.
 */
const PAYLOAD = {
  insights: [
    {
      headline: 'Electricity €22.65/MWh',
      description: 'Range €2–€171/MWh, day average €57.',
      level: 'routine',
      category: 'economy',
      timestamp: '2026-08-28T14:17:31.407Z',
    },
  ],
  generatedAt: '2026-08-28T14:18:01.482Z',
  source: 'portaBaltica AI (data-driven)',
};

function renderBanner() {
  return render(
    <ThemeProvider>
      <CountryProvider>
        <InsightsBanner />
      </CountryProvider>
    </ThemeProvider>,
  );
}

/** Drain the microtask queue rather than waiting on the clock. */
async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('the insights banner says who wrote it and when', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => PAYLOAD })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attributes the insights and dates them', async () => {
    const { container } = renderBanner();
    await settle();

    expect(container.textContent, 'the insight itself should still render')
      .toContain('Electricity');
    expect(container.textContent, 'machine-written text must say what wrote it')
      .toContain('portaBaltica AI (data-driven)');
    expect(container.textContent, 'and when, so a reader can tell a minute ago from a week ago')
      .toMatch(/Generated \d{2}:\d{2} UTC/);
  });

  it('omits what the server did not send, rather than defaulting it', async () => {
    // The control, and the reason this is two tests. A version that always
    // rendered the line would pass the assertions above while inventing an
    // attribution on a payload that carries none — absence becoming a
    // confident value, which is the failure this repo names most often.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ insights: PAYLOAD.insights }) })),
    );

    const { container } = renderBanner();
    await settle();

    expect(container.textContent).toContain('Electricity');
    expect(container.textContent, 'no source was sent, so none may be shown')
      .not.toContain('portaBaltica AI');
    expect(container.textContent, 'and no generation time may be invented')
      .not.toMatch(/Generated/);
  });

  it('names the scrolling row, because the browser makes it a tab stop', async () => {
    // Chromium 127+ makes a scroll container keyboard-focusable so it can be
    // scrolled by keyboard. Every card in this row is a plain div, so there is
    // no focusable child to absorb that, and the container became an unnamed
    // `generic` stop -- a keyboard user landed on it and heard nothing.
    //
    // Found by a live accessibility audit, not by this suite, and it was
    // intermittent on desktop: overflow depends on rendered value width, so a
    // wide price made it appear and a narrow one made it vanish. Measured on
    // production, /data overflowed by 117px at 1440 and 1006px at 375 -- so it
    // is permanent on a phone and occasional on a laptop, which is why reading
    // the source called it fine.
    //
    // jsdom has no layout and never makes it focusable, so this cannot assert
    // the tab stop. It asserts the property that makes the stop harmless: the
    // row carries a role and a name, whatever the viewport does.
    const { container } = renderBanner();
    await settle();

    const row = container.querySelector('.overflow-x-auto');
    expect(row, 'the scrolling row is gone; this test is checking nothing').not.toBeNull();

    expect(row!.getAttribute('role'), 'a focusable container needs a role').toBe('group');

    const labelledBy = row!.getAttribute('aria-labelledby');
    expect(labelledBy, 'and a name, or a keyboard user hears nothing').toBeTruthy();

    const label = container.querySelector(`#${labelledBy}`);
    expect(label, `aria-labelledby="${labelledBy}" points at no element in this tree`)
      .not.toBeNull();
    expect(label!.textContent?.trim(), 'the name a screen reader will read').toBe('Insights');
  });
});
