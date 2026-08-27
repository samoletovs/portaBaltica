import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Byline } from '../src/components/news/Byline';

/**
 * These render the component. That distinction is the whole point of the file.
 *
 * `renderByline` rebuilds a byline from the correspondent registry so that an
 * article filed under an older surname still shows the current one. It is
 * correct, and `newsroomRoster.test.tsx` proves it — by calling it directly,
 * with an id.
 *
 * `Byline` passed it `{ name, beat, byline }` and no `id`, so the registry
 * lookup found nothing and every byline on the site fell through to the stored
 * string. Both the function and its test were right; the path between them was
 * not. A unit test on `renderByline` passes on either side of this fix, which
 * is exactly how it survived.
 */

const STALE = {
  id: 'kolka',
  name: 'Gintaras Vaitkus',
  byline: 'Gintaras Vaitkus · AI correspondent, Maritime & Trade',
};

function mount(persona: { id: string; name: string; byline?: string }, variant?: 'compact' | 'full') {
  return render(
    <MemoryRouter>
      <Byline persona={persona} variant={variant} />
    </MemoryRouter>,
  );
}

describe('the byline a reader actually sees', () => {
  it('shows the roster name, not the one stored on the article', () => {
    mount(STALE);

    expect(screen.getByText(/Gintaras Kolka/)).toBeTruthy();
    expect(screen.queryByText(/Vaitkus/)).toBeNull();
  });

  it('does the same in the full variant, which carries the avatar and the link', () => {
    mount(STALE, 'full');

    expect(screen.getByText(/Gintaras Kolka/)).toBeTruthy();
    expect(screen.queryByText(/Vaitkus/)).toBeNull();
  });

  it('still discloses after the repair', () => {
    mount(STALE);

    expect(screen.getByText(/· AI correspondent/)).toBeTruthy();
  });

  it('keeps the beat, which was the one field the id was already used for', () => {
    mount(STALE);

    expect(screen.getByText(/Maritime & Trade/)).toBeTruthy();
  });
});

describe('a persona the registry has never heard of', () => {
  /**
   * The backlog path. Articles filed before #43 must keep rendering, and a
   * persona id that resolves to nothing must not blank the byline — the
   * disclosure is an absolute in the published policy.
   */
  it('falls back to the stored name rather than vanishing', () => {
    mount({
      id: 'unknown-lighthouse',
      name: 'Someone New',
      byline: 'Someone New · AI correspondent, Economy & Labour',
    });

    expect(screen.getByText(/Someone New/)).toBeTruthy();
  });

  it('still discloses', () => {
    mount({ id: 'unknown-lighthouse', name: 'Someone New' });

    expect(screen.getByText(/· AI correspondent/)).toBeTruthy();
  });
});
