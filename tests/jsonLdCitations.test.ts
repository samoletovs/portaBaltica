import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { newsArticleJsonLd } from '../src/newsroom/structured-data';
import type { Article } from '../src/news-types';

const require = createRequire(import.meta.url);
const meta = require(resolve('api/shared/articleMeta.js'));

/**
 * The structured data must not count one source three times.
 *
 * `provenance.sources` carries an entry per SERIES the signal read, and a
 * `structural_divergence` signal reads three series out of ONE Eurostat cube.
 * Both JSON-LD builders emitted that array straight into `isBasedOn` and
 * `citation`, so a single dataset appeared three times with an identical name,
 * url and version.
 *
 * Measured against production on 2026-08-28T13:12Z, over the newest ten tier A
 * articles:
 *
 *   baltic-road-freight-gap-widens-...        isBasedOn 3 entries -> 1 distinct
 *   baltic-road-freight-divergence-...        isBasedOn 3 entries -> 1 distinct
 *   baltic-transport-services-balance-...     isBasedOn 3 entries -> 1 distinct
 *
 * Three of ten. It is not a rendering bug and no reader sees it: the provenance
 * panel on the page correctly shows one source. It is only in the machine-
 * readable half -- which is the half `robots.txt` explicitly invites answer
 * engines to read, asking them in return to "cite the article, and carry the
 * vintage with the figure". So the one artefact written for machines was
 * inflating the provenance it exists to make checkable.
 *
 * Deduped on the identifying triple rather than on the URL alone. Two readings
 * of the same dataset at different vintages are genuinely two citations, and
 * collapsing them would discard the vintage the policy promises to carry.
 */

const SOURCE = {
  source_id: 'eurostat',
  source_name: 'Eurostat',
  dataset: 'road_go_tq_tott',
  url: 'https://ec.europa.eu/eurostat/api/x?geo=LV',
  dataset_version: '2026-07-30T23:00:00+0200',
  retrieved_at: '2026-08-27T17:10:00Z',
};

function articleWith(sources: unknown[]): Article {
  return {
    id: 'a1',
    slug: 'road-freight-gap-widens',
    tier: 'A',
    section: 'trade',
    headline: 'Baltic road freight gap widens',
    dek: 'A dek.',
    status: 'published',
    persona: { id: 'kolka', name: 'Gintaras Kolka', beat: 'Maritime & Trade' },
    body: [],
    created_at: '2026-08-27T17:10:46Z',
    published_at: '2026-08-27T17:10:46Z',
    provenance: {
      sources,
      model: 'gpt-4o-mini',
      generated_at: '2026-08-27T17:10:46Z',
      validator: { passed: true, checked_at: '2026-08-27T17:10:53Z', checks: [] },
    },
  } as unknown as Article;
}

/** The same shape the API builder is handed, which is the stored article. */
function storedWith(sources: unknown[]) {
  return articleWith(sources) as unknown as Record<string, unknown>;
}

const key = (e: Record<string, unknown>) =>
  JSON.stringify([e['@type'], e.name, e.url, e.version]);

describe('JSON-LD counts distinct sources, not series read', () => {
  it('collapses one cube read three times into one citation', () => {
    const three = articleWith([SOURCE, SOURCE, SOURCE]);
    const ld = newsArticleJsonLd(three)!;
    expect(ld, 'a tier A article produced no JSON-LD').not.toBeNull();

    const cites = ld.citation as Record<string, unknown>[];
    expect(cites.length, 'three identical Dataset entries reached the citation array').toBe(1);
    expect((ld.isBasedOn as unknown[]).length).toBe(1);
    expect(cites[0].name).toBe('road_go_tq_tott');
    expect(cites[0].version, 'the vintage must survive deduplication').toBe(SOURCE.dataset_version);
  });

  it('keeps two readings of one dataset at different vintages', () => {
    // The whole reason for deduping on the triple rather than the URL: a
    // second reading at a later vintage is a second citation, and losing it
    // would break the promise robots.txt makes about carrying the vintage.
    const later = { ...SOURCE, dataset_version: '2026-08-27T23:00:00+0200' };
    const ld = newsArticleJsonLd(articleWith([SOURCE, later, SOURCE]))!;
    const cites = ld.citation as Record<string, unknown>[];
    expect(cites.length, 'two distinct vintages were collapsed into one').toBe(2);
    expect(new Set(cites.map((c) => c.version)).size).toBe(2);
  });

  it('keeps genuinely different datasets', () => {
    // The control. Without it, a builder that returned a single entry
    // unconditionally would satisfy every assertion above.
    const other = { ...SOURCE, dataset: 'mar_go_qm_lv', url: 'https://ec.europa.eu/eurostat/api/y' };
    const ld = newsArticleJsonLd(articleWith([SOURCE, other]))!;
    expect((ld.citation as unknown[]).length, 'two different cubes were collapsed').toBe(2);
  });

  it('agrees with the server-side builder, which is what a crawler receives', () => {
    // The page is rendered client-side, so a crawler that does not run
    // JavaScript reads api/shared/articleMeta.js instead. Two builders, one
    // claim -- and tests/articleMetaParity.test.ts exists because they drifted
    // before. Deduping one and not the other would mean the same article
    // asserted one source to a browser and three to a crawler.
    const three = storedWith([SOURCE, SOURCE, SOURCE]);
    const server = meta.newsArticleJsonLd(three) as Record<string, unknown> | null;
    expect(server, 'the server builder produced no JSON-LD for a tier A article').not.toBeNull();

    const serverCites = (server!.citation as Record<string, unknown>[]).map(key);
    const clientCites = (
      newsArticleJsonLd(articleWith([SOURCE, SOURCE, SOURCE]))!.citation as Record<string, unknown>[]
    ).map(key);

    expect(serverCites.length, 'the server builder still emits duplicates').toBe(1);
    expect(serverCites, 'the two builders disagree about the citation set').toEqual(clientCites);
  });
});
