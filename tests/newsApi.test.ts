import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchArticleIndex, isValidSlug, loadArticle } from '../src/news-api';
import { FAILING_VERDICT, tierAArticle, tierASummary, tierCSummary } from './fixtures/articles';

function mockJson(payload: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadArticle', () => {
  it('returns a servable article', async () => {
    vi.stubGlobal('fetch', mockJson(tierAArticle()));

    const result = await loadArticle('latvian-wage-growth-outpaces-inflation');

    expect(result.state).toBe('ok');
  });

  it('refuses an article whose validator did not pass', async () => {
    const article = tierAArticle();
    article.provenance.validator = FAILING_VERDICT;
    vi.stubGlobal('fetch', mockJson(article));

    const result = await loadArticle(article.slug);

    // The loader must not hand an unvalidated article to the renderer at all.
    expect(result.state).toBe('not-servable');
    expect(result).not.toHaveProperty('article');
  });

  it('refuses an article that is still awaiting approval', async () => {
    vi.stubGlobal('fetch', mockJson(tierAArticle({ status: 'pending_approval' })));

    expect((await loadArticle('latvian-wage-growth-outpaces-inflation')).state).toBe('not-servable');
  });

  it('refuses a payload that is not an article at all', async () => {
    vi.stubGlobal('fetch', mockJson('just a string'));

    expect((await loadArticle('anything-at-all')).state).toBe('not-servable');
  });

  it('reports a missing article as not found', async () => {
    vi.stubGlobal('fetch', mockJson(null, 404));

    expect((await loadArticle('no-such-article')).state).toBe('not-found');
  });

  it('never requests a malformed slug', async () => {
    const fetchMock = mockJson(tierAArticle());
    vi.stubGlobal('fetch', fetchMock);

    // Path traversal dressed as a slug. Rejected before a URL is built.
    const result = await loadArticle('../../etc/passwd');

    expect(result.state).toBe('not-found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no credentials with the request', async () => {
    const fetchMock = mockJson(tierAArticle());
    vi.stubGlobal('fetch', fetchMock);

    await loadArticle('latvian-wage-growth-outpaces-inflation');

    // Generation is batch precisely so the browser never holds a credential.
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
  });
});

describe('isValidSlug', () => {
  it('accepts the schema’s slug form', () => {
    expect(isValidSlug('latvian-wage-growth-2026')).toBe(true);
  });

  it.each(['../secrets', 'Has Spaces', 'UPPER', 'trailing-', '', 'a//b'])(
    'rejects %j',
    (slug) => {
      expect(isValidSlug(slug)).toBe(false);
    },
  );
});

describe('fetchArticleIndex', () => {
  it('returns well-formed summaries', async () => {
    vi.stubGlobal('fetch', mockJson({
      generated_at: '2026-08-24T06:20:00Z',
      count: 2,
      articles: [tierASummary(), tierCSummary()],
    }));

    const index = await fetchArticleIndex();

    expect(index.articles).toHaveLength(2);
  });

  it('drops a tier A summary with no byline', async () => {
    vi.stubGlobal('fetch', mockJson({
      articles: [tierASummary({ persona: undefined })],
    }));

    // An article of ours with nothing to disclose with does not get shown.
    expect((await fetchArticleIndex()).articles).toHaveLength(0);
  });

  it('drops a tier C summary with no attribution', async () => {
    vi.stubGlobal('fetch', mockJson({
      articles: [
        tierCSummary({
          syndicated: { attribution: '', original_url: 'https://news.err.ee/x', snippet: 'x' },
        }),
      ],
    }));

    expect((await fetchArticleIndex()).articles).toHaveLength(0);
  });

  it('drops entries with an unrecognised tier', async () => {
    vi.stubGlobal('fetch', mockJson({
      articles: [tierASummary({ tier: 'D' as never })],
    }));

    expect((await fetchArticleIndex()).articles).toHaveLength(0);
  });

  it('returns an empty index rather than throwing on a malformed payload', async () => {
    vi.stubGlobal('fetch', mockJson({ nonsense: true }));

    const index = await fetchArticleIndex();

    expect(index.articles).toEqual([]);
    expect(index.count).toBe(0);
  });
});


describe('the index withholds what the pipeline withdrew', () => {
  // `drop_from_index` removes a retracted article, so ordinarily nothing here
  // is anything but published. This is the second lock: if that removal ever
  // half-fails, the stale entry is what remains, and the front page would
  // carry a headline we have publicly withdrawn.
  //
  // It is deliberately the same rule as `ourArticles` in
  // `api/shared/newsroom.js`, which guards RSS and the sitemap. Two surfaces
  // read this index, and a rule that holds on one of them is not a rule.
  it('drops a retracted entry', async () => {
    const withdrawn = tierASummary({
      slug: 'baltic-telecommunications-services-balance-widens',
      status: 'retracted',
    });
    vi.stubGlobal(
      'fetch',
      mockJson({ generated_at: 'now', count: 2, articles: [tierASummary(), withdrawn] }),
    );

    const index = await fetchArticleIndex();

    expect(index.articles.map((a) => a.slug)).not.toContain(withdrawn.slug);
    expect(index.articles).toHaveLength(1);
    expect(index.count).toBe(1);
  });

  it('drops a status this build has never heard of', async () => {
    // An allow list, so a state added upstream is withheld rather than shown
    // by a frontend that does not know what it means.
    vi.stubGlobal(
      'fetch',
      mockJson({
        generated_at: 'now',
        count: 1,
        articles: [tierASummary({ status: 'embargoed' as never })],
      }),
    );

    expect((await fetchArticleIndex()).articles).toHaveLength(0);
  });

  it('keeps an entry written before the field existed', async () => {
    // Everything already on the front page predates this, and must not vanish.
    const legacy = tierASummary();
    delete (legacy as { status?: unknown }).status;
    vi.stubGlobal('fetch', mockJson({ generated_at: 'now', count: 1, articles: [legacy] }));

    expect((await fetchArticleIndex()).articles).toHaveLength(1);
  });

  it('keeps a published entry', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson({ generated_at: 'now', count: 1, articles: [tierASummary({ status: 'published' })] }),
    );

    expect((await fetchArticleIndex()).articles).toHaveLength(1);
  });
});
