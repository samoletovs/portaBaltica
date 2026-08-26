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
    expect(link.getAttribute('href')).toBe('/newsroom/nida');
  });
});

describe('ArticleView — the provenance passport', () => {
  it('arrives collapsed, with the record folded inside the part that opens', () => {
    renderArticle(tierAArticle());

    const heading = screen.getByRole('heading', { name: 'Where this came from' });
    const passport = heading.closest('details');

    // The record runs longer than most of the articles it follows. A reader who
    // has just finished the story should not have to scroll a wall of dataset
    // cards to reach the next one.
    expect(passport, 'the passport is not a disclosure at all').not.toBeNull();
    expect(passport!.open, 'the passport is open on arrival').toBe(false);

    // The heading is the control, so there is an obvious way in.
    expect(heading.closest('summary')?.parentElement).toBe(passport);

    // Collapsing it must not quietly retract the promise: the check count is
    // on the header, which stays on the page.
    const badge = screen.getByText(/5 of 5 checks passed/);
    expect(badge.closest('summary')?.parentElement).toBe(passport);

    // And the datasets are inside the part that opens, not left beside it.
    const dataset = screen.getByRole('link', { name: /Open the dataset/, hidden: true });
    expect(dataset.closest('details')).toBe(passport);
    expect(dataset.closest('summary')).toBeNull();
  });

  it('shows the four things the policy promises: sources, datasets, retrieval time and model', () => {
    renderArticle(tierAArticle());

    expect(screen.getByRole('heading', { name: 'Where this came from' })).toBeTruthy();
    expect(screen.getByText('Eurostat')).toBeTruthy();
    expect(screen.getByText(/lc_lci_lev/)).toBeTruthy();
    expect(screen.getByText('gpt-4o-mini@2024-07-18')).toBeTruthy();
    expect(screen.getByText('Andre Kõpu')).toBeTruthy();
    expect(screen.getByText(/Retrieved/)).toBeTruthy();
  });

  it('shows the deterministic signal that caused the story, as section 6 commits to', () => {
    renderArticle(tierAArticle());

    // The policy says story selection is deterministic code, not the model.
    // The panel has to be able to show which detector fired.
    expect(screen.getByRole('heading', { name: 'Why this story exists' })).toBeTruthy();
    expect(screen.getByText('sig-lv-wages-2026q2')).toBeTruthy();
    expect(screen.getByText(/deterministic detector, not a model/i)).toBeTruthy();
  });

  it('shows the prompt version and the validation results', () => {
    renderArticle(tierAArticle());

    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByText(/5 of 5 checks passed/)).toBeTruthy();
    expect(
      screen.getByText('No number appears in the text that is absent from the data'),
    ).toBeTruthy();
  });

  it('shows every research source consulted for the story', () => {
    const article = tierAArticle();
    article.provenance.research = {
      method: 'registered_feeds',
      candidates_considered: 4,
      consulted: [
        {
          source_id: 'statistics_estonia_news',
          source_name: 'Statistics Estonia news',
          role: 'official_statement',
          title: 'The unemployment rate fell in the latest quarter',
          url: 'https://stat.ee/en/example',
          retrieved_at: '2026-08-24T05:30:00Z',
        },
      ],
    };

    renderArticle(article);

    expect(screen.getByRole('heading', { name: 'Reporting context consulted' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /unemployment rate fell/ })).toBeTruthy();
    expect(screen.getByText(/Statistics Estonia news · official statement/)).toBeTruthy();
  });

  it('shows who approved reviewed material and when', () => {
    // Tier B and C pass through human approval; the policy commits to showing it.
    const article = tierAArticle();
    article.provenance.approved_by = 'Sam Samoletovs';
    article.provenance.approved_at = '2026-08-24T06:12:00Z';

    renderArticle(article);

    expect(screen.getByText('Approved by')).toBeTruthy();
  });

  it('reads as something a reader can act on rather than boilerplate', () => {
    renderArticle(tierAArticle());

    expect(screen.getByText(/you can check the figures for yourself/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the dataset/ })).toBeTruthy();
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
