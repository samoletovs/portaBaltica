import { useCallback, useEffect, useState } from 'react';
import { EvidenceError } from './evidence-validation';

type EvidenceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: EvidenceError };

export function useEvidenceResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; state: EvidenceState<T> }>();
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const value = await load(controller.signal);
        if (!controller.signal.aborted) setResult({ key, attempt, state: { status: 'ready', value } });
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({
            key, attempt, state: {
              status: 'error',
              error: error instanceof EvidenceError ? error : new EvidenceError('network', 'The archive could not be read. Please try again.'),
            },
          });
        }
      }
    }
    void read();
    return () => controller.abort();
  }, [key, load, attempt]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const state: EvidenceState<T> = result?.key === key && result.attempt === attempt ? result.state : { status: 'loading' };
  return { state, retry };
}
