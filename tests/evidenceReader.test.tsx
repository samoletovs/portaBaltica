import { createHash, webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  evidenceBindingKey, evidenceFileUrl, evidenceHealth, fetchEvidencePack, resolveEvidenceSource,
} from '../src/evidence-api';
import {
  EVIDENCE_SELECTION, EVIDENCE_SERIES, type EvidenceIndex, type EvidenceManifest,
  type EvidenceComparison, type EvidenceNormalized, type EvidenceSummary,
} from '../src/evidence-types';
import { isEvidenceTimestamp, parseEvidenceIndex, parseEvidenceManifest, parseEvidenceMonth } from '../src/evidence-validation';
import type { ProvenanceSource } from '../src/news-types';
import { EvidenceCatalogue } from '../src/components/news/EvidenceCatalogue';
import { EvidencePage } from '../src/components/news/EvidencePage';
import { EvidenceRevisions } from '../src/components/news/EvidenceRevisions';
import { EvidenceSourceLink } from '../src/components/news/EvidenceSourceLink';
import { ProvenanceBlock } from '../src/components/news/ProvenanceBlock';
import { DashboardNav } from '../src/components/Header';
import { tierAArticle } from './fixtures/articles';

const ID = 'a'.repeat(32);

async function eventually<T>(read: () => T): Promise<T> {
  let failure: unknown;
  for (let turn = 0; turn < 200; turn += 1) {
    try {
      return read();
    } catch (error) {
      failure = error;
    }
    await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
  }
  throw failure;
}
const BEFORE = 'b'.repeat(32);
const RETRIEVED = '2026-09-13T10:00:00Z';
const URL = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?geo=EE&geo=LV&geo=LT&freq=M&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const source: ProvenanceSource = { source_id: 'eurostat', dataset: 'une_rt_m', retrieved_at: RETRIEVED, url: URL };
const request = vi.fn<typeof fetch>();
let responses: Map<string, string | number>;

