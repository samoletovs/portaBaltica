/**
 * EU AI Act Article 50 — the machine-readable half of the disclosure.
 *
 * Article 50 has applied since 2 August 2026, and from 2 December 2026 the
 * marking of AI-generated text on matters of public interest must be
 * machine-readable, not only legible. The byline carries the legible half and
 * persona_rules.py enforces it. Nothing enforced the other half, so these tests
 * do — including the direction that is easier to get wrong and more damaging:
 * marking a human journalist's work as synthetic.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AI_DISCLOSURE,
  HUMAN_DISCLOSURE,
  disclosureFor,
  newsArticleJsonLd,
} from '../src/newsroom/structured-data';
import type { Article } from '../src/news-types';

function tierA(overrides: Partial<Article> = {}): Article {
  return {
    id: '01ABC',
    slug: 'estonia-unemployment',
    tier: 'A',
    status: 'published',
    headline: "Estonia's unemployment rate declines in June 2026",
    dek: 'A standfirst.',
    section: 'labour',
    created_at: '2026-08-24T12:00:00Z',
    published_at: '2026-08-24T12:00:00Z',
    persona: { id: 'ristna', name: 'Kadri Ristna', beat: 'Environment & Climate' },
    body: [{ type: 'paragraph', text: 'The rate fell.' }],
    provenance: {
      sources: [{ source_id: 'eurostat', retrieved_at: '2026-08-24T10:00:00Z' }],
      generated_at: '2026-08-24T12:00:00Z',
      validator: { passed: true, checked_at: '2026-08-24T12:00:00Z', checks: [] },
    },
    ...overrides,
  } as Article;
}

describe('machine-readable AI disclosure', () => {
  it('marks an AI-written article as algorithmically generated', () => {
    const jsonLd = newsArticleJsonLd(tierA());

    expect(jsonLd?.digitalSourceType).toBe(AI_DISCLOSURE);
  });

  it('uses the IPTC vocabulary term a verifier will recognise', () => {
    // C2PA Content Credentials embed this same vocabulary, so a term invented
    // for us would be a disclosure only we can read — which is not a
    // disclosure.
    expect(AI_DISCLOSURE).toBe(
      'https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
    );
  });

  it('does not mark third-party material as machine-generated', () => {
    // The damaging direction: attributing a synthetic origin to a human
    // journalist's reporting.
    expect(disclosureFor('B')).toBe(HUMAN_DISCLOSURE);
    expect(disclosureFor('C')).toBe(HUMAN_DISCLOSURE);
    expect(disclosureFor('B')).not.toBe(AI_DISCLOSURE);
  });

  it('keeps the disclosure alongside the legible byline, not instead of it', () => {
    const jsonLd = newsArticleJsonLd(tierA());

    expect(String((jsonLd?.author as Record<string, unknown>)?.name)).toContain(
      'AI correspondent',
    );
    expect(jsonLd?.digitalSourceType).toBeTruthy();
  });
});

describe('llms.txt', () => {
  const text = readFileSync(resolve(__dirname, '../public/llms.txt'), 'utf-8');

  it('exists and names the site', () => {
    expect(text).toContain('portaBaltica');
  });

  it('points an answer engine at the corrections log', () => {
    // An assistant that can quote us should be able to find out when we were
    // wrong.
    expect(text).toContain('/corrections');
  });

  it('states the AI disclosure so a summariser repeats it', () => {
    expect(text).toMatch(/AI[- ]generated/i);
    expect(text).toContain('trainedAlgorithmicMedia');
  });

  it('tells a citing model to carry the vintage with the figure', () => {
    expect(text.toLowerCase()).toContain('vintage');
  });

  it('is referenced from robots.txt', () => {
    const robots = readFileSync(resolve(__dirname, '../public/robots.txt'), 'utf-8');
    expect(robots).toContain('llms.txt');
  });
});
