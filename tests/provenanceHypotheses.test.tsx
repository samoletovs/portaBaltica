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
  consulted: ["the newsroom's AI demographer", "the newsroom's AI political economist"],
  hypotheses: [
    {
      claim: 'The small cohort born in the 1990s is now of childbearing age',
      lens: 'demography',
      analyst: "the newsroom's AI demographer",
      discipline: 'demographer',
      basis: 'domain_knowledge',
      attribution: "the newsroom's AI demographer",
      strength: 'likely',
      testable_with: 'age-specific fertility rates',
      corroborated_by: ["the newsroom's AI political economist"],
    },
  ],
  discarded: 2,
};

describe('ProvenanceBlock — the causal panel', () => {
  it('names who was consulted and says their answers are not findings', () => {
    renderPassport(PANEL);

    expect(screen.getByText(/What the causal panel proposed/i)).toBeTruthy();
    expect(screen.getAllByText(/the newsroom's AI demographer/).length).toBeGreaterThan(0);
    expect(screen.getByText(/proposals, not\s+findings/i)).toBeTruthy();
  });

  it('says plainly that the analysts are software', () => {
    // The passport is where a reader goes to check who claimed what, so it is
    // the one place that must not leave "analyst" ambiguous.
    renderPassport(PANEL);

    expect(screen.getByText(/These are software, not people/)).toBeTruthy();
    expect(screen.getByText(/AI analysts were/)).toBeTruthy();
  });

  it('discloses a legacy record that names an invented person', () => {
    // NOT a fixture assertion. Articles already in blob storage carry
    // `analyst: "Dr Ineta Zvirbule"` — an invented economist with no bio page,
    // no roster entry and no AI label — and one of them is live. The component
    // cannot rewrite history; it must not echo a fabricated expert as though
    // the site stood behind them either.
    //
    // Asserting against the current fixture would prove nothing, because the
    // current fixture has no "Dr" in it to find. This supplies the shape that
    // actually exists in production.
    renderPassport({
      prompt_version: 'hypothesis-v1',
      consulted: ['Dr Ineta Zvirbule (household and labour-market economist)'],
      hypotheses: [
        {
          claim: 'Weaker external demand reduced industrial output',
          lens: 'household',
          analyst: 'Dr Ineta Zvirbule',
          discipline: 'household and labour-market economist',
          basis: 'domain_knowledge',
          attribution: 'Dr Ineta Zvirbule',
          strength: 'likely',
        },
      ],
    });

    const entry = screen.getByText(/Weaker external demand reduced industrial output/);
    expect(entry.textContent).toMatch(/an AI analyst on this masthead, not a person/);
  });

  it('does not double-disclose an analyst that names itself', () => {
    // A control for the repair above: applied indiscriminately it would render
    // "the newsroom's AI demographer (an AI analyst on this masthead...)".
    renderPassport(PANEL);

    const entry = screen.getByText(/small cohort born in the 1990s/);
    expect(entry.textContent).toMatch(/proposed by the newsroom's AI demographer/);
    expect(entry.textContent).not.toMatch(/an AI analyst on this masthead/);
  });

  it('attributes each cause and says what it rests on', () => {
    renderPassport(PANEL);

    const entry = screen.getByText(/small cohort born in the 1990s/);
    expect(entry.textContent).toMatch(/proposed by the newsroom's AI demographer/);
    expect(entry.textContent).toMatch(/from its own domain knowledge rather than from this data/);
  });

  it('reports a corroboration as independent rather than as agreement in one answer', () => {
    renderPassport(PANEL);

    expect(
      screen.getByText(/Reached independently by the newsroom's AI political economist/),
    ).toBeTruthy();
  });

  it('distinguishes a panel that found nothing from a panel nobody convened', () => {
    // The case the whole provenance block exists for. An article closing "the
    // data does not show what drove this" means one thing when two specialists
    // looked and another when the stage never ran, and only this tells them
    // apart.
    renderPassport({
      prompt_version: 'hypothesis-v1',
      consulted: ["the newsroom's AI demographer"],
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
      consulted: ["the newsroom's AI demographer"],
      hypotheses: [
        {
          claim: 'Parental leave eligibility was narrowed',
          lens: 'demography',
          analyst: "the newsroom's AI demographer",
          discipline: 'demographer',
          basis: 'official_document',
          attribution: "the newsroom's AI demographer",
          informed_by: 'Latvijas Banka news',
          strength: 'possible',
        },
      ],
    });

    const entry = screen.getByText(/Parental leave eligibility was narrowed/);
    expect(entry.textContent).toMatch(/proposed by the newsroom's AI demographer/);
    expect(entry.textContent).toMatch(/which had read Latvijas Banka news/);
    expect(entry.textContent).toMatch(/The claim is ours, not that publisher's/);
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

  it('names every reason a candidate is thrown away, not just the two it used to', () => {
    // The specificity rule became the commonest cause of a discard. A sentence
    // listing only figures and citations would tell a reader the guard did
    // something other than what it did.
    renderPassport(PANEL);

    expect(
      screen.getByText(/naming no particular beyond the finding itself/i),
    ).toBeTruthy();
  });

  it('shows the calibrated band and the range it stands for', () => {
    // The band word alone is what "likely" meant before it was pinned to a
    // number, and 73% of published hypotheses carried it. The range is what
    // makes the word mean the same thing in every article — and the passport
    // is where it belongs, because a percentage in the prose would be a figure
    // the pipeline never verified.
    renderPassport({
      ...PANEL,
      hypotheses: [
        {
          ...PANEL.hypotheses[0],
          likelihood: 'very likely',
          likelihood_range: '90–100%',
        },
      ],
    });

    expect(screen.getByText(/very likely \(90–100%\)/i)).toBeTruthy();
  });

  it('falls back to the older strength when an article predates the scale', () => {
    renderPassport(PANEL);

    expect(screen.getByText(/likely/i)).toBeTruthy();
  });

  it("publishes the analyst's own rival explanation and what would disprove it", () => {
    // Analysis of Competing Hypotheses: a claim is not established by the
    // evidence consistent with it, since rivals usually are too. Showing the
    // rival is what stops a single proposal reading as the only candidate.
    renderPassport({
      ...PANEL,
      hypotheses: [
        {
          ...PANEL.hypotheses[0],
          rival: 'Emigration thinning the cohort rather than its original size',
          disconfirmed_by: 'Age-specific rates flat while the crude rate falls',
        },
      ],
    });

    expect(
      screen.getByText(/Emigration thinning the cohort rather than its original size/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/Age-specific rates flat while the crude rate falls/i),
    ).toBeTruthy();
  });
});
