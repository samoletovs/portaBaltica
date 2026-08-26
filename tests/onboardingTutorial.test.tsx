import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingTutorial } from '../src/components/OnboardingTutorial';

describe('OnboardingTutorial', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
