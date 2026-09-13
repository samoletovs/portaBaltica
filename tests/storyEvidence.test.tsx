import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { storyEvidence } from '../src/newsroom/story-evidence';
import { StoryEvidenceGraphic, LeadStoryEvidence } from '../src/components/news/StoryEvidenceGraphic';
import { tierAArticle, tierASummary } from './fixtures/articles';
import type { Article, PublishedObservation } from '../src/news-types';
import { loadArticle } from '../src/news-api';
import { ArticleCard } from '../src/components/news/NewsCard';

vi.mock('../src/news-api', () => ({ loadArticle: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function point(article: Article, overrides: Partial<PublishedObservation> = {}): PublishedObservation {
  const source = article.provenance.sources[0];
  return {
    article_id: article.id, slug: article.slug, headline: article.headline,
    signal_id: article.provenance.signal_id, metric: 'salary', metric_label: 'Hourly labour cost',
    geography: 'LV', period: '2025', value: 16.3, unit: 'EUR/hour',
    raw_source: true, summary: false, source_id: source.source_id, dataset: source.dataset ?? null,
    observed_at: source.retrieved_at, published_at: article.published_at!, ...overrides,
  };
}

function comparison() {
  const article = tierAArticle();
  article.provenance.published_observations = [
    point(article, { geography: 'Baltic', raw_source: false, summary: true, value: 4.8 }),
    point(article), point(article, { geography: 'EE', value: 21.1 }), point(article, { geography: 'LT', value: 17.8 }),
  ];
  return article;
}

describe('graphics from the published evidence, not current API values', () => {
  it('compares source observations at the finding period, not the derived gap or a newer period', () => {
    const article = comparison();
    article.provenance.published_observations!.push(point(article, { period: '2026', value: 99 }));
    const model = storyEvidence(article)!;
    expect(model.kind).toBe('countries');
    expect(model.points.map(p => [p.geography, p.value, p.period])).toEqual([
      ['LV', 16.3, '2025'], ['EE', 21.1, '2025'], ['LT', 17.8, '2025'],
    ]);
  });

  it('uses a single country’s two latest recorded periods without claiming contiguity', () => {
    const article = comparison();
    article.provenance.published_observations = [
      point(article, { summary: true, value: -12 }),
      point(article, { period: '2020', value: 50 }),
      point(article, { period: '2023', value: 8 }),
      point(article, { geography: 'LT', value: 80 }),
    ];
    const model = storyEvidence(article)!;
    expect(model.kind).toBe('periods');
    expect(model.points.map(p => [p.period, p.value])).toEqual([['2023', 8], ['2025', -12]]);
    expect(model.minimum).toBe(-12);
    expect(model.maximum).toBe(8);
    render(<MemoryRouter><StoryEvidenceGraphic evidence={model} sourceHref="#article-evidence" /></MemoryRouter>);
    expect(screen.getByText(/Two recorded observations, not a complete time series/)).toBeTruthy();
  });

  it.each(['missing', 'corrected', 'retracted', 'tier-B', 'mixed-units', 'conflict', 'foreign-article', 'untraced', 'one-point'] as const)(
    'falls back to typography for %s evidence', kind => {
      const article = comparison();
      const points = article.provenance.published_observations!;
      if (kind === 'missing') delete article.provenance.published_observations;
      if (kind === 'corrected') article.corrections = [{ corrected_at: '2026-09-09T00:00:00Z', description: 'A correction.' }];
      if (kind === 'retracted') article.status = 'retracted';
      if (kind === 'tier-B') article.tier = 'B';
      if (kind === 'mixed-units') points[2].unit = '%';
      if (kind === 'conflict') points.push({ ...points[1], value: 99 });
      if (kind === 'foreign-article') points.forEach(p => { p.article_id = 'another-article'; });
      if (kind === 'untraced') article.provenance.sources = [];
      if (kind === 'one-point') article.provenance.published_observations = points.slice(0, 2);
      expect(storyEvidence(article)).toBeNull();
    },
  );

  it('keeps a real zero and uses an honest zero baseline', () => {
    const article = comparison();
    article.provenance.published_observations!.forEach(p => { p.value = 0; });
    const model = storyEvidence(article)!;
    expect(model.points.map(p => p.value)).toEqual([0, 0, 0]);
    render(<MemoryRouter><StoryEvidenceGraphic evidence={model} sourceHref="#article-evidence" /></MemoryRouter>);
    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(document.querySelectorAll('.story-evidence-dot')).toHaveLength(3);
  });

  it('keeps the source precision so a comparison can be reconciled with its reported gap', () => {
    const article = comparison();
    article.provenance.published_observations![1].value = 201.61;
    article.provenance.published_observations![2].value = 78.26;
    render(<MemoryRouter><StoryEvidenceGraphic evidence={storyEvidence(article)!} sourceHref="#article-evidence" /></MemoryRouter>);
    expect(screen.getByText('201.61')).toBeTruthy();
    expect(screen.getByText('78.26')).toBeTruthy();
    expect(screen.queryByText('202')).toBeNull();
  });

  it('loads just the promoted article and does not borrow another article’s record', async () => {
    const article = comparison();
    const summary = tierASummary({ id: article.id, slug: article.slug });
    vi.mocked(loadArticle).mockResolvedValue({ state: 'ok', article });
    const view = render(<MemoryRouter><LeadStoryEvidence summary={summary} /></MemoryRouter>);
    await act(async () => {});
    expect(loadArticle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('figure')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Inspect the source record/ }).getAttribute('href')).toBe(`/article/${article.slug}#article-evidence`);
    view.unmount();
    vi.mocked(loadArticle).mockResolvedValue({ state: 'ok', article: { ...article, id: 'different' } });
    render(<MemoryRouter><LeadStoryEvidence summary={summary} /></MemoryRouter>);
    await act(async () => {});
    expect(screen.queryByRole('figure')).toBeNull();
  });

  it('withholds a lead graphic when the correction log knows more than the cached article', async () => {
    const article = comparison();
    const summary = tierASummary({ id: article.id, slug: article.slug });
    vi.mocked(loadArticle).mockResolvedValue({ state: 'ok', article });
    const view = render(<MemoryRouter><ArticleCard summary={summary} variant="lead" /></MemoryRouter>);
    await act(async () => {});
    expect(screen.getByRole('figure')).toBeTruthy();
    view.rerender(<MemoryRouter><ArticleCard summary={summary} variant="lead" corrected /></MemoryRouter>);
    expect(screen.getByText('Corrected')).toBeTruthy();
    expect(screen.queryByRole('figure')).toBeNull();
    expect(loadArticle).toHaveBeenCalledTimes(1);
  });
});
