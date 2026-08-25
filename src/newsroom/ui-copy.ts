// ─── House style for the site's own words ───
//
// newsroom/style.md governs articles. It should govern the pages around them
// too: a reader cannot tell which words came from the pipeline and which from
// a component, and should not have to.
//
// This module extracts the strings a reader can actually see from a component
// source file, so a test can hold them to the same standard. It is not a lint
// rule about code — class names, import paths and identifiers are not prose and
// are deliberately excluded.

/** Guardian style is an en dash, used sparingly. The em dash is the AI tell. */
export const EM_DASH = '\u2014';

/** The register we already reject in generated articles. */
export const GENERATED_TELLS = [
  'it is worth noting',
  'it is important to note',
  'moreover,',
  'furthermore,',
  'in conclusion',
  'a testament to',
  'plays a crucial role',
  'plays a vital role',
  'underscores the importance',
  'ever-evolving',
  'in today’s',
  "in today's",
  'delve into',
];

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

/** Tailwind soup, import specifiers and other non-prose string literals. */
function isProse(value: string): boolean {
  const text = value.trim();
  if (text.length < 12) return false;
  if (!/\s/.test(text)) return false;
  // Class lists: many short tokens, no sentence punctuation.
  if (/^[a-z0-9:/[\]().,%_-]+$/.test(text) && !/[.!?]/.test(text)) return false;
  if (/^[.@/]|^https?:/.test(text)) return false;
  if (/^[a-z-]+(\s+[a-z0-9:/[\]().%_-]+)+$/.test(text) && !/[A-Z]/.test(text)) return false;
  // Needs at least two word-like runs. They need not be adjacent: a title such
  // as "Corrections | portaBaltica" is prose a reader sees, and an earlier
  // version of this check missed it because a separator sat between the words.
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  return words.length >= 2;
}

/**
 * Strings from a component that a reader could see.
 *
 * Takes JSX text nodes and quoted literals, minus comments. Imperfect by
 * nature — it errs toward including a little too much, which is the safe
 * direction for a style check.
 */
export function visibleStrings(source: string): string[] {
  const withoutComments = source.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, ' ');

  const found: string[] = [];

  // Quoted literals, including template literals.
  for (const match of withoutComments.matchAll(/'([^'\\\n]{12,})'|"([^"\\\n]{12,})"|`([^`\\]{12,})`/g)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (isProse(value)) found.push(value);
  }

  // JSX text nodes: between > and < with no braces or tags.
  for (const match of withoutComments.matchAll(/>([^<>{}]{12,})</g)) {
    const value = match[1].replace(/\s+/g, ' ');
    if (isProse(value)) found.push(value);
  }

  return found;
}

/** Style problems in reader-visible copy. */
export function checkUiCopy(strings: string[]): string[] {
  const problems: string[] = [];

  for (const text of strings) {
    const lowered = text.toLowerCase();
    for (const tell of GENERATED_TELLS) {
      if (lowered.includes(tell)) {
        problems.push(`reads as unedited, '${tell}': ${text.slice(0, 60)}`);
      }
    }
  }

  return problems;
}
