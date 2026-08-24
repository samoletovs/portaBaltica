import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ArticleView } from '../src/components/news/ArticleView';
import { FAILING_VERDICT, SECRET_PROSE, tierAArticle, tierCArticle } from './fixtures/articles';

// The chart embed pulls recharts through a lazy boundary. The gate is what is
// under test here, not the chart, so it is stubbed to keep these tests fast
// and free of an async import.
vi.mock('../src/components/news/ChartEmbed', () => ({
  ChartEmbed: ({ indicatorId }: { indicatorId: string }) => (
    <div data-testid="chart-embed">{indicatorId}</div>
  ),
}));

function renderArticle(article: Parameters<typeof ArticleView>[0]['article']) {
  return render(
    <MemoryRouter>
      <ArticleView article={article} />
    </MemoryRouter>,
  );
}

describe('ArticleView — the render-time gate', () => {
  it('renders a servable article', () => {
    const article = tierAArticle();
    renderArticle(article);

    expect(screen.getByRole('heading', { level: 1, name: article.headline })).toBeTruthy();
    expect(screen.getByText(/Hourly labour cost in Latvia rose 8.4%/)).toBeTruthy();
  });

  it('renders nothing of an article whose validator failed', () => {
    const article = tierAArticle();
    article.provenance.validator = FAILING_VERDICT;

    renderArticle(article);

    // If the gate is removed, the headline and body appear and these fail.
    expect(screen.queryByText(article.headline)).toBeNull();
    expect(screen.queryByText(/Hourly labour cost in Latvia rose 8.4%/)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/not passed the checks we run before publishing/i)).toBeTruthy();
  });

  it('renders nothing of an article that is not published, even with a passing verdict', () => {
    const article = tierAArticle({ status: 'pending_approval' });

    renderArticle(article);

    expect(screen.queryByText(article.headline)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders nothing of a retracted article', () => {
    const article = tierAArticle({ status: 'retracted' });

    renderArticle(article);

    expect(screen.queryByText(article.headline)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('ArticleView — the byline always discloses', () => {
  it('renders "AI correspondent" in the byline of a tier A article', () => {
    renderArticle(tierAArticle());

    expect(screen.getByText(/AI correspondent/)).toBeTruthy();
  });

  it('rebuilds a disclosing byline when the stored one has lost the disclosure', () => {
    // The exact failure mode this guards against: a byline that reads like a
    // staff journalist's because the disclosure was dropped upstream.
    const article = tierAArticle();
    article.persona = { id: 'nida', name: 'Nida', beat: 'Economy & Labour', byline: 'Nida' };

    renderArticle(article);

    expect(screen.getByText('Nida · AI correspondent, Economy & Labour')).toBeTruthy();
    expect(screen.queryByText('Nida', { exact: true })).toBeNull();
  });

  it('links the byline to the correspondent bio page', () => {
    renderArticle(tierAArticle());

    const link = screen.getByRole('link', { name: /AI correspondent/ });
    expect(link.getAttribute('href')).toBe('/correspondents/nida');
  });
});

describe('ArticleView — the provenance passport', () => {
  it('shows the dataset, the retrieval time and the model', () => {
    renderArticle(tierAArticle());

    expect(screen.getByRole('heading', { name: 'Where this came from' })).toBeTruthy();
    expect(screen.getByText('Eurostat')).toBeTruthy();
    expect(screen.getByText(/lc_lci_lev/)).toBeTruthy();
    expect(screen.getByText('gpt-4o-mini@2024-07-18')).toBeTruthy();
    expect(screen.getByText('Sam Samoletovs')).toBeTruthy();
    expect(screen.getByText(/Retrieved/)).toBeTruthy();
  });

  it('emits NewsArticle structured data for tier A', () => {
    const { container } = renderArticle(tierAArticle());

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();

    const data = JSON.parse(script!.textContent!);
    expect(data['@type']).toBe('NewsArticle');
    expect(data.author.name).toContain('AI correspondent');
    // Never a Person: the author is a disclosed software system.
    expect(data.author['@type']).toBe('Organization');
  });
});

describe('ArticleView — tier C is link-out only', () => {
  it('never renders prose for a tier C item, even when the JSON carries some', () => {
    const article = tierCArticle();

    renderArticle(article);

    // The fixture deliberately carries body prose and a rewritten dek.
    expect(screen.queryByText(SECRET_PROSE)).toBeNull();
    expect(screen.getByText(article.syndicated!.snippet!)).toBeTruthy();
  });

  it('emits no structured data claiming a tier C item as our reporting', () => {
    const { container } = renderArticle(tierCArticle());

    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it('carries no portaBaltica byline', () => {
    renderArticle(tierCArticle());

    expect(screen.queryByText(/AI correspondent/)).toBeNull();
  });

  it('sends the reader to the original outlet', () => {
    renderArticle(tierCArticle());

    const link = screen.getByRole('link', { name: /Estonia’s grid operator/ });
    expect(link.getAttribute('href')).toBe('https://news.err.ee/example-story');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