function path(file: string, id = ID) {
  return `/articles/evidence/v1/snapshots/${id}/${file}`;
}
function data(): EvidenceNormalized {
  return {
    format_version: 1, series_id: EVIDENCE_SERIES, dataset: 'une_rt_m', selection: EVIDENCE_SELECTION,
    start_period: '2020-01', source_updated_at: '2026-09-01T23:00:00+0200',
    rows: [
      { geo: 'EE', period: '2026-07', value: 0, missing: false, status: '' },
      { geo: 'LV', period: '2026-07', value: 7.31234, missing: false, status: 'p' },
      { geo: 'LV', period: '2026-06', value: null, missing: true, status: 'u' },
      { geo: 'LT', period: '2026-07', value: 6.1, missing: false, status: '' },
    ],
  };
}
function pack(normalized = data()): EvidenceManifest {
  const raw = '{"exact":"original source response"}\n';
  const csv = 'geo,period,value,status,missing\nLV,2026-06,,u,true\n';
  const dictionary = '{"columns":{"value":"Missing is not zero"}}\n';
  const normalizedBytes = JSON.stringify(normalized);
  const manifest: EvidenceManifest = {
    format_version: 1, series_id: EVIDENCE_SERIES, snapshot_id: ID, status: 'complete',
    created_at: '2026-09-13T12:00:00Z',
    provenance: { request_url: URL, retrieved_at: RETRIEVED, sha256: hash(raw), http_status: 200 },
    artifacts: {
      'normalized.json': { sha256: hash(normalizedBytes) },
      'observations.csv': { sha256: hash(csv) }, 'dictionary.json': { sha256: hash(dictionary) },
    },
    row_count: normalized.rows.length, missing_count: normalized.rows.filter(row => row.missing).length,
    flagged_count: normalized.rows.filter(row => row.status).length,
    attribution: 'Source: Eurostat',
    modifications: 'Selected Baltic countries and periods; normalized to JSON and CSV. Raw response retained.',
    disclaimer: 'Eurostat is not responsible for this transformed archive or its interpretation.',
  };
  responses.set(path('manifest.json'), JSON.stringify(manifest));
  responses.set(path('normalized.json'), normalizedBytes);
  responses.set(path('source.json'), raw);
  responses.set(path('observations.csv'), csv);
  responses.set(path('dictionary.json'), dictionary);
  return manifest;
}
function summary(id = ID, observed = RETRIEVED): EvidenceSummary {
  return { snapshot_id: id, observed_at: observed, source_updated_at: '2026-09-01T23:00:00+0200', row_count: 4, missing_count: 1, flagged_count: 2 };
}
function index(): EvidenceIndex {
  return {
    version: 1, series_id: EVIDENCE_SERIES, dataset: 'une_rt_m', title: 'Baltic unemployment evidence archive',
    selection: EVIDENCE_SELECTION, start_period: '2020-01', stale_after_hours: 26,
    last_attempt: { attempted_at: RETRIEVED, finished_at: RETRIEVED, status: 'captured' },
    last_success_at: RETRIEVED, latest_snapshot_id: ID, months: ['2026-09'], recent: [summary()],
  };
}
function binding(overrides: Record<string, unknown> = {}) {
  const manifest = pack();
  const key = hash(['eurostat', 'une_rt_m', RETRIEVED, URL].join('\n'));
  responses.set(`/articles/evidence/v1/bindings/${key}.json`, JSON.stringify({
    version: 1, source_id: 'eurostat', dataset: 'une_rt_m', observed_at: RETRIEVED,
    request_url: URL, snapshot_id: ID, raw_sha256: manifest.provenance.sha256, ...overrides,
  }));
  return key;
}
function comparisonPack() {
  const before = data();
  before.rows[0].status = 'p';
  before.rows[1].value = 7.1;
  const prior = pack(before);
  responses.set(path('manifest.json', BEFORE), JSON.stringify({
    ...prior, snapshot_id: BEFORE, provenance: { ...prior.provenance, retrieved_at: '2026-09-01T10:00:00Z' },
  }));
  responses.set(path('normalized.json', BEFORE), JSON.stringify(before));
  const after = data();
  after.rows[2] = { ...after.rows[2], value: 1.1, missing: false, status: '' };
  after.rows[3] = { ...after.rows[3], value: null, missing: true };
  after.rows.push({ geo: 'LV', period: '2020-01', value: 5, missing: false, status: '' });
  after.rows.push({ geo: 'EE', period: '2026-08', value: 0, missing: false, status: '' });
  const manifest = pack(after);
  const comparison: EvidenceComparison = {
    before: BEFORE, after: ID, unchanged: false, metadata_changed: false, value_revisions: 1,
    changes: [
      { geo: 'EE', period: '2026-07', kind: 'status_change', before: before.rows[0], after: after.rows[0] },
      { geo: 'LV', period: '2026-07', kind: 'value_revision', before: before.rows[1], after: after.rows[1] },
      { geo: 'LV', period: '2026-06', kind: 'filled_missing', before: before.rows[2], after: after.rows[2] },
      { geo: 'LT', period: '2026-07', kind: 'became_missing', before: before.rows[3], after: after.rows[3] },
      { geo: 'LV', period: '2020-01', kind: 'new_period', before: null, after: after.rows[4] },
      { geo: 'EE', period: '2026-08', kind: 'new_period', before: null, after: after.rows[5] },
    ],
  };
  manifest.previous_snapshot_id = BEFORE;
  manifest.artifacts['comparison.json'] = { sha256: hash(JSON.stringify(comparison)) };
  responses.set(path('comparison.json'), JSON.stringify(comparison));
  responses.set(path('manifest.json'), JSON.stringify(manifest));
  return { manifest, comparison };
}
function showPage(route = `/evidence/${ID}`) {
  return render(<MemoryRouter initialEntries={[route]}><Routes>
    <Route path="/evidence" element={<EvidenceCatalogue />} />
    <Route path="/evidence/:snapshotId" element={<EvidencePage />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  responses = new Map();
  request.mockReset();
  request.mockImplementation(async input => {
    const result = responses.get(String(input));
    if (typeof result === 'string') return new Response(result, { status: 200 });
    return new Response('', { status: result ?? 404 });
  });
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('URL', class extends globalThis.URL {
    static createObjectURL() { return 'blob:evidence'; }
    static revokeObjectURL() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('untrusted archive contracts', () => {
  it.each([
    { status: ['failed'] }, { status: ['captured'] }, { status: { state: 'failed' } },
    { status: null }, { status: 0 },
  ])('rejects a non-string capture status: $status', ({ status }) => {
    const original = index();
    expect(() => parseEvidenceIndex({
      ...original, last_attempt: { ...original.last_attempt, status },
    })).toThrow();
  });

  it('accepts the pinned contract including Eurostat source timezone syntax', () => {
    expect(parseEvidenceIndex(index()).recent[0].source_updated_at).toContain('+0200');
    expect(parseEvidenceManifest(pack(), ID).snapshot_id).toBe(ID);
  });

  it.each([
    '2026-02-30T10:00:00Z', '2026-02-29T10:00:00Z', '1900-02-29T10:00:00Z',
    '2026-04-31T10:00:00Z', '2026-13-01T10:00:00Z', '2026-00-01T10:00:00Z',
    '2026-01-00T10:00:00Z', '0000-01-01T10:00:00Z', '2026-09-13T24:00:00Z',
    '2026-09-13T10:60:00Z', '2026-09-13T10:00:60Z', '2026-09-13T10:00:00+24:00',
    '2026-09-13T10:00:00+02:60', '2026-09-13T10:00:00', '2026-09-13',
  ])('rejects impossible or timezone-free evidence timestamp %s', value => {
    expect(isEvidenceTimestamp(value)).toBe(false);
    expect(() => parseEvidenceIndex({ ...index(), last_success_at: value })).toThrow();
    expect(evidenceHealth({ ...index(), last_success_at: value }, Date.parse(RETRIEVED)).label).toBe('Archive timing invalid');
  });

  it.each([
    '2024-02-29T23:59:59Z', '2000-02-29T10:00:00+0200',
    '2026-09-13T10:00:00.123456+02:00', '2026-01-01T00:00:00-05:30',
  ])('accepts real calendar dates with explicit timezone without rewriting %s', value => {
    expect(isEvidenceTimestamp(value)).toBe(true);
    const manifest = pack();
    expect(parseEvidenceManifest({
      ...manifest, provenance: { ...manifest.provenance, retrieved_at: value },
    }, ID).provenance.retrieved_at).toBe(value);
  });

  it('refuses impossible source-update and monthly capture dates, not just health dates', async () => {
    const impossible = '2026-02-30T10:00:00+0200';
    expect(() => parseEvidenceMonth({
      version: 1, month: '2026-02', snapshots: [summary(ID, impossible)],
    }, '2026-02')).toThrow();
    expect(() => parseEvidenceIndex({
      ...index(), recent: [{ ...summary(), source_updated_at: impossible }],
    })).toThrow();
    pack({ ...data(), source_updated_at: impossible });
    await expect(fetchEvidencePack(ID)).rejects.toMatchObject({ kind: 'integrity' });
  });

  it('cannot label a normalized February 30 retrieval fresh on March 2', () => {
    const impossible = '2026-02-30T10:00:00Z';
    const forged: EvidenceIndex = {
      ...index(), last_success_at: impossible,
      last_attempt: { attempted_at: impossible, finished_at: impossible, status: 'captured' },
      recent: [summary(ID, impossible)], months: ['2026-02'],
    };
    expect(() => parseEvidenceIndex(forged)).toThrow();
    expect(evidenceHealth(forged, Date.parse('2026-03-02T11:00:00Z')).label).toBe('Archive timing invalid');
  });

  it.each(['../private', 'A'.repeat(32), ID + '?file=secret', '//evil.example'])('refuses unsafe snapshot ID %s before any network call', async id => {
    await expect(fetchEvidencePack(id)).rejects.toMatchObject({ kind: 'integrity' });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects arbitrary source links and inconsistent measurement selections', () => {
    const manifest = pack();
    expect(() => parseEvidenceManifest({ ...manifest, provenance: { ...manifest.provenance, request_url: 'javascript:alert(1)' } }, ID)).toThrow();
    expect(() => parseEvidenceManifest({ ...manifest, provenance: { ...manifest.provenance, request_url: URL.replace('s_adj=SA', 's_adj=NSA') } }, ID)).toThrow();
    expect(() => parseEvidenceIndex({ ...index(), selection: { ...EVIDENCE_SELECTION, unit: 'NR' } })).toThrow();
  });

  it('rejects incomplete manifests, missing download hashes and wrong snapshot identities', () => {
    const manifest = pack();
    expect(() => parseEvidenceManifest({ ...manifest, status: 'partial' }, ID)).toThrow();
    expect(() => parseEvidenceManifest({ ...manifest, artifacts: {} }, ID)).toThrow();
    expect(() => parseEvidenceManifest(manifest, BEFORE)).toThrow();
  });

  it('does not use metadata artifact names as download destinations', () => {
    const manifest = pack();
    const checked = parseEvidenceManifest({ ...manifest, artifacts: {
      ...manifest.artifacts, 'observations.csv': { ...manifest.artifacts['observations.csv'], name: 'https://evil.example/leak.csv' },
    } }, ID);
    expect(evidenceFileUrl(checked.snapshot_id, 'observations.csv')).toBe(path('observations.csv'));
  });

  it('rejects a monthly index that names another month or duplicates captures', () => {
    expect(() => parseEvidenceMonth({ version: 1, month: '2026-09', snapshots: [summary()] }, '2026-08')).toThrow();
    expect(() => parseEvidenceMonth({ version: 1, month: '2026-09', snapshots: [summary(), summary()] }, '2026-09')).toThrow();
  });

  it('withholds observations whose exact JSON bytes disagree with the manifest', async () => {
    pack();
    responses.set(path('normalized.json'), JSON.stringify({ ...data(), rows: [] }));
    await expect(fetchEvidencePack(ID)).rejects.toMatchObject({ kind: 'integrity' });
  });

  it('rejects count or missing-value inconsistencies even with a matching checksum', async () => {
    const normalized = data();
    normalized.rows[0].missing = true;
    pack(normalized);
    await expect(fetchEvidencePack(ID)).rejects.toMatchObject({ kind: 'integrity' });
    const manifest = pack();
    responses.set(path('manifest.json'), JSON.stringify({ ...manifest, flagged_count: 0 }));
    await expect(fetchEvidencePack(ID)).rejects.toMatchObject({ kind: 'integrity' });
  });
});

describe('exact article binding', () => {
  it('uses the exact UTF-8 newline tuple without URL or date normalization', async () => {
    const key = binding();
    expect(await evidenceBindingKey(source)).toBe(key);
    expect(await resolveEvidenceSource(source)).toBe(ID);
    expect(request.mock.calls.map(([url]) => String(url))).toContain(`/articles/evidence/v1/bindings/${key}.json`);
  });

  it.each([
    { source_id: 'other' }, { dataset: 'other' }, { observed_at: '2026-09-13T10:00:00+00:00' },
    { request_url: URL + '&lang=en' }, { snapshot_id: '../raw' }, { raw_sha256: '0'.repeat(64) }, { version: 2 },
  ])('refuses a mismatched returned binding tuple: %j', async overrides => {
    binding(overrides);
    await expect(resolveEvidenceSource(source)).rejects.toMatchObject({ kind: 'integrity' });
  });

  it('verifies an explicit snapshot against its manifest without doing a legacy lookup', async () => {
    pack();
    expect(await resolveEvidenceSource({ ...source, evidence_snapshot_id: ID })).toBe(ID);
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([path('manifest.json')]);
  });

  it('does not infer a match for old sources missing the original URL', async () => {
    expect(await resolveEvidenceSource({ ...source, url: undefined })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('does not calculate a legacy binding for an impossible or timezone-free retrieval', async () => {
    expect(await resolveEvidenceSource({ ...source, retrieved_at: '2026-02-30T10:00:00Z' })).toBeNull();
    expect(await resolveEvidenceSource({ ...source, retrieved_at: '2026-09-13T10:00:00' })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('does not fall back to the latest or nearest capture on a missing binding', async () => {
    responses.set('/articles/evidence/v1/index.json', JSON.stringify(index()));
    render(<MemoryRouter><EvidenceSourceLink source={source} /></MemoryRouter>);
    expect(await eventually(() => screen.getByText('No exact frozen source match is published.'))).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open exact frozen source' })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('renders only the verified exact link and never changes source identity', async () => {
    binding();
    render(<MemoryRouter><EvidenceSourceLink source={source} /></MemoryRouter>);
    const link = await eventually(() => screen.getByRole('link', { name: 'Open exact frozen source' }));
    expect(link.getAttribute('href')).toBe(`/evidence/${ID}`);
    expect(source.url).toBe(URL);
  });

  it('complements the upstream publication table with one exact source link without duplicating or rewriting it', async () => {
    pack();
    const article = tierAArticle();
    article.provenance.sources = [{ ...source, evidence_snapshot_id: ID }];
    article.provenance.published_observations = [{
      article_id: article.id, slug: article.slug, headline: article.headline,
      signal_id: article.provenance.signal_id, metric: 'unemployment_rate', metric_label: 'Unemployment rate',
      geography: 'LV', period: '2026-07', value: 7.31234, unit: '%',
      raw_source: true, summary: false, source_id: 'eurostat', dataset: 'une_rt_m',
      observed_at: RETRIEVED, published_at: article.published_at!,
    }];
    const original = JSON.stringify(article);
    render(<MemoryRouter><ProvenanceBlock provenance={article.provenance} article={article} /></MemoryRouter>);
    const disclosure = screen.getByText('Where this came from').closest('summary');
    if (!disclosure) throw new Error('Missing source disclosure');
    fireEvent.click(disclosure);
    expect((await eventually(() => screen.getByRole('link', { name: 'Open exact frozen source' }))).getAttribute('href')).toBe(`/evidence/${ID}`);
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const table = screen.getByRole('table', { name: /Frozen observations/ });
    expect(within(table).getByText('7.31234')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download frozen evidence as JSON' })).toBeTruthy();
    expect(JSON.stringify(article)).toBe(original);
  });
});

describe('archive reader behaviour', () => {
  it('keeps observation, retrieval and import dates distinct, including missing and flags', async () => {
    pack();
    showPage();
    expect(await eventually(() => screen.getByText('Observation and capture dates'))).toBeTruthy();
    expect(screen.getByText('2026-06 to 2026-07')).toBeTruthy();
    expect(screen.getByText('Source retrieved').nextElementSibling?.textContent).toContain('10:00');
    expect(screen.getByText('Archive pack created').nextElementSibling?.textContent).toContain('12:00');
    const table = screen.getByRole('table', { name: /Latvia/ });
    expect(within(table).getByText('Missing')).toBeTruthy();
    expect(within(table).getByText('7.31234')).toBeTruthy();
    expect(within(table).getByText('p')).toBeTruthy();
    expect(within(table).getByText('u')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'EE' } });
    expect(within(screen.getByRole('table', { name: /Estonia/ })).getByText('0')).toBeTruthy();
    expect(screen.getByText(/complete raw response may include earlier periods and the EU aggregate/)).toBeTruthy();
  });

  it('bounds the default table but keeps all periods and the full CSV available', async () => {
    const normalized = data();
    normalized.rows = normalized.rows.filter(row => row.geo !== 'LV');
    normalized.rows.push(...Array.from({ length: 24 }, (_, n) => ({
      geo: 'LV' as const, period: `${2025 + Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`,
      value: n / 10, status: '', missing: false,
    })));
    pack(normalized);
    showPage();
    const table = await eventually(() => screen.getByRole('table', { name: /Latvia/ }));
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 24 months' }));
    expect(within(table).getAllByRole('row')).toHaveLength(25);
    expect(screen.getByRole('link', { name: 'Download all observations CSV' }).getAttribute('href')).toBe(path('observations.csv'));
  });

  it('separates actual revisions, flag changes, missing values, new months and newly included history', async () => {
    comparisonPack();
    showPage();
    const selector = await eventually(() => screen.getByLabelText('Change category'));
    expect(screen.getByRole('option', { name: 'Revised reading (1)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Flag change (1)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Missing value filled (1)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Reading became missing (1)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'New observation period (1)' })).toBeTruthy();
    fireEvent.change(selector, { target: { value: 'coverage_added' } });
    const revisionTable = screen.getByRole('table', { name: /Original and subsequent/ });
    expect(within(revisionTable).getByRole('rowheader', { name: /2020-01/ })).toBeTruthy();
    expect(within(revisionTable).queryByRole('rowheader', { name: /2026-08/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open previous capture' }).getAttribute('href')).toBe(`/evidence/${BEFORE}`);
    expect(screen.getByRole('link', { name: 'Download every comparison row' }).getAttribute('href')).toBe(path('comparison.json'));
  });

  it('lets a reader inspect every revision and isolate a country without downloading JSON', () => {
    const changes: EvidenceComparison['changes'] = Array.from({ length: 27 }, (_, n) => {
      const geo = n < 13 ? 'EE' : n < 26 ? 'LV' : 'LT';
      const period = n === 12 || n === 25 ? '2026-01' : `2025-${String(n % 12 + 1).padStart(2, '0')}`;
      const before = { geo, period, value: n, missing: false, status: '' } as const;
      return { geo, period, kind: 'value_revision', before, after: { ...before, value: n + 0.125 } };
    });
    render(<MemoryRouter><EvidenceRevisions comparison={{
      before: BEFORE, after: ID, unchanged: false, metadata_changed: false, value_revisions: changes.length, changes,
    }} /></MemoryRouter>);
    const table = screen.getByRole('table', { name: /Original and subsequent/ });
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    const expand = screen.getByRole('button', { name: 'Show all 27 matching changes' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expand);
    expect(within(table).getAllByRole('row')).toHaveLength(28);
    expect(expand.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(screen.getByLabelText('Revision country'), { target: { value: 'LV' } });
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    expect(within(table).getAllByRole('rowheader').every(row => row.textContent?.includes('Latvia'))).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('12 of 13 matching changes for Latvia');
    expect(screen.getByRole('status').getAttribute('aria-atomic')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 13 matching changes' }));
    expect(within(table).getByText('25.125')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Change category'), { target: { value: 'status_change' } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('0 of 0 matching changes for Latvia');
    fireEvent.change(screen.getByLabelText('Change category'), { target: { value: 'value_revision' } });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(13);
    fireEvent.change(screen.getByLabelText('Revision country'), { target: { value: 'LT' } });
    expect(within(screen.getByRole('table')).getByText('26.125')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('prints the whole selected observation and revision view, then restores screen filters and disclosures', async () => {
    const { manifest, comparison } = comparisonPack();
    const normalized: EvidenceNormalized = JSON.parse(responses.get(path('normalized.json')) as string);
    const before: EvidenceNormalized = JSON.parse(responses.get(path('normalized.json', BEFORE)) as string);
    for (let n = 0; n < 24; n += 1) {
      const row = { geo: 'LV', period: `${2023 + Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`, value: 7, missing: false, status: '' } as const;
      before.rows.push(row);
      const after = { ...row, value: 7.25 };
      normalized.rows.push(after);
      comparison.changes.push({ geo: 'LV', period: row.period, kind: 'value_revision', before: row, after });
    }
    const prior: EvidenceManifest = JSON.parse(responses.get(path('manifest.json', BEFORE)) as string);
    for (const [id, record, data] of [[BEFORE, prior, before], [ID, manifest, normalized]] as const) {
      record.row_count = data.rows.length;
      record.artifacts['normalized.json'] = { sha256: hash(JSON.stringify(data)) };
      responses.set(path('normalized.json', id), JSON.stringify(data));
      responses.set(path('manifest.json', id), JSON.stringify(record));
    }
    comparison.value_revisions += 24;
    manifest.artifacts['comparison.json'] = { sha256: hash(JSON.stringify(comparison)) };
    responses.set(path('manifest.json'), JSON.stringify(manifest));
    responses.set(path('comparison.json'), JSON.stringify(comparison));
    showPage();
    await eventually(() => screen.getByLabelText('Change category'));
    fireEvent.change(screen.getByLabelText('Change category'), { target: { value: 'value_revision' } });
    const observations = screen.getByRole('table', { name: /Latvia/ });
    const revisions = screen.getByRole('table', { name: /Original and subsequent/ });
    expect(within(observations).getAllByRole('row')).toHaveLength(13);
    expect(within(revisions).getAllByRole('row')).toHaveLength(13);
    const disclosures = Array.from(document.querySelectorAll('details'));
    expect(disclosures.length).toBeGreaterThan(1);
    const nested = document.createElement('details');
    nested.innerHTML = '<summary>Nested source context</summary><p>Recorded context</p>';
    disclosures[0].appendChild(nested);
    disclosures.push(nested);
    disclosures[1].open = true;
    const original = disclosures.map(details => details.open);
    act(() => { window.dispatchEvent(new Event('beforeprint')); });
    expect(disclosures.every(details => details.open)).toBe(true);
    expect(within(observations).getAllByRole('row')).toHaveLength(28);
    expect(within(revisions).getAllByRole('row')).toHaveLength(26);
    expect(revisions.querySelector('caption')?.textContent).toContain('Revised reading');
    act(() => { window.dispatchEvent(new Event('beforeprint')); });
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(disclosures.map(details => details.open)).toEqual(original);
    expect(within(observations).getAllByRole('row')).toHaveLength(13);
    expect(within(revisions).getAllByRole('row')).toHaveLength(13);
    expect((screen.getByLabelText('Change category') as HTMLSelectElement).value).toBe('value_revision');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 25 matching changes' }));
    act(() => { window.dispatchEvent(new Event('beforeprint')); });
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(within(revisions).getAllByRole('row')).toHaveLength(26);
  });

  it('removes print listeners and restores disclosures when leaving a snapshot during print', async () => {
    pack();
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const view = showPage();
    await eventually(() => screen.getByRole('heading', { name: 'Frozen observations' }));
    const disclosures = Array.from(document.querySelectorAll('details'));
    disclosures[1].open = true;
    const original = disclosures.map(details => details.open);
    const listeners = added.mock.calls.filter(([name]) => name === 'beforeprint' || name === 'afterprint');
    expect(listeners.map(([name]) => name).sort()).toEqual(['afterprint', 'beforeprint']);
    act(() => { window.dispatchEvent(new Event('beforeprint')); });
    expect(disclosures.every(details => details.open)).toBe(true);
    view.unmount();
    expect(disclosures.map(details => details.open)).toEqual(original);
    for (const [name, listener] of listeners) expect(removed).toHaveBeenCalledWith(name, listener);
    act(() => { window.dispatchEvent(new Event('beforeprint')); });
    expect(disclosures.map(details => details.open)).toEqual(original);
  });

  it('refuses a checksum-valid comparison that silently omits a changed observation', async () => {
    const { manifest, comparison } = comparisonPack();
    comparison.changes = comparison.changes.filter(change => change.kind !== 'status_change');
    const body = JSON.stringify(comparison);
    manifest.artifacts['comparison.json'] = { sha256: hash(body) };
    responses.set(path('comparison.json'), body);
    responses.set(path('manifest.json'), JSON.stringify(manifest));
    await expect(fetchEvidencePack(ID)).rejects.toMatchObject({ kind: 'integrity' });
  });

  it('reaches old captures outside the recent list through the complete monthly index', async () => {
    responses.set('/articles/evidence/v1/index.json', JSON.stringify({ ...index(), months: ['2026-09', '2025-01'] }));
    const old = Array.from({ length: 25 }, (_, n) => summary(n.toString(16).padStart(32, '0'), `2025-01-01T10:${String(n).padStart(2, '0')}:00Z`));
    responses.set('/articles/evidence/v1/months/2025-01.json', JSON.stringify({ version: 1, month: '2025-01', snapshots: old }));
    showPage('/evidence');
    const selector = await eventually(() => screen.getByLabelText('Retrieval month'));
    fireEvent.change(selector, { target: { value: '2025-01' } });
    const older = await eventually(() => screen.getByRole('button', { name: 'Older captures' }));
    fireEvent.click(older);
    fireEvent.click(older);
    await eventually(() => expect(screen.getByRole('link', { name: /Retrieved 1 Jan 2025, 10:00 UTC/ }).getAttribute('href')).toBe(`/evidence/${'0'.repeat(32)}`));
    expect(older.hasAttribute('disabled')).toBe(true);
  });

  it('never gives failed, stale, missing or recycled ancient observations a fresh label', () => {
    const now = Date.parse('2026-09-13T11:00:00Z');
    expect(evidenceHealth(index(), now).warning).toBe(false);
    expect(evidenceHealth({ ...index(), last_attempt: { attempted_at: RETRIEVED, finished_at: RETRIEVED, status: 'failed' } }, now).label).toBe('Last capture failed');
    expect(evidenceHealth(index(), now + 48 * 3_600_000).label).toBe('Capture overdue');
    expect(evidenceHealth({ ...index(), last_attempt: null }, now).label).toBe('No confirmed capture');
    expect(evidenceHealth({ ...index(), last_success_at: '2026-01-01T00:00:00Z', recent: [summary(ID, '2026-01-01T00:00:00Z')] }, now).label).toBe('Capture overdue');
  });

  it('caps metadata freshness at 26 hours rather than trusting a longer declaration', () => {
    const now = Date.parse(RETRIEVED);
    expect(evidenceHealth({ ...index(), stale_after_hours: 1000 }, now + 26 * 3_600_000).warning).toBe(false);
    expect(evidenceHealth({ ...index(), stale_after_hours: 1000 }, now + 26 * 3_600_000 + 1).label).toBe('Capture overdue');
  });

  it('does not turn a current cache attempt into a fresh source retrieval', () => {
    const now = Date.parse('2026-09-15T10:00:00Z');
    const attempt = { attempted_at: '2026-09-15T10:00:00Z', finished_at: '2026-09-15T10:00:00Z', status: 'reused' as const };
    expect(evidenceHealth({ ...index(), last_attempt: attempt }, now).label).toBe('Capture overdue');
    const fresh = { ...index(), last_attempt: { ...attempt, status: 'unchanged' as const },
      last_success_at: attempt.finished_at };
    expect(evidenceHealth(fresh, now).label).toBe('Source checked, unchanged');
  });

  it('fails explicitly on malformed and future timing rather than calling it stale or fresh', () => {
    const now = Date.parse(RETRIEVED);
    expect(evidenceHealth({ ...index(), last_success_at: 'not-a-date' }, now).label).toBe('Archive timing invalid');
    expect(evidenceHealth({ ...index(), last_success_at: '2026-09-13T10:00:01Z' }, now).label).toBe('Archive timing invalid');
    expect(evidenceHealth({ ...index(), last_attempt: {
      attempted_at: '2026-09-13T10:00:01Z', finished_at: '2026-09-13T10:00:01Z', status: 'captured',
    } }, now).label).toBe('Archive timing invalid');
  });

  it('keeps frozen detail metadata aligned with the shared non-indexable page policy', async () => {
    pack();
    showPage();
    await eventually(() => screen.getByRole('heading', { name: 'Observation and capture dates' }));
    expect(document.title).toBe('Frozen evidence | portaBaltica');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'A timestamped Baltic unemployment snapshot with original source data, missing-value flags and reproducible downloads.',
    );
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${window.location.origin}/evidence/${ID}`);
  });

  it('presents verified download addresses and verifies raw, CSV and dictionary bytes on demand', async () => {
    pack();
    showPage();
    const download = await eventually(() => screen.getByRole('link', { name: 'Download original source JSON' }));
    expect(download.getAttribute('href')).toBe(path('source.json'));
    expect(download.hasAttribute('download')).toBe(true);
    expect(screen.getByRole('link', { name: 'Download data dictionary' }).getAttribute('href')).toBe(path('dictionary.json'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify all downloads' }));
    expect(await eventually(() => screen.getByText(/Source, CSV and dictionary bytes match/))).toBeTruthy();
    expect(request.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([path('source.json'), path('observations.csv'), path('dictionary.json')]));
  });

  it('saves byte-identical source content via a local download even when storage is cross-origin', async () => {
    pack();
    const saved: NodeBlob[] = [];
    const create = vi.fn((blob: Blob | MediaSource) => {
      if (blob instanceof NodeBlob) saved.push(blob);
      return 'blob:verified-source';
    });
    vi.stubGlobal('Blob', NodeBlob);
    vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation(create);
    vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    showPage();
    fireEvent.click(await eventually(() => screen.getByRole('link', { name: 'Download original source JSON' })));
    expect(await eventually(() => screen.getByText('Checksum matched. Download started.'))).toBeTruthy();
    expect(await saved[0].text()).toBe(responses.get(path('source.json')));
    expect(clicked).toEqual([`portabaltica-${ID}-source.json`]);
  });

  it('does not save source bytes that no longer match the recorded hash', async () => {
    pack();
    responses.set(path('source.json'), '{"tampered":true}');
    const create = vi.spyOn(globalThis.URL, 'createObjectURL');
    showPage();
    fireEvent.click(await eventually(() => screen.getByRole('link', { name: 'Download original source JSON' })));
    expect(await eventually(() => screen.getByRole('alert'))).toHaveProperty('textContent', expect.stringContaining('Download withheld'));
    expect(create).not.toHaveBeenCalled();
  });

  it('reports mismatched download bytes without claiming successful verification', async () => {
    pack();
    responses.set(path('source.json'), '{"changed":true}');
    showPage();
    fireEvent.click(await eventually(() => screen.getByRole('button', { name: 'Verify all downloads' })));
    expect(await eventually(() => screen.getByRole('alert'))).toHaveProperty('textContent', expect.stringContaining('Downloads could not all be verified'));
    expect(screen.queryByText(/Source, CSV and dictionary bytes match/)).toBeNull();
  });

  it.each([
    { status: 404, heading: 'Evidence not found' },
    { status: 503, heading: 'The archive is unavailable' },
  ])('offers recovery for HTTP $status without displaying observations', async ({ status, heading }) => {
    responses.set(path('manifest.json'), status);
    showPage();
    expect(await eventually(() => screen.getByRole('heading', { name: heading }))).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '← Browse capture history' }).getAttribute('href')).toBe('/evidence');
  });

  it('withholds corrupted normalized observations and offers an integrity-specific state', async () => {
    pack();
    responses.set(path('normalized.json'), '{}');
    showPage();
    expect(await eventually(() => screen.getByRole('heading', { name: 'Evidence could not be verified' }))).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps loading accessible until the manifest arrives', () => {
    request.mockImplementation(() => new Promise<Response>(() => {}));
    showPage();
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Reading and verifying frozen evidence');
  });

  it('makes the archive discoverable from the existing data navigation', () => {
    render(<MemoryRouter><DashboardNav active="all" country="LV" /></MemoryRouter>);
    const navigation = screen.getByRole('navigation', { name: 'Dashboard sectors' });
    expect(screen.getByRole('link', { name: 'Evidence archive' }).getAttribute('href')).toBe('/evidence');
    expect(within(navigation).queryByRole('link', { name: 'Evidence archive' })).toBeNull();
  });
});
