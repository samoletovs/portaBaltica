import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { clampSnippet, snippetText } from '../src/newsroom/snippet';
import { formatFigures, needsRounding } from '../src/newsroom/format-figures';
import { LinkOutCard } from '../src/components/news/LinkOutCard';

/**
 * Regressions from the v2 read-through. Every case here is something a reader
 * actually saw on production, so each test names the symptom rather than the
 * function.
 */

describe('feed snippets arrive as HTML', () => {
  // What EUobserver actually publishes in <description>.
  const REAL = `<div><img width="600" height="422" src="https://static.euobserver.com/2026/08/x.jpg" class="attachment-thumbnail size-thumbnail wp-post-image" alt="" decoding="async" loading="lazy" srcset="https://static.euobserver.com/2026/08/x.jpg 600w, https://static.euobserver.com/2026/08/y.jpg 1200w" sizes="(max-width: 600px) 100vw, 600px" /> </div>Intellectual property and copyright laws were developed to protect what people make.`;

  it('shows the publisher’s sentence, not their markup', () => {
    const text = snippetText(REAL);

    expect(text).toBe(
      'Intellectual property and copyright laws were developed to protect what people make.',
    );
  });

  it('never leaks a tag, an attribute or a URL into the card', () => {
    const text = snippetText(REAL);

    expect(text).not.toMatch(/[<>]/);
    expect(text).not.toContain('srcset');
    expect(text).not.toContain('http');
    expect(text).not.toContain('class=');
  });

  it('changes no word of what the publisher wrote', () => {
    // Stripping markup is not rewriting. The prose that survives must be
    // exactly the publisher's, which is the only thing tier C permits.
    const words = snippetText('<p>Elering said the test <em>ran</em> without incident.</p>');

    expect(words).toBe('Elering said the test ran without incident.');
  });

  it('drops content that is not prose at all', () => {
    expect(snippetText('<script>steal()</script>Real text.')).toBe('Real text.');
    expect(snippetText('<style>.a{}</style>Real text.')).toBe('Real text.');
  });

  it('decodes entities so readers do not see &amp;', () => {
    expect(snippetText('Riga &amp; Tallinn &mdash; both &quot;on track&quot;')).toBe(
      'Riga & Tallinn — both "on track"',
    );
  });

  it('returns nothing for an image-only description', () => {
    // Several outlets publish exactly this. An empty quotation block with
    // attribution underneath looks like we lost the text.
    expect(snippetText('<div><img src="x.jpg" /></div>')).toBe('');
  });

  it('keeps a long summary from taking over the page', () => {
    const long = `${'word '.repeat(200)}end`;

    const clamped = clampSnippet(snippetText(long));

    expect(clamped.length).toBeLessThan(240);
    expect(clamped.endsWith('…')).toBe(true);
  });

  it('leaves a short summary exactly as it is', () => {
    const short = 'Elering said the test ran without incident.';

    expect(clampSnippet(short)).toBe(short);
  });
});

describe('the tier C card renders the cleaned snippet', () => {
  it('shows prose and not markup', () => {
    render(
      <MemoryRouter>
        <LinkOutCard
          headline="Does copyright protect AI-generated content?"
          snippet={'<div><img src="https://static.euobserver.com/x.jpg" /></div>Intellectual property laws protect what people make.'}
          attribution="EUobserver"
          originalUrl="https://euobserver.com/example"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Intellectual property laws protect what people make.')).toBeTruthy();
    // If the raw string were rendered again this would find it.
    expect(screen.queryByText(/img src=|<div>/)).toBeNull();
  });

  it('omits the quotation entirely when the feed carried only an image', () => {
    render(
      <MemoryRouter>
        <LinkOutCard
          headline="A headline"
          snippet={'<div><img src="x.jpg" /></div>'}
          attribution="ERR News"
          originalUrl="https://news.err.ee/x"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/quoted verbatim/)).toBeNull();
  });
});

describe('figures are readable', () => {
  it('shortens the deviation that shipped to production', () => {
    expect(formatFigures('a deviation of -6.71378% from the four-year average')).toBe(
      'a deviation of -6.7% from the four-year average',
    );
  });

  it('shortens a four-year average of 7.075%', () => {
    expect(formatFigures('the four-year average of 7.075%')).toBe('the four-year average of 7.1%');
  });

  it('leaves a figure that is already readable alone', () => {
    const text = 'unemployment fell to 6.6% in June';

    expect(formatFigures(text)).toBe(text);
    expect(needsRounding(text)).toBe(false);
  });

  it('never touches a year, a count or anything without a decimal point', () => {
    // A transform that could turn 2026 into 2.0k would be worse than the
    // problem it solves.
    const text = 'In June 2026, across 1500 firms, the rate was 6.6%';

    expect(formatFigures(text)).toBe(text);
  });

  it('keeps two decimals for a bare quantity', () => {
    expect(formatFigures('16.31578 EUR/hour')).toBe('16.32 EUR/hour');
  });

  it('handles several figures in one sentence', () => {
    expect(formatFigures('6.71378% against 7.07500% a year earlier')).toBe(
      '6.7% against 7.1% a year earlier',
    );
  });
});
