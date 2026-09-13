import { isServable, type Article, type PublishedObservation } from '../news-types';
import { cadenceOf } from '../dataFreshness';

export type EvidenceCountry = 'LV' | 'EE' | 'LT';
export interface StoryEvidence {
  title: string;
  unit: string;
  kind: 'countries' | 'periods';
  points: (PublishedObservation & { geography: EvidenceCountry })[];
  minimum: number;
  maximum: number;
}

function isCountry(value: string): value is EvidenceCountry {
  return value === 'LV' || value === 'EE' || value === 'LT';
}

/** Only the article's frozen, source-bound observations may illustrate its finding. */
export function storyEvidence(article: Article): StoryEvidence | null {
  if (article.tier !== 'A' || !isServable(article) || article.corrections?.length || article.format) return null;
  const observations = article.provenance.published_observations;
  if (!Array.isArray(observations)) return null;
  const own = observations.filter(point => point && point.article_id === article.id && point.slug === article.slug
    && point.signal_id === article.provenance.signal_id && Number.isFinite(point.value));
  const summaries = own.filter(point => point.summary === true);
  if (summaries.length !== 1) return null;
  const primary = summaries[0];
  if (!primary.metric || !primary.period) return null;
  const raw = own.filter((point): point is PublishedObservation & { geography: EvidenceCountry } =>
    point.raw_source === true && point.metric === primary.metric && isCountry(point.geography)
    && typeof point.period === 'string' && Boolean(point.period) && Boolean(point.metric_label) && Boolean(point.unit)
    && article.provenance.sources.some(source => source.source_id === point.source_id
      && (source.dataset ?? null) === point.dataset));
  if (!raw.length) return null;

  // A unit or source mismatch is not permission to choose a convenient slice.
  const definitions = new Set(raw.map(point => JSON.stringify([point.metric_label, point.unit, point.source_id, point.dataset])));
  if (definitions.size !== 1) return null;
  const unique = new Map<string, typeof raw[number]>();
  for (const point of raw) {
    const key = `${point.geography}:${point.period}`;
    if (unique.has(key) && unique.get(key)!.value !== point.value) return null;
    unique.set(key, point);
  }
  let points: typeof raw;
  let kind: StoryEvidence['kind'];
  if (isCountry(primary.geography) && primary.raw_source) {
    const cadence = cadenceOf(primary.period) ?? (/^\d{4}-\d{2}-\d{2}$/.test(primary.period) ? 'D' : null);
    if (!cadence) return null;
    points = [...unique.values()].filter(point => point.geography === primary.geography
      && point.period <= primary.period
      && (cadenceOf(point.period) ?? (/^\d{4}-\d{2}-\d{2}$/.test(point.period) ? 'D' : null)) === cadence)
      .sort((a, b) => a.period.localeCompare(b.period)).slice(-2);
    if (!points.some(point => point.period === primary.period && point.value === primary.value)) return null;
    kind = 'periods';
  } else if (primary.geography === 'Baltic') {
    points = [...unique.values()].filter(point => point.period === primary.period)
      .sort((a, b) => ['LV', 'EE', 'LT'].indexOf(a.geography) - ['LV', 'EE', 'LT'].indexOf(b.geography));
    kind = 'countries';
  } else {
    return null;
  }
  if (points.length < 2) return null;
  const minimum = Math.min(0, ...points.map(point => point.value));
  const maximum = Math.max(0, ...points.map(point => point.value));
  if (!Number.isFinite(maximum - minimum)) return null;
  return { title: raw[0].metric_label, unit: raw[0].unit, kind, points, minimum, maximum: maximum === minimum ? minimum + 1 : maximum };
}
