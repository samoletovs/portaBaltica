import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../src/ThemeContext';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { InsightsBanner } from '../src/components/InsightsBanner';

/**
 * The insights banner reserves the shape it is about to become.
 *
 * WHAT WAS WRONG
 * --------------
 * The loading placeholder was four bars that resembled nothing in the real
 * card, and the loaded state additionally renders an attribution line the
 * placeholder did not render at all. So the section grew when the data landed
 * and pushed the whole dashboard down with it. Measured on `/data`:
 *
 *     loading   section 165   row 118   cards [110, 110, 110]
 *     loaded    section 225   row 152   cards [144, 144, 144, 144]
 *
 * 34px of that was the card — a badge row, a headline and a three-line
 * description, against four arbitrary bars — and 26px was the attribution
 * line. After: `section grew by 0px`, loading and loaded identical.
 *
 * WHY THE SYMPTOM WAS THE WRONG THING TO MEASURE
 * ----------------------------------------------
 * As CLS this looked intermittent — `/data/maritime` measured
 * `[0.031, 0.074, 0.305, 0.031, 0.068]`, one run in five above the "poor"
 * line — because the *magnitude* depends on how much happened to be on screen
 * when the shift landed. The underlying growth was **15 of 15 runs**. A fix
 * had looked unverifiable against a 1-in-5 signal and was trivially verifiable
 * against a 15-of-15 one: measure the cause, not the symptom.
 *
 * WHAT THIS ASSERTS, GIVEN JSDOM HAS NO LAYOUT
 * --------------------------------------------
 * Not the heights — jsdom cannot compute them. The thing the heights rest on:
 * that the placeholder and the real card carry the same type-scale classes in
 * the same order, so the browser gives them the same line boxes. Both sides
 * are read from a render and compared, rather than written down, because a
 * copied list would keep passing after the real card changed.
 */

function mount(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <CountryProvider>
          <FilterProvider>{ui}</FilterProvider>
        </CountryProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const PAYLOAD = {
  insights: [
    { type: 'info', headline: 'Electricity holds near the monthly mean', description: 'A description long enough to wrap onto more than one line in a card this wide.' },
    { type: 'info', headline: 'Rail freight steady', description: 'Another description.' },
    { type: 'info', headline: 'Ports quiet', description: 'A third.' },
  ],
  generatedAt: '2026-09-02T09:00:00Z',
  source: 'Computed from Eurostat and Nord Pool',
};

function serve(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)),
  );
}

function serveNever() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
}

/** The type-scale classes carried inside one card, in document order. */
const TYPE_STEPS = ['text-caption', 'text-ui', 'text-callout', 'text-prose', 'text-lead', 'text-title'];

function typeShape(root: Element): string[] {
  return [...root.querySelectorAll('*')]
    .map((el) => TYPE_STEPS.filter((step) => el.classList.contains(step)).join(' '))
    .filter(Boolean);
}

function firstCard(container: HTMLElement): Element | null {
  // The row is the flex strip; a card is one of its children.
  const row = container.querySelector('[aria-label="Loading insights"], [class*="overflow-x-auto"]');
  return row?.firstElementChild ?? null;
}

describe('the insights banner while it is loading', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('gives its placeholder card the same type shape as a real one', async () => {
    serveNever();
    const loading = mount(<InsightsBanner />);
    const placeholder = firstCard(loading.container);
    expect(placeholder, 'the loading state renders no card at all').not.toBeNull();
    const reserved = typeShape(placeholder!);
    loading.unmount();

    vi.unstubAllGlobals();
    serve(PAYLOAD);
    const loaded = mount(<InsightsBanner />);
    await waitFor(() => expect(loaded.container.textContent).toContain('Rail freight steady'));
    const real = firstCard(loaded.container);
    expect(real, 'the loaded state renders no card at all').not.toBeNull();

    expect(
      reserved,
      'the placeholder card no longer mirrors the real one, so it cannot be the same ' +
        'height and the dashboard will move down when the insights land',
    ).toEqual(typeShape(real!));
  });

  it('reserves the attribution line the loaded state renders', async () => {
    // Worth its own assertion because it is a whole element rather than a
    // difference of degree: absent while loading and 26px afterwards.
    serveNever();
    const loading = mount(<InsightsBanner />);
    const reservedLines = loading.container.querySelectorAll('p.text-caption.mt-2').length;
    loading.unmount();

    vi.unstubAllGlobals();
    serve(PAYLOAD);
    const loaded = mount(<InsightsBanner />);
    await waitFor(() => expect(loaded.container.textContent).toContain('Nord Pool'));

    expect(
      reservedLines,
      'the loading state does not reserve the attribution line, so the page below moves ' +
        'when it appears',
    ).toBe(loaded.container.querySelectorAll('p.text-caption.mt-2').length);
  });

  it('still renders real insights and their provenance', async () => {
    // CONTROL. Every assertion above compares a placeholder to a loaded state,
    // and would be satisfied by a component that renders neither.
    serve(PAYLOAD);
    const { container } = mount(<InsightsBanner />);
    await waitFor(() => expect(container.textContent).toContain('Ports quiet'));

    expect(container.textContent).toContain('Electricity holds near the monthly mean');
    expect(container.textContent).toContain('Computed from Eurostat and Nord Pool');
  });
});
