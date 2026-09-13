import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ArticleView } from '../src/components/news/ArticleView';
import { DataExplorerPage } from '../src/components/DataExplorerPage';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { fetchBalticCompare, type BalticCompareData } from '../src/api';
import type { Article, PublishedObservation } from '../src/news-types';
import { tierAArticle } from './fixtures/articles';

vi.mock('../src/api', () => ({ fetchBalticCompare: vi.fn() }));
vi.mock('../src/components/BalticCompareChart', () => ({
  BalticCompareChart: () => <div>Current comparison chart</div>,
}));
vi.mock('../src/components/news/ChartEmbed', () => ({ ChartEmbed: () => <div>Current article chart</div> }));

const definition = { id: 'gdp', title: 'GDP Growth Rate', unit: '% QoQ', freq: 'Q', dataset: 'namq_10_gdp' };
const compare = vi.mocked(fetchBalticCompare);
const response: BalticCompareData = {
  indicator: definition.id, title: definition.title, unit: definition.unit,
  source: 'Eurostat (namq_10_gdp)', dataset: definition.dataset,
  fetchedAt: '2026-09-11T08:00:00Z', reference: null,
  countries: {
    LV: { label: 'Latvia', series: [{ period: '2026-Q1', value: 0 }, { period: '2026-Q2', value: 1.5 }] },
    EE: { label: 'Estonia', series: [{ period: '2026-Q1', value: 0.7 }, { period: '2026-Q2', value: null }] },
    LT: { label: 'Lithuania', series: [{ period: '2026-Q1', value: 1.2 }, { period: '2026-Q2', value: 2.1 }] },
  },
};

function observation(article: Article, overrides: Partial<PublishedObservation> = {}): PublishedObservation {
  const source = article.provenance.sources[0];
  return {
    article_id: article.id, slug: article.slug, headline: article.headline,
    signal_id: article.provenance.signal_id, metric: 'hourly_labour_cost', metric_label: 'Hourly labour cost',
    geography: 'LV', period: '2025', value: 16.31234, unit: 'EUR/hour',
    raw_source: true, summary: false, source_id: source.source_id, dataset: source.dataset ?? null,
    observed_at: source.retrieved_at, published_at: article.published_at!, ...overrides,
  };
}

function articleWithRecord() {
  const article = tierAArticle();
  article.provenance.published_observations = [
    observation(article, { geography: 'Baltic', raw_source: false, summary: true, value: 4.8, comparison_basis: 'Difference between recorded country readings' }),
    observation(article),
    observation(article, { geography: 'EE', value: 21.11234 }),
    observation(article, { geography: 'LT', value: 0 }),
  ];
  return article;
}

function showArticle(article: Article) {
  render(<MemoryRouter initialEntries={[`/article/${article.slug}#article-evidence`]}><ArticleView article={article} /></MemoryRouter>);
}

