// ─── Reading published articles ───
//
// The browser only ever reads finished static JSON. Generation happens on a
// timer in a Function that holds the managed identity; nothing here needs a
// credential, a key or a token, which is the entire reason the pipeline is
// batch rather than per-request. If this module ever needs a secret, something
// upstream has gone wrong.
//
// Default base is same-origin `/articles`, which the Static Web App maps onto
// the public blob container. `VITE_ARTICLES_BASE_URL` overrides it for local
// development against a fixture directory.

import type { Article, ArticleIndex, ArticleSummary } from './news-types';
import { isServable } from './news-types';

const BASE = (import.meta.env.VITE_ARTICLES_BASE_URL ?? '/articles').replace(/\/$/, '');

/** Mirrors the `slug` pattern in newsroom/schemas/article.schema.json. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * States that may appear on the front page.
 *
 * An allow list rather than a deny list, so a state this build has never heard
 * of is withheld rather than shown. `retracted`, `rejected`, `draft` and
 * `pending_approval` are all absent by construction.
 *
 * `corrected` is here for the same reason `api/shared/newsroom.js` allows it:
 * an amended article is reader-facing, and hiding it would suppress the
 * correction while leaving the record of the error. The pipeline does not
 * currently write that status — `revisions.py` deliberately keeps a corrected
 * article `published`, because both this gate and `is_servable` require it —
 * so the entry is forward-looking rather than load-bearing today.
 */
const SHOWABLE_STATUSES: readonly string[] = ['published', 'corrected'];

/**
 * Feed-level fail-closed check.
 *
 * The index carries summaries, which have no validator verdict of their own —
 * the pipeline only writes published items into it. That is a guarantee we
 * decline to take on trust, so a summary must still be structurally coherent
 * for its tier before it is allowed onto the page: tier A needs a byline,
 * tier C needs its attribution and its outbound link. Anything else is dropped
 * silently rather than rendered half-formed.
 */
