import { Component, type ReactNode, type ErrorInfo } from 'react';

/**
 * The wordings browsers use when a JavaScript module fails to arrive.
 *
 * This is one of the few places a string match is honest rather than a lexical
 * proxy: it genuinely *is* a vocabulary, fixed by browser vendors rather than
 * by us. Chromium says "Failed to fetch dynamically imported module", Firefox
 * and Safari say "Importing a module script failed", and a boundary has
 * nothing else to go on — a failed `import()` arrives as an ordinary
 * `TypeError`.
 *
 * The same wordings appear in the recovery script in `index.html`, which
 * cannot import from here because it must run before the bundle it guards.
 * `tests/errorBoundaryCopy.test.tsx` asserts the two agree, because two copies
 * of a vocabulary drift and only one of them is the one that fires.
 */
const STALE_ASSET = /dynamically imported module|Importing a module script failed/i;

/** The recovery script's guard key, shared so the two cannot reload in turn. */
const RECOVERY_KEY = 'pb-asset-recovery';
const RECOVERY_WINDOW_MS = 30_000;

interface Props {
  children: ReactNode;
  /**
   * What to show instead of the full-page message. A boundary around one
   * dashboard section wants to replace that section, not the viewport.
   */
  fallback?: (error: Error) => ReactNode;
}
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('portaBaltica error boundary:', error, info.componentStack);
  }

  /**
   * Has a reload already been tried in the last thirty seconds?
   *
   * Read, never written: this only decides what to *say*. Offering "reload" to
   * a reader whose reload has just failed is the same dead end as the raw
   * exception, so when the recovery has recently fired we tell them the truth
   * instead — it did not work, and here is somewhere else to go.
   */
  private reloadAlreadyTried(): boolean {
    try {
      const last = parseInt(sessionStorage.getItem(RECOVERY_KEY) ?? '0', 10);
      return Number.isFinite(last) && last > 0 && Date.now() - last < RECOVERY_WINDOW_MS;
    } catch {
      return false;
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error ?? new Error('Unknown error'));
      }

      const message = this.state.error?.message ?? '';

      // Two situations that read identically to a reader, and the difference
      // decides whether reloading is worth their time.
      //
      // A stale asset means the site was rebuilt while they were reading:
      // their HTML names bundles that no longer exist. Reloading genuinely
      // fixes it. `index.html` catches most of these before React starts —
      // but not the ones React swallows. A failed `React.lazy()` rejection is
      // handled by React, so the browser never fires `unhandledrejection` and
      // the recovery never sees it; it arrives here instead. Measured against
      // a server that 404s one chunk, not assumed.
      //
      // Anything else is a real fault in our code. Reloading will probably
      // reproduce it, and "try again" would be a friendlier lie than the
      // exception it replaced.
      const stale = STALE_ASSET.test(message);
      const retried = this.reloadAlreadyTried();
      const offerReload = !stale || !retried;

      const headline = stale
        ? 'The site updated while you were reading'
        : 'Something went wrong at our end';

      const explanation = stale
        ? retried
          ? 'Reloading has not picked up the new version yet. It should settle shortly — the dashboard is still there in the meantime.'
          : 'We published a new version a moment ago, so part of this page is no longer where your browser expected it. Reloading will fetch the current one.'
        : 'This is a fault on our side, not anything you did. Reloading may well hit it again, so the dashboard is probably the faster way back.';

      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans, system-ui, sans-serif)', background: 'var(--bg-page, #0a0f1a)', color: 'var(--text-primary, #fff)' }}>
          <div style={{ textAlign: 'center', maxWidth: 460, padding: 32 }}>
            <h1 style={{ fontSize: '1.75rem', lineHeight: 1.25, fontWeight: 600, marginBottom: 12 }}>{headline}</h1>
            <p style={{ fontSize: '1rem', lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 20 }}>
              {explanation}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {offerReload && (
                <button
                  onClick={() => window.location.reload()}
                  style={{ padding: '8px 20px', borderRadius: 8, background: 'var(--news-accent)', color: 'var(--bg-page)', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}
                >
                  Reload
                </button>
              )}
              <a
                href="/data"
                style={{ padding: '8px 20px', borderRadius: 8, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-card, #26344f)', fontSize: '0.875rem', textDecoration: 'none', lineHeight: 1.6 }}
              >
                Go to the dashboard
              </a>
            </div>

            {/* The exception is the only diagnostic anyone gets for a fault
                that reaches here, so it is moved rather than deleted. It is
                already in the console via `componentDidCatch`; this is for the
                reader willing to tell us what they saw, and it is shut by
                default because it is our vocabulary, not theirs. */}
            {message && (
              <details style={{ marginTop: 24, textAlign: 'left' }}>
                <summary style={{ cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--text-tertiary, #8496ad)' }}>
                  Technical detail
                </summary>
                <p style={{ fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--text-tertiary, #8496ad)', marginTop: 8, wordBreak: 'break-word' }}>
                  {message}
                </p>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
