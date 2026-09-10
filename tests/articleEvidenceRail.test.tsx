import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Article } from '../src/news-types';
import { ArticleView } from '../src/components/news/ArticleView';
import { tierAArticle, tierCArticle } from './fixtures/articles';

vi.mock('../src/components/news/ChartEmbed', () => ({
  ChartEmbed: ({ indicatorId, country }: { indicatorId: string; country?: string }) => (
    <div data-testid="chart-embed" data-indicator={indicatorId} data-country={country} />
  ),
}));

function renderArticle(article: Article, hash = '') {
  return render(<MemoryRouter initialEntries={[`/article/${article.slug}${hash}`]}><ArticleView article={article} /></MemoryRouter>);
}

function rail() {
  return screen.getByRole('complementary', { name: 'Behind the story' });
}

describe('the article’s adjacent evidence record', () => {
  it('opens the source record on a direct evidence link without changing ordinary arrival', () => {
    renderArticle(tierAArticle(), '#article-evidence');
    expect(document.querySelector<HTMLDetailsElement>('#article-evidence details')?.open).toBe(true);
    expect(screen.getByRole('link', { name: /Open the dataset/ }).getAttribute('href'))
      .toBe(tierAArticle().provenance.sources[0].url);
  });

  it('opens the record on Sources navigation, including another visit after closing it', () => {
    renderArticle(tierAArticle());
    const passport = document.querySelector<HTMLDetailsElement>('#article-evidence details')!;
    const sources = within(screen.getByRole('navigation', { name: 'Article reading navigation' }))
      .getByRole('link', { name: /^Sources/ });
    expect(passport.open).toBe(false);
    fireEvent.click(sources);
    expect(passport.open).toBe(true);
    expect(document.activeElement?.id).toBe('article-evidence');
    expect(sources.getAttribute('aria-current')).toBe('location');
    fireEvent.click(passport.querySelector('summary')!);
    expect(passport.open).toBe(false);
    fireEvent.click(sources);
    expect(passport.open).toBe(true);
    expect(document.activeElement?.id).toBe('article-evidence');
  });

  it.each([false, true])('prints the full source record and restores its previous open state (%s)', (wasOpen) => {
    renderArticle(tierAArticle());
    const passport = document.querySelector<HTMLDetailsElement>('#article-evidence details')!;
    const checks = passport.querySelector<HTMLDetailsElement>('details')!;
    expect(checks).not.toBeNull();
    passport.open = wasOpen;
    checks.open = !wasOpen;
    fireEvent(window, new Event('beforeprint'));
    expect(passport.open).toBe(true);
    expect(checks.open).toBe(true);
    fireEvent(window, new Event('beforeprint'));
    fireEvent(window, new Event('afterprint'));
    expect(passport.open).toBe(wasOpen);
    expect(checks.open).toBe(!wasOpen);
  });

  it('uses the recorded source URL, dataset version and retrieval instant for every source', () => {
    const article = tierAArticle();
    article.provenance.sources.push({
      source_id: 'ecb',
      dataset: 'EXR',
      retrieved_at: '2026-08-23T16:30:00Z',
      url: 'https://data.ecb.europa.eu/data/datasets/EXR',
    });
    renderArticle(article);

    const sources = within(rail()).getByRole('region', {
      name: 'Sources recorded with this article',
    });
    const entries = within(sources).getAllByRole('listitem');
    expect(entries).toHaveLength(article.provenance.sources.length);
    article.provenance.sources.forEach((source, index) => {
      const entry = entries[index];
      const link = within(entry).getByRole('link', { name: `View source: ${source.dataset}` });
      expect(link.getAttribute('href')).toBe(source.url);
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(entry.querySelector('time')?.getAttribute('datetime')).toBe(source.retrieved_at);
      expect(entry.textContent).toContain(source.source_id);
    });
    expect(entries[0].textContent).toContain(article.provenance.sources[0].dataset_version);

    // The adjacent record supplements the passport; it does not replace it.
    const passport = document.getElementById('article-evidence')!;
    expect(within(passport).getByText('gpt-4o-mini@2024-07-18')).toBeTruthy();
    expect(within(passport).getByRole('heading', { name: 'Where this came from' })).toBeTruthy();
    expect(passport.querySelector('details')?.open).toBe(false);
  });

  it('routes research to the first chart the page can render, for the article’s own country', () => {
    const article = tierAArticle({
      countries: ['EE'],
      body: [
        { type: 'paragraph', text: 'An Estonian finding.', chart_ref: 'gdp' },
        { type: 'chart', chart_ref: 'unknown_metric' },
        { type: 'chart', chart_ref: 'unemployment_rate' },
        { type: 'chart', chart_ref: 'inflation' },
      ],
    });
    renderArticle(article);

    expect(within(rail()).getByRole('link', { name: /Open in Data explorer/ }).getAttribute('href'))
      .toBe('/indicator/unemployment?country=EE');
    expect(screen.getByRole('link', { name: /Check it yourself/ }).getAttribute('href'))
      .toBe('/indicator/unemployment?country=EE');

    const nav = screen.getByRole('navigation', { name: 'Article reading navigation' });
    const live = within(nav).getByRole('link', { name: /Live data/ });
    const target = document.getElementById(live.getAttribute('href')!.split('#')[1])!;
    expect(target).not.toBeNull();
    const chart = within(target).getByTestId('chart-embed');
    expect(chart.getAttribute('data-indicator')).toBe('unemployment_rate');
    expect(chart.getAttribute('data-country')).toBe('EE');
    expect(screen.getAllByTestId('chart-embed')).toHaveLength(3);
  });

  it('ties reading navigation to the actual story and complete provenance, not placeholder sections', () => {
    renderArticle(tierAArticle());
    const nav = screen.getByRole('navigation', { name: 'Article reading navigation' });
    const storyLink = within(nav).getByRole('link', { name: /^Story/ });
    const sourcesLink = within(nav).getByRole('link', { name: /^Sources/ });
    const story = document.getElementById(storyLink.getAttribute('href')!.split('#')[1])!;
    const sources = document.getElementById(sourcesLink.getAttribute('href')!.split('#')[1])!;

    expect(within(story).getByText(/Hourly labour cost in Latvia rose 8.4%/)).toBeTruthy();
    expect(within(sources).getByText(/5 of 5 checks passed/)).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('article').querySelector('main')).toBeNull();
  });

  it('has no live-data navigation or research claim when all chart references are unresolvable', () => {
    renderArticle(tierAArticle({
      body: [
        { type: 'paragraph', text: 'A finding without an available chart.', chart_ref: 'inflation' },
        { type: 'chart', chart_ref: 'unknown_metric' },
      ],
    }));
    const nav = screen.getByRole('navigation', { name: 'Article reading navigation' });

    expect(within(nav).queryByRole('link', { name: /Live data/ })).toBeNull();
    expect(within(rail()).queryByRole('link', { name: /Open in Data explorer/ })).toBeNull();
    expect(document.getElementById('article-live-data')).toBeNull();
    expect(screen.getByRole('link', { name: /Check it yourself/ }).getAttribute('href'))
      .toBe('/data/economy');
    expect(within(rail()).getByRole('link', { name: /View source/ }).getAttribute('href'))
      .toBe(tierAArticle().provenance.sources[0].url);
  });

  it('does not invent a country for a multi-country story', () => {
    renderArticle(tierAArticle({ countries: ['Baltic', 'EE', 'LV', 'LT'] }));
    expect(within(rail()).getByRole('link', { name: /Open in Data explorer/ }).getAttribute('href'))
      .toBe('/indicator/salary');
    expect(within(document.getElementById('article-live-data')!)
      .getByTestId('chart-embed').getAttribute('data-country')).toBeNull();
  });

  it('retains source identity without inventing a URL when one was not recorded', () => {
    const article = tierAArticle();
    delete article.provenance.sources[0].url;
    renderArticle(article);

    const evidence = within(rail());
    expect(evidence.getByText('lc_lci_lev')).toBeTruthy();
    expect(evidence.getByText('Source URL not recorded')).toBeTruthy();
    expect(evidence.queryByRole('link', { name: /View source/ })).toBeNull();
  });

  it('keeps a verbatim release exact and does not illustrate it as our data reporting', () => {
    const text = 'The published value is 1.234567%.\n\n  The spacing and wording are the publisher’s.';
    renderArticle(tierAArticle({
      tier: 'B',
      persona: undefined,
      syndicated: {
        source_id: 'ec_presscorner',
        original_url: 'https://ec.europa.eu/commission/presscorner/example',
        attribution: 'European Commission',
        full_text: text,
        snippet_is_verbatim: true,
      },
    }));

    const body = screen.getByRole('region', { name: 'The press release, as published' });
    expect(body.querySelector('.whitespace-pre-line')?.textContent).toBe(text);
    expect(screen.queryByRole('img', { name: /Geographic illustration/ })).toBeNull();
    expect(screen.queryByTestId('chart-embed')).toBeNull();
    expect(screen.queryByRole('link', { name: /Live data/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Read at the original publisher/ }).getAttribute('href'))
      .toBe('https://ec.europa.eu/commission/presscorner/example');
    expect(screen.getByRole('complementary', { name: 'Publication record' })).toBeTruthy();
  });

  it.each(['draft', 'retracted'] as const)('does not expose the new evidence experience for %s content', (status) => {
    renderArticle(tierAArticle({ status }));
    expect(screen.queryByRole('navigation', { name: 'Article reading navigation' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Behind the story' })).toBeNull();
    expect(screen.queryByRole('img', { name: /Geographic illustration/ })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('keeps tier C a link-out, without our illustration or an evidence rail', () => {
    renderArticle(tierCArticle());
    expect(screen.queryByRole('article', { name: tierCArticle().headline })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Article reading navigation' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('link', { name: /Estonia’s grid operator/ }).getAttribute('href'))
      .toBe(tierCArticle().syndicated!.original_url);
  });
});
