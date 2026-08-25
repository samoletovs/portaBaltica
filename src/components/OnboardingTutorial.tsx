import { useCallback, useEffect, useState } from 'react';
import type { DashboardSection } from '../types';

interface OnboardingTutorialProps {
  activeSection: DashboardSection | 'all';
  onSectionChange: (section: DashboardSection | 'all') => void;
}

interface OnboardingStep {
  title: string;
  description: string;
  section?: DashboardSection | 'all';
}

const STORAGE_KEY = 'pb-onboarding-complete';

const STEPS: OnboardingStep[] = [
  {
    title: 'Welcome to portaBaltica',
    description: 'This quick tour highlights the key dashboard areas and how to navigate between them.',
    section: 'all',
  },
  {
    title: 'Track economy signals',
    description: 'Open the Economy section for inflation, wages, electricity prices, and exchange rates.',
    section: 'economy',
  },
  {
    title: 'Monitor environmental trends',
    description: 'Use Environment for weather and air quality signals across the Baltics.',
    section: 'environment',
  },
  {
    title: 'Check maritime operations',
    description: 'Maritime keeps the original port activity view with ship visits, ferry, and cargo flows.',
    section: 'maritime',
  },
  {
    title: 'You are ready',
    description: 'Use the section tabs anytime to jump between dashboard domains.',
    section: 'all',
  },
];

function markOnboardingComplete() {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // ignore storage errors
  }
}

export function OnboardingTutorial({ activeSection, onSectionChange }: OnboardingTutorialProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'true';
    } catch {
      return true;
    }
  });
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  // The tour moves the dashboard only when the reader moves the tour. It used
  // to do this in an effect keyed on `activeSection`, which made it a
  // *controller* of state it does not own: any section the reader chose while
  // the tour was open differed from the current step's section, so the effect
  // fired and navigated them straight back. The section tabs looked dead for
  // every first-time visitor, because the tour is open by default.
  function goToStep(index: number) {
    const next = STEPS[index];
    if (!next) return;
    setStepIndex(index);
    if (next.section && next.section !== activeSection) onSectionChange(next.section);
  }

  const closeTutorial = useCallback(() => {
    markOnboardingComplete();
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeTutorial();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeTutorial, isOpen]);

  function restartTutorial() {
    setIsOpen(true);
    goToStep(0);
  }

  if (!isOpen) {
    return (
      <div className="mb-6 flex justify-end">
        <button
          onClick={restartTutorial}
          className="text-caption px-3 py-1.5 rounded transition-colors"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
          aria-label="Restart guided tour"
        >
          Take a tour
        </button>
      </div>
    );
  }

  return (
    <section
      className="mb-6 rounded-xl p-4 sm:p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
      aria-label="Dashboard onboarding tutorial"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-caption uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Guided tour
          </p>
          <h2 className="text-callout font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{step.title}</h2>
          <p className="text-ui" style={{ color: 'var(--text-secondary)' }}>{step.description}</p>
        </div>
        <button
          onClick={closeTutorial}
          className="text-caption px-2 py-1 rounded transition-colors"
          style={{ color: 'var(--text-tertiary)', background: 'var(--bg-card-hover)' }}
        >
          Skip tour
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
          Step {stepIndex + 1} of {STEPS.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToStep(Math.max(0, stepIndex - 1))}
            className="text-caption px-3 py-1.5 rounded transition-colors disabled:opacity-40"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-card-hover)' }}
            disabled={stepIndex === 0}
          >
            Back
          </button>
          <button
            onClick={() => (isLastStep ? closeTutorial() : goToStep(stepIndex + 1))}
            className="text-caption px-3 py-1.5 rounded transition-colors"
            style={{ color: '#fff', background: 'var(--text-secondary)' }}
          >
            {isLastStep ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </section>
  );
}
