/**
 * Two implementations of one contract, held to each other.
 *
 * WHY THIS EXISTS
 * ---------------
 * The client decides an article's title, description, robots directive and
 * JSON-LD in TypeScript compiled for the browser. `api/shared/articleMeta.js`
 * now decides the same things in CommonJS on the Function host, because social
 * crawlers never run the first one. There is no shared build step between
 * `src/` and `api/`, so the second is a mirror — and a mirror nobody checks is
 * just a second opinion waiting to disagree.
 *
 * This suite runs both over the same inputs and requires them to agree. It is
 * not a formality: writing the mirror the obvious way already produced one real
 * divergence, caught here rather than in production.
 *
 * THE DIVERGENCE IT CAUGHT
 * ------------------------
 * `renderByline` prefers the correspondent roster over the name stored in the
 * article, because all five correspondents were renamed to the house's
 * lighthouse surnames and the stored documents were deliberately left alone.
 * Measured against the live index on 2026-08-27, every tier A article stores a
 * name the site no longer prints:
 *
 *   Gintaras Vaitkus, Ilze Bērziņa, Kadri Lepik, Marek Soosaar, Rasa Petrauskaitė
 *
 * A mirror that read `persona.name` would have served crawlers a structured-data
 * author for every article that contradicts the byline on the page. The
 * `renderByline` cases below use those exact stored names, so this suite fails
 * against that implementation rather than passing on a fixture that happens to
 * agree.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

import { isServable } from '../src/news-types';
import { isValidSlug } from '../src/news-api';
import { newsArticleJsonLd } from '../src/newsroom/structured-data';
import { renderByline, CORRESPONDENTS } from '../src/newsroom/correspondents';
import { publisherName } from '../src/newsroom/editorial';
import type { Article } from '../src/news-types';

const require = createRequire(import.meta.url);
const meta = require(resolve(__dirname, '..', 'api/shared/articleMeta.js'));

/**
 * The stored persona names, as blob storage actually holds them today.
 * Every one of these is stale, which is the point.
 */
const STORED_PERSONAS = [
  { id: 'kolka', name: 'Gintaras Vaitkus', beat: 'Maritime & Trade' },
  { id: 'nida', name: 'Ilze Bērziņa', beat: 'Economy & Labour' },
  { id: 'ristna', name: 'Kadri Lepik', beat: 'Environment & Climate' },
  { id: 'akmensrags', name: 'Marek Soosaar', beat: 'Energy & Markets' },
  { id: 'irbene', name: 'Rasa Petrauskaitė', beat: 'Government, EU & Society' },
];

function baseArticle(overrides: Record<string, unknown> = {}): Article {
  return {
    id: '01M115W57T56VK9HZ69EY80WAV',
    slug: 'latvia-s-ports-set-record-with-1-175-thousand-tonnes-6d06ee',
    tier: 'A',
    status: 'published',
    section: 'maritime',
    headline: "Latvia's ports set record with 1,175 thousand tonnes in Q4 2025",
    dek: 'A shift in logistics through Latvian ports.',
    persona: {
      id: 'kolka',
      name: 'Gintaras Vaitkus',
      beat: 'Maritime & Trade',
      byline: 'Gintaras Vaitkus · AI correspondent, Maritime & Trade',
    },
    provenance: {
      sources: [
        {
          source_id: 'eurostat',
          dataset: 'mar_go_qm_lv',
          dataset_version: '2026-08-27',
          retrieved_at: '2026-08-27T08:00:00Z',
          url: 'https://ec.europa.eu/eurostat/databrowser/view/mar_go_qm_lv',
        },
        { source_id: 'no-url', retrieved_at: '2026-08-27T08:00:00Z' },
      ],
      accountable_editor: 'Sam Samoletovs',
      validator: { passed: true, checked_at: '2026-08-27T08:30:00Z', checks: [] },
    },
    created_at: '2026-08-27T08:30:00Z',
    published_at: '2026-08-27T08:37:03Z',
    ...overrides,
  } as unknown as Article;
}

describe('the correspondent roster the mirror carries', () => {
  it('matches the roster the page renders from', () => {
    const fromClient: Record<string, { name: string; beat: string }> = {};
    for (const correspondent of CORRESPONDENTS) {
      fromClient[correspondent.id] = { name: correspondent.name, beat: correspondent.beat };
    }
    expect(meta.CORRESPONDENT_ROSTER).toEqual(fromClient);
  });
});

describe('renderByline agrees', () => {
  for (const persona of STORED_PERSONAS) {
    it(`for the stored persona "${persona.name}"`, () => {
      const stored = { ...persona, byline: `${persona.name} · AI correspondent, ${persona.beat}` };
      const expected = renderByline(stored);
      expect(meta.renderByline(stored)).toBe(expected);
      // And it must actually be resolving, not echoing: the current name is
      // not the stored one for any of these.
      expect(expected).not.toContain(persona.name);
    });
  }

  it('for a persona the roster does not know', () => {
    const unknown = { id: 'saulkrasti', name: 'Dace Saulkrasti', beat: 'Editorial review' };
    expect(meta.renderByline(unknown)).toBe(renderByline(unknown));
  });

  it('for a persona with no name at all', () => {
    const nameless = { id: 'ghost', byline: 'Someone · AI correspondent' };
    expect(meta.renderByline(nameless)).toBe(renderByline(nameless));
    expect(meta.renderByline({ id: 'ghost' })).toBe(renderByline({ id: 'ghost' }));
  });
});

