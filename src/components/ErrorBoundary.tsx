import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props { children: ReactNode }
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

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans, system-ui, sans-serif)', background: 'var(--bg-page, #0a0f1a)', color: 'var(--text-primary, #fff)' }}>
          <div style={{ textAlign: 'center', maxWidth: 420, padding: 32 }}>
            <h1 style={{ fontSize: '1.75rem', lineHeight: 1.25, fontWeight: 600, marginBottom: 12 }}>Something went wrong</h1>
            <p style={{ fontSize: '1rem', lineHeight: 1.6, color: 'var(--text-secondary, #94a3b8)', marginBottom: 20 }}>
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '8px 20px', borderRadius: 8, background: '#0ea5e9', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
