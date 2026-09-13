import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ArticlePage from '../src/components/news/ArticlePage';
import { loadArticle, type ArticleLoad } from '../src/news-api';
import { tierAArticle } from './fixtures/articles';

vi.mock('../src/news-api', () => ({ loadArticle: vi.fn() }));
vi.mock('../src/components/news/ChartEmbed', () => ({ ChartEmbed: () => null }));
const load = vi.mocked(loadArticle);

async function show() {
  await act(async () => {
    render(<MemoryRouter initialEntries={['/article/latvian-wage-growth-outpaces-inflation']}>
      <Routes><Route path="/article/:slug" element={<ArticlePage />} /></Routes>
    </MemoryRouter>);
  });
}

beforeEach(() => { load.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('article retrieval is not an editorial verdict', () => {
  it('explains a failed request and retries the same article without alleging failed checks', async () => {
    load.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce({ state: 'ok', article: tierAArticle() });
    await show();
    expect(screen.getByRole('heading', { name: 'The article could not be loaded' })).toBeTruthy();
    expect(screen.queryByText(/It has not passed the checks/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry article' })); });
    expect(screen.getByRole('article')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map(([slug]) => slug)).toEqual(Array(2).fill(tierAArticle().slug));
  });

  it('shows a loading state while a retry is pending instead of leaving a dead error message', async () => {
    let finish!: (result: ArticleLoad) => void;
    load.mockRejectedValueOnce(new Error('HTTP 503')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await show();
    expect(screen.getByRole('button', { name: 'Retry article' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry article' }));
    expect(screen.getByLabelText('Loading article').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Retry article' })).toBeNull();
    await act(async () => { finish({ state: 'ok', article: tierAArticle() }); });
    expect(screen.getByRole('article')).toBeTruthy();
  });

  it.each(['not-found', 'not-servable'] as const)('retains the separate %s outcome without a misleading network retry', async state => {
    load.mockResolvedValue({ state });
    await show();
    expect(screen.getByRole('heading', { name: state === 'not-found' ? 'Article not found' : 'This article is not available' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry article' })).toBeNull();
    expect(screen.queryByText('The article could not be loaded')).toBeNull();
  });
});
