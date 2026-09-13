import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PageIntro, PageTitle } from '../src/components/PageIntro';
import { Markdown } from '../src/newsroom/markdown';

afterEach(cleanup);

describe('shared page presentation', () => {
  it('keeps title, reading context, actions and optional metadata in one opening', () => {
    let activated = false;
    render(<PageIntro
      title={<>The Baltic <span>journal</span></>}
      lead="Read the finding, inspect the evidence."
      description="Recorded observations remain separate from current series."
      actions={<button onClick={() => { activated = true; }}>Inspect</button>}
      aside={<p>Latvia, Estonia and Lithuania</p>}
    ><p>AI authorship is disclosed.</p></PageIntro>);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('The Baltic journal');
    expect(heading.closest('.site-page-intro-with-aside')).not.toBeNull();
    expect(heading.className).toContain('text-display md:text-masthead font-semibold');
    expect(screen.getByText('Read the finding, inspect the evidence.').className).toContain('site-page-lead');
    expect(screen.getByText('Latvia, Estonia and Lithuania').closest('.site-page-aside')).not.toBeNull();
    expect(screen.getByText('AI authorship is disclosed.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(activated).toBe(true);
  });

  it('does not leave an empty metadata column or action bar on a focused tool', () => {
    const { container } = render(<PageIntro title="Data explorer" lead="Choose a measure." />);
    expect(container.querySelector('.site-page-aside')).toBeNull();
    expect(container.querySelector('.site-page-actions')).toBeNull();
    expect(container.querySelector('.site-page-intro-with-aside')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('preserves heading identity and shares the same title role with policy rendering', () => {
    const { rerender } = render(<PageTitle id="article-title" tabIndex={-1}>Recorded headline</PageTitle>);
    const heading = screen.getByRole('heading', { level: 1 });
    const classes = heading.className;
    expect(heading.id).toBe('article-title');
    expect(heading.tabIndex).toBe(-1);
    rerender(<Markdown source="# Our policy" />);
    const policy = screen.getByRole('heading', { level: 1 });
    expect(policy.className.startsWith(classes.trim())).toBe(true);
    expect(policy.id).toBe('our-policy');
  });
});