export function isRenderableSummary(value: unknown): value is ArticleSummary {
  if (!isRecord(value)) return false;
  const { slug, headline, tier, section } = value;
  if (typeof slug !== 'string' || !isValidSlug(slug)) return false;
  if (typeof headline !== 'string' || headline.length === 0) return false;
  if (typeof section !== 'string') return false;
  if (tier !== 'A' && tier !== 'B' && tier !== 'C') return false;

  // An allow list, so an unrecognised state is withheld rather than shown.
  //
  // `drop_from_index` removes a retracted article, so in the ordinary case no
  // entry here is anything but `published`. This is the second lock: if that
  // removal ever half-fails — a transient blob error between writing the
  // article and rebuilding the index — the stale entry is what remains, and
  // the front page would carry a headline we have publicly withdrawn.
  //
  // The check is skipped when the field is absent, because entries written
  // before it existed are servable and must not vanish. It is deliberately the
  // same shape as `ourArticles` in `api/shared/newsroom.js`, which guards the
  // feeds: two surfaces read this index, and a rule that holds on one of them
  // is not a rule.
  if (typeof value.status === 'string' && !SHOWABLE_STATUSES.includes(value.status)) {
    return false;
  }

  if (tier === 'A') {
    const persona = value.persona;
    if (!isRecord(persona)) return false;
    if (typeof persona.name !== 'string' || persona.name.length === 0) return false;
  }

  if (tier === 'B' || tier === 'C') {
    const syndicated = value.syndicated;
    if (!isRecord(syndicated)) return false;
    if (typeof syndicated.attribution !== 'string' || syndicated.attribution.length === 0) return false;
    if (typeof syndicated.original_url !== 'string' || syndicated.original_url.length === 0) return false;
  }

  return true;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

export async function fetchArticleIndex(signal?: AbortSignal): Promise<ArticleIndex> {
  const raw = await getJson(`${BASE}/index.json`, signal);
  if (!isRecord(raw) || !Array.isArray(raw.articles)) {
    return { generated_at: '', count: 0, articles: [] };
  }
  const articles = raw.articles.filter(isRenderableSummary);
  return {
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
    count: articles.length,
    articles,
  };
}

/**
 * The weekly reviews, newest first.
 *
 * `format` answers what KIND of piece this is, as against what it is about,
 * and the newsroom writes it onto the summary precisely so a feed can find a
 * digest without reading the body. Selecting on it is therefore reading a
 * declared field, not inferring one — which is the difference between this and
 * matching the headline or the section, both of which the first weekly wrap
 * proved cannot tell a cross-beat digest from an ordinary maritime report.
 *
 * Returns an empty array when there is no wrap, and the caller must render that
 * as nothing rather than as an empty shell. Today it is the live state: the one
 * wrap ever published was retracted, so there is no current weekly review at
 * all, and a page that filled that hole with a placeholder would be inventing
 * an artefact we do not have.
 */
export function weeklyWraps(articles: readonly ArticleSummary[]): ArticleSummary[] {
  return articles
    .filter((article) => article.format === 'weekly_wrap')
    .slice()
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
}

/**
 * What the last weekly run did, as the run itself recorded it.
 *
 * `weekly.py` writes this to `runs/weekly-latest.json` on every run, whatever
 * the outcome, and its own comment says why: "a weekly cron that never fires and
 * a week with nothing worth wrapping produce the same artefact", so the report
 * exists to tell those two apart. Nothing read it. It was written by one file
 * and consumed by nobody — the answer was computed and dropped at the seam.
 */
export interface WeeklyRunReport {
  /** `published`, `not_enough_findings` or `draft_refused`. */
  outcome: string;
  /** ISO instant the run finished. */
  finishedAt: string;
  /** The wrap's slug, when one was published. */
  slug: string;
}

/**
 * A weekly review is due every seven days, and this allows one more.
 *
 * The timer is `0 0 15 * * 0` — Sundays at 15:00Z — so two consecutive reports
 * are seven days apart. A report older than eight days means a scheduled Sunday
 * came and went and left no record at all: not a wrap, and not even a run
 * saying it declined to write one. The extra day is slack for a late or retried
 * run, so an alarm means a missed week rather than a slow afternoon.
 */
export const WEEKLY_REVIEW_OVERDUE_DAYS = 8;

export async function fetchWeeklyReport(signal?: AbortSignal): Promise<WeeklyRunReport | null> {
  const raw = await getJson(`${BASE}/runs/weekly-latest.json`, signal);
  // `getJson` returns null on 404 and throws on anything else, and both are
  // handled here rather than being allowed to look like an outcome. A report we
  // cannot read must not become a claim about what the newsroom did.
  if (!isRecord(raw)) return null;
  if (typeof raw.outcome !== 'string' || !raw.outcome) return null;
  if (typeof raw.finished_at !== 'string' || !raw.finished_at) return null;
  return {
    outcome: raw.outcome,
    finishedAt: raw.finished_at,
    slug: typeof raw.slug === 'string' ? raw.slug : '',
  };
}

/**
 * Why there is no weekly review to show, distinguished rather than guessed.
 *
 * The page already keeps "we do not know yet", "we could not find out" and
 * "there is none" apart, and says so in its own docblock. It collapsed a fourth
 * distinction inside the last of those: **we ran and found nothing** and **we
 * never ran** rendered the same sentence. That is the same failure the file was
 * built to avoid, one axis over — and it is the one that matters here, because
 * a cron that silently stops produces a page that reads exactly like a quiet
 * week, forever.
 *
 * `unknown` is the honest default and every unreadable case lands on it. An
 * absent or illegible report must never resolve to a statement about the
 * newsroom's editorial decisions.
 */
export type WeeklyAbsence =
  | { reason: 'unknown' }
  | { reason: 'withdrawn' }
  | { reason: 'nothing-to-review' }
  | { reason: 'not-run'; since: string };

export function explainNoReview(
  report: WeeklyRunReport | null,
  now: Date = new Date(),
): WeeklyAbsence {
  if (!report) return { reason: 'unknown' };

  const finished = Date.parse(report.finishedAt);
  if (Number.isNaN(finished)) return { reason: 'unknown' };

  const days = (now.getTime() - finished) / 86_400_000;
  // A report stamped ahead of the reader -- clock skew between the Function App
  // and a browser -- gives a negative age, which is not greater than the
  // threshold and so cannot raise the alarm. Stated because the arithmetic is
  // what makes it safe rather than a guard: `>` on a negative number is the
  // whole defence, and rewriting this as `Math.abs` would break it silently.
  //
  // That sentence was a claim about behaviour that nothing executed, which is
  // what `AGENTS.md` warns about for examples in guidance -- and it was wrong
  // about "silently" only because nobody had tried. `Math.abs` here leaves 14 of
  // 14 tests green. It is now pinned by "is not fooled by a clock further ahead
  // than the whole allowance" in `tests/weeklyRunReport.test.tsx`, which needs a
  // skew larger than the allowance to tell the two apart: the obvious one-hour
  // case cannot fail the mutation it looks like it is about.
  if (days > WEEKLY_REVIEW_OVERDUE_DAYS) {
    return { reason: 'not-run', since: report.finishedAt };
  }

  // The run published one and the reader cannot see it. The only way that
  // happens is a withdrawal: `drop_from_index` removes a retracted article, so
  // the index no longer carries it while the run report still says it went out.
  // Stated as fact here, where the page previously offered it as one half of a
  // guess.
  if (report.outcome === 'published') return { reason: 'withdrawn' };

  return { reason: 'nothing-to-review' };
}

/**
 * One entry in the public corrections log.
 *
 * Flattened from `Article.corrections` by the pipeline into an append-only
 * `corrections.json` so the log can be read without fetching every article.
 * Absent until the first correction is ever issued, which is why a 404 here is
 * an empty log rather than an error.
 */
export interface CorrectionLogEntry {
  slug: string;
  headline: string;
  corrected_at: string;
  description: string;
  previous_value?: string;
}

function isCorrectionEntry(value: unknown): value is CorrectionLogEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.slug === 'string' &&
    isValidSlug(value.slug) &&
    typeof value.headline === 'string' &&
    typeof value.corrected_at === 'string' &&
    typeof value.description === 'string'
  );
}

