import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  fetchPropertyData, fetchEconomyData, fetchSystemStatus, searchAddress,
  searchBusinessOwners, fetchArticleFeedbackSummary,
} from '../src/api';
import { BusinessTile } from '../src/components/BusinessTile';
import { SystemStatusFooter } from '../src/components/SystemStatusFooter';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('safe API failures', () => {
  const loaders = [
    () => fetchPropertyData(),
    () => fetchEconomyData(),
    () => fetchSystemStatus(),
    () => searchAddress('Riga'),
    () => searchBusinessOwners('Berzins'),
    () => fetchArticleFeedbackSummary('test-story'),
  ];

  it.each(loaders.map((load, index) => [index, load] as const))(
    'gives retry guidance for HTTP, network and JSON failures on transport %i',
    async (_index, load) => {
      for (const response of [
        () => Promise.resolve(Response.json({ error: 'private upstream detail' }, { status: 503 })),
        () => Promise.reject(new TypeError('private network detail')),
        () => Promise.resolve(new Response('<html>private proxy detail</html>')),
      ]) {
        vi.stubGlobal('fetch', vi.fn(response));
        await expect(load()).rejects.toThrow('Please try again');
        await expect(load()).rejects.not.toThrow(/private|Unexpected token|API failed/);
      }
    },
  );

  it('explains rate limiting without exposing server text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 429 })));
    await expect(searchAddress('Riga')).rejects.toThrow('Too many requests. Please wait a moment and try again.');
  });

  it('preserves cancellation rather than reporting it as a failure', async () => {
    const aborted = new DOMException('Request cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(aborted));
    await expect(fetchArticleFeedbackSummary('test-story')).rejects.toBe(aborted);
  });
});

describe('API failures reach the reader', () => {
  it.each([
    ['Search beneficial owners by company registration number or surname', 'Search', 'totalMatches'],
    ['Search Latvian addresses', 'Search addresses', 'total'],
  ])('shows an accessible error for %s and clears it after retry', async (inputLabel, buttonLabel, totalKey) => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('private network detail'))
      .mockResolvedValueOnce(Response.json({ [totalKey]: 0, companies: [], addresses: [] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<BusinessTile euFunds={null} euLoading={false} />);
    fireEvent.change(screen.getByLabelText(inputLabel), { target: { value: 'Riga' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: buttonLabel })); });
    expect(screen.getByRole('alert').textContent).toContain('Please try again');
    expect(screen.getByRole('alert').textContent).not.toContain('private');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: buttonLabel })); });
    expect(screen.getByText(/0 (?:total )?matches/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a status-read failure rather than silently removing the footer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('private network detail')));
    await act(async () => { render(<SystemStatusFooter />); });
    expect(screen.getByRole('alert').textContent).toContain('System status could not be loaded');
    expect(screen.getByRole('alert').textContent).toContain('Please try again');
  });
});
