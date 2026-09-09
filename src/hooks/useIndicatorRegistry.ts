import { useCallback, useEffect, useState } from 'react';

export interface IndicatorRegistryEntry {
  id: string;
  title: string;
  unit: string;
  dataset: string;
  freq: string;
}

function isEntry(value: unknown): value is IndicatorRegistryEntry {
  if (!value || typeof value !== 'object') return false;
  return ['id', 'title', 'unit', 'dataset', 'freq'].every(
    key => typeof (value as Record<string, unknown>)[key] === 'string',
  );
}

export function useIndicatorRegistry() {
  const [entries, setEntries] = useState<IndicatorRegistryEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setEntries(null);
    setError(false);
    setAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void fetch('/api/baltic-compare?list=1', {
      signal: controller.signal,
      credentials: 'omit',
    }).then(async response => {
      if (!response.ok) throw new Error('Catalogue unavailable');
      const payload: unknown = await response.json();
      const list = payload && typeof payload === 'object'
        ? (payload as { indicators?: unknown }).indicators : undefined;
      if (!Array.isArray(list) || !list.every(isEntry)) throw new Error('Invalid catalogue');
      if (active) setEntries(list);
    }).catch(() => {
      if (active) setError(true);
    }).finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return { entries, error, retry };
}
