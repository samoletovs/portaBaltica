// ─── Feed snippets are HTML, not text ───
//
// An RSS <description> is allowed to contain markup, and most outlets use it:
// EUobserver ships a wrapped <img> thumbnail before a single word of prose. We
// render the snippet as text, so a reader saw the literal tag soup —
// `<div><img width="600" src="..." srcset="..." />` — filling the sidebar
// before the sentence began.
//
// The fix is to take the text content, which is what "the summary they
// published" always meant. This is emphatically not a rewrite: no word is
// changed, reordered, paraphrased or added. Tags are removed, entities are
// decoded, whitespace is collapsed. The remaining prose is byte-for-byte the
// publisher's own, which is the only thing tier C permits us to show.
//
// Rendering markup rather than stripping it was never an option. Injecting a
// third party's HTML into our page would hand an untrusted feed control of our
// DOM, and feed items are treated as hostile input everywhere else in this
// system.

/** Block-level tags whose boundaries are meaningful as a space. */
const BLOCK_BOUNDARY = /<\/?(p|div|br|li|tr|h[1-6]|blockquote|section)\b[^>]*>/gi;

/** Elements whose *content* is not prose and must not survive stripping. */
const NON_PROSE = /<(script|style|iframe|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

const ANY_TAG = /<[^>]*>/g;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) && point > 0 && point < 0x10ffff
        ? String.fromCodePoint(point)
        : '';
    })
    .replace(/&[a-z]+;|&#39;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

/**
 * Reduces a feed snippet to the publisher's own prose.
 *
 * Returns an empty string when the snippet carried no prose at all — an
 * image-only description, which several outlets publish. The card renders no
 * quotation in that case rather than an empty pair of quote marks.
 */
export function snippetText(raw: string | undefined | null): string {
  if (!raw) return '';

  const text = raw
    .replace(NON_PROSE, ' ')
    .replace(BLOCK_BOUNDARY, ' ')
    .replace(ANY_TAG, '')
    .replace(/\s+/g, ' ')
    .trim();

  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/**
 * Trims to a whole word near `limit` characters.
 *
 * Some feeds publish several hundred words in the description. Tier C is
 * "headline plus the outlet's own short summary", and an item that fills a
 * screen stops being a pointer and starts competing with the reporting it is
 * supposed to send people to. Cutting at a word boundary and marking the cut
 * with an ellipsis keeps every printed word the publisher's own.
 */
export function clampSnippet(text: string, limit = 220): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : limit).trimEnd()}…`;
}