async function showExplorer(search: string) {
  await act(async () => {
    render(<CountryProvider><FilterProvider><MemoryRouter initialEntries={[`/explore${search}`]}>
      <Routes><Route path="/explore" element={<DataExplorerPage />} /></Routes>
    </MemoryRouter></FilterProvider></CountryProvider>);
  });
  expect(screen.getByLabelText('Inspect one period')).toBeTruthy();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ indicators: [definition] }) }));
  compare.mockResolvedValue(response);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the frozen publication record', () => {
  it('exposes every recorded observation with its own country, period, exact value, unit and source', () => {
    const article = articleWithRecord();
    showArticle(article);
    const record = screen.getByRole('table', { name: /Frozen observations/ });
    const rows = within(record).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(article.provenance.published_observations!.length);
    article.provenance.published_observations!.forEach((point, index) => {
      expect(rows[index].textContent).toContain(point.period);
      expect(rows[index].textContent).toContain(String(point.value));
      expect(rows[index].textContent).toContain(point.unit);
      expect(within(rows[index]).getByRole('link').getAttribute('href')).toBe(article.provenance.sources[0].url);
    });
    expect(within(rows[0]).getByText('Calculated finding')).toBeTruthy();
    expect(within(rows[1]).getByText('Source observation')).toBeTruthy();
    expect(within(rows[3]).getByText('0', { exact: true })).toBeTruthy();
    expect(screen.getByText(/not a complete historical series/)).toBeTruthy();
    expect(compare).not.toHaveBeenCalled();
  });

  it('exports the frozen records losslessly, with publication, source and correction context', async () => {
    const article = articleWithRecord();
    article.corrections = [{ corrected_at: '2026-09-01T12:00:00Z', description: 'The original comparison was corrected.' }];
    const blobs: NodeBlob[] = [];
    vi.stubGlobal('Blob', NodeBlob);
    const OriginalURL = URL;
    vi.stubGlobal('URL', class extends OriginalURL {
      static createObjectURL(blob: Blob | MediaSource) { blobs.push(blob as unknown as NodeBlob); return 'blob:evidence'; }
      static revokeObjectURL() {}
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    showArticle(article);
    const status = screen.getByTestId('frozen-download-status');
    expect(status.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Download frozen evidence as JSON' }));
    const downloaded = JSON.parse(await blobs[0].text());
    expect(downloaded.published_observations).toEqual(article.provenance.published_observations);
    expect(downloaded.sources).toEqual(article.provenance.sources);
    expect(downloaded.corrections).toEqual(article.corrections);
    expect(downloaded.article.published_at).toBe(article.published_at);
    expect(downloaded.record_type).toBe('frozen_publication_evidence');
    expect(screen.getByTestId('frozen-download-status')).toBe(status);
    expect(status.textContent).toContain('download started');
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByText(/Read the correction notices before reusing/)).toBeTruthy();
  });

  it('states an absent historical record instead of substituting today’s API values', () => {
    showArticle(tierAArticle());
    expect(screen.getByText(/Frozen observations were not recorded with this article/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download frozen evidence as JSON' })).toBeNull();
    expect(compare).not.toHaveBeenCalled();
  });

  it('does not publish a foreign article’s observation as this story’s evidence', () => {
    const article = articleWithRecord();
    article.provenance.published_observations!.push(observation(article, { article_id: 'other-article', value: 99999 }));
    showArticle(article);
    expect(within(screen.getByRole('table', { name: /Frozen observations/ })).getAllByRole('row')).toHaveLength(5);
    expect(screen.getByText(/1 recorded entry could not be matched/)).toBeTruthy();
    expect(screen.queryByText('99999', { exact: true })).toBeNull();
  });

  it('keeps the table usable and announces a browser download failure', () => {
    const OriginalURL = URL;
    vi.stubGlobal('URL', class extends OriginalURL {
      static createObjectURL(): string { throw new Error('Downloads blocked'); }
    });
    showArticle(articleWithRecord());
    const status = screen.getByTestId('frozen-download-status');
    fireEvent.click(screen.getByRole('button', { name: 'Download frozen evidence as JSON' }));
    expect(status.textContent).toContain('Download is not available in this browser');
    expect(screen.getByRole('table', { name: /Frozen observations/ })).toBeTruthy();
  });

  it('does not invent a source URL for recorded evidence when none was retained', () => {
    const article = articleWithRecord();
    delete article.provenance.sources[0].url;
    showArticle(article);
    const table = screen.getByRole('table', { name: /Frozen observations/ });
    expect(within(table).queryAllByRole('link')).toHaveLength(0);
    expect(within(table).getAllByText('Source link not recorded')).toHaveLength(4);
  });
});

describe('reproducible explorer links', () => {
  it('restores a shared history window, representation, country and period before requesting data', async () => {
    await showExplorer('?indicator=gdp&country=EE&years=3&view=table&period=2026-Q2');
    expect(compare.mock.calls).toEqual([['gdp', 3]]);
    expect(screen.getByRole('button', { name: 'Show 3 years of data' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Switch to Estonia' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Inspect one period') as HTMLSelectElement).value).toBe('2026-Q2');
    expect(screen.getByText('Not published')).toBeTruthy();
  });

  it('copies the selected state and lets history controls change a restored window', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await showExplorer('?indicator=gdp&country=EE&years=10&view=table&period=2026-Q2');
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 years of data' }));
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('Inspect one period'), { target: { value: '2026-Q1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy measure link' })); });
    const link = new URL(writeText.mock.calls[0][0]);
    expect(Object.fromEntries(link.searchParams)).toEqual({ country: 'EE', years: '3', view: 'table', period: '2026-Q1' });
    expect(compare.mock.calls).toEqual([['gdp', 10], ['gdp', 3]]);
  });

  it('names an unavailable shared period without silently presenting a replacement as the selection', async () => {
    await showExplorer('?indicator=gdp&years=999&view=invalid&period=1999-Q1');
    expect(compare.mock.calls).toEqual([['gdp', 5]]);
    expect(screen.getByRole('button', { name: 'Chart' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Shared period 1999-Q1 is not available in this window/)).toBeTruthy();
    expect((screen.getByLabelText('Inspect one period') as HTMLSelectElement).value).toBe('2026-Q1');
  });
});
