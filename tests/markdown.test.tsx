import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Markdown } from '../src/newsroom/markdown';
import { headingId, parseMarkdown } from '../src/newsroom/markdown-parse';

function renderMarkdown(source: string) {
  return render(
    <MemoryRouter>
      <Markdown source={source} />
    </MemoryRouter>,
  );
}

describe('parseMarkdown', () => {
  it('joins a hard-wrapped paragraph into flowing prose', () => {
    const blocks = parseMarkdown('One line of prose\nwrapped across two.');

    expect(blocks).toEqual([{ kind: 'paragraph', text: 'One line of prose wrapped across two.' }]);
  });

  it('reads a labelled metadata header as fields rather than a run-on sentence', () => {
    // Both policy documents open this way. CommonMark would collapse the two
    // lines into one paragraph, which is not what the author means.
    const blocks = parseMarkdown('**Last updated:** 2026-08-24\n**Accountable editor:** Sam Samoletovs');

    expect(blocks).toEqual([
      {
        kind: 'meta',
        entries: [
          { label: 'Last updated', value: '2026-08-24' },
          { label: 'Accountable editor', value: 'Sam Samoletovs' },
        ],
      },
    ]);
  });

  it('does not mistake a single labelled sentence for a metadata header', () => {
    const blocks = parseMarkdown('**Permitted:** writing prose around figures\nthe pipeline verified.');

    expect(blocks[0].kind).toBe('paragraph');
  });

  it('parses a table with its header row', () => {
    const blocks = parseMarkdown('| A | B |\n|---|---|\n| one | two |');

    expect(blocks).toEqual([
      { kind: 'table', header: ['A', 'B'], rows: [['one', 'two']] },
    ]);
  });

  it('treats a pipe line with no divider as ordinary text', () => {
    const blocks = parseMarkdown('| not a table |');

    expect(blocks[0].kind).toBe('paragraph');
  });

  it('always makes progress, so no input can hang the parser', () => {
    // Regression: a pipe row with no divider under it fell through every block
    // branch and consumed no lines, spinning forever. Every branch must now
    // advance the cursor. The timeout is the assertion.
    const pathological = '| a |\n| b |\ntext\n| c |\n---\n| d |';

    const blocks = parseMarkdown(pathological);

    expect(blocks.length).toBeGreaterThan(0);
  }, 2000);

  it('continues a wrapped list item rather than starting a new one', () => {
    const blocks = parseMarkdown('- first item\n  continued here\n- second item');

    expect(blocks).toEqual([
      { kind: 'list', ordered: false, items: ['first item continued here', 'second item'] },
    ]);
  });

  it('distinguishes ordered from unordered lists', () => {
    expect(parseMarkdown('1. one\n2. two')[0]).toMatchObject({ ordered: true });
    expect(parseMarkdown('- one\n- two')[0]).toMatchObject({ ordered: false });
  });

  it('reads a rule but not a table divider as a horizontal rule', () => {
    expect(parseMarkdown('---')[0].kind).toBe('rule');
  });
});

describe('Markdown rendering', () => {
  it('renders headings with linkable ids', () => {
    renderMarkdown('## Why we do not rewrite other publications');

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.id).toBe('why-we-do-not-rewrite-other-publications');
    expect(headingId('5. Why we do not')).toBe('5-why-we-do-not');
  });

  it('renders bold, italic and inline code', () => {
    const { container } = renderMarkdown('Text with **bold**, *italic* and `code`.');

    expect(container.querySelector('strong')!.textContent).toBe('bold');
    expect(container.querySelector('em')!.textContent).toBe('italic');
    expect(container.querySelector('code')!.textContent).toBe('code');
  });

  it('routes internal links through the router', () => {
    renderMarkdown('See the [corrections log](/corrections).');

    const link = screen.getByRole('link', { name: 'corrections log' });
    expect(link.getAttribute('href')).toBe('/corrections');
    // Router links are same-document navigation, not new tabs.
    expect(link.getAttribute('target')).toBeNull();
  });

  it('opens external links in a new tab, safely', () => {
    renderMarkdown('Report at [GitHub](https://github.com/samoletovs/portaBaltica/issues).');

    const link = screen.getByRole('link', { name: /GitHub/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('renders a table as a real table with column headers', () => {
    renderMarkdown('| Severity | What happens |\n|---|---|\n| Retraction | Marked `retracted` |');

    expect(screen.getByRole('columnheader', { name: 'Severity' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: /Retraction/ })).toBeTruthy();
  });

  it('never interprets markdown source as HTML', () => {
    // The renderer produces React elements and uses no dangerouslySetInnerHTML,
    // so markup in the source is text. If someone swaps in an HTML-emitting
    // library without sanitising, this fails.
    const { container } = renderMarkdown('Danger <script>alert(1)</script> and <img src=x>.');

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});
