import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  ACCOUNTABLE_PUBLISHER,
  AI_EDITOR,
  BYLINE_SUFFIX,
  CORRESPONDENTS,
  NEWSROOM,
  renderByline,
} from '../src/newsroom/correspondents';
import { publisherName } from '../src/newsroom/editorial';
import { ArticleView } from '../src/components/news/ArticleView';
import { NewsroomIndex } from '../src/components/news/NewsroomIndex';
import { NewsroomLayout } from '../src/components/news/NewsroomLayout';
import { tierAArticle } from './fixtures/articles';

vi.mock('../src/components/news/ChartEmbed', () => ({
  ChartEmbed: ({ indicatorId, country }: { indicatorId: string; country?: string }) => (
    <div data-testid="chart-embed" data-indicator={indicatorId} data-country={country ?? ''} />
  ),
}));

afterEach(() => vi.unstubAllGlobals());

function renderArticle(article: Parameters<typeof ArticleView>[0]['article']) {
  return render(
    <MemoryRouter>
      <ArticleView article={article} />
    </MemoryRouter>,
  );
}

describe('house naming', () => {
  it('gives every correspondent a lighthouse surname', () => {
    const surnames = CORRESPONDENTS.map((c) => c.name.split(' ').slice(1).join(' '));

    expect(surnames).toEqual(['Nida', 'Akmeņrags', 'Kolka', 'Ristna', 'Irbene']);
  });

  it('gives the editor and the publisher one too', () => {
    expect(AI_EDITOR.name).toBe('Dace Saulkrasti');
    expect(ACCOUNTABLE_PUBLISHER).toBe('Andre Kõpu');
  });

  it('still discloses in every byline', () => {
    CORRESPONDENTS.forEach((c) => expect(renderByline(c)).toMatch(/·\s*AI correspondent/));
  });
});

describe('a renamed correspondent does not keep two names', () => {
  it('rebuilds the byline from the registry, not from the stored string', () => {
    // Articles filed before the rename carry the old surname baked into
    // `persona.byline`. Trusting it would print one name on the article and a
    // different one on the page it links to.
    const stale = renderByline({
      id: 'nida',
      name: 'Ilze Bērziņa',
      beat: 'Economy & Labour',
      byline: 'Ilze Bērziņa · AI correspondent, Economy & Labour',
    });

    expect(stale).toBe('Ilze Nida · AI correspondent, Economy & Labour');
    expect(stale).not.toContain('Bērziņa');
  });

  it('still discloses for a persona the registry has never heard of', () => {
    expect(renderByline({ id: 'unknown', name: 'Someone New' })).toContain(BYLINE_SUFFIX);
  });

  it('prints one publisher name even for articles that stored the old one', () => {
    expect(publisherName('Sam Samoletovs')).toBe(ACCOUNTABLE_PUBLISHER);
    expect(publisherName(undefined)).toBe(ACCOUNTABLE_PUBLISHER);
    // Anything unrecognised is left alone rather than silently overwritten.
    expect(publisherName('Someone Else')).toBe('Someone Else');
  });
});

describe('the editor is visible to readers', () => {
  it('is named in the provenance panel of an article', () => {
    renderArticle(tierAArticle());

    expect(screen.getByText('Reviewed by')).toBeTruthy();
    expect(screen.getByText(/Dace Saulkrasti/)).toBeTruthy();
  });

  it('names the accountable publisher as publisher, not as editor', () => {
    // Two different roles. Calling the human "accountable editor" while an AI
    // editor also reviews the copy makes it unclear who did what.
    renderArticle(tierAArticle());

    expect(screen.getByText('Accountable publisher')).toBeTruthy();
    expect(screen.getByText(ACCOUNTABLE_PUBLISHER)).toBeTruthy();
  });

  it('appears in the masthead line on every page', () => {
    render(
      <MemoryRouter>
        <NewsroomLayout />
      </MemoryRouter>,
    );

    expect(screen.getByText(/reviewed by an AI editor/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(ACCOUNTABLE_PUBLISHER))).toBeTruthy();
  });

  it('has a place on the newsroom page, separated from the writers', () => {
    render(
      <MemoryRouter>
        <NewsroomIndex />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Correspondents' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Accountable publisher' })).toBeTruthy();
    expect(screen.getByText(AI_EDITOR.name)).toBeTruthy();
  });

  it('says plainly that the publisher is the human one', () => {
    render(
      <MemoryRouter>
        <NewsroomIndex />
      </MemoryRouter>,
    );

    expect(screen.getByText(/The only human on this masthead/i)).toBeTruthy();
  });

  it('lists all seven of us in the roster', () => {
    expect(NEWSROOM).toHaveLength(7);
    expect(NEWSROOM.filter((m) => m.role === 'correspondent')).toHaveLength(5);
    expect(NEWSROOM.filter((m) => m.role === 'editor')).toHaveLength(1);
    expect(NEWSROOM.filter((m) => m.role === 'publisher')).toHaveLength(1);
  });
});

describe('the masthead is one line and four destinations', () => {
  it('offers exactly four places to go', () => {
    render(
      <MemoryRouter>
        <NewsroomLayout />
      </MemoryRouter>,
    );

    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(nav.querySelectorAll('a')).toHaveLength(4);
  });

  it('points at the newsroom rather than at a list of writers', () => {
    const { container } = render(
      <MemoryRouter>
        <NewsroomLayout />
      </MemoryRouter>,
    );

    expect(container.querySelector('a[href="/newsroom"]')).not.toBeNull();
    expect(container.querySelector('a[href="/correspondents"]')).toBeNull();
  });
});

describe('the links under an article go somewhere useful', () => {
  it('carries the article’s country to the indicator page', () => {
    // The indicator page answers for one country. Without this it answered for
    // whatever the dashboard switcher was last left on, so an Estonian story
    // could open Lithuania.
    const { container } = renderArticle(tierAArticle({ countries: ['EE'] }));

    const check = container.querySelector('a[href^="/indicator/"]');
    expect(check?.getAttribute('href')).toBe('/indicator/salary?country=EE');
  });

  it('falls back to the section for a Baltic-wide story', () => {
    // Three countries, no single series to point at.
    const { container } = renderArticle(tierAArticle({ countries: ['Baltic', 'LV', 'EE', 'LT'] }));

    const check = container.querySelector('a[href^="/indicator/"]');
    expect(check?.getAttribute('href')).toBe('/indicator/salary');
  });

  it('sends the reader to the section when the story embeds no chart', () => {
    const article = tierAArticle();
    article.body = [{ type: 'paragraph', text: 'No chart here.' }];

    const { container } = renderArticle(article);

    expect(container.querySelector('a[href="/data/economy"]')).not.toBeNull();
  });
});

describe('correspondent pages moved but did not disappear', () => {
  it('renders the newsroom at /newsroom', () => {
    render(
      <MemoryRouter initialEntries={['/newsroom']}>
        <Routes>
          <Route path="/newsroom" element={<NewsroomIndex />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'The newsroom' })).toBeTruthy();
  });
});
