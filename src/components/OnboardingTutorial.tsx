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

/**
 * The narrowest viewport the tour is allowed to open itself on.
 *
 * 640px is Tailwind's `sm`, which is the breakpoint the panel below already
 * uses to stop being a full-width strip and become a card in the corner. So
 * this is not a new judgement about where a phone starts — it is the one the
 * layout was already making about where this thing costs a reader something.
 */
const AUTO_OPEN_MIN_WIDTH = 640;

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

/**
 * Whether the tour may open itself, as distinct from being asked for.
 *
 * Measured against the deployed site, the panel is **223px tall at every phone
 * width** — 26% of an iPhone 17 Pro viewport, 33% of an iPhone SE — and it is
 * pinned to the bottom edge, which on a phone is the part of the screen a thumb
 * is already occupying. On a desktop the same panel is a 384px card in the
 * corner of a 900px viewport and costs about a tenth of it. The panel did not
 * change; the fraction of the screen it takes did, and a third of a phone is a
 * different proposition from a tenth of a laptop.
 *
 * It is also the wrong tour to insist on here. Every step points at the section
 * tabs, which on a phone are already on screen and already scrollable — so the
 * panel explains a control it is simultaneously covering.
 *
 * So the tour is not removed on a phone, it stops interrupting. The trigger in
 * the page heading still opens it, and the completion flag is deliberately
 * **not** written when we decline: a reader who was never offered the tour has
 * not dismissed it, and should still be offered it if they come back on a
 * laptop. Writing the flag here would silently retire the feature for anyone
 * whose first visit happened to be on a phone.
 *
 * `innerWidth` rather than `matchMedia`, which jsdom does not implement —
 * verified, not assumed. Reaching for it would have meant writing a fallback,
 * and a fallback is a decision about what an absent measurement means, taken in
 * the file least likely to be read again.
 */
function shouldOpenUninvited(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth < AUTO_OPEN_MIN_WIDTH) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'true';
  } catch {
    return true;
  }
}

/**
 * The guided tour.
 *
 * It used to render as a banner above everything on `/data`, so the first thing
 * a first-time visitor saw was an explanation of the product rather than the
 * product - about 60px of it on a desktop and proportionally more on a phone,
 * pushing the data it was describing below the fold. A tour that displaces the
 * thing it is touring is working against itself.
 *
 * So it is out of the document flow entirely. The trigger is a chip in the page
 * header, taking no vertical space of its own, and the tour is a panel anchored
 * to the bottom of the viewport: present, dismissible, and never between the
 * reader and the first chart.
 *
 * It is deliberately not a modal. It does not trap focus and it does not cover
 * the page, because nothing here is urgent enough to interrupt someone - the
 * reader can ignore it and keep scrolling, which is the whole point of moving
 * it out of the flow.
 *
 * On a phone it does not open itself at all; see `shouldOpenUninvited`.
 */
export function OnboardingTutorial({ activeSection, onSectionChange }: OnboardingTutorialProps) {
  const [isOpen, setIsOpen] = useState(shouldOpenUninvited);
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

  // Closing writes the flag, so a returning reader never sees it again - and
  // that is true of finishing, skipping and pressing Escape alike. There is no
  // way to dismiss it that leaves it to come back tomorrow.
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
    setStepIndex(0);
  }

  if (!isOpen) {
    return (
      <button
        onClick={restartTutorial}
        className="text-caption px-3 py-2 rounded transition-colors shrink-0"
        style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
        aria-label="Restart guided tour"
      >
        Take a tour
      </button>
    );
  }

  return (
    <section
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:p-0 sm:w-96"
      aria-label="Dashboard onboarding tutorial"
    >
      <div
        className="rounded-xl p-4"
        style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-card)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-caption uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Guided tour
            </p>
            <h2 className="text-callout font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{step.title}</h2>
            <p className="text-ui" style={{ color: 'var(--text-secondary)' }}>{step.description}</p>
          </div>
          {/* None of this panel's controls carries `target-inline`, and that is
              a correction rather than an omission. That class is the opt-out
              from the 44px touch minimum, and index.css reserves it for "a
              small inline chip inside a larger target" — a segmented control's
              segment, a filter pill. A dialog's Skip, Back and Next are not
              chips inside anything; they are the only way out of the panel.
              Measured on a phone with all four opted out: Skip 64x26, Back
              49x34, Next 50x34, and the trigger 84x36. Every control on the one
              surface that is operated exclusively by thumb was under the
              minimum. */}
          <button
            onClick={closeTutorial}
            className="text-caption px-2 py-1 rounded transition-colors shrink-0"
            style={{ color: 'var(--text-tertiary)', background: 'var(--bg-card)' }}
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
              className="text-caption px-3 py-2 rounded transition-colors disabled:opacity-40"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}
              disabled={stepIndex === 0}
            >
              Back
            </button>
            {/* The primary action used to be white on `--text-secondary` - a
                *text* token pressed into service as a fill. In the dark theme
                that is white on a mid grey-blue, around 2:1, so the one button
                the tour most wants pressed was its least legible element. The
                accent panel is what DESIGN.md 1.5 reserves for a primary call
                to action. */}
            <button
              onClick={() => (isLastStep ? closeTutorial() : goToStep(stepIndex + 1))}
              className="news-accent-panel news-fg text-caption font-semibold px-3 py-2 rounded transition-colors"
            >
              {isLastStep ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}