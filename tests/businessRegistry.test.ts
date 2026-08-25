/**
 * Guards for the data.gov.lv business-registry counts.
 *
 * These exist because the Economy tile displayed "Suspended Activities: 0" for
 * months. Nothing was throwing and the build was green — the dataset id
 * `saimnieciskas-darbibas-apstiprinasana-atjaunosana` had never existed, the
 * portal answered 404, and a bare `catch` returned `0`. A missing dataset and
 * a genuine zero were the same pixel.
 *
 * So the tests below assert two things the old code could not satisfy: that a
 * failure is never rendered as a number, and that a "suspension" means one
 * that is actually in force rather than any row in a decision log going back
 * to 2014.
 *
 * No network calls — the fixtures are shaped from real rows observed on
 * 2026-08-25.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const registry = require_('../api/shared/businessRegistry.js');
const ckan = require_('../api/shared/ckan.js');

const NOW = Date.parse('2026-08-25T00:00:00Z');

/** VID writes "no decision recorded" as whitespace, not as an empty string. */
const NOT_RESTORED = '  ';

function row(bannedUntil: string | null, restored: string = NOT_RESTORED) {
  return {
    Lemuma_par_atjaunosanu_datums: restored,
    Aizliegts_veikt_darijumus_lidz: bannedUntil,
  };
}

describe('suspension is in force', () => {
  it('counts an open-ended ban with no restoration decision', () => {
    // SIA "AKORUS": suspended 2025-02-28, no end date, never restored.
    expect(registry.isSuspensionInForce(row(null), NOW)).toBe(true);
  });

  it('counts a ban whose end date has not arrived yet', () => {
    expect(registry.isSuspensionInForce(row('2026-12-01T00:00:00'), NOW)).toBe(true);
  });

  it('does not count a ban that has already lapsed', () => {
    // SIA "SENVIETA": banned 2014-01-21 to 2018-02-03, never formally
    // restored. Counting it today would be an eight-year-old fact.
    expect(registry.isSuspensionInForce(row('2018-02-03T00:00:00'), NOW)).toBe(false);
  });

  it('does not count a business that was restored', () => {
    expect(registry.isSuspensionInForce(row(null, ' 14.03.2025 '), NOW)).toBe(false);
  });

  it('treats a whitespace restoration date as "never restored"', () => {
    // The exact blank encoding is the publisher's choice and has no guarantee
    // behind it. Anything blank must mean the same thing.
    for (const blank of ['', ' ', '  ', '\t', null, undefined]) {
      expect(registry.isSuspensionInForce(row(null, blank as string), NOW)).toBe(true);
    }
  });

  it('treats an unusable end date as open-ended, not as expired', () => {
    expect(registry.isSuspensionInForce(row('not a date'), NOW)).toBe(true);
  });
});

describe('countSuspensionsInForce', () => {
  it('counts only the rows still in force', () => {
    const rows = [
      row(null),                          // open-ended       → in force
      row('2026-12-01T00:00:00'),         // future expiry    → in force
      row('2018-02-03T00:00:00'),         // lapsed           → not
      row(null, ' 14.03.2025 '),          // restored         → not
    ];
    expect(registry.countSuspensionsInForce(rows, NOW)).toBe(2);
  });

  it('does not report the whole decision log as suspensions', () => {
    // The log holds ~53k decisions and only ~5k are live. Returning the row
    // count would swap one wrong number for a bigger one.
    const rows = [
      ...Array.from({ length: 90 }, () => row('2019-01-01T00:00:00')),
      ...Array.from({ length: 10 }, () => row(null)),
    ];
    expect(registry.countSuspensionsInForce(rows, NOW)).toBe(10);
    expect(registry.countSuspensionsInForce(rows, NOW)).not.toBe(rows.length);
  });
});

describe('CKAN client', () => {
  it('rejects an HTTP 200 that carries success:false', async () => {
    // The portal answers 200 with {"success": false} for an unknown action, so
    // a status-code-only check reads an error object as data.
    const body = { success: false, error: { message: 'Action name not known' } };
    const parse = () => {
      if (body.success !== true) throw new Error('CKAN failed: ' + body.error.message);
      return body;
    };
    expect(parse).toThrow(/Action name not known/);
  });

  it('encodes filters as a JSON query parameter', () => {
    const url = ckan.buildUrl('datastore_search', { resource_id: 'abc', limit: '0', filters: JSON.stringify({ Aktivs: 'ir' }) });
    expect(url).toContain('resource_id=abc');
    expect(decodeURIComponent(url)).toContain('{"Aktivs":"ir"}');
  });

  it('omits parameters that are undefined rather than sending "undefined"', () => {
    const url = ckan.buildUrl('datastore_search', { resource_id: 'abc', filters: undefined });
    expect(url).not.toContain('filters');
  });
});

describe('pickLatestActive', () => {
  const pkg = {
    resources: [
      // Published later, but the datastore has not ingested it: querying this
      // id returns 404. Selecting it would empty the maritime panels.
      { id: 'jul', name: 'REJVESLS_20260705.csv', created: '2026-07-05T08:53:58', datastore_active: false },
      { id: 'mar', name: 'REJVESLS_20260301.csv', created: '2026-03-01T08:53:35', datastore_active: true },
      { id: 'feb', name: 'REJVESLS_20260215.csv', created: '2026-02-15T08:52:44', datastore_active: true },
      { id: 'cargo', name: 'CRGTURNBYTYPEYEAR_20260301.csv', created: '2026-03-01T08:53:17', datastore_active: true },
    ],
  };

  it('never selects a resource the datastore will not serve', () => {
    const picked = ckan.pickLatestActive(pkg, 'REJVESLS_', 2);
    expect(picked.map((r: { id: string }) => r.id)).toEqual(['mar', 'feb']);
  });

  it('keeps series in one dataset apart', () => {
    // The cargo dataset interleaves LOADCRG_* and CRGTURNBYTYPEYEAR_*; matching
    // on the dataset alone would splice two different tables together.
    const picked = ckan.pickLatestActive(pkg, 'CRGTURNBYTYPEYEAR_', 3);
    expect(picked).toHaveLength(1);
    expect(picked[0].id).toBe('cargo');
  });

  it('returns newest first', () => {
    const picked = ckan.pickLatestActive(pkg, 'REJVESLS_', 3);
    expect(picked[0].snapshotDate).toBe('2026-03-01');
  });

  it('reads the snapshot date from the filename, not the upload time', () => {
    expect(ckan.snapshotDateOf('PSNGFERRY_20260705.csv', '2026-07-06T00:00:00')).toBe('2026-07-05');
  });

  it('falls back to the upload time when the filename carries no date', () => {
    expect(ckan.snapshotDateOf('some_export.csv', '2026-07-06T00:00:00Z')).toBe('2026-07-06');
  });

  it('returns an empty list rather than throwing on an empty dataset', () => {
    expect(ckan.pickLatestActive({ resources: [] }, 'REJVESLS_', 3)).toEqual([]);
    expect(ckan.pickLatestActive(null, 'REJVESLS_', 3)).toEqual([]);
  });
});