describe('publisherName agrees', () => {
  for (const stored of [
    undefined,
    '',
    '   ',
    'Sam Samoletovs',
    'Sam Samoletov',
    'Andre Ovīši',
    'Andre Kõpu',
    'Someone Else',
  ]) {
    it(`for ${JSON.stringify(stored)}`, () => {
      expect(meta.publisherName(stored)).toBe(publisherName(stored));
    });
  }
});

describe('isServable agrees', () => {
  const cases: unknown[] = [
    baseArticle(),
    baseArticle({ status: 'retracted' }),
    baseArticle({ status: 'draft' }),
    baseArticle({ status: 'corrected' }),
    baseArticle({ status: 'rejected' }),
    baseArticle({ status: 'pending_approval' }),
    baseArticle({ provenance: { sources: [], validator: { passed: false, checked_at: '', checks: [] } } }),
    baseArticle({ provenance: { sources: [] } }),
    baseArticle({ provenance: {} }),
    { status: 'published' },
    {},
  ];

  it('across every state an article can be in', () => {
    const client = cases.map((c) => isServable(c as Article));
    const server = cases.map((c) => meta.isServable(c));
    expect(server).toEqual(client);
    // The comparison is worthless if every answer is the same answer.
    expect(new Set(client).size).toBe(2);
  });
});

describe('isValidSlug agrees', () => {
  const slugs = [
    'latvia-s-ports-set-record-with-1-175-thousand-tonnes-6d06ee',
    'eiropas-komisāra-valda-dombrovska-runa-rīgas-tehniskajā-universitātē-df6376be',
    'reason-for-cia-chief-s-trip-via-rīga-8a530118',
    'baiba-braže-has-a-busy-day-in-sweden-bfe0a539',
    'UPPERCASE',
    'trailing-',
    '-leading',
    'double--dash',
    '../escape',
    '',
    'a',
  ];

  it('across real and hostile slugs', () => {
    const client = slugs.map((s) => isValidSlug(s));
    const server = slugs.map((s) => meta.isValidSlug(s));
    expect(server).toEqual(client);
    expect(new Set(client).size).toBe(2);
  });
});

describe('newsArticleJsonLd agrees', () => {
  const cases: [string, Article][] = [
    ['a plain tier A article', baseArticle()],
    ['one with no dek', baseArticle({ dek: undefined })],
    ['one with no published_at', baseArticle({ published_at: undefined })],
    ['a tier B press release', baseArticle({ tier: 'B' })],
    ['a tier C link-out', baseArticle({ tier: 'C' })],
    ['a tier A with no persona', baseArticle({ persona: undefined })],
    ['a corrected article', baseArticle({
      status: 'corrected',
      corrections: [
        { corrected_at: '2026-08-27T07:53:37Z', description: 'First note.', previous_value: '130.9' },
        { corrected_at: '2026-08-27T08:08:13Z', description: 'Second note.' },
      ],
    })],
    ['one with research provenance', baseArticle({
      provenance: {
        sources: [
          {
            source_id: 'eurostat',
            dataset: 'mar_go_qm_lv',
            retrieved_at: '2026-08-27T08:00:00Z',
            url: 'https://ec.europa.eu/x',
          },
        ],
        research: {
          method: 'registered_feeds',
          candidates_considered: 4,
          consulted: [
            {
              source_id: 'lsm',
              source_name: 'LSM',
              role: 'prior_coverage',
              title: 'Ports report',
              url: 'https://lsm.lv/x',
              retrieved_at: '2026-08-27T08:00:00Z',
            },
          ],
        },
        accountable_editor: 'Andre Ovīši',
        validator: { passed: true, checked_at: '2026-08-27T08:30:00Z', checks: [] },
      },
    })],
    ['one with no sources at all', baseArticle({
      provenance: { sources: [], validator: { passed: true, checked_at: '', checks: [] } },
    })],
  ];

  for (const [label, subject] of cases) {
    it(label, () => {
      expect(meta.newsArticleJsonLd(subject)).toEqual(newsArticleJsonLd(subject));
    });
  }

  it('produced a non-null result for at least one case, and null for another', () => {
    // Deep-equality between two nulls would pass for a function that returns
    // null unconditionally.
    expect(meta.newsArticleJsonLd(baseArticle())).not.toBeNull();
    expect(meta.newsArticleJsonLd(baseArticle({ tier: 'C' }))).toBeNull();
  });

  it('resolves the author to the current name, not the stored one', () => {
    const jsonLd = meta.newsArticleJsonLd(baseArticle()) as Record<string, { name: string }>;
    expect(jsonLd.author.name).toBe('Gintaras Kolka · AI correspondent, Maritime & Trade');
    expect(jsonLd.author.name).not.toContain('Vaitkus');
  });
});
