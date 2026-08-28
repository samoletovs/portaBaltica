import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ElsewhereRail from '../src/components/news/ElsewhereRail';
import { SECRET_PROSE, tierCSummary } from './fixtures/articles';

function fromOutlet(attribution: string, headline: string) {
  const base = tierCSummary();
  return {
    ...base,
    id: `${attribution}-${headline}`,
    slug: `${attribution}-${headline}`.toLowerCase().replace(/\W+/g, '-'),
    headline,
    syndicated: { ...base.syndicated!, attribution },
  };
}

const MIXED = [
  fromOutlet('EUobserver', 'EU raises alarm on election irregularities'),
  fromOutlet('EUobserver', 'Irish alumina refinery and EU sanctions'),
  fromOutlet('ERR News', 'Estonian ministry publishes budget outline'),
  fromOutlet('LSM', 'Latvian rail freight volumes fall'),
];

function renderRail(items = MIXED) {
  return render(
    <MemoryRouter>
      <ElsewhereRail items={items} />
    </MemoryRouter>,
  );
}

describe('Elsewhere rail: outlet filter', () => {
  it('offers one control per outlet present, with a count', () => {
    renderRail();

    const group = screen.getByRole('group', { name: /filter by outlet/i });
    expect(within(group).getByRole('button', { name: /^EUobserver, 2 stories$/ })).toBeTruthy();
    expect(within(group).getByRole('button', { name: /^ERR News, 1 story$/ })).toBeTruthy();
    expect(within(group).getByRole('button', { name: /^LSM, 1 story$/ })).toBeTruthy();
  });

  it('shows only the chosen outlet', () => {
    renderRail();

    fireEvent.click(screen.getByRole('button', { name: /^ERR News, 1 story$/ }));

    expect(screen.getByText('Estonian ministry publishes budget outline')).toBeTruthy();
    expect(screen.queryByText('EU raises alarm on election irregularities')).toBeNull();
    expect(screen.queryByText('Latvian rail freight volumes fall')).toBeNull();
  });

  it('restores every outlet when the reader clears the filter', () => {
    renderRail();

    fireEvent.click(screen.getByRole('button', { name: /^LSM, 1 story$/ }));
    expect(screen.queryByText('Estonian ministry publishes budget outline')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /all outlets/i }));
    expect(screen.getByText('Estonian ministry publishes budget outline')).toBeTruthy();
  });

  it('marks the active outlet for assistive technology, not just visually', () => {
    renderRail();

    fireEvent.click(screen.getByRole('button', { name: /^ERR News, 1 story$/ }));

    expect(
      screen.getByRole('button', { name: /^ERR News, 1 story$/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: /all outlets/i }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('is operable from the keyboard by construction, not by handler', () => {
    renderRail();

    // jsdom does not synthesise a click from Enter, so simulating one would
    // only test jsdom. The regression worth catching is the real one: someone
    // swapping these for clickable divs, which look identical and are dead to
    // keyboard and screen-reader users. Assert they are genuine buttons.
    const group = screen.getByRole('group', { name: /filter by outlet/i });
    const controls = within(group).getAllByRole('button');
    expect(controls.length).toBeGreaterThan(1);
    for (const control of controls) {
      expect(control.tagName).toBe('BUTTON');
      expect(control.getAttribute('type')).toBe('button');
      control.focus();
      expect(document.activeElement).toBe(control);
    }
  });

  it('hides the control entirely when every item is from one outlet', () => {
    renderRail([fromOutlet('EUobserver', 'Only story')]);

    expect(screen.queryByRole('group', { name: /filter by outlet/i })).toBeNull();
  });
});

describe('Elsewhere rail: what filtering must never do', () => {
  // The whole point of tier C is that it is somebody else's work, shown as a
  // pointer. A view control is exactly the kind of change that could quietly
  // turn a narrowed list into "our" feed, so assert it does not.
  it('never renders rewritten prose, filtered or unfiltered', () => {
    renderRail();

    expect(screen.queryByText(SECRET_PROSE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^ERR News, 1 story$/ }));

    expect(screen.queryByText(SECRET_PROSE)).toBeNull();
  });

  it('keeps every surviving item an outbound link to its own outlet', () => {
    renderRail();

    fireEvent.click(screen.getByRole('button', { name: /^EUobserver, 2 stories$/ }));

    const links = screen
      .getAllByRole('link')
      .filter((link) => (link.getAttribute('href') ?? '').startsWith('http'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('never presents a filtered item as written by one of our correspondents', () => {
    renderRail();

    fireEvent.click(screen.getByRole('button', { name: /^ERR News, 1 story$/ }));

    expect(screen.queryByText(/AI correspondent/i)).toBeNull();
  });
});

describe('Elsewhere rail: length', () => {
  const many = Array.from({ length: 9 }, (_, i) => fromOutlet('EUobserver', `Story ${i}`));

  it('caps the rail so it cannot outrun our own reporting', () => {
    renderRail(many);

    expect(screen.getByText('Story 3')).toBeTruthy();
    expect(screen.queryByText('Story 4')).toBeNull();
  });

  it('expands on request', () => {
    renderRail(many);

    fireEvent.click(screen.getByRole('button', { name: /show 5 more/i }));

    expect(screen.getByText('Story 8')).toBeTruthy();
  });

  it('collapses again when the reader picks a different outlet', () => {
    const mixed = [...many, fromOutlet('ERR News', 'Estonian story')];
    renderRail(mixed);

    fireEvent.click(screen.getByRole('button', { name: /show 6 more/i }));
    expect(screen.getByText('Story 8')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^EUobserver, 9 stories$/ }));

    expect(screen.queryByText('Story 8')).toBeNull();
    expect(screen.getByRole('button', { name: /show 5 more/i })).toBeTruthy();
  });
});

describe('Elsewhere rail: an empty wire is not a fact about the world', () => {
  it('announces nothing when it was given nothing', () => {
    // `items` arrives as a prop, so this component cannot tell "the wire is
    // quiet" from "we could not reach it" -- an empty array is both. With every
    // API call failing, `/` correctly says the front page could not be loaded
    // in the main column while this region announced "0 stories from other
    // outlets": a network error spoken aloud as an assertion about the world.
    renderRail([]);

    expect(
      screen.queryByRole('status'),
      'a live region must not report a count it cannot vouch for',
    ).toBeNull();
  });

  it('still announces when there is a corpus, so the fix is not blanket suppression', () => {
    // The control. Without it, deleting the region outright would pass the
    // assertion above.
    //
    // It does NOT distinguish `items` from `shown`: a plant swapping the guard
    // to `shown.length > 0` passes every test here, because `useOutlets`
    // derives the filter buttons from `items`, so no reachable filter matches
    // nothing. Stated rather than implied — a control that cannot separate two
    // implementations should not be described as though it can.
    renderRail(MIXED);

    const region = screen.getByRole('status');
    expect(region.textContent).toMatch(/\d+ stor/);
  });
});
