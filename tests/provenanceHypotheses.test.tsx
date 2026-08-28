import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProvenanceBlock } from '../src/components/news/ProvenanceBlock';
import { tierAArticle } from './fixtures/articles';
import type { HypothesesProvenance } from '../src/news-types';

vi.mock('../src/components/news/ChartEmbed', () => ({
  ChartEmbed: () => null,
}));

/**
 * The panel's whole safety argument is that a reader can tell a proposed cause
 * from a finding. In the article body that is enforced by the validator; here
 * it has to be enforced by what the passport actually says, because this is
 * where a reader goes to check who claimed what.
 */

function renderPassport(hypotheses?: HypothesesProvenance) {
  const article = tierAArticle();
  if (hypotheses) article.provenance.hypotheses = hypotheses;
  return render(
    <MemoryRouter>
      <ProvenanceBlock provenance={article.provenance} />
    </MemoryRouter>,
  );
}

const PANEL: HypothesesProvenance = {
  prompt_version: 'hypothesis-v1',
  consulted: ['Dr Liina Sarapuu (demographer)', 'Rasa Irbene (political economist)'],
  hypotheses: [
    {
      claim: 'The small cohort born in the 1990s is now of childbearing age',
      lens: 'demography',
      analyst: 'Dr Liina Sarapuu',
      discipline: 'demographer',
      basis: 'domain_knowledge',
      attribution: 'Dr Liina Sarapuu',
      strength: 'likely',
      testable_with: 'age-specific fertility rates',
      corroborated_by: ['Rasa Irbene'],
    },
  ],
  discarded: 2,
};

describe('ProvenanceBlock — the causal panel', () => {
  it('names who was consulted and says their answers are not findings', () => {
    renderPassport(PANEL);

    expect(screen.getByText(/What the causal panel proposed/i)).toBeTruthy();
    expect(screen.getByText(/Dr Liina Sarapuu \(demographer\)/)).toBeTruthy();
    expect(screen.getByText(/proposals, not\s+findings/i)).toBeTruthy();
  });

  it('attributes each cause and says what it rests on', () => {
    renderPassport(PANEL);

    const entry = screen.getByText(/small cohort born in the 1990s/);
    expect(entry.textContent).toMatch(/held by Dr Liina Sarapuu/);
    expect(entry.textContent).toMatch(/from their own expertise rather than from this data/);
  });

  it('reports a corroboration as independent rather than as agreement in one answer', () => {
    renderPassport(PANEL);

    expect(screen.getByText(/Reached independently by Rasa Irbene/)).toBeTruthy();
  });

  it('distinguishes a panel that found nothing from a panel nobody convened', () => {
    // The case the whole provenance block exists for. An article closing "the
    // data does not show what drove this" means one thing when two specialists
    // looked and another when the stage never ran, and only this tells them
    // apart.
    renderPassport({
      prompt_version: 'hypothesis-v1',
      consulted: ['Dr Liina Sarapuu (demographer)'],
      hypotheses: [],
    });

    expect(screen.getByText(/not the same as nobody asking/i)).toBeTruthy();
  });

  it('records a document as what informed the analyst, not as the claimant', () => {
    // The high-severity finding from review, on the reader-facing side. The
    // pipeline can establish that a release was retrieved; it cannot establish
    // that the release says the claim. A passport line reading "held by
    // Latvijas Banka" would put our analyst's reading in the bank's mouth, and
    // it is the one fabrication a reader can catch and we cannot: they follow
    // the link and find we paraphrased it.
    renderPassport({
      prompt_version: 'hypothesis-v1',
      consulted: ['Dr Liina Sarapuu (demographer)'],
      hypotheses: [
        {
          claim: 'Parental leave eligibility was narrowed',
          lens: 'demography',
          analyst: 'Dr Liina Sarapuu',
          discipline: 'demographer',
          basis: 'official_document',
          attribution: 'Dr Liina Sarapuu',
          informed_by: 'Latvijas Banka news',
          strength: 'possible',
        },
      ],
    });

    const entry = screen.getByText(/Parental leave eligibility was narrowed/);
    expect(entry.textContent).toMatch(/held by Dr Liina Sarapuu/);
    expect(entry.textContent).toMatch(/who had read Latvijas Banka news/);
    expect(entry.textContent).toMatch(/The claim is theirs, not that publisher's/);
  });

  it('says nothing at all when the panel never ran', () => {
    renderPassport();

    expect(screen.queryByText(/What the causal panel proposed/i)).toBeNull();
    expect(screen.queryByText(/not the same as nobody asking/i)).toBeNull();
  });

  it('publishes how many candidates were thrown away', () => {
    renderPassport(PANEL);

    expect(screen.getByText(/2 further explanations were proposed and discarded/i)).toBeTruthy();
  });
});