export async function fetchCorrections(signal?: AbortSignal): Promise<CorrectionLogEntry[]> {
  const raw = await getJson(`${BASE}/corrections.json`, signal);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isCorrectionEntry)
    .sort((a, b) => b.corrected_at.localeCompare(a.corrected_at));
}

/**
 * Which articles carry a correction, for a surface that lists headlines.
 *
 * WHY THE LOG AND NOT THE INDEX
 * -----------------------------
 * The obvious place for this is `ArticleSummary`, written by `write_index`. It
 * would mark nothing. A correction is applied by `apply_correction_note` in
 * `newsroom/pipeline/revisions.py`, which writes `<slug>.json` and appends to
 * `corrections.json` and NEVER TOUCHES `index.json` — and `write_index` merges
 * pre-existing index entries verbatim, so no later run retrofits a field onto
 * them either. Measured against production on 2026-09-01: 16 of the 20
 * feed-visible correction entries were applied more than five minutes before
 * the index was last written, the oldest four days earlier and many index
 * rewrites ago, and 0 of 93 entries carried anything about a correction.
 *
 * So a summary field marks 0 of 18 today and goes on marking 0. The log is the
 * only store that has the answer, it is already public, and reading it here
 * means the feed and `/corrections` cannot disagree about who was corrected —
 * they are the same file.
 *
 * A SET OF SLUGS, DELIBERATELY, RATHER THAN A COUNT
 * ------------------------------------------------
 * The log counts entries and the feed marks articles: 28 entries over 25 slugs.
 * They are different populations and are supposed to differ, so nothing here
 * should tempt a caller into showing "corrected twice". That is a fact about
 * our process rather than about the claim a reader is looking at, and it does
 * not survive contact with the log — one of the three doubly-corrected articles
 * is doubly-corrected because we corrected our own correction, which a "2"
 * would present to a reader as two errors.
 */
export function correctedSlugs(entries: readonly CorrectionLogEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.slug));
}

/**
 * What a headline-listing surface knows about which articles were corrected.
 *
 * Three states rather than a set that is empty when we could not find out. An
 * unmarked card would otherwise mean either "not corrected" or "we could not
 * read the log", which is one artefact for two states — and the second is the
 * dangerous one, because the entire point of the marker is that a reader who
 * sees none concludes the headline stands.
 *
 * Note that a 404 is `ok`, not `failed`. `fetchCorrections` returns an empty
 * array for it, because the log genuinely does not exist until the first
 * correction is ever issued — "none have been issued" is an answer, not a
 * failure to get one.
 */
export type CorrectionState =
  | { state: 'loading' }
  | { state: 'ok'; slugs: Set<string> }
  | { state: 'failed' };

export type ArticleLoad =
  | { state: 'ok'; article: Article }
  | { state: 'not-found' }
  /**
   * Withdrawn by us, after publication, and still readable at its own URL.
   *
   * A distinct state because a retracted article is not an unservable one and
   * the difference is the whole of the corrections policy. It passed every
   * check and was published; we withdrew it later for an editorial fault. The
   * `not-servable` copy — "it has not passed the checks we run before
   * publishing" — is therefore false about it, and false in the direction that
   * flatters us, on the one page a sceptical reader goes to in order to check
   * whether we admit mistakes.
   *
   * `isServable` stays exactly as strict. It answers "may this be presented as
   * journalism", which is still no. This answers a different question: "may
   * this be shown at its own URL, marked as withdrawn", which the published
   * policy answers yes — "the page stays up, showing why. We do not delete the
   * evidence."
   */
  | { state: 'retracted'; article: Article }
  /** Reached the client but has no passing validator verdict. Never rendered. */
  | { state: 'not-servable' };

/**
 * Loads one article and applies the render-time gate before handing it back.
 *
 * The gate is applied again in the view, deliberately. Two independent checks
 * on the same rule is the cheapest insurance there is against one of them
 * being removed by someone who did not know why it was there.
 */
export async function loadArticle(slug: string, signal?: AbortSignal): Promise<ArticleLoad> {
  if (!isValidSlug(slug)) return { state: 'not-found' };

  const raw = await getJson(`${BASE}/${slug}.json`, signal);
  if (raw === null) return { state: 'not-found' };
  if (!isRecord(raw)) return { state: 'not-servable' };

  const article = raw as unknown as Article;
  // A retracted article is withdrawn, not unservable. It still needs a passing
  // verdict to be shown at all — a draft that was never published does not
  // become readable by being marked retracted — but given one it goes to the
  // reader carrying its notice, because that is what the corrections policy
  // promises and it is the only page that promise is ever tested on.
  if (article.status === 'retracted' && article.provenance?.validator?.passed === true) {
    return { state: 'retracted', article };
  }
  if (!isServable(article)) return { state: 'not-servable' };
  return { state: 'ok', article };
}
