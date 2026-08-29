/**
 * `/api/business-search` published its page cap as a match count.
 *
 * It asked CKAN for `limit=50` and emitted `totalMatches: results.length`, and
 * `BusinessTile` renders that inside a sentence naming the query — so a reader
 * searching the beneficial-ownership register was given a specific false answer
 * rather than a vague one. Measured against the datastore's own `total`:
 *
 *     query        site said    truth
 *     Bērziņš             50      904
 *     Kalniņš             50      652
 *     Ozoliņš             50      582
 *
 * Four of four common Latvian surnames landing on exactly the page size is the
 * tell. A real count does not do that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const https = require('https');

let reply: { status?: number; body: unknown } = { body: {} };
let originalGet: typeof https.get;

function stubHttps() {
  originalGet = https.get;
  https.get = (url: string, opts: unknown, cb?: (r: unknown) => void) => {
    const done = typeof opts === 'function' ? (opts as (r: unknown) => void) : cb!;
    const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
    res.statusCode = reply.status || 200;
    res.resume = () => {};
    setImmediate(() => {
      done(res);
      if (res.statusCode >= 200 && res.statusCode < 300) res.emit('data', JSON.stringify(reply.body));
      res.emit('end');
    });
    const req = new EventEmitter() as EventEmitter & { destroy: () => void };
    req.destroy = () => {};
    return req;
  };
}

function callApi(q: string) {
  delete require.cache[require.resolve('../api/business-search/index.js')];
  require('../api/shared/cache.js').clear();
  const handler = require('../api/business-search/index.js');
  const ctx: { res?: { body: string; status: number } } = {};
  return handler(ctx, { query: { q }, headers: {} })
    .then(() => ({ status: ctx.res!.status, body: JSON.parse(ctx.res!.body) }));
}

/** `datastore_search` reports `total` for the whole match set, whatever `limit` it honoured. */
function matches(total: number, returned: number) {
  const records = Array.from({ length: returned }, (_, i) => ({
    legal_entity_registration_number: 'REG' + i, forename: 'A', surname: 'Bērziņš',
  }));
  return { success: true, result: { total, records } };
}

describe('/api/business-search counts matches, not rows returned', () => {
  beforeEach(() => { stubHttps(); });
  afterEach(() => { https.get = originalGet; });

  it('publishes the registry\u2019s count, not the page cap', async () => {
    reply = { body: matches(904, 50) };
    const { body } = await callApi('Bērziņš');
    expect(body.totalMatches).toBe(904);
    expect(body.returned).toBe(50);
    // The shipped value was the cap. It must not be reachable.
    expect(body.totalMatches).not.toBe(50);
  });

  it('says the list stops when the registry holds more', async () => {
    reply = { body: matches(904, 50) };
    const { body } = await callApi('Bērziņš');
    expect(body.truncated).toBe(true);
  });

  it('does not claim truncation when every match is returned', async () => {
    reply = { body: matches(17, 17) };
    const { body } = await callApi('Berzins');
    expect(body.totalMatches).toBe(17);
    expect(body.truncated).toBe(false);
  });

  it('falls back to the rows returned only when the datastore omits a total', async () => {
    // The fallback is safe because it is reached only when the datastore
    // declined to say — never as the default, which is what shipped.
    reply = { body: { success: true, result: { records: [{ legal_entity_registration_number: 'X' }] } } };
    const { body } = await callApi('Bērziņš');
    expect(body.totalMatches).toBe(1);
    expect(body.truncated).toBe(false);
  });
});

describe('BusinessTile tells the reader the list stops', () => {
  beforeEach(() => { vi.resetModules(); });

  async function renderWith(result: Record<string, unknown>) {
    vi.doMock('../src/api', () => ({
      searchBusinessOwners: () => Promise.resolve(result),
      searchAddress: () => Promise.resolve(null),
    }));
    const { BusinessTile } = await import('../src/components/BusinessTile');
    const { CountryProvider } = await import('../src/CountryContext');
    render(
      <CountryProvider>
        <BusinessTile euFunds={null} euLoading={false} />
      </CountryProvider>,
    );
  }

  it('renders the registry count, not the number of rows on screen', async () => {
    const companies = Array.from({ length: 48 }, (_, i) => ({
      registrationNumber: 'REG' + i, owners: [{ forename: 'A', surname: 'Bērziņš' }],
    }));
    await renderWith({
      query: 'Bērziņš', totalMatches: 904, returned: 50, truncated: true,
      companies, source: 'PLG', fetchedAt: '2026-08-29T00:00:00Z',
    });
    const input = screen.getByLabelText(/search beneficial owners/i);
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'Bērziņš' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const line = await screen.findByText(/904 matches/);
    expect(line.textContent).toMatch(/904 matches/);
    // A corrected count beside ten rows must not imply the ten are the answer.
    expect(line.textContent).toMatch(/showing 10/);
    // And the old behaviour — the cap as the count — must be gone.
    expect(line.textContent).not.toMatch(/^\s*50 matches/);
  });
});
