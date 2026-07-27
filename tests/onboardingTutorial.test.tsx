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
});
