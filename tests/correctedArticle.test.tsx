import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ArticleView } from '../src/components/news/ArticleView';
import { tierAArticle } from './fixtures/articles';

vi.mock('../src/components/news/ChartEmbed', () => ({
  ChartEmbed: ({ indicatorId }: { indicatorId: string }) => <div>{indicatorId}</div>,
}));

/**
 * One article credited an explanation to "Dr. Ineta Zvirbule", who does not
 * exist. It carries a correction; the paragraph is left exactly as published.
 *
 * These tests pin the second half of that, because it is the half a future
 * change is likely to "fix". `analystLabel` already repairs the provenance
 * block, and extending it to body prose looks like the obvious next step. It is
 * not: a note saying "we credited Dr Zvirbule" beside a paragraph that no
 * longer says it describes a state the reader cannot check, and a correction
 * that cannot be verified against the page it corrects is worse than none.
 */

const OFFENDING =
  'The divergence in consumer confidence may be influenced by structural changes in ' +
  'the labour market. Dr. Ineta Zvirbule suggests this is a likely explanation, but ' +
  'the data cannot confirm it.';

const NOTE =
  'This article credited an explanation to “Dr. Ineta Zvirbule”. There is no such ' +
  'person. The suggestion came from one of the newsroom’s own AI analysts. The ' +
  'paragraph is left exactly as published.';

function corrected() {
  const article = tierAArticle();
  article.body = [{ type: 'paragraph', text: OFFENDING }];
  article.corrections = [
    {
      corrected_at: '2026-08-28T16:00:00Z',
      description: NOTE,
      previous_value: 'Dr. Ineta Zvirbule suggests this is a likely explanation.',
    },
  ];
  return article;
}

function renderArticle(article: Parameters<typeof ArticleView>[0]['article']) {
  return render(
    <MemoryRouter>
      <ArticleView article={article} />
    </MemoryRouter>,
  );
}

describe('a corrected article', () => {
  it('shows the correction', () => {
    renderArticle(corrected());

    expect(screen.getByRole('heading', { name: 'Corrected' })).toBeTruthy();
    expect(screen.getByText(/There is no such person/)).toBeTruthy();
  });

  it('leaves the paragraph exactly as published', () => {
    // Not a fixture assertion: the text IS in the fixture, and the point is
    // that the component renders it unaltered. If someone later routes body
    // prose through analystLabel, this fails and tells them why.
    //
    // Queried on the paragraph specifically, because the same sentence also
    // appears in the correction's "Previously:" line — which is the design
    // working, not a duplicate.
    const { container } = renderArticle(corrected());

    const paragraphs = Array.from(container.querySelectorAll('p')).map(
      (node) => node.textContent ?? '',
    );
    const body = paragraphs.find((text) => text.includes('divergence in consumer confidence'));

    expect(body).toContain('Dr. Ineta Zvirbule suggests this is a likely explanation');
    expect(body).not.toContain('an AI analyst on this masthead');
  });

  it('puts the correction above the paragraph it corrects', () => {
    // The whole reason a note is sufficient and a rewrite is not. If the notice
    // rendered below the body, a reader would meet the fabricated expert first
    // and the correction would be a footnote to a deception.
    const { container } = renderArticle(corrected());

    const html = container.innerHTML;
    expect(html.indexOf('There is no such person')).toBeLessThan(
      html.indexOf('suggests this is a likely explanation'),
    );
  });

  it('quotes the sentence, so the note can be checked against the page', () => {
    renderArticle(corrected());

    expect(screen.getByText(/Previously:/)).toBeTruthy();
  });

  it('keeps a corrected article readable and in full', () => {
    // A correction is not a retraction. The story stands.
    const article = corrected();
    renderArticle(article);

    expect(screen.getByRole('heading', { level: 1, name: article.headline })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
