import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressSearchResult, BusinessSearchResult } from '../src/types';
import { BusinessTile } from '../src/components/BusinessTile';
import { CountryProvider } from '../src/CountryContext';

type Result = AddressSearchResult | BusinessSearchResult;
const searches = vi.hoisted(() => ({
  owners: vi.fn<(query: string) => Promise<Result>>(),
  addresses: vi.fn<(query: string) => Promise<Result>>(),
}));
vi.mock('../src/api', () => ({
  searchBusinessOwners: searches.owners,
  searchAddress: searches.addresses,
}));

function owners(query: string, empty = false): BusinessSearchResult {
  return {
    query, totalMatches: empty ? 0 : 1,
    companies: empty ? [] : [{ registrationNumber: query, owners: [] }],
    source: 'Test registry', fetchedAt: '2026-09-06T07:00:00Z',
  };
}

function addresses(query: string, empty = false): AddressSearchResult {
  return {
    query, total: empty ? 0 : 1,
    addresses: empty ? [] : [{
      code: 1, fullAddress: `${query} address`, name: query, postalCode: '', lat: null, lon: null,
    }],
    source: 'Test registry', fetchedAt: '2026-09-06T07:00:00Z',
  };
}

function deferred() {
  let resolve!: (value: Result) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Result>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const cases = [
  {
    name: 'owners', input: /search beneficial owners/i, button: 'Search',
    retry: 'Retry owner search', mock: searches.owners, result: owners,
    resultText: (query: string) => `Reg# ${query}`, empty: /No owners found/,
  },
  {
    name: 'addresses', input: /search Latvian addresses/i, button: 'Search addresses',
    retry: 'Retry address search', mock: searches.addresses, result: addresses,
    resultText: (query: string) => `${query} address`, empty: /No addresses found/,
  },
];

async function mount() {
  render(<CountryProvider><BusinessTile euFunds={null} euLoading={false} /></CountryProvider>);
  await act(async () => {});
}

beforeEach(() => { searches.owners.mockReset(); searches.addresses.mockReset(); });
afterEach(cleanup);

describe.each(cases)('$name registry search', (search) => {
  it('validates the trimmed query before either keyboard or button submission', async () => {
    await mount();
    const input = screen.getByRole('textbox', { name: search.input });
    fireEvent.change(input, { target: { value: '  ab  ' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(search.mock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: search.button }).hasAttribute('disabled')).toBe(true);

    search.mock.mockResolvedValue(search.result('Alpha'));
    fireEvent.change(input, { target: { value: '  Alpha  ' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(search.mock).toHaveBeenCalledWith('Alpha');
    expect(screen.getByText(search.resultText('Alpha'))).toBeTruthy();
  });

  it('removes old results on editing and reports failure against the submitted query', async () => {
    search.mock.mockResolvedValueOnce(search.result('Alpha'));
    await mount();
    const input = screen.getByRole('textbox', { name: search.input });
    const statusNodes = screen.getAllByRole('status');
    fireEvent.change(input, { target: { value: 'Alpha' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: search.button })); });
    expect(screen.getByText(search.resultText('Alpha'))).toBeTruthy();

    const pending = deferred();
    search.mock.mockReturnValueOnce(pending.promise);
    fireEvent.change(input, { target: { value: 'Beta' } });
    expect(screen.queryByText(search.resultText('Alpha'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: search.button }));
    expect(screen.getByText(new RegExp(`Searching ${search.name} for "Beta"`))).toBeTruthy();
    await act(async () => { pending.reject(new Error('503')); });

    expect(screen.getByText(new RegExp(`Could not search ${search.name} for "Beta"`))).toBeTruthy();
    expect(screen.queryByText(search.resultText('Alpha'))).toBeNull();
    expect(screen.getByRole('button', { name: search.retry })).toBeTruthy();
    for (const [index, node] of statusNodes.entries()) {
      expect(screen.getAllByRole('status')[index]).toBe(node);
    }
  });

  it('retries the failed query and replaces the failure with matching results', async () => {
    search.mock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(search.result('Alpha'));
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: search.input }), { target: { value: 'Alpha' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: search.button })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: search.retry })); });
    expect(search.mock.mock.calls).toEqual([['Alpha'], ['Alpha']]);
    expect(screen.queryByText(/Could not search/)).toBeNull();
    expect(screen.getByText(search.resultText('Alpha'))).toBeTruthy();
  });

  it('names an empty query result and suggests another search', async () => {
    search.mock.mockResolvedValue(search.result('Nobody', true));
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: search.input }), { target: { value: 'Nobody' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: search.button })); });
    const message = screen.getByText(search.empty);
    expect(message.textContent).toContain('"Nobody"');
    expect(message.textContent).toContain('Try another');
    expect(message.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('button', { name: search.retry })).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('ignores an older request that later %ss', async (outcome) => {
    const first = deferred();
    const second = deferred();
    search.mock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await mount();
    const input = screen.getByRole('textbox', { name: search.input });
    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => { second.resolve(search.result('Beta')); });
    await act(async () => {
      if (outcome === 'resolve') first.resolve(search.result('Alpha'));
      else first.reject(new Error('old failure'));
    });
    expect(screen.getByText(search.resultText('Beta'))).toBeTruthy();
    expect(screen.queryByText(search.resultText('Alpha'))).toBeNull();
    expect(screen.queryByText(/Could not search/)).toBeNull();
  });

  it('does not restore a pending result after the input changes without resubmission', async () => {
    const pending = deferred();
    search.mock.mockReturnValue(pending.promise);
    await mount();
    const input = screen.getByRole('textbox', { name: search.input });
    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'Beta' } });
    await act(async () => { pending.resolve(search.result('Alpha')); });
    expect(screen.queryByText(search.resultText('Alpha'))).toBeNull();
    expect(screen.queryByText(/Searching .* for/)).toBeNull();
    expect(search.mock).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest request loading when an earlier request fails', async () => {
    const first = deferred();
    const second = deferred();
    search.mock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await mount();
    const input = screen.getByRole('textbox', { name: search.input });
    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => { first.reject(new Error('old failure')); });
    expect(screen.getByText(new RegExp(`Searching ${search.name} for "Beta"`))).toBeTruthy();
    expect(screen.queryByRole('button', { name: search.retry })).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(search.mock).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(search.result('Beta')); });
    expect(screen.getByText(search.resultText('Beta'))).toBeTruthy();
  });

  it('does not submit the same pending query twice through Enter', async () => {
    const pending = deferred();
    search.mock.mockReturnValue(pending.promise);
    await mount();
    const input = screen.getByRole('textbox', { name: search.input });
    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(search.mock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: search.button }).hasAttribute('disabled')).toBe(true);
    await act(async () => { pending.resolve(search.result('Alpha')); });
  });
});

it('keeps business panels stacked until xl and gives each a callout heading', async () => {
  await mount();
  const heading = screen.getByRole('heading', { name: 'Who Owns This Company?', level: 3 });
  expect(heading.classList.contains('text-callout')).toBe(true);
  const grid = heading.parentElement?.parentElement;
  expect(grid?.classList.contains('xl:grid-cols-3')).toBe(true);
  expect(grid?.classList.contains('md:grid-cols-3')).toBe(false);
  for (const name of ['Address Lookup', 'EU Recovery & Resilience Fund']) {
    expect(screen.getByRole('heading', { name, level: 3 }).classList.contains('text-callout')).toBe(true);
  }
});
