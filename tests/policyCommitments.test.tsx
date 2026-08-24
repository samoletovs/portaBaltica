import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import aiUseSource from '../newsroom/policy/ai-use.md?raw';
import correctionsSource from '../newsroom/policy/corrections.md?raw';
import AiPolicyPage from '../src/components/news/AiPolicyPage';
import CorrectionsPage from '../src/components/news/CorrectionsPage';
import { NewsroomLayout } from '../src/components/news/NewsroomLayout';
import { CorrespondentAvatar } from '../src/components/news/CorrespondentAvatar';
import { Byline } from '../src/components/news/Byline';
import { CORRESPONDENTS, renderByline } from '../src/newsroom/correspondents';
import { ACCOUNTABLE_EDITOR } from '../src/newsroom/editorial';

/**
 * The policy is published, so these are not style preferences — they are
 * commitments a reader can hold us to. Each test below names the sentence in
 * newsroom/policy/ai-use.md that it enforces, and fails if the UI stops
 * honouring it.
 */

afterEach(() => vi.unstubAllGlobals());

function renderPage(ui: ReactElement) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in tests')));
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('Commitment: "We will never use a synthetic human face."', () => {
  it.each(CORRESPONDENTS)('renders $name as an abstract generated mark', (correspondent) => {
    const { container } = render(<CorrespondentAvatar id={correspondent.id} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    // No raster image, no embedded HTML, no external reference — a photograph
    // or a generated face could only arrive through one of these. Internal
    // `url(#gradient)` references are the mark's own paint and are fine.
    expect(svg!.querySelector('image')).toBeNull();
    expect(svg!.querySelector('foreignObject')).toBeNull();
    expect(svg!.querySelector('use')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(svg!.innerHTML).not.toMatch(/(xlink:)?href=/i);
    expect(svg!.innerHTML).not.toMatch(/url\((?!#)/i);
  });

  it('tells assistive technology that the mark is not a photograph', () => {
    const { container } = render(<CorrespondentAvatar id="kolka" />);

    expect(container.querySelector('svg')!.getAttribute('aria-label')).toContain(
      'Not a photograph of a person',
    );
  });
});

describe('Commitment: every byline reads "· AI correspondent", always, without exception', () => {
  it.each(CORRESPONDENTS)('holds for $name', (correspondent) => {
    // The policy quotes the separator as well as the words.
    expect(renderByline(correspondent)).toMatch(/·\s*AI correspondent/);
  });

  it('holds when the stored byline has had the disclosure stripped', () => {
    render(
      <MemoryRouter>
        <Byline persona={{ id: 'nida', name: 'Nida', byline: 'Nida' }} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/·\s*AI correspondent/)).toBeTruthy();
  });

  it('holds when the stored byline is missing entirely', () => {
    render(
      <MemoryRouter>
        <Byline persona={{ id: 'irbene', name: 'Irbene', byline: '' }} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/·\s*AI correspondent/)).toBeTruthy();
  });

  it('exposes no way to suppress the disclosure', () => {
    // There is deliberately no variant, flag or prop that renders a bare name.
    render(
      <MemoryRouter>
        <Byline persona={{ id: 'nida', name: 'Nida', byline: 'Nida' }} variant="full" />
      </MemoryRouter>,
    );

    expect(screen.getByText(/·\s*AI correspondent/)).toBeTruthy();
    expect(screen.queryByText('Nida', { exact: true })).toBeNull();
  });
});

describe('/about/ai renders the published policy, not a paraphrase of it', () => {
  it('shows the policy heading and metadata from the source file', () => {
    renderPage(<AiPolicyPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'How portaBaltica uses AI' })).toBeTruthy();
    expect(screen.getByText('Accountable editor')).toBeTruthy();
    expect(screen.getByText('Sam Samoletovs')).toBeTruthy();
  });

  it('carries the binding sentences verbatim', () => {
    const { container } = renderPage(<AiPolicyPage />);
    const text = container.textContent ?? '';

    expect(text).toContain('We will never use a synthetic human face.');
    expect(text).toContain('always, without exception');
    expect(text).toContain('is not an explanation we will ever offer you');
    expect(text).toContain('we would rather you did');
  });

  it('renders every section of the source document', () => {
    const { container } = renderPage(<AiPolicyPage />);
    const rendered = container.textContent ?? '';

    // Every H2 in the source file must appear on the page. If someone renders
    // only part of the policy, or reverts to hand-written JSX that drifts from
    // the source, this catches it.
    const headings = [...aiUseSource.matchAll(/^##\s+(.*)$/gm)].map((match) => match[1].trim());
    expect(headings.length).toBeGreaterThan(5);
    headings.forEach((heading) => expect(rendered).toContain(heading));
  });

  it('renders the permitted/forbidden table as a table', () => {
    renderPage(<AiPolicyPage />);

    expect(screen.getByRole('columnheader', { name: 'The model may not' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: /Supply or recall a number/ })).toBeTruthy();
  });

  it('no longer contains the hand-written placeholder copy it replaced', () => {
    const { container } = renderPage(<AiPolicyPage />);
    const text = container.textContent ?? '';

    expect(text).not.toContain('What the correspondents never do');
    expect(text).not.toContain('The gate');
  });
});

describe('newsroom masthead disclosure', () => {
  it('distinguishes AI editing from human accountability above the fold', () => {
    const { container } = renderPage(<NewsroomLayout />);
    const text = container.textContent ?? '';

    expect(text).toContain('edited by a disclosed AI editor');
    expect(text).toContain(`${ACCOUNTABLE_EDITOR} is accountable for everything published here`);
    expect(text).not.toContain(`edited by ${ACCOUNTABLE_EDITOR}`);
    expect(screen.getByRole('link', { name: 'What that means' }).getAttribute('href')).toBe(
      '/about/ai',
    );
  });
});

describe('/corrections renders the published policy and the log', () => {
  it('shows the policy text from the source file', () => {
    const { container } = renderPage(<CorrectionsPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Corrections policy' })).toBeTruthy();
    expect(container.textContent).toContain('public, attached to the article, and append-only');
  });

  it('renders every section of the source document', () => {
    const { container } = renderPage(<CorrectionsPage />);
    const rendered = container.textContent ?? '';

    const headings = [...correctionsSource.matchAll(/^##\s+(.*)$/gm)].map((match) => match[1].trim());
    expect(headings.length).toBeGreaterThan(3);
    headings.forEach((heading) => expect(rendered).toContain(heading));
  });

  it('renders the severity table', () => {
    renderPage(<CorrectionsPage />);

    expect(screen.getByRole('columnheader', { name: 'Severity' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: /Retraction/ })).toBeTruthy();
  });

  it('publishes the log even when it is empty, so the emptiness is checkable', async () => {
    renderPage(<CorrectionsPage />);

    expect(screen.getByRole('heading', { name: 'The log' })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/its emptiness is verifiable rather than assumed/i)).toBeTruthy(),
    );
  });

  it('links back to the file it was rendered from', () => {
    renderPage(<CorrectionsPage />);

    const link = screen.getByRole('link', { name: /newsroom\/policy\/corrections\.md/ });
    expect(link.getAttribute('href')).toContain('newsroom/policy/corrections.md');
  });
});
