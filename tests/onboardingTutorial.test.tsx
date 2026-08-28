import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingTutorial } from '../src/components/OnboardingTutorial';

describe('OnboardingTutorial', () => {
  const DESKTOP_WIDTH = 1024;

  function setViewportWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  }

  beforeEach(() => {
    localStorage.clear();
    // jsdom's default is 1024, but stating it makes every test below say which
    // device it is describing rather than inheriting one.
    setViewportWidth(DESKTOP_WIDTH);
  });

  it('renders for first-time users', () => {
    render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);
    expect(screen.getByText('Welcome to portaBaltica')).toBeTruthy();
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });

  it('advances steps and changes dashboard section', () => {
    const onSectionChange = vi.fn();
    render(<OnboardingTutorial activeSection="all" onSectionChange={onSectionChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Track economy signals')).toBeTruthy();
    expect(onSectionChange).toHaveBeenCalledWith('economy');
  });

  it('lets the reader use the section tabs while the tour is open', () => {
    const onSectionChange = vi.fn();
    const { rerender } = render(
      <OnboardingTutorial activeSection="all" onSectionChange={onSectionChange} />,
    );
    onSectionChange.mockClear();

    // The reader clicks the Economy tab; the dashboard re-renders on the new
    // route. The tour must not drag them back to its own step's section.
    rerender(<OnboardingTutorial activeSection="economy" onSectionChange={onSectionChange} />);

    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it('does not move a reader who arrived on a section link', () => {
    const onSectionChange = vi.fn();
    render(<OnboardingTutorial activeSection="maritime" onSectionChange={onSectionChange} />);

    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it('marks tutorial complete when skipped', () => {
    render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));

    expect(localStorage.getItem('pb-onboarding-complete')).toBe('true');
    expect(screen.queryByLabelText('Dashboard onboarding tutorial')).toBeNull();
  });

  it('does not render when already completed', () => {
    localStorage.setItem('pb-onboarding-complete', 'true');

    render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);

    expect(screen.queryByLabelText('Dashboard onboarding tutorial')).toBeNull();
  });

  it('can be restarted from the tour button after completion', () => {
    localStorage.setItem('pb-onboarding-complete', 'true');

    render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Restart guided tour' }));

    expect(screen.getByText('Welcome to portaBaltica')).toBeTruthy();
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });

  it('closes the tour on Escape', () => {
    render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);
    expect(screen.getByLabelText('Dashboard onboarding tutorial')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByLabelText('Dashboard onboarding tutorial')).toBeNull();
    expect(localStorage.getItem('pb-onboarding-complete')).toBe('true');
  });

  it('stays dismissed for a reader who comes back', () => {
    // Every exit writes the flag, so there is no way to dismiss the tour that
    // leaves it to reappear on the next visit. Escape has its own test above;
    // this is the one that proves the dismissal survives a fresh mount, which
    // is what a returning reader actually is.
    const { unmount } = render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    unmount();

    render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);
    expect(screen.queryByLabelText('Dashboard onboarding tutorial')).toBeNull();
  });

  it('does not sit between the reader and the dashboard', () => {
    // It used to render as a banner above every tile, costing about 60px on a
    // desktop and proportionally more on a phone, so a first-time visitor's
    // first screen explained the product instead of being it. The panel is
    // anchored to the viewport now rather than taking a place in the flow.
    render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);

    const panel = screen.getByLabelText('Dashboard onboarding tutorial');
    expect(panel.className, 'the tour must not occupy space in the document flow').toContain('fixed');
  });

  it('offers its restart control without occupying a row of its own', () => {
    // The dismissed state used to be a full-width right-aligned strip above the
    // page, which spent a row on a button most readers never press. It is a
    // chip that sits in the page heading row now, so it costs no height.
    localStorage.setItem('pb-onboarding-complete', 'true');
    render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Restart guided tour' });
    expect(trigger.parentElement?.className ?? '').not.toContain('justify-end');
  });

  describe('on a phone', () => {
    // Measured against the deployed site at every phone width: the panel is
    // 223px tall, which is 26% of an iPhone 17 Pro viewport and 33% of an
    // iPhone SE, and it is pinned to the bottom edge — the part of the screen a
    // thumb already occupies. The same panel on a desktop is a card in the
    // corner costing about a tenth of the viewport. The panel did not change;
    // the fraction of the screen it takes did.
    const PHONE_WIDTH = 402; // iPhone 17 Pro

    it('does not open itself', () => {
      setViewportWidth(PHONE_WIDTH);

      render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);

      expect(
        screen.queryByLabelText('Dashboard onboarding tutorial'),
        'the tour must not cover a third of a phone uninvited',
      ).toBeNull();
    });

    it('is still available on demand', () => {
      // Not opening itself is different from being removed. Without this, the
      // assertion above would pass just as well for a deleted feature — the
      // control that must still be present, measured the same way.
      setViewportWidth(PHONE_WIDTH);

      render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Restart guided tour' }));

      expect(screen.getByText('Welcome to portaBaltica')).toBeTruthy();
      expect(screen.getByLabelText('Dashboard onboarding tutorial')).toBeTruthy();
    });

    it('does not mark the tour complete for a reader it never offered it to', () => {
      // Declining to interrupt is not the reader declining. Writing the flag
      // here would retire the tour permanently for anyone whose first visit
      // happened to be on a phone — including on the desktop where it is cheap.
      setViewportWidth(PHONE_WIDTH);

      const { unmount } = render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);
      expect(localStorage.getItem('pb-onboarding-complete')).toBeNull();
      unmount();

      setViewportWidth(DESKTOP_WIDTH);
      render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);

      expect(screen.getByText('Welcome to portaBaltica')).toBeTruthy();
    });

    it('still remembers a reader who opened it and dismissed it', () => {
      setViewportWidth(PHONE_WIDTH);
      render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Restart guided tour' }));
      fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));

      expect(localStorage.getItem('pb-onboarding-complete')).toBe('true');
    });
  });

  it('gives every one of its controls a full touch target', () => {
    // `target-inline` is the opt-out from the 44px minimum in index.css, and
    // that file reserves it for "a small inline chip inside a larger target" —
    // a segmented control's segment, a filter pill. All four of this panel's
    // controls carried it, so on the one surface operated exclusively by thumb,
    // every control was under the minimum: measured on a phone, Skip 64x26,
    // Back 49x34, Next 50x34, and the trigger 84x36.
    //
    // A class assertion rather than a measured height, because jsdom applies no
    // stylesheet: every element here reports a zero box, so a size read would
    // pass whatever the markup said.
    const { unmount } = render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);
    const inPanel = ['Skip tour', 'Back', 'Next'].map((name) =>
      screen.getByRole('button', { name }),
    );
    const panelClassNames = inPanel.map((button) => ({
      label: button.textContent ?? '',
      className: button.className,
    }));
    unmount();

    localStorage.setItem('pb-onboarding-complete', 'true');
    render(<OnboardingTutorial activeSection="all" onSectionChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Restart guided tour' });

    const all = [...panelClassNames, { label: 'Take a tour', className: trigger.className }];
    expect(all, 'the control set under test shrank; the check would pass on an empty one').toHaveLength(4);

    for (const control of all) {
      expect(
        control.className,
        `"${control.label}" opts out of the 44px touch minimum`,
      ).not.toContain('target-inline');
    }
  });
});
